// نقطة الدخول. لا تحتوي أي منطق أعمال، فقط تجميع الأجزاء.
import { createCloud } from './data/cloud.js';
import { AppStore } from './data/store.js';
import { ctx } from './ui/ctx.js';
import { renderApp, mountDispatchers } from './ui/app.js';
import { applyTheme, currentTheme } from './ui/theme.js';

applyTheme(currentTheme());

const cfg = window.PERSONAL_APP_CONFIG || {};
ctx.cloud = createCloud({ url: cfg.supabaseUrl || '', anonKey: cfg.supabaseAnonKey || '' });
ctx.store = new AppStore({ cloud: ctx.cloud });
ctx.store.subscribe(() => renderApp());

mountDispatchers();
window.addEventListener('hashchange', () => renderApp());
window.addEventListener('online', () => {
  if (ctx.store.isSyncEnabled()) ctx.store.pull();
});

if (!location.hash) location.hash = '#/growth';
renderApp();
ctx.store.start();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // التطبيق يعمل بدون Service Worker، فلا نعرض خطأ للمستخدم.
  });
}
