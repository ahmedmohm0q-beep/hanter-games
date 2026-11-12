import { ctx, ui } from '../ctx.js';
import { esc, options, badge, emptyState, formData } from '../util.js';
import { openModal } from '../modal.js';
import { runForm, runAction } from '../run.js';
import { newId } from '../../core/state.js';
import { addService, updateService, setServiceArchived, filterServices, serviceCategories } from '../../core/services.js';
import { isSafeHttpUrl } from '../../core/text.js';

function serviceCard(state, s) {
  const sched = s.subscriptionScheduleId ? state.finance.schedules.find((x) => x.id === s.subscriptionScheduleId) : null;
  return `<li class="svc-card ${s.archived ? 'muted' : ''}">
    <div class="svc-head">
      <strong>${esc(s.name)}</strong>
      ${s.category ? badge(s.category) : ''}
      ${s.archived ? badge('مؤرشف', 'warn') : ''}
    </div>
    <p class="hint small"><bdi dir="ltr">${esc(s.url)}</bdi></p>
    ${s.note ? `<p class="small">${esc(s.note)}</p>` : ''}
    ${s.managerRef ? `<p class="small">🔎 المرجع في مدير كلمات المرور: <strong>${esc(s.managerRef)}</strong></p>` : ''}
    ${sched ? `<p class="hint small">اشتراك مرتبط في المال: ${esc(sched.name)}</p>` : ''}
    <div class="svc-actions">
      ${isSafeHttpUrl(s.url) ? `<a class="btn ghost" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">فتح الموقع</a>` : ''}
      <button type="button" class="ghost" data-act="svc-edit" data-id="${esc(s.id)}">تعديل</button>
      <button type="button" class="ghost" data-act="svc-archive" data-id="${esc(s.id)}" data-archived="${s.archived ? '0' : '1'}">${s.archived ? 'تفعيل' : 'أرشفة'}</button>
    </div>
  </li>`;
}

function serviceForm(state, s = null) {
  const schedules = state.finance.schedules.filter((x) => !x.cancelled);
  const cats = serviceCategories(state.services);
  return `
    <form data-form="${s ? 'svc-save' : 'svc-add'}" data-id="${esc(s?.id || '')}" class="form-grid">
      <label>اسم الخدمة<input name="name" maxlength="120" required value="${esc(s?.name || '')}" /></label>
      <label>الرابط<input name="url" inputmode="url" required placeholder="https://" value="${esc(s?.url || '')}" /></label>
      <label>التصنيف<input name="category" list="svc-cats" maxlength="60" value="${esc(s?.category || '')}" />
        <datalist id="svc-cats">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist></label>
      <label>اشتراك مرتبط في أموالي (اختياري)<select name="subscriptionScheduleId"><option value="">— لا يوجد —</option>${schedules
        .map((x) => `<option value="${esc(x.id)}" ${s?.subscriptionScheduleId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`)
        .join('')}</select></label>
      <label class="wide">مرجع نصي للعثور عليه في مدير كلمات المرور<input name="managerRef" maxlength="200" placeholder="مثال: Personal / Banks / Mashreq" value="${esc(s?.managerRef || '')}" /></label>
      <label class="wide">ملاحظة غير سرية<textarea name="note" rows="2" maxlength="1000">${esc(s?.note || '')}</textarea></label>
      <p class="hint wide">لا تكتب هنا كلمة المرور أو رمز التحقق أو أرقام الاسترداد. هذه تُحفظ في مدير كلمات المرور فقط.</p>
      <div class="wide actions-end"><button class="primary" type="submit">حفظ</button></div>
    </form>`;
}

export function renderServices(state) {
  const f = ui.services;
  const list = filterServices(state.services, f);
  const cats = serviceCategories(state.services);
  const pm = state.settings.passwordManagerUrl;
  const pmLabel = state.settings.passwordManagerLabel || 'مدير كلمات المرور';
  return `
    <article class="card">
      <div class="card-head">
        <div><h3>حساباتي الرقمية</h3>
        <p class="hint small">فهرس للمواقع والخدمات فقط. كلمات المرور في مدير كلمات مختص، ولا يعرضها التطبيق ولا يحفظها.</p></div>
        <button type="button" class="primary" data-act="svc-add">+ خدمة</button>
      </div>
      ${isSafeHttpUrl(pm)
        ? `<a class="btn ghost" href="${esc(pm)}" target="_blank" rel="noopener noreferrer">🔐 افتح ${esc(pmLabel)}</a>`
        : `<p class="hint small">لم تحدد بعد رابط مدير كلمات المرور. أضفه من الإعدادات ليظهر هنا اختصار الفتح.</p>`}
    </article>
    <article class="card filters">
      <input type="search" data-change="svc-query" value="${esc(f.query)}" placeholder="بحث بالاسم أو الرابط أو المرجع" aria-label="بحث" />
      <select data-change="svc-category" aria-label="تصنيف">${options(cats, f.category, { empty: 'كل التصنيفات' })}</select>
      <label class="check"><input type="checkbox" data-change="svc-archived" ${f.showArchived ? 'checked' : ''} /> إظهار المؤرشف</label>
    </article>
    ${list.length
      ? `<ul class="svc-list">${list.map((s) => serviceCard(state, s)).join('')}</ul>`
      : emptyState(state.services.length ? 'لا توجد نتائج' : 'لم تضف أي خدمة بعد', state.services.length ? 'جرّب تغيير البحث.' : 'أضف حساباتك المهمة: البنوك، البريد، الحكومة، الاشتراكات.')}`;
}

export const handlers = {
  acts: {
    'svc-add'() {
      openModal({ title: 'خدمة جديدة', body: serviceForm(ctx.store.state), wide: true });
    },
    'svc-edit'(el) {
      const s = ctx.store.state.services.find((x) => x.id === el.dataset.id);
      if (!s) return;
      openModal({ title: 'تعديل الخدمة', body: serviceForm(ctx.store.state, s), wide: true });
    },
    'svc-archive'(el) {
      runAction(
        () => ctx.store.update((s) => setServiceArchived(s, el.dataset.id, el.dataset.archived === '1')),
        el.dataset.archived === '1' ? 'أُرشفت الخدمة' : 'أُعيد تفعيلها',
      );
    },
  },
  forms: {
    'svc-add'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) =>
          addService(s, {
            name: d.name,
            url: d.url,
            category: d.category,
            note: d.note,
            managerRef: d.managerRef,
            subscriptionScheduleId: d.subscriptionScheduleId || null,
          }, newId),
        ),
        { successMessage: 'أُضيفت الخدمة' },
      );
    },
    'svc-save'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) =>
          updateService(s, form.dataset.id, {
            name: d.name,
            url: d.url,
            category: d.category,
            note: d.note,
            managerRef: d.managerRef,
            subscriptionScheduleId: d.subscriptionScheduleId || null,
          }),
        ),
        { successMessage: 'تم الحفظ' },
      );
    },
  },
  changes: {
    'svc-query'(el) {
      ui.services.query = el.value;
    },
    'svc-category'(el) {
      ui.services.category = el.value;
    },
    'svc-archived'(el) {
      ui.services.showArchived = el.checked;
    },
  },
};
