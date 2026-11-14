-- بديل مؤقت لطبقة Supabase: أدوار anon/authenticated وجدول auth.users ودالة auth.uid() من JWT.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT ((nullif(current_setting('request.jwt.claims', true), '')::json) ->> 'sub')::uuid
$$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
