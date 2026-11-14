\set ON_ERROR_STOP 1
-- إعداد: مستخدمان، والمالك هو الأول فقط
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test'),
  ('22222222-2222-2222-2222-222222222222', 'other@test');
INSERT INTO public.app_owner (user_id) VALUES ('11111111-1111-1111-1111-111111111111');

-- T2..T5: المالك يحفظ، وإعادة نفس الطلب لا تكتب، والإصدار الخاطئ يُرفض
DO $$ DECLARE v int; BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
  SET ROLE authenticated;
  SELECT public.save_user_state(0, '{"schemaVersion":1,"n":1}', 'aaaaaaaa-0000-0000-0000-000000000001') INTO v;
  IF v <> 1 THEN RAISE EXCEPTION 'T2 expected version 1, got %', v; END IF;
  SELECT public.save_user_state(0, '{"schemaVersion":1,"n":1}', 'aaaaaaaa-0000-0000-0000-000000000001') INTO v;
  IF v <> 1 THEN RAISE EXCEPTION 'T3 retry expected 1, got %', v; END IF;
  SELECT version INTO v FROM public.user_state;
  IF v <> 1 THEN RAISE EXCEPTION 'T3b retry must not write, version=%', v; END IF;
  BEGIN
    PERFORM public.save_user_state(0, '{"x":1}', 'aaaaaaaa-0000-0000-0000-000000000002');
    RAISE EXCEPTION 'T4 stale version was accepted';
  EXCEPTION WHEN sqlstate 'P0409' THEN NULL;
  END;
  SELECT public.save_user_state(1, '{"n":2}', 'aaaaaaaa-0000-0000-0000-000000000003') INTO v;
  IF v <> 2 THEN RAISE EXCEPTION 'T5 expected 2, got %', v; END IF;
  RESET ROLE;
  RAISE NOTICE 'T2-T5 owner save/dedupe/conflict: OK';
END $$;

-- T6..T8: مستخدم آخر لا يقرأ ولا يكتب بيانات المالك
DO $$ DECLARE cnt int; BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', false);
  SET ROLE authenticated;
  SELECT count(*) INTO cnt FROM public.user_state;
  IF cnt <> 0 THEN RAISE EXCEPTION 'T7 RLS leak: other user sees % rows', cnt; END IF;
  BEGIN
    PERFORM public.save_user_state(0, '{}', 'bbbbbbbb-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'T6 non-owner wrote through function';
  EXCEPTION WHEN sqlstate '42501' THEN NULL;
  END;
  BEGIN
    INSERT INTO public.user_state (owner_id, state, version) VALUES ('22222222-2222-2222-2222-222222222222', '{}', 0);
    RAISE EXCEPTION 'T8 direct insert allowed for authenticated';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'T6-T8 non-owner isolation: OK';
END $$;

-- T9..T10: المجهول (anon) لا يصل لأي شيء
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', '', false);
  SET ROLE anon;
  BEGIN
    PERFORM 1 FROM public.user_state;
    RAISE EXCEPTION 'T9 anon can read user_state';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.save_user_state(0, '{}', 'cccccccc-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'T10 anon can call save';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'T9-T10 anon denied: OK';
END $$;

-- T11: لا يوجد إلا مالك واحد
DO $$ BEGIN
  BEGIN
    INSERT INTO public.app_owner (user_id) VALUES ('22222222-2222-2222-2222-222222222222');
    RAISE EXCEPTION 'T11 second owner row allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'T11 single owner: OK';
END $$;

-- T12: الحالة يجب أن تكون كائن JSON
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', false);
  SET ROLE authenticated;
  BEGIN
    PERFORM public.save_user_state(1, '[1,2]', 'dddddddd-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'T12 array payload accepted';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'T12 payload shape: OK';
END $$;

DO $$ BEGIN RAISE NOTICE 'ALL SQL TESTS PASSED'; END $$;
