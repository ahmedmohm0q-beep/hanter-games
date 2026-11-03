-- HANTER GAMES — initial schema
-- Principles:
--   * every user-owned row has user_id = auth.uid(), enforced by RLS on every table
--   * composite foreign keys (id, user_id) make cross-owner links impossible
--   * goals cannot form cycles (trigger)
--   * optimistic concurrency: an UPDATE must carry the version it was based on;
--     a stale version raises 'version_conflict' instead of silently overwriting
--   * idempotent retries: a repeated mutation id is a no-op
--   * soft delete (deleted_at) keeps history and lets other devices sync deletions

create extension if not exists pgcrypto;

-- ---------- shared trigger functions ----------

create or replace function public.hg_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.updated_at := now();
    return new;
  end if;
  -- retry of a mutation that already applied → no-op (idempotency)
  if new.last_mutation_id is not null and new.last_mutation_id = old.last_mutation_id then
    return old;
  end if;
  if new.version is distinct from old.version then
    raise exception 'version_conflict' using errcode = 'P0409',
      detail = format('row %s is at version %s, update was based on %s', old.id, old.version, new.version);
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'owner_change_forbidden' using errcode = '42501';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- macro-ish helper columns are repeated per table for clarity.

-- ---------- settings ----------
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  locale text not null default 'ar' check (locale in ('ar','en')),
  theme text not null default 'dark' check (theme in ('dark','light','system')),
  week_starts_on smallint not null default 6 check (week_starts_on between 0 and 6),
  time_zone text not null default 'Asia/Dubai',
  reduced_motion text not null default 'system' check (reduced_motion in ('system','on','off')),
  sound boolean not null default false,
  gamification boolean not null default true,
  trend jsonb not null default '{"windowDays":14,"improveThresholdPP":5,"declineThresholdPP":-5,"minDue":6,"minCoverage":0.6}',
  reminders jsonb not null default '{"enabled":false,"quietStart":"22:00","quietEnd":"07:00","maxPerDay":3}',
  active_plan_year_id uuid,
  onboarded boolean not null default false,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  unique (user_id)
);

-- ---------- plan years ----------
create table public.plan_years (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text not null default '',
  start_date date not null,
  archived boolean not null default false,
  start_history jsonb not null default '[]',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  unique (id, user_id)
);

-- ---------- goals ----------
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_year_id uuid not null,
  parent_id uuid,
  level text not null check (level in ('year','half','month','week')),
  kind text not null default 'outcome' check (kind in ('outcome','milestone')),
  title text not null check (length(title) between 1 and 300),
  description text not null default '',
  start_date date not null,
  deadline date,
  deadline_time time,
  deadline_time_zone text,
  success_metric jsonb not null default '{"measure":{"type":"binary"},"target":1}',
  priority smallint not null default 2 check (priority between 1 and 3),
  weight numeric check (weight is null or weight > 0),
  status text not null default 'active' check (status in ('active','done','paused','archived')),
  notes text not null default '',
  sort_order integer not null default 0,
  period_start date,
  weekly_capacity_hours numeric check (weekly_capacity_hours is null or weekly_capacity_hours >= 0),
  deadline_history jsonb not null default '[]',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  unique (id, user_id),
  foreign key (plan_year_id, user_id) references public.plan_years(id, user_id),
  foreign key (parent_id, user_id) references public.goals(id, user_id),
  check (parent_id is null or parent_id <> id),
  check (deadline is null or deadline >= start_date)
);
create index goals_parent_idx on public.goals(user_id, parent_id);
create index goals_year_idx on public.goals(user_id, plan_year_id);

create or replace function public.hg_goal_no_cycle()
returns trigger language plpgsql set search_path = '' as $$
declare cur uuid := new.parent_id; depth int := 0;
begin
  while cur is not null loop
    if cur = new.id then
      raise exception 'goal_cycle' using errcode = '23514';
    end if;
    select g.parent_id into cur from public.goals g where g.id = cur;
    depth := depth + 1;
    if depth > 1000 then raise exception 'goal_depth_exceeded'; end if;
  end loop;
  return new;
end $$;

-- ---------- goal points (fears / benefits / obstacles) ----------
create table public.goal_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null,
  box text not null check (box in ('fears','benefits','obstacles')),
  text text not null default '' check (length(text) <= 2000),
  if_then text not null default '',
  next_step text not null default '',
  sort_order integer not null default 0,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  foreign key (goal_id, user_id) references public.goals(id, user_id)
);
create index goal_points_goal_idx on public.goal_points(user_id, goal_id);

-- ---------- habits & versioned schedules ----------
create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_ids uuid[] not null default '{}', -- validated by trigger (same owner)
  title text not null check (length(title) between 1 and 300),
  cue text not null default '',
  measure jsonb not null default '{"type":"binary"}',
  archived boolean not null default false,
  sort_order integer not null default 0,
  weight numeric check (weight is null or weight > 0),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  unique (id, user_id)
);

create or replace function public.hg_habit_goal_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from unnest(new.goal_ids) gid
    where not exists (select 1 from public.goals g where g.id = gid and g.user_id = new.user_id)
  ) then
    raise exception 'habit_goal_owner_mismatch' using errcode = '42501';
  end if;
  return new;
end $$;

create table public.habit_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null,
  effective_from date not null,
  rule jsonb not null,
  target numeric not null check (target > 0),
  minimum numeric check (minimum is null or minimum > 0),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  foreign key (habit_id, user_id) references public.habits(id, user_id),
  check (rule ? 'kind')
);
create index habit_schedules_idx on public.habit_schedules(user_id, habit_id, effective_from);

create table public.habit_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null,
  start_date date not null,
  end_date date not null,
  kind text not null check (kind in ('rest','pause')),
  note text not null default '',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  foreign key (habit_id, user_id) references public.habits(id, user_id),
  check (end_date > start_date)
);

-- ---------- tasks ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null,
  title text not null check (length(title) between 1 and 300),
  due_date date not null,
  measure jsonb not null default '{"type":"binary"}',
  target numeric not null default 1 check (target > 0),
  weight numeric check (weight is null or weight > 0),
  sort_order integer not null default 0,
  reschedule_history jsonb not null default '[]',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals(id, user_id)
);
create index tasks_due_idx on public.tasks(user_id, due_date);

-- ---------- logs (the single record of what was actually done) ----------
create table public.logs (
  id uuid primary key, -- generated on the client → retries are idempotent
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid,
  task_id uuid,
  date date not null,
  amount numeric not null default 0 check (amount >= 0),
  kind text not null default 'progress' check (kind in ('progress','skip')),
  note text not null default '' check (length(note) <= 2000),
  source text not null default 'manual' check (source in ('manual','timer','quick')),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  foreign key (habit_id, user_id) references public.habits(id, user_id),
  foreign key (task_id, user_id) references public.tasks(id, user_id),
  check ((habit_id is null) <> (task_id is null))
);
create index logs_date_idx on public.logs(user_id, date);

create table public.outcome_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null,
  date date not null,
  value numeric not null,
  note text not null default '',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  foreign key (goal_id, user_id) references public.goals(id, user_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('week','month')),
  period_start date not null,
  achieved text not null default '',
  blocker text not null default '',
  adjustment text not null default '',
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  unique (user_id, period_type, period_start)
);

-- XP ledger: one row per unique achievement; undo sets revoked_at, redo clears it.
create table public.reward_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_key text not null,
  xp integer not null check (xp >= 0),
  kind text not null,
  earned_on date not null,
  revoked_at timestamptz,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  unique (user_id, source_key)
);

-- Quote library (public, read-only to signed-in users) and per-user display log.
create table public.quotes (
  id text primary key,
  lang text not null check (lang in ('ar','en')),
  text text not null,
  translation text not null,
  translation_by text not null check (translation_by in ('app','published')),
  author text not null,
  author_alt text not null default '',
  work text not null,
  year text not null default '',
  source_url text not null,
  source_note text not null default '',
  verified_on date not null
);

create table public.quote_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  lang text not null check (lang in ('ar','en')),
  quote_id text not null references public.quotes(id),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_mutation_id uuid,
  unique (user_id, date, lang) -- first device to show a quote fixes it for every device
);

-- ---------- triggers ----------
do $$
declare t text;
begin
  foreach t in array array['settings','plan_years','goals','goal_points','habits','habit_schedules',
    'habit_exceptions','tasks','logs','outcome_results','reviews','reward_entitlements','quote_views'] loop
    execute format('create trigger %I_touch before insert or update on public.%I for each row execute function public.hg_touch()', t, t);
  end loop;
end $$;

create trigger goals_no_cycle before insert or update of parent_id on public.goals
  for each row execute function public.hg_goal_no_cycle();
create trigger habits_goal_owner before insert or update of goal_ids on public.habits
  for each row execute function public.hg_habit_goal_owner();

-- ---------- Row Level Security ----------
do $$
declare t text;
begin
  foreach t in array array['settings','plan_years','goals','goal_points','habits','habit_schedules',
    'habit_exceptions','tasks','logs','outcome_results','reviews','reward_entitlements','quote_views'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy "%1$s_select_own" on public.%1$I for select to authenticated using ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "%1$s_insert_own" on public.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "%1$s_update_own" on public.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)$p$, t);
    execute format($p$create policy "%1$s_delete_own" on public.%1$I for delete to authenticated using ((select auth.uid()) = user_id)$p$, t);
  end loop;
end $$;

alter table public.quotes enable row level security;
revoke all on public.quotes from anon;
grant select on public.quotes to authenticated;
create policy "quotes_read" on public.quotes for select to authenticated using (true);

-- ---------- realtime (cross-device updates) ----------
do $$
declare t text;
begin
  foreach t in array array['settings','plan_years','goals','goal_points','habits','habit_schedules',
    'habit_exceptions','tasks','logs','outcome_results','reviews','quote_views'] loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
exception when undefined_object then
  raise notice 'supabase_realtime publication not found; realtime disabled';
end $$;
