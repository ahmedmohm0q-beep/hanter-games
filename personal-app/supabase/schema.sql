-- تطبيق تطوّري الشخصي: مالك واحد، وحالة واحدة لكل مالك، وحفظ بشرط الإصدار.
-- شغّل هذا الملف مرة واحدة في SQL Editor بمشروع Supabase الخاص بك (مشروع جديد مخصص للتطبيق).
-- ملاحظة: لم يُختبر هذا الملف على خادم Postgres حقيقي من داخل بيئة البناء (لا يوجد خادم متاح هناك).

-- 1) المالك: صف واحد فقط يشير إلى المستخدم المالك.
create table if not exists public.app_owner (
  user_id uuid primary key references auth.users (id) on delete cascade
);
-- يمنع أي صف ثانٍ، فيبقى مالك واحد مهما حدث.
create unique index if not exists app_owner_single_row on public.app_owner ((true));

-- 2) الحالة: كائن JSON كامل لكل مالك + إصدار + معرّف آخر طلب (لمنع التكرار).
create table if not exists public.user_state (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  last_request_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.app_owner enable row level security;
alter table public.user_state enable row level security;

-- لا وصول مباشر لجدول المالك من المتصفح.
revoke all on public.app_owner from anon, authenticated;

-- 3) دالة التحقق من المالك. تعمل بصلاحيات منشئها لقراءة app_owner فقط.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_owner o where o.user_id = auth.uid());
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- 4) سياسة القراءة: المالك فقط، ولصفه فقط.
drop policy if exists user_state_owner_select on public.user_state;
create policy user_state_owner_select on public.user_state
  for select to authenticated
  using (owner_id = auth.uid() and public.is_owner());

-- لا سياسات كتابة مباشرة: الكتابة عبر الدالة فقط.
revoke all on public.user_state from anon, authenticated;
grant select on public.user_state to authenticated;

-- 5) الحفظ: يرفض الكتابة إذا تغيّر الإصدار في السحابة (تعارض بين جهازين).
--    وإذا وصل نفس معرّف الطلب مرة أخرى (إعادة محاولة) يُرجع الإصدار دون كتابة.
create or replace function public.save_user_state(
  p_expected_version integer,
  p_state jsonb,
  p_request_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.user_state%rowtype;
  uid uuid := auth.uid();
  next_version integer;
begin
  if uid is null or not public.is_owner() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    raise exception 'invalid state' using errcode = '22023';
  end if;
  if pg_column_size(p_state) > 8000000 then
    raise exception 'state too large' using errcode = '54000';
  end if;

  select * into rec from public.user_state where owner_id = uid for update;

  if found and rec.last_request_id = p_request_id then
    return rec.version;
  end if;

  if coalesce(rec.version, 0) <> p_expected_version then
    raise exception 'version conflict' using errcode = 'P0409';
  end if;

  next_version := coalesce(rec.version, 0) + 1;

  insert into public.user_state (owner_id, state, version, last_request_id, updated_at)
  values (uid, p_state, next_version, p_request_id, now())
  on conflict (owner_id) do update
    set state = excluded.state,
        version = excluded.version,
        last_request_id = excluded.last_request_id,
        updated_at = excluded.updated_at;

  return next_version;
end;
$$;

revoke all on function public.save_user_state(integer, jsonb, uuid) from public, anon;
grant execute on function public.save_user_state(integer, jsonb, uuid) to authenticated;

-- الخطوات بعد التشغيل (تُنفَّذ يدويًا مرة واحدة):
-- أ) Authentication → Users: أنشئ المستخدم المالك بالبريد وكلمة المرور من لوحة المشروع.
-- ب) انسخ معرّفه (UUID) ثم شغّل:
--    insert into public.app_owner (user_id) values ('<UUID-الخاص-بك>');
-- ج) Authentication → Sign In / Providers: أوقف التسجيل العام (Allow new users to sign up).
