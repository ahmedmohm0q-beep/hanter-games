#!/usr/bin/env bash
# Builds dist-preview/index.html with Bun (no npm install needed). Requires react/react-dom resolvable.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
bun build src/main.tsx --outdir "$OUT" --target browser --minify --external @supabase/supabase-js --define 'process.env.NODE_ENV="production"'
node scripts/build-preview.mjs "$OUT"
