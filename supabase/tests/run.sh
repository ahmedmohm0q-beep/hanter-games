#!/usr/bin/env bash
# Runs the migration + behaviour tests on a throwaway local Postgres (NOT on Supabase).
# Requires: psql connection to an empty database via PG* env vars, e.g.
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-hgtest}
psql -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/shim.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"; done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/seed.sql
psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/rls_and_integrity.sql
