import { ctx, ui, PAGES } from './ctx.js';
import { esc, formData } from './util.js';
import { closeModal, showFormError, toast } from './modal.js';
import { errMsg } from './run.js';
import { renderGrowth, handlers as hGrowth } from './pages/growth.js';
import { renderBank, handlers as hBank } from './pages/bank.js';
import { renderJourney, handlers as hJourney } from './pages/journey.js';
import { renderCurrent, handlers as hCurrent } from './pages/current.js';
import { renderMoney, handlers as hMoney } from './pages/money.js';
import { renderServices, handlers as hServices } from './pages/services.js';
import { renderSettings, handlers as hSettings, syncChip, conflictModal } from './pages/settings.js';

const PAGE_RENDER = {
  growth: (s) => renderGrowth(s),
  bank: (s) => renderBank(s),
  journey: (s) => renderJourney(s),
  current: (s) => renderCurrent(s),
  money: (s) => renderMoney(s),
  services: (s) => renderServices(s),
  settings: (s) => renderSettings(s, ctx.cloud, ctx.store),
};

const ALL = [hGrowth, hBank, hJourney, hCurrent, hMoney, hServices, hSettings];
const ACTS = Object.assign({}, ...ALL.map((h) => h.acts));
const FORMS = Object.assign({}, ...ALL.map((h) => h.forms));
const CHANGES = Object.assign({}, ...ALL.map((h) => h.changes));

const COMMON_ACTS = {
  'close-modal'() {
    if (window.__confirmResolve) window.__confirmResolve(false);
    closeModal();
  },
  'close-modal-overlay'(el, e) {
    if (e.target !== el) return false;
    if (window.__confirmResolve) window.__confirmResolve(false);
    closeModal();
  },
  'confirm-yes'() {
    if (window.__confirmResolve) window.__confirmResolve(true);
  },
  'confirm-no'() {
    if (window.__confirmResolve) window.__confirmResolve(false);
  },
  'conflict-open'() {
    conflictModal(ctx.store);
  },
};

FORMS.login = async (form, d) => {
  try {
    await ctx.cloud.signIn(d.email, d.password);
    form.querySelector('input[name=password]').value = '';
    renderApp();
    ctx.store.start();
  } catch (e) {
    showFormError(form, errMsg(e));
  }
};

export function currentPage() {
  const h = location.hash.replace(/^#\/?/, '');
  return PAGE_RENDER[h] ? h : 'growth';
}

function loginView() {
  return `
    <main class="login">
      <div class="login-card card">
        <div class="logo big">🌱</div>
        <h1>تطوّري</h1>
        <p class="hint">التسجيل العام مغلق. هذا التطبيق لمالك واحد.</p>
        <form data-form="login" class="stack">
          <label>البريد الإلكتروني<input name="email" type="email" autocomplete="username" required /></label>
          <label>كلمة المرور<input name="password" type="password" autocomplete="current-password" required /></label>
          <button class="primary" type="submit">دخول</button>
        </form>
        <p class="hint small">الجلسة تبقى على هذا الجهاز حتى تسجّل الخروج. تسجيل الخروج يمسح البيانات المحلية.</p>
      </div>
    </main>`;
}

function banner(store) {
  const parts = [];
  if (store.notice) parts.push(`<div class="banner warn" role="alert">${esc(store.notice)}</div>`);
  if (store.sync.error && store.sync.status !== 'offline') parts.push(`<div class="banner warn" role="alert">${esc(store.sync.error)}</div>`);
  if (store.sync.status === 'offline') parts.push(`<div class="banner" role="status">${esc(store.sync.error || 'بلا اتصال')}</div>`);
  if (store.sync.status === 'auth') parts.push(`<div class="banner warn" role="alert">${esc(store.sync.error || 'انتهت الجلسة')}</div>`);
  if (store.sync.status === 'conflict') {
    parts.push(`<div class="banner warn" role="alert">تعارض بين نسختين يحتاج قرارك. <button type="button" class="ghost" data-act="conflict-open">فتح القرار</button></div>`);
  }
  if (!ctx.cloud.configured) parts.push(`<div class="banner" role="note">وضع هذا الجهاز فقط: لم تُضبط السحابة بعد.</div>`);
  return parts.join('');
}

export function renderApp() {
  const app = document.getElementById('app');
  if (!app) return;
  const store = ctx.store;
  if (ctx.cloud.configured && !ctx.cloud.session) {
    app.innerHTML = loginView();
    return;
  }
  const s = store.state;
  const page = currentPage();
  const name = esc(s.settings.appName || 'تطوّري');
  document.title = s.settings.appName || 'تطوّري';

  // قرار التعارض يظهر تلقائيًا مرة واحدة، ثم يبقى في الشريط حتى يُحسم.
  if (store.sync.status === 'conflict' && !ui.conflictShown) {
    ui.conflictShown = true;
    conflictModal(store);
  }
  if (store.sync.status !== 'conflict') ui.conflictShown = false;

  app.innerHTML = `
    <header class="topbar">
      <div class="brand"><span class="logo" aria-hidden="true">🌱</span><strong>${name}</strong></div>
      ${syncChip(store)}
      <a class="icon-link ${page === 'settings' ? 'active' : ''}" href="#/settings" aria-label="الإعدادات">⚙️</a>
    </header>
    ${banner(store)}
    <main id="page" class="page" tabindex="-1">${PAGE_RENDER[page](s)}</main>
    <nav class="bottom-nav" aria-label="الأقسام الرئيسية">
      ${PAGES.map(
        (p) => `<a href="#/${p.id}" class="${page === p.id ? 'active' : ''}" ${page === p.id ? 'aria-current="page"' : ''}><span aria-hidden="true">${p.icon}</span>${esc(p.label)}</a>`,
      ).join('')}
    </nav>`;
}

export function mountDispatchers() {
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const fn = COMMON_ACTS[act] || ACTS[act];
    if (!fn) return;
    if (act === 'close-modal-overlay' && e.target !== el) return;
    if (el.tagName === 'A') {
      // روابط التنقل تكفيها hash، والروابط الخارجية تفتح بشكل طبيعي.
      return;
    }
    e.preventDefault();
    try {
      const result = await fn(el, e);
      if (result !== false) renderApp();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  });

  document.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    const fn = CHANGES[el.dataset.change];
    if (!fn) return;
    try {
      const result = await fn(el, e);
      if (result !== false) renderApp();
    } catch (err) {
      toast(errMsg(err), 'error');
    }
  });

  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = FORMS[form.dataset.form];
    if (!fn) return;
    try {
      await fn(form, formData(form));
    } catch (err) {
      showFormError(form, errMsg(err));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.querySelector('.overlay')) {
      if (window.__confirmResolve) window.__confirmResolve(false);
      closeModal();
    }
  });
}
