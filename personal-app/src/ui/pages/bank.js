import { ctx, ui } from '../ctx.js';
import { esc, options, parseLines, formData, emptyState, badge } from '../util.js';
import { openModal, toast, confirmDialog } from '../modal.js';
import { runForm, runAction } from '../run.js';
import { newId } from '../../core/state.js';
import { isSafeHttpUrl } from '../../core/text.js';
import { ValidationError } from '../../core/money.js';
import {
  BANK_TYPES,
  BANK_STATUSES,
  quickAddBank,
  updateBank,
  archiveBank,
  cloneBankAsTemplate,
  deleteBank,
  filterBank,
} from '../../core/bank.js';
import { instantiateFromBank, distributeGoal, sortedLevels } from '../../core/plan.js';
import { isLevelPrepared } from '../../core/levels.js';

const MEASURE_LABEL = { binary: 'ثنائي (تم / لم يتم)', numeric: 'رقمي (هدف بالأرقام)', composite: 'مركّب (مهام صغيرة)' };

function parseSubtasks(text) {
  return parseLines(text).map((line) => {
    const p = line.split('|').map((x) => x.trim());
    const title = p[0];
    const type = p[1] === 'numeric' ? 'numeric' : 'binary';
    if (type === 'numeric') return { title, type, target: Number(p[2]), weight: p[3] ? Number(p[3]) : 1 };
    return { title, type, target: null, weight: p[2] ? Number(p[2]) : 1 };
  });
}

function parseLinks(text) {
  return parseLines(text).map((line) => {
    const [a, b] = line.split('|').map((x) => x.trim());
    const url = b !== undefined ? b : a;
    const label = b !== undefined ? a : '';
    if (!isSafeHttpUrl(url)) throw new ValidationError(`الرابط غير صالح: ${url}`);
    return { label, url };
  });
}

function itemCard(state, b) {
  const domain = state.growth.domains.find((d) => d.id === b.domainId);
  const links = (b.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a>`).join(' · ');
  const isGoal = b.type === 'big_goal';
  return `
    <li class="bank-card ${b.status === 'archived' ? 'muted' : ''}">
      <div class="bank-head">
        <button type="button" class="pin ${b.pinned ? 'on' : ''}" data-act="bank-pin" data-id="${esc(b.id)}" aria-pressed="${b.pinned}" aria-label="${b.pinned ? 'إلغاء التثبيت' : 'تثبيت'}">${b.pinned ? '📌' : '📍'}</button>
        <div class="grow">
          <strong>${esc(b.title)}</strong>
          <div class="tags">${badge(BANK_TYPES[b.type] || b.type)} ${badge(BANK_STATUSES[b.status] || b.status, b.status === 'ready' ? 'good' : '')}
            ${domain ? badge(domain.name) : ''}${b.usedCount ? badge(`استُخدم ${b.usedCount}×`) : ''}</div>
        </div>
      </div>
      ${b.description ? `<p class="hint">${esc(b.description)}</p>` : ''}
      ${links ? `<p class="links">${links}</p>` : ''}
      <div class="bank-actions">
        ${isGoal
          ? `<button type="button" class="ghost" data-act="goal-open" data-id="${esc(b.id)}">توزيع على المستويات</button>`
          : `<button type="button" class="ghost" data-act="bank-to-level" data-id="${esc(b.id)}">إضافة إلى مستوى</button>`}
        <button type="button" class="ghost" data-act="bank-edit" data-id="${esc(b.id)}">تعديل</button>
        <button type="button" class="ghost" data-act="bank-clone" data-id="${esc(b.id)}">نسخة كقالب</button>
        <button type="button" class="ghost" data-act="bank-archive" data-id="${esc(b.id)}" data-archived="${b.status === 'archived' ? '0' : '1'}">${b.status === 'archived' ? 'إلغاء الأرشفة' : 'أرشفة'}</button>
        ${b.usedCount ? '' : `<button type="button" class="ghost danger-text" data-act="bank-delete" data-id="${esc(b.id)}">حذف</button>`}
      </div>
    </li>`;
}

function editForm(state, b = null) {
  const v = b || { type: 'idea', status: 'draft', measure: 'binary', weight: 1, subtasks: [], links: [], tags: [], successCriteria: [] };
  const points = state.growth.points.filter((p) => !p.archived);
  const subLines = (v.subtasks || [])
    .map((s) => (s.type === 'numeric' ? `${s.title} | numeric | ${s.target} | ${s.weight}` : `${s.title} | binary | ${s.weight}`))
    .join('\n');
  const linkLines = (v.links || []).map((l) => `${l.label} | ${l.url}`).join('\n');
  return `
    <form data-form="bank-save" class="form-grid" data-id="${esc(b?.id || '')}">
      <label>النوع<select name="type">${options(Object.entries(BANK_TYPES).map(([id, label]) => ({ id, label })), v.type, { labelKey: 'label' })}</select></label>
      <label>الحالة<select name="status">${options(Object.entries(BANK_STATUSES).map(([id, label]) => ({ id, label })), v.status, { labelKey: 'label' })}</select></label>
      <label class="wide">العنوان<input name="title" maxlength="200" required value="${esc(b?.title || '')}" /></label>
      <label class="wide">الوصف<textarea name="description" rows="2" maxlength="1000">${esc(b?.description || '')}</textarea></label>
      <label class="wide">ملاحظات<textarea name="notes" rows="2" maxlength="2000">${esc(b?.notes || '')}</textarea></label>
      <label>نوع القياس<select name="measure">${options(Object.entries(MEASURE_LABEL).map(([id, label]) => ({ id, label })), v.measure, { labelKey: 'label' })}</select></label>
      <label>الهدف الرقمي (للرقمي فقط)<input name="target" inputmode="decimal" value="${esc(b?.target ?? '')}" /></label>
      <label>الوحدة (اختياري)<input name="unit" maxlength="40" value="${esc(b?.unit || '')}" placeholder="صفحة، ساعة، جلسة" /></label>
      <label>الوزن داخل المستوى<input name="weight" inputmode="decimal" value="${esc(b?.weight ?? 1)}" /></label>
      <label>المجال<select name="domainId">${options(state.growth.domains, v.domainId, { empty: 'بدون مجال' })}</select></label>
      <label>نقطة التطوير المرتبطة<select name="pointId">${options(points, v.pointId, { empty: 'بدون نقطة' })}</select></label>
      <label class="wide">المهام الصغيرة (سطر لكل مهمة: عنوان | binary | وزن أو عنوان | numeric | هدف | وزن)
        <textarea name="subtasks" rows="3" placeholder="قراءة الفصل الأول | binary | 1">${esc(subLines)}</textarea></label>
      <label class="wide">شروط النجاح (سطر لكل شرط)<textarea name="successCriteria" rows="2">${esc((v.successCriteria || []).join('\n'))}</textarea></label>
      <label class="wide">روابط ومصادر (سطر: اسم | https://...)<textarea name="links" rows="2">${esc(linkLines)}</textarea></label>
      <label class="wide">وسوم (افصل بفاصلة)<input name="tags" maxlength="200" value="${esc((b?.tags || []).join(', '))}" /></label>
      <p class="hint wide">التعديل هنا يؤثر على القالب فقط. النسخ الموجودة في المستويات لا تتغير تلقائيًا.</p>
      <div class="wide actions-end"><button class="primary" type="submit">حفظ</button></div>
    </form>`;
}

function levelChoice(state, bankId, mode) {
  const levels = sortedLevels(state).filter((l) => l.status !== 'completed');
  if (levels.length === 0) {
    return '<p class="hint">لا توجد مستويات مفتوحة. أنشئ مستوى من صفحة الرحلة أولًا.</p>';
  }
  return `
    <form data-form="bank-to-level" class="form-grid">
      <input type="hidden" name="bankId" value="${esc(bankId)}" />
      <label class="wide">المستوى<select name="levelId">${levels
        .map((l) => `<option value="${esc(l.id)}">${esc(l.name)} — ${l.status === 'current' ? 'الحالي' : 'قادم'}${isLevelPrepared(l) ? '' : ' (غير مجهز بعد)'}</option>`)
        .join('')}</select></label>
      <p class="hint wide">${mode === 'reward' ? 'المكافأة تنتقل إلى المستوى، ولا تُحسب تحديًا.' : 'ينشئ هذا نسخة تنفيذية مستقلة في المستوى. تعديل القالب بعد ذلك لا يغيّرها.'}</p>
      <div class="wide actions-end"><button class="primary" type="submit">إضافة</button></div>
    </form>`;
}

export function renderBank(state) {
  const f = ui.bank;
  const items = filterBank(state.bank, f);
  const typeOpts = options(Object.entries(BANK_TYPES).map(([id, label]) => ({ id, label })), f.type, { empty: 'كل الأنواع', labelKey: 'label' });
  const statusOpts = options(Object.entries(BANK_STATUSES).map(([id, label]) => ({ id, label })), f.status, { empty: 'كل الحالات', labelKey: 'label' });
  return `
    <article class="card">
      <form data-form="bank-quick" class="inline-form">
        <input name="title" maxlength="200" required placeholder="اكتب فكرة أو تحديًا بعنوان فقط…" aria-label="إضافة سريعة" />
        <button class="primary" type="submit">إضافة</button>
      </form>
      <p class="hint">العناصر هنا قوالب. إضافتها إلى مستوى تنشئ نسخة مستقلة، ولا تؤثر في أي نسبة إنجاز قبل ذلك.</p>
    </article>
    <article class="card filters">
      <input type="search" data-change="bank-query" value="${esc(f.query)}" placeholder="بحث في العناوين والوسوم" aria-label="بحث" />
      <select data-change="bank-type" aria-label="نوع">${typeOpts}</select>
      <select data-change="bank-status" aria-label="حالة">${statusOpts}</select>
      <label class="check"><input type="checkbox" data-change="bank-archived" ${f.showArchived ? 'checked' : ''} /> إظهار المؤرشف</label>
    </article>
    ${items.length
      ? `<ul class="bank-list">${items.map((b) => itemCard(state, b)).join('')}</ul>`
      : emptyState(
          state.bank.length ? 'لا توجد نتائج تطابق البحث' : 'البنك فارغ',
          state.bank.length ? 'جرّب تغيير الفلاتر.' : 'أضف أول فكرة بعنوان فقط، ثم أكمل التفاصيل لاحقًا.',
        )}`;
}

export const handlers = {
  acts: {
    'bank-pin'(el) {
      const b = ctx.store.state.bank.find((x) => x.id === el.dataset.id);
      if (!b) return;
      runAction(() => ctx.store.update((s) => updateBank(s, el.dataset.id, { pinned: !b.pinned })));
    },
    'bank-edit'(el) {
      const b = ctx.store.state.bank.find((x) => x.id === el.dataset.id);
      if (!b) return;
      openModal({ title: 'تعديل العنصر', body: editForm(ctx.store.state, b), wide: true });
    },
    'bank-clone'(el) {
      runAction(() => ctx.store.update((s) => cloneBankAsTemplate(s, el.dataset.id, newId)), 'أُنشئت نسخة قالب جديدة');
    },
    'bank-archive'(el) {
      const archive = el.dataset.archived === '1';
      runAction(
        () => ctx.store.update((s) => (archive ? archiveBank(s, el.dataset.id) : updateBank(s, el.dataset.id, { status: 'draft' }))),
        archive ? 'أُرشف العنصر. النسخ المستخدمة في المستويات تبقى كما هي.' : 'أُعيد تفعيل العنصر',
      );
    },
    async 'bank-delete'(el) {
      const ok = await confirmDialog('هل تريد حذف هذا العنصر من البنك؟ لا يمكن التراجع.', 'حذف');
      if (!ok) return;
      runAction(() => ctx.store.update((s) => deleteBank(s, el.dataset.id)), 'تم الحذف');
    },
    'bank-to-level'(el) {
      const b = ctx.store.state.bank.find((x) => x.id === el.dataset.id);
      if (!b) return;
      openModal({
        title: `إضافة "${b.title}" إلى مستوى`,
        body: levelChoice(ctx.store.state, b.id, b.type === 'reward' ? 'reward' : 'copy'),
      });
    },
    'goal-open'(el) {
      const s = ctx.store.state;
      const goal = s.bank.find((x) => x.id === el.dataset.id);
      if (!goal) return;
      const levels = sortedLevels(s).filter((l) => l.status !== 'completed');
      if (levels.length === 0) {
        toast('أنشئ مستويات مفتوحة أولًا لتوزيع الهدف عليها', 'error');
        return;
      }
      const rows = [0, 1, 2]
        .map(
          (i) => `
          <fieldset class="part">
            <legend>جزء ${i + 1}</legend>
            <label>المستوى<select name="levelId_${i}"><option value="">— تجاهل هذا الجزء —</option>${levels
              .map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`)
              .join('')}</select></label>
            <label>عنوان الجزء<input name="title_${i}" maxlength="200" /></label>
            <label>الهدف الرقمي<input name="target_${i}" inputmode="decimal" /></label>
            <label>الوحدة<input name="unit_${i}" maxlength="40" /></label>
          </fieldset>`,
        )
        .join('');
      openModal({
        title: `توزيع: ${goal.title}`,
        wide: true,
        body: `<form data-form="goal-distribute" class="stack"><input type="hidden" name="goalId" value="${esc(goal.id)}" />
          <p class="hint">كل جزء يصبح تحديًا رقميًا مستقلًا في المستوى المختار، ويحمل مرجع الهدف.</p>${rows}
          <div class="actions-end"><button class="primary" type="submit">توزيع</button></div></form>`,
      });
    },
  },
  forms: {
    'bank-quick'(form) {
      const d = formData(form);
      const ok = runForm(form, () => ctx.store.update((s) => quickAddBank(s, d.title, newId)), { keepOpen: true, successMessage: 'أُضيفت إلى البنك' });
      if (ok) form.reset();
    },
    'bank-save'(form) {
      const d = formData(form);
      const id = form.dataset.id || null;
      runForm(form, () =>
        ctx.store.update((s) => {
          const patch = {
            type: d.type,
            status: d.status,
            title: d.title,
            description: d.description,
            notes: d.notes,
            measure: d.measure,
            target: d.measure === 'numeric' ? d.target : null,
            unit: d.unit,
            weight: d.weight,
            domainId: d.domainId,
            pointId: d.pointId,
            subtasks: parseSubtasks(d.subtasks),
            successCriteria: parseLines(d.successCriteria),
            links: parseLinks(d.links),
            tags: String(d.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
          };
          if (id) {
            updateBank(s, id, patch);
          } else {
            const created = quickAddBank(s, patch.title, newId);
            updateBank(s, created.id, patch);
          }
        }),
      );
    },
    'bank-to-level'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => {
          instantiateFromBank(s, d.bankId, d.levelId, newId);
        }),
        { successMessage: 'أُضيف إلى المستوى' },
      );
    },
    'goal-distribute'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => {
          const parts = [0, 1, 2]
            .filter((i) => d[`levelId_${i}`])
            .map((i) => ({
              levelId: d[`levelId_${i}`],
              title: d[`title_${i}`] || `${findGoalTitle(s, d.goalId)} — جزء ${i + 1}`,
              measure: 'numeric',
              target: d[`target_${i}`],
              unit: d[`unit_${i}`],
              weight: 1,
            }));
          distributeGoal(s, d.goalId, parts, newId);
        }),
      );
    },
  },
  changes: {
    'bank-query'(el) {
      ui.bank.query = el.value;
    },
    'bank-type'(el) {
      ui.bank.type = el.value;
    },
    'bank-status'(el) {
      ui.bank.status = el.value;
    },
    'bank-archived'(el) {
      ui.bank.showArchived = el.checked;
    },
  },
};

function findGoalTitle(state, id) {
  return state.bank.find((b) => b.id === id)?.title || 'الهدف';
}
