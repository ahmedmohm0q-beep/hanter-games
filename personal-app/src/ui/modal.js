import { esc } from './util.js';

export function openModal({ title, body, footer = '', wide = false }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="overlay" data-act="close-modal-overlay">
      <section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-head">
          <h2 id="modal-title">${esc(title)}</h2>
          <button class="icon-btn" type="button" data-act="close-modal" aria-label="إغلاق">✕</button>
        </header>
        <div class="modal-body">${body}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ''}
      </section>
    </div>`;
  const first = root.querySelector('input, select, textarea, button.primary');
  if (first) setTimeout(() => first.focus(), 30);
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  if (root) root.innerHTML = '';
}

export function showFormError(form, message) {
  let box = form.querySelector('.form-error');
  if (!box) {
    box = document.createElement('div');
    box.className = 'form-error';
    box.setAttribute('role', 'alert');
    form.prepend(box);
  }
  box.textContent = message;
}

let toastTimer = null;
export function toast(message, tone = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.className = `toast show ${tone}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 3200);
}

// تأكيد بسيط عبر نافذة. يعيد Promise تُحل بـ true أو false.
export function confirmDialog(message, confirmLabel = 'تأكيد') {
  return new Promise((resolve) => {
    openModal({
      title: 'تأكيد',
      body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `<button class="ghost" type="button" data-act="confirm-no">إلغاء</button>
               <button class="danger" type="button" data-act="confirm-yes">${esc(confirmLabel)}</button>`,
    });
    window.__confirmResolve = (v) => {
      window.__confirmResolve = null;
      closeModal();
      resolve(v);
    };
  });
}
