// Service Worker بسيط: يخزّن واجهة التطبيق (الملفات الثابتة) فقط.
// لا يخزّن أي بيانات مالية أو شخصية ولا استجابات Supabase، لأن البيانات تُقرأ دائمًا من الخادم أو من التخزين المحلي للتطبيق.
const VERSION = 'taawur-shell-v1';
const SHELL = [
  './',
  './index.html',
  './config.js',
  './css/app.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './src/main.js',
  './src/core/money.js',
  './src/core/dates.js',
  './src/core/levels.js',
  './src/core/state.js',
  './src/core/plan.js',
  './src/core/bank.js',
  './src/core/text.js',
  './src/core/growth.js',
  './src/core/finance.js',
  './src/core/finance-edit.js',
  './src/core/services.js',
  './src/core/backup.js',
  './src/data/cloud.js',
  './src/data/store.js',
  './src/ui/app.js',
  './src/ui/ctx.js',
  './src/ui/util.js',
  './src/ui/modal.js',
  './src/ui/run.js',
  './src/ui/pages/growth.js',
  './src/ui/pages/bank.js',
  './src/ui/pages/journey.js',
  './src/ui/pages/current.js',
  './src/ui/pages/money.js',
  './src/ui/pages/services.js',
  './src/ui/pages/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // لا نتدخل في طلبات Supabase أو أي نطاق خارجي.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
