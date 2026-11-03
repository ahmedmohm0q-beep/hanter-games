-- Fix: false "version_conflict" on the second edit of any row.
-- supabase-js upsert runs INSERT ... ON CONFLICT DO UPDATE. The BEFORE INSERT branch of
-- hg_touch() used to force version := 1, and EXCLUDED carries that rewritten value into
-- the UPDATE branch, so every update after the first looked stale. Now a real insert keeps
-- the client's version (minimum 1); the UPDATE branch still checks it against the stored row.
create or replace function public.hg_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.version is null or new.version < 1 then
      new.version := 1;
    end if;
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
