#!/usr/bin/env bash
# يبني ملف HTML واحد يعمل بفتحه مباشرة من الجهاز (بدون خادم). الناتج: dist/tatawwur.html
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
npx --yes esbuild@0.25.12 src/main.js --bundle --format=iife --minify --target=es2020 --outfile=dist/app.bundle.js
python3 -I scripts/assemble-standalone.py "$PWD" "$PWD/dist"
rm -f dist/app.bundle.js
echo "built: $PWD/dist/tatawwur.html"
