-- Behavioural tests for the schema. Each block raises an exception on failure.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

insert into public.plan_years (id, start_date) values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-15');
insert into public.goals (id, plan_year_id, level, title, start_date, deadline)
  values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'year', 'Pass CMA Part 1', '2026-11-15', '2027-03-10');
insert into public.goals (id, plan_year_id, parent_id, level, title, start_date)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'half', 'H1', '2026-11-15');
insert into public.habits (id, title, goal_ids) values ('cccccccc-0000-0000-0000-000000000001', 'Study', '{bbbbbbbb-0000-0000-0000-000000000001}');

-- T1: goal cycle is rejected
do $$ begin
  update public.goals set parent_id = 'bbbbbbbb-0000-0000-0000-000000000002', version = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  raise exception 'T1 FAILED: cycle accepted';
exception when others then
  if sqlerrm <> 'goal_cycle' then raise; end if;
  raise notice 'T1 ok: cycle rejected';
end $$;

-- T2: idempotent log insert (client-generated id + mutation id retried)
insert into public.logs (id, habit_id, date, amount, last_mutation_id) values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-11-16', 1, 'eeeeeeee-0000-0000-0000-000000000001')
  on conflict (id) do update set amount = excluded.amount, version = public.logs.version, last_mutation_id = excluded.last_mutation_id;
insert into public.logs (id, habit_id, date, amount, last_mutation_id) values ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', '2026-11-16', 1, 'eeeeeeee-0000-0000-0000-000000000001')
  on conflict (id) do update set amount = excluded.amount, version = 1, last_mutation_id = excluded.last_mutation_id;
do $$ declare n int; v int; begin
  select count(*), max(version) into n, v from public.logs;
  if n <> 1 or v <> 1 then raise exception 'T2 FAILED: n=% v=%', n, v; end if;
  raise notice 'T2 ok: retry did not duplicate or bump version';
end $$;

-- T3: optimistic concurrency — device A and B both edit version 1
update public.goals set notes = 'from device A', version = 1, last_mutation_id = gen_random_uuid() where id = 'bbbbbbbb-0000-0000-0000-000000000002';
do $$ begin
  update public.goals set notes = 'from device B', version = 1, last_mutation_id = gen_random_uuid() where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  raise exception 'T3 FAILED: stale write accepted';
exception when others then
  if sqlerrm <> 'version_conflict' then raise; end if;
  raise notice 'T3 ok: stale write rejected (no silent loss)';
end $$;
do $$ declare n text; begin
  select notes into n from public.goals where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  if n <> 'from device A' then raise exception 'T3b FAILED: %', n; end if;
end $$;

-- Switch to user 2
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

-- T4: other account cannot read
do $$ declare n int; begin
  select (select count(*) from public.goals) + (select count(*) from public.logs) + (select count(*) from public.habits) into n;
  if n <> 0 then raise exception 'T4 FAILED: user 2 sees % rows', n; end if;
  raise notice 'T4 ok: other account reads nothing';
end $$;

-- T5: other account cannot update/delete (RLS filters → 0 rows)
do $$ declare n int; begin
  update public.goals set title = 'hacked' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T5 FAILED: updated %', n; end if;
  delete from public.logs;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T5 FAILED: deleted %', n; end if;
  raise notice 'T5 ok: other account cannot modify';
end $$;

-- T6: other account cannot insert rows owned by user 1
do $$ begin
  insert into public.plan_years (user_id, start_date) values ('11111111-1111-1111-1111-111111111111', '2026-01-01');
  raise exception 'T6 FAILED';
exception when insufficient_privilege then raise notice 'T6 ok: cannot write as another user';
end $$;

-- T7: other account cannot link its own rows to user 1's goal (composite FK)
insert into public.plan_years (id, start_date) values ('aaaaaaaa-0000-0000-0000-000000000002', '2026-11-15');
do $$ begin
  insert into public.goals (plan_year_id, parent_id, level, title, start_date)
    values ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'half', 'x', '2026-11-15');
  raise exception 'T7 FAILED';
exception when foreign_key_violation then raise notice 'T7 ok: cross-owner parent rejected';
end $$;
do $$ begin
  insert into public.habits (title, goal_ids) values ('x', '{bbbbbbbb-0000-0000-0000-000000000001}');
  raise exception 'T7b FAILED';
exception when insufficient_privilege then raise notice 'T7b ok: cross-owner habit link rejected';
end $$;

-- T8: anon has no access at all
reset role;
set role anon;
do $$ begin
  perform 1 from public.goals;
  raise exception 'T8 FAILED';
exception when insufficient_privilege then raise notice 'T8 ok: anon denied';
end $$;
reset role;
select 'ALL SQL TESTS PASSED' as result;
