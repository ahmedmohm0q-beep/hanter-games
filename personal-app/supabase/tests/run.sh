#!/usr/bin/env bash
# يشغّل schema.sql واختبارات RLS على قاعدة Postgres فارغة (مثلًا محلية).
# الاستخدام: DATABASE_URL=postgres://... bash personal-app/supabase/tests/run.sh
# ملاحظة: 00-supabase-shim.sql يحاكي auth.uid() والأدوار لأن Postgres العادي لا يحتويها.
# على مشروع Supabase حقيقي لا تشغّل الشيم، وشغّل schema.sql فقط.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${DATABASE_URL:?set DATABASE_URL to an empty test database}"
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$here/00-supabase-shim.sql"
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$here/../schema.sql"
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$here/10-rls-and-versions.sql"
echo "ALL SUPABASE SQL TESTS PASSED"
