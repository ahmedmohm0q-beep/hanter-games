// Builds a single-file preview (dist-preview/index.html) with Bun — used for the chat preview
// and for browser tests when npm/Vite are unavailable. Data is stored in the browser only.
// Usage: bun build src/main.tsx --outdir /tmp/hgbuild --target browser --minify --external @supabase/supabase-js \
//          --define 'process.env.NODE_ENV="production"' && node scripts/build-preview.mjs /tmp/hgbuild
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const dir = process.argv[2] ?? '/tmp/hgbuild';
const js = readFileSync(`${dir}/main.js`, 'utf8');
const css = readFileSync(`${dir}/main.css`, 'utf8');
const logo = readFileSync(new URL('../public/icons/logo.svg', import.meta.url), 'utf8');
const logoUri = `data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}`;
const html = `<!doctype html>
<html lang="ar" dir="rtl" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>HANTER GAMES</title>
<link rel="icon" href="${logoUri}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
<style>${css}</style>
<script>window.__HG_PREVIEW__ = true;</script>
</head>
<body>
<div id="root"></div>
<script type="module">${js.replaceAll('"icons/logo.svg"', JSON.stringify(logoUri)).replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>`;
const body = `<title>HANTER GAMES</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
<style>${css}</style>
<script>window.__HG_PREVIEW__ = true; document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl';</script>
<div id="root"></div>
<script type="module">${js.replaceAll('"icons/logo.svg"', JSON.stringify(logoUri)).replace(/<\/script/gi, '<\\/script')}</script>
`;
mkdirSync(new URL('../dist-preview', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist-preview/artifact.html', import.meta.url), body);
writeFileSync(new URL('../dist-preview/index.html', import.meta.url), html);
console.log(`dist-preview/index.html ${(html.length / 1024).toFixed(0)} KB`);
