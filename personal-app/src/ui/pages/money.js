import { ctx, ui } from '../ctx.js';
import { esc, options, badge, emptyState, formData, compressImage, parseLines } from '../util.js';
import { openModal, toast, confirmDialog } from '../modal.js';
import { runForm, runAction } from '../run.js';
import { newId } from '../../core/state.js';
import { parseMoney, formatMoney, normalizeDigits, ValidationError } from '../../core/money.js';
import { todayISO } from '../../core/dates.js';
import {
  TXN_TYPES,
  ACCOUNT_KINDS,
  SCHEDULE_KINDS,
  FREQUENCIES,
  getAccount,
  getCurrency,
  getSchedule,
  getSpace,
  accountsInSpace,
  categoriesInSpace,
  addSpace,
  addCurrency,
  addCategory,
  addAccount,
  updateAccount,
  addRate,
  postTxn,
  accountBalance,
  periodSummary,
  addBudget,
  deleteBudget,
  budgetStatus,
  budgetOverlaps,
  addSchedule,
  editSchedule,
  cancelSchedule,
  payOccurrence,
  linkExistingTxn,
  occurrenceStatus,
  scheduleOverview,
  debtOverview,
  reconcileAccount,
  createAdjustmentFromReconciliation,
  netWorth,
} from '../../core/finance.js';
import { editTxnMeta, deleteTxn } from '../../core/finance-edit.js';

const TABS = [
  ['accounts', 'الحسابات'],
  ['txns', 'العمليات'],
  ['budgets', 'الميزانيات'],
  ['debts', 'الديون'],
  ['schedules', 'الالتزامات'],
  ['reports', 'التقارير'],
  ['settings', 'العملات والتصنيفات'],
];

const TXN_FIELD_TYPES = {
  accountId: ['income', 'expense', 'transfer', 'borrow', 'lend', 'repay', 'refund', 'adjust'],
  toAccountId: ['transfer'],
  toAmount: ['transfer'],
  fee: ['transfer', 'repay'],
  categoryId: ['income', 'expense', 'transfer', 'repay'],
  debtId: ['repay'],
  refundOfId: ['refund'],
  dueDate: ['borrow', 'lend'],
  party: ['income', 'expense', 'borrow', 'lend', 'repay'],
  amount: ['income', 'expense', 'transfer', 'borrow', 'lend', 'repay', 'refund'],
};

// ---------- أدوات ----------
function spaceId(state) {
  const ids = state.finance.spaces.map((s) => s.id);
  if (!ui.money.spaceId || !ids.includes(ui.money.spaceId)) ui.money.spaceId = state.finance.activeSpaceId || ids[0];
  return ui.money.spaceId;
}

function decimalsOf(state, code) {
  return getCurrency(state, code).decimals;
}

function toDecimal(minor, decimals) {
  if (minor === null || minor === undefined) return '';
  const neg = minor < 0;
  const abs = Math.abs(minor).toString().padStart(decimals + 1, '0');
  const int = decimals > 0 ? abs.slice(0, -decimals) : abs;
  const frac = decimals > 0 ? abs.slice(-decimals) : '';
  return `${neg ? '-' : ''}${int}${decimals > 0 ? '.' + frac : ''}`;
}

function fmt(state, minor, code) {
  return `<bdi dir="ltr">${esc(formatMoney(minor, code, decimalsOf(state, code)))}</bdi>`;
}

function currencyOptions(state, selected) {
  return options(state.finance.currencies.map((c) => ({ id: c.code, name: `${c.code} — ${c.name}` })), selected);
}

function accountOptions(state, sid, selected, { empty = null, onlyCurrency = null } = {}) {
  const list = accountsInSpace(state, sid).filter((a) => !onlyCurrency || a.currency === onlyCurrency);
  return options(list.map((a) => ({ id: a.id, name: `${a.name} (${a.currency})` })), selected, { empty });
}

function categoryOptions(state, sid, selected, kind = null) {
  const cats = categoriesInSpace(state, sid, kind);
  const inc = cats.filter((c) => c.kind === 'income');
  const exp = cats.filter((c) => c.kind === 'expense');
  const group = (label, list) =>
    list.length ? `<optgroup label="${esc(label)}">${options(list, selected, { empty: null })}</optgroup>` : '';
  return `<option value="">— بلا تصنيف —</option>${group('دخل', inc)}${group('مصروف', exp)}`;
}

function txnLabel(state, t) {
  const acc = getAccount(state, t.accountId);
  return `${t.date} · ${TXN_TYPES[t.type]} · ${formatMoney(t.amountMinor, t.currency, decimalsOf(state, t.currency))} · ${acc.name}`;
}

// ---------- نموذج العملية ----------
function txnForm(state, { formName = 'txn-add', presetType = 'expense', presetDebtId = '', presetAccountId = '', sid }) {
  const debts = debtOverview(state, sid).filter((d) => d.remaining > 0);
  const refundable = state.finance.txns
    .filter((t) => t.spaceId === sid && t.type === 'expense')
    .slice(-200)
    .reverse();
  const typeOpts = options(Object.entries(TXN_TYPES).map(([id, label]) => ({ id, label })), presetType, { labelKey: 'label' });
  const fieldWrap = (key, inner) => {
    const types = TXN_FIELD_TYPES[key];
    const show = types.includes(presetType);
    return `<div class="field" data-field="${key}" data-types="${types.join(' ')}" ${show ? '' : 'hidden'}>${inner}</div>`;
  };
  return `
    <form data-form="${formName}" class="form-grid txn-form">
      <label>نوع العملية<select name="type" data-change="txn-type">${typeOpts}</select></label>
      <label>التاريخ<input name="date" type="date" value="${todayISO()}" required /></label>
      ${fieldWrap('accountId', `<label><span class="lbl-acc">الحساب</span><select name="accountId" required>${accountOptions(state, sid, presetAccountId, { empty: '— اختر الحساب —' })}</select></label>`)}
      ${fieldWrap('toAccountId', `<label>إلى حساب<select name="toAccountId">${accountOptions(state, sid, '', { empty: '— اختر —' })}
        </select></label>
        <span class="hint small">يمكن أن يكون الحساب في مساحة أخرى (تمويل أو سحب مالك).</span>`)}
      ${fieldWrap('amount', `<label>المبلغ (بعملة الحساب)<input name="amount" inputmode="decimal" required placeholder="0.00" /></label>`)}
      ${fieldWrap('toAmount', `<label>المبلغ المستلم (إذا اختلفت العملة)<input name="toAmount" inputmode="decimal" placeholder="بعملة حساب الوجهة" /></label>`)}
      ${fieldWrap('fee', `<label>الرسوم أو الفوائد<input name="fee" inputmode="decimal" placeholder="0.00" /></label>`)}
      ${fieldWrap('categoryId', `<label>التصنيف<select name="categoryId">${categoryOptions(state, sid, '')}</select></label>`)}
      ${fieldWrap('debtId', `<label>الدين المرتبط<select name="debtId"><option value="">— اختر —</option>${debts
        .map((d) => `<option value="${esc(d.id)}" ${d.id === presetDebtId ? 'selected' : ''}>${esc(d.party)} — ${d.direction === 'i_owe' ? 'عليّ' : 'لي'} — متبقٍ ${esc(formatMoney(d.remaining, d.currency, decimalsOf(state, d.currency)))}</option>`)
        .join('')}</select></label>`)}
      ${fieldWrap('refundOfId', `<label>المصروف الأصلي<select name="refundOfId"><option value="">— اختر —</option>${refundable
        .map((t) => `<option value="${esc(t.id)}">${esc(txnLabel(state, t))}</option>`)
        .join('')}</select></label>`)}
      ${fieldWrap('party', `<label>الجهة أو الشخص<input name="party" maxlength="200" /></label>`)}
      ${fieldWrap('dueDate', `<label>تاريخ الاستحقاق (اختياري)<input name="dueDate" type="date" /></label>`)}
      <label class="wide">ملاحظة<input name="note" maxlength="1000" /></label>
      <label class="wide">إيصال (اختياري، صورة)<input name="receipt" type="file" accept="image/*" /></label>
      <p class="hint wide" data-hint></p>
      <div class="wide actions-end"><button class="primary" type="submit">تسجيل العملية</button></div>
    </form>`;
}

// ---------- الحسابات ----------
function accountsView(state, sid) {
  const list = accountsInSpace(state, sid, { includeArchived: true });
  const rows = list.length
    ? list
        .map((a) => {
          const bal = accountBalance(state, a.id);
          const recs = state.finance.reconciliations.filter((r) => r.accountId === a.id);
          const last = recs[recs.length - 1];
          return `<li class="acc-card ${a.archived ? 'muted' : ''}">
            <div class="acc-head"><strong>${esc(a.name)}</strong> ${badge(ACCOUNT_KINDS[a.kind])} ${badge(a.currency)} ${a.archived ? badge('مؤرشف', 'warn') : ''}</div>
            <div class="acc-balance">${fmt(state, bal, a.currency)}</div>
            <p class="hint small">رصيد افتتاحي ${fmt(state, a.openingMinor, a.currency)} منذ ${esc(a.openingDate)}${last ? ` · آخر مطابقة ${esc(last.date)}: فرق ${fmt(state, last.diffMinor, a.currency)}` : ''}</p>
            <div class="acc-actions">
              <button type="button" class="ghost" data-act="acc-edit" data-id="${esc(a.id)}">تعديل</button>
              <button type="button" class="ghost" data-act="acc-reconcile" data-id="${esc(a.id)}">مطابقة مع الواقع</button>
              <button type="button" class="ghost" data-act="acc-archive" data-id="${esc(a.id)}" data-archived="${a.archived ? '0' : '1'}">${a.archived ? 'تفعيل' : 'أرشفة'}</button>
            </div>
          </li>`;
        })
        .join('')
    : '';
  const recList = state.finance.reconciliations
    .filter((r) => accountsInSpace(state, sid, { includeArchived: true }).some((a) => a.id === r.accountId) && r.diffMinor !== 0 && !r.adjustTxnId)
    .map((r) => {
      const a = getAccount(state, r.accountId);
      return `<li>${esc(r.date)} · ${esc(a.name)} · فرق ${fmt(state, r.diffMinor, a.currency)} <button type="button" class="ghost" data-act="recon-adjust" data-id="${esc(r.id)}">إنشاء تسوية بالفرق</button></li>`;
    })
    .join('');
  return `
    <article class="card">
      <div class="card-head"><div><h3>الحسابات المالية</h3><p class="hint small">هذه حسابات مالية (كاش، بنوك، محافظ). الحسابات الرقمية والمواقع في تبويب «حساباتي».</p></div>
        <button type="button" class="primary" data-act="acc-add">+ حساب مالي</button></div>
      ${list.length ? `<ul class="acc-list">${rows}</ul>` : emptyState('لا توجد حسابات في هذه المساحة', 'أضف حساب الكاش أو البنك بالرصيد الافتتاحي وتاريخ البداية.')}
    </article>
    ${recList ? `<article class="card"><h3>فروق مطابقة لم تُسوَّ بعد</h3><ul class="plain">${recList}</ul><p class="hint small">التسوية تُنشئ عملية تعديل صريحة في سجل الحساب. لا يتغير الرصيد قبل ذلك.</p></article>` : ''}`;
}

function accountForm(state, sid, a = null) {
  return `
    <form data-form="${a ? 'acc-save' : 'acc-add-form'}" data-id="${esc(a?.id || '')}" class="form-grid">
      <label class="wide">الاسم<input name="name" maxlength="80" required value="${esc(a?.name || '')}" /></label>
      <label>النوع<select name="kind">${options(Object.entries(ACCOUNT_KINDS).map(([id, label]) => ({ id, label })), a?.kind || 'bank', { labelKey: 'label' })}</select></label>
      <label>العملة<select name="currency" ${a && a.txnsLocked ? 'disabled' : ''}>${currencyOptions(state, a?.currency || 'AED')}</select></label>
      <label>الرصيد الافتتاحي<input name="openingMinor" inputmode="decimal" value="${a ? toDecimal(a.openingMinor, decimalsOf(state, a.currency)) : '0'}" /></label>
      <label>تاريخ بداية الحساب<input name="openingDate" type="date" required value="${esc(a?.openingDate || todayISO())}" /></label>
      <p class="hint wide">الرصيد الافتتاحي ليس دخلًا للفترة. لا تُغيَّر العملة أو الرصيد بعد وجود عمليات، استخدم التسوية.</p>
      <input type="hidden" name="spaceId" value="${esc(sid)}" />
      <div class="wide actions-end"><button class="primary" type="submit">حفظ</button></div>
    </form>`;
}

// ---------- العمليات ----------
function txnsView(state, sid) {
  const f = ui.money;
  const q = f.query.trim().toLowerCase();
  const list = state.finance.txns
    .filter((t) => t.spaceId === sid)
    .filter((t) => !f.type || t.type === f.type)
    .filter((t) => !f.accountId || t.accountId === f.accountId || t.toAccountId === f.accountId)
    .filter((t) => !q || [t.party, t.note, TXN_TYPES[t.type]].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt.localeCompare(a.createdAt)))
    .slice(0, 300);
  const rows = list
    .map((t) => {
      const acc = getAccount(state, t.accountId);
      const toAcc = t.toAccountId ? getAccount(state, t.toAccountId) : null;
      const cat = t.categoryId ? state.finance.categories.find((c) => c.id === t.categoryId) : null;
      const sign = t.type === 'expense' || t.type === 'lend' ? '−' : t.type === 'income' || t.type === 'borrow' || t.type === 'refund' ? '+' : '';
      const ctxTxt = t.type === 'transfer'
        ? `${esc(acc.name)} ← ${esc(toAcc ? toAcc.name : '')}${t.crossSpace ? ' (بين مساحتين)' : ''}`
        : esc(acc.name);
      return `<li class="txn-row">
        <div class="txn-main">
          <span class="hint small">${esc(t.date)}</span> ${badge(TXN_TYPES[t.type])}
          <strong>${sign}${fmt(state, Math.abs(t.amountMinor), t.currency)}</strong>
          ${t.type === 'transfer' && t.toCurrency !== t.currency ? `<span class="hint small">→ ${fmt(state, t.toAmountMinor, t.toCurrency)}</span>` : ''}
        </div>
        <div class="hint small">${ctxTxt}${cat ? ` · ${esc(cat.name)}` : ''}${t.party ? ` · ${esc(t.party)}` : ''}${t.feeMinor ? ` · رسوم ${fmt(state, t.feeMinor, t.currency)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}${t.receipt ? ' · 🧾' : ''}${t.history?.length ? ` · عُدّلت ${t.history.length} مرة` : ''}</div>
        <div class="txn-actions"><button type="button" class="ghost" data-act="txn-edit" data-id="${esc(t.id)}">تعديل البيانات</button></div>
      </li>`;
    })
    .join('');
  return `
    <article class="card">
      <h3>تسجيل عملية</h3>
      ${txnForm(state, { sid })}
    </article>
    <article class="card filters">
      <select data-change="money-type" aria-label="نوع">${options(Object.entries(TXN_TYPES).map(([id, label]) => ({ id, label })), f.type, { empty: 'كل الأنواع', labelKey: 'label' })}</select>
      <select data-change="money-account" aria-label="حساب">${accountOptions(state, sid, f.accountId, { empty: 'كل الحسابات' })}</select>
      <input type="search" data-change="money-query" value="${esc(f.query)}" placeholder="بحث بالجهة أو الملاحظة" aria-label="بحث" />
    </article>
    ${list.length ? `<ul class="txn-list">${rows}</ul>` : emptyState('لا توجد عمليات مطابقة', 'سجّل أول عملية من النموذج أعلاه.')}
    <p class="hint small">عرض أحدث 300 عملية. التحويل بين حساباتي لا يُحسب دخلًا ولا مصروفًا، والرسوم فقط مصروف.</p>`;
}

// ---------- الميزانيات ----------
function budgetsView(state, sid) {
  const budgets = state.finance.budgets.filter((b) => b.spaceId === sid);
  const overlaps = budgetOverlaps(state, sid);
  const expCats = categoriesInSpace(state, sid, 'expense');
  const cards = budgets
    .map((b) => {
      const st = budgetStatus(state, b.id);
      const rows = st.rows
        .map(
          (r) => `<tr class="${r.overrun ? 'overrun' : ''}">
            <td>${esc(r.categoryName)}</td>
            <td>${fmt(state, r.planned, b.currency)}</td>
            <td>${fmt(state, r.paid, b.currency)}</td>
            <td>${fmt(state, r.committed, b.currency)}</td>
            <td>${fmt(state, r.remaining, b.currency)}${r.overrun ? ' ' + badge('تجاوز', 'warn') : ''}</td>
            <td>${fmt(state, r.afterCommitted, b.currency)}</td>
            <td>${r.unconvertedCount ? badge(`${r.unconvertedCount} بعملة أخرى غير محسوبة`, 'warn') : ''}</td>
          </tr>`,
        )
        .join('');
      return `<article class="card">
        <div class="card-head"><div><h3>${esc(b.name)}</h3><p class="hint small">من ${esc(b.start)} إلى ${esc(b.end)} · ${esc(b.currency)}</p></div>
          <button type="button" class="ghost danger-text" data-act="budget-delete" data-id="${esc(b.id)}">حذف</button></div>
        <div class="table-wrap"><table>
          <thead><tr><th>التصنيف</th><th>المخطط</th><th>المدفوع فعليًا</th><th>التزامات قادمة</th><th>المتبقي</th><th>بعد الالتزامات</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="hint">لا توجد بنود</td></tr>'}</tbody>
        </table></div>
        <p class="hint small">المدفوع يشمل العمليات الفعلية فقط. الالتزامات القادمة من جدول الالتزامات غير المدفوعة. لا تُجمع الميزانيات معًا في إجمالي.</p>
      </article>`;
    })
    .join('');
  return `
    <article class="card">
      <div class="card-head"><h3>ميزانية جديدة</h3></div>
      ${expCats.length === 0 ? '<p class="hint">أضف تصنيفات مصروف من تبويب «العملات والتصنيفات» أولًا.</p>' : `
      <form data-form="budget-add" class="form-grid">
        <label class="wide">اسم الميزانية<input name="name" maxlength="80" required placeholder="مثال: ميزانية الشهر الأول" /></label>
        <label>بداية الفترة<input name="start" type="date" required value="${todayISO()}" /></label>
        <label>نهاية الفترة (شاملة)<input name="end" type="date" required /></label>
        <label>العملة<select name="currency">${currencyOptions(state, 'AED')}</select></label>
        <label class="wide">البنود (سطر لكل تصنيف: اسم التصنيف | المبلغ)<textarea name="lines" rows="3" placeholder="${esc(expCats[0]?.name || 'طعام')} | 1500"></textarea></label>
        <p class="hint wide">لا أفترض شهرًا ميلاديًا؛ حدد الفترة كما تريد (مثلًا من 25 إلى 24 من الشهر التالي).</p>
        <div class="wide actions-end"><button class="primary" type="submit">إنشاء الميزانية</button></div>
      </form>`}
    </article>
    ${overlaps.length ? `<article class="card warn-card"><h3>تنبيه تداخل</h3><ul class="plain">${overlaps.map((o) => `<li>"${esc(o.a)}" و"${esc(o.b)}" تغطيان نفس التصنيف في فترات متداخلة. لن تُجمعا في إجمالي.</li>`).join('')}</ul></article>` : ''}
    ${cards || (expCats.length ? emptyState('لا توجد ميزانيات بعد', 'أنشئ أول ميزانية بفترة تحددها أنت.') : '')}`;
}

// ---------- الديون ----------
function debtsView(state, sid) {
  const list = debtOverview(state, sid);
  const cards = list
    .map((d) => {
      const pays = d.payments.map((p) => `<li>${esc(p.date)} · ${fmt(state, p.amountMinor - p.feeMinor, d.currency)} أصل${p.feeMinor ? ` + ${fmt(state, p.feeMinor, d.currency)} ${d.direction === 'i_owe' ? 'رسوم' : 'فائدة'}` : ''}</li>`).join('');
      return `<li class="debt-card">
        <div class="acc-head"><strong>${esc(d.party)}</strong> ${badge(d.direction === 'i_owe' ? 'عليّ' : 'لي', d.direction === 'i_owe' ? 'warn' : 'good')}
          ${d.overdue ? badge('متأخر', 'warn') : ''}${d.remaining <= 0 ? badge('مسدد') : ''}</div>
        <p class="hint small">الأصل ${fmt(state, d.principalMinor, d.currency)} · المدفوع ${fmt(state, d.paid, d.currency)} · المتبقي <b>${fmt(state, d.remaining, d.currency)}</b>${d.dueDate ? ` · استحقاق ${esc(d.dueDate)}` : ''}</p>
        ${pays ? `<details><summary>سجل الدفعات (${d.payments.length})</summary><ul class="plain small">${pays}</ul></details>` : ''}
        ${d.remaining > 0 ? `<button type="button" class="ghost" data-act="debt-pay" data-id="${esc(d.id)}">${d.direction === 'i_owe' ? 'سداد دفعة' : 'تسجيل تحصيل'}</button>` : ''}
      </li>`;
    })
    .join('');
  const totals = {};
  for (const d of list) {
    if (d.remaining <= 0) continue;
    const k = d.currency;
    totals[k] = totals[k] || { receivable: 0, payable: 0 };
    if (d.direction === 'owed_to_me') totals[k].receivable += d.remaining;
    else totals[k].payable += d.remaining;
  }
  const totalsHtml = Object.entries(totals)
    .map(([c, v]) => `<li>${esc(c)}: لي ${fmt(state, v.receivable, c)} · عليّ ${fmt(state, v.payable, c)}</li>`)
    .join('');
  return `
    <article class="card">
      <h3>ملخص الديون (بكل عملة على حدة)</h3>
      <ul class="plain">${totalsHtml || '<li class="hint">لا توجد ديون مفتوحة.</li>'}</ul>
      <p class="hint small">تُسجَّل الديون تلقائيًا عند عملية «اقتراض» أو «إقراض». قبض القرض لا يُحسب دخلًا، وسداد الأصل لا يُحسب مصروفًا.</p>
    </article>
    ${list.length ? `<ul class="debt-list">${cards}</ul>` : emptyState('لا توجد ديون مسجلة', 'سجّل اقتراضًا أو إقراضًا من تبويب العمليات.')}`;
}

// ---------- الالتزامات المجدولة ----------
function schedulesView(state, sid) {
  const ov = scheduleOverview(state, sid);
  const row = (r, late) => {
    const s = getSchedule(state, r.scheduleId);
    return `<li class="sch-row ${late ? 'late' : ''}">
      <div><strong>${esc(r.name)}</strong> <span class="hint small">استحقاق ${esc(r.dueDate)}</span> ${late ? badge('متأخر', 'warn') : ''}
        ${r.status === 'partial' || r.status === 'overdue_partial' ? badge('دفع جزئي') : ''}</div>
      <div class="hint small">المتبقي ${fmt(state, r.remaining, s.currency)}</div>
      <div class="acc-actions">
        <button type="button" class="ghost" data-act="occ-pay" data-sch="${esc(r.scheduleId)}" data-occ="${esc(r.occId)}">تسجيل دفع</button>
        <button type="button" class="ghost" data-act="occ-link" data-sch="${esc(r.scheduleId)}" data-occ="${esc(r.occId)}">ربط بعملية موجودة</button>
      </div></li>`;
  };
  const schedules = state.finance.schedules.filter((s) => s.spaceId === sid);
  const scheduleCards = schedules
    .map((s) => {
      const paid = s.occurrences.filter((o) => occurrenceStatus(o, todayISO()) === 'paid').length;
      return `<li class="sch-card ${s.cancelled ? 'muted' : ''}">
        <div class="acc-head"><strong>${esc(s.name)}</strong> ${badge(SCHEDULE_KINDS[s.kind])} ${badge(FREQUENCIES[s.frequency])} ${s.cancelled ? badge('ملغى', 'warn') : ''}</div>
        <p class="hint small">${fmt(state, s.amountMinor, s.currency)} لكل دفعة · ${s.count ? `${s.count} دفعة` : 'مستمر حتى الإلغاء'} · مدفوع ${paid} من ${s.occurrences.length} مُجدولة</p>
        ${s.cancelled ? '' : `<div class="acc-actions">
          <button type="button" class="ghost" data-act="sch-edit" data-id="${esc(s.id)}">تعديل من تاريخ</button>
          <button type="button" class="ghost danger-text" data-act="sch-cancel" data-id="${esc(s.id)}">إلغاء من تاريخ</button></div>`}
      </li>`;
    })
    .join('');
  return `
    <article class="card">
      <div class="card-head"><h3>الالتزامات القادمة</h3><button type="button" class="primary" data-act="sch-add">+ التزام جديد</button></div>
      <p class="hint small">الالتزام المجدول لا يخصم من الرصيد حتى تسجّل الدفع. الدفع الجزئي يترك الباقي مستحقًا.</p>
      <h4>متأخرة</h4>
      ${ov.overdue.length ? `<ul class="plain">${ov.overdue.map((r) => row(r, true)).join('')}</ul>` : '<p class="hint">لا توجد متأخرات.</p>'}
      <h4>قادمة</h4>
      ${ov.upcoming.length ? `<ul class="plain">${ov.upcoming.slice(0, 60).map((r) => row(r, false)).join('')}</ul>` : '<p class="hint">لا توجد التزامات قادمة.</p>'}
    </article>
    ${scheduleCards ? `<article class="card"><h3>كل الالتزامات</h3><ul class="plain">${scheduleCards}</ul></article>` : ''}`;
}

function scheduleForm(state, sid, s = null) {
  const v = s || { kind: 'bill', frequency: 'monthly', startDate: todayISO(), count: null, currency: 'AED', intervalDays: 30 };
  const debts = debtOverview(state, sid).filter((d) => d.remaining > 0);
  return `
    <form data-form="${s ? 'sch-edit-save' : 'sch-add-form'}" data-id="${esc(s?.id || '')}" class="form-grid">
      <label>النوع<select name="kind">${options(Object.entries(SCHEDULE_KINDS).map(([id, label]) => ({ id, label })), v.kind, { labelKey: 'label' })}</select></label>
      <label>الاسم<input name="name" maxlength="120" required value="${esc(s?.name || '')}" /></label>
      <label>مبلغ الدفعة<input name="amount" inputmode="decimal" required value="${s ? toDecimal(s.amountMinor, decimalsOf(state, s.currency)) : ''}" /></label>
      <label>العملة<select name="currency" ${s ? 'disabled' : ''}>${currencyOptions(state, v.currency)}</select></label>
      <label>حساب الدفع (اختياري)<select name="accountId">${accountOptions(state, sid, s?.accountId, { empty: 'يُحدد عند الدفع' })}</select></label>
      <label>التصنيف (للمصروف)<select name="categoryId">${categoryOptions(state, sid, s?.categoryId, 'expense')}</select></label>
      <label>الدين المرتبط (للأقساط)<select name="debtId"><option value="">— لا يوجد —</option>${debts.map((d) => `<option value="${esc(d.id)}" ${s?.debtId === d.id ? 'selected' : ''}>${esc(d.party)}</option>`).join('')}</select></label>
      <label>الجهة<input name="party" maxlength="200" value="${esc(s?.party || '')}" /></label>
      <label>تاريخ أول استحقاق<input name="startDate" type="date" required value="${esc(v.startDate)}" ${s ? 'readonly' : ''} /></label>
      <label>التكرار<select name="frequency">${options(Object.entries(FREQUENCIES).map(([id, label]) => ({ id, label })), v.frequency, { labelKey: 'label' })}</select></label>
      <label>كل كم يومًا (للتكرار المخصص)<input name="intervalDays" inputmode="numeric" value="${esc(v.intervalDays ?? '')}" /></label>
      <label>عدد الدفعات (فارغ = مستمر)<input name="count" inputmode="numeric" value="${esc(s?.count ?? '')}" /></label>
      <label>تاريخ نهاية (اختياري)<input name="endDate" type="date" value="${esc(s?.endDate || '')}" /></label>
      ${s ? '<label class="wide">تاريخ سريان التعديل (التغيير يطبَّق من هذا التاريخ فقط)<input name="effectiveFrom" type="date" required value="' + todayISO() + '" /></label>' : ''}
      <p class="hint wide">التعديل لا يغيّر الدفعات المدفوعة أو المتأخرة.</p>
      <div class="wide actions-end"><button class="primary" type="submit">حفظ</button></div>
    </form>`;
}

// ---------- التقارير ----------
function reportsView(state, sid) {
  const from = ui.money.reportFrom || `${todayISO().slice(0, 8)}01`;
  const to = ui.money.reportTo || todayISO();
  const sum = periodSummary(state, sid, from, to);
  const nw = netWorth(state, sid, state.settings.displayCurrency || 'AED', to);
  const curs = Object.keys(sum.byCurrency);
  const block = (c) => {
    const b = sum.byCurrency[c];
    const d = decimalsOf(state, c);
    const line = (label, v, note = '') => `<tr><th>${label}</th><td>${fmt(state, v, c)}</td><td class="hint small">${note}</td></tr>`;
    return `<article class="card"><h3>${esc(c)}</h3><div class="table-wrap"><table>
      ${line('الدخل', b.income, 'دخل + فوائد دين مقبوضة')}
      ${line('المصروف الإجمالي', b.grossExpense, 'يشمل الرسوم والفوائد المدفوعة')}
      ${line('الاستردادات', b.refunds, 'تُخصم من المصروف')}
      ${line('المصروف بعد الاستردادات', b.expenses)}
      ${line('الفائض النقدي التشغيلي', b.netOperating, 'دخل − مصروف (ليس صافي ربح محاسبيًا: لا يطبّق النظام محاسبة الاستحقاق)')}
      ${line('صافي الحركة النقدية', b.netCash, 'كل تغيّر أرصدة حسابات المساحة في الفترة')}
      ${line('اقتراض', b.borrowed, 'ليس دخلًا')}
      ${line('إقراض', b.lent, 'ليس مصروفًا')}
      ${line('سداد أصل دين عليّ', b.debtOut, 'ليس مصروفًا')}
      ${line('تحصيل أصل دين لي', b.debtIn, 'ليس دخلًا')}
      ${line('تسويات الرصيد', b.adjustments)}
      ${line('تمويل مالك (داخل)', b.ownerIn)}
      ${line('تمويل مالك / سحب (خارج)', b.ownerOut)}
      </table></div></article>`;
  };
  const moves = sum.ownerMoves.length
    ? `<ul class="plain">${sum.ownerMoves.map((m) => `<li>${esc(m.date)} · ${esc(m.label)} · ${fmt(state, m.amount, m.currency)} ${m.otherSpace ? `(${esc(m.otherSpace)})` : ''}</li>`).join('')}</ul>`
    : '<p class="hint">لا توجد حركات مالك في هذه الفترة.</p>';
  const nwRows = nw.rows.length
    ? nw.rows.map((r) => `<tr><td>${esc(r.currency)}</td><td>${fmt(state, r.assets, r.currency)}</td><td>${fmt(state, r.receivables, r.currency)}</td><td>${fmt(state, r.payables, r.currency)}</td><td>${fmt(state, r.net, r.currency)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="hint">لا توجد حسابات أو ديون مسجلة.</td></tr>';
  return `
    <article class="card filters">
      <label>من<input type="date" data-change="rep-from" value="${esc(from)}" /></label>
      <label>إلى<input type="date" data-change="rep-to" value="${esc(to)}" /></label>
      <label>عملة العرض<select data-change="display-cur">${currencyOptions(state, state.settings.displayCurrency || 'AED')}</select></label>
    </article>
    ${curs.length ? curs.map(block).join('') : emptyState('لا توجد عمليات في هذه الفترة', 'غيّر الفترة أو سجّل عمليات.')}
    <article class="card"><h3>حركات المالك بين المساحات</h3>${moves}<p class="hint small">الانتقال من الشخصي إلى المشروع يُصنَّف تمويل مالك، والعكس سحب مالك. لا يُحسب دخلًا ولا مصروفًا.</p></article>
    <article class="card"><h3>صافي الثروة</h3>
      <div class="table-wrap"><table><thead><tr><th>العملة</th><th>الأصول (الحسابات)</th><th>لي</th><th>عليّ</th><th>الصافي</th></tr></thead><tbody>${nwRows}</tbody></table></div>
      <p class="hint">${nw.display.total === null
        ? `لا يمكن عرض إجمالي بعملة ${esc(nw.display.currency)}: لا يوجد سعر صرف مسجَّل للعملات: ${esc(nw.display.missing.join('، '))}. أضف السعر من تبويب العملات.`
        : `الإجمالي بعملة ${esc(nw.display.currency)} بأحدث سعر مسجّل: ${fmt(state, nw.display.total, nw.display.currency)}`}</p>
      <p class="hint small">${esc(nw.scope)}</p>
    </article>`;
}

// ---------- الإعدادات المالية ----------
function settingsView(state, sid) {
  const sp = getSpace(state, sid);
  const cats = categoriesInSpace(state, sid);
  const catRows = cats.map((c) => `<li>${esc(c.name)} ${badge(c.kind === 'income' ? 'دخل' : 'مصروف')}</li>`).join('');
  const rates = [...state.finance.rates].sort((a, b) => (a.date < b.date ? 1 : -1));
  return `
    <article class="card">
      <h3>المساحات المالية</h3>
      <p class="hint small">كل مساحة لها حساباتها وتصنيفاتها وميزانياتها وتقاريرها، ولا تُجمع النتائج تلقائيًا.</p>
      <ul class="plain">${state.finance.spaces.map((s) => `<li>${esc(s.name)} ${badge(s.kind === 'personal' ? 'شخصي' : 'مشروع')}</li>`).join('')}</ul>
      <form data-form="space-add" class="inline-form"><input name="name" maxlength="80" required placeholder="اسم مساحة مشروع جديد" /><button class="ghost" type="submit">إضافة مساحة</button></form>
    </article>
    <article class="card">
      <h3>تصنيفات: ${esc(sp.name)}</h3>
      <ul class="plain">${catRows || '<li class="hint">لا توجد تصنيفات بعد.</li>'}</ul>
      <form data-form="category-add" class="inline-form">
        <input name="name" maxlength="60" required placeholder="اسم التصنيف" />
        <select name="kind"><option value="expense">مصروف</option><option value="income">دخل</option></select>
        <button class="ghost" type="submit">إضافة</button></form>
    </article>
    <article class="card">
      <h3>العملات</h3>
      <ul class="plain">${state.finance.currencies.map((c) => `<li>${esc(c.code)} — ${esc(c.name)} (${c.decimals} خانات عشرية)</li>`).join('')}</ul>
      <form data-form="currency-add" class="inline-form">
        <input name="code" maxlength="3" required placeholder="USD" style="max-width:6em" />
        <input name="name" maxlength="60" required placeholder="اسم العملة" />
        <input name="decimals" inputmode="numeric" value="2" style="max-width:5em" aria-label="الخانات العشرية" />
        <button class="ghost" type="submit">إضافة</button></form>
    </article>
    <article class="card">
      <h3>أسعار الصرف (يدوية، بتاريخ)</h3>
      <p class="hint small">السعر المسجَّل بتاريخ معين يبقى كما هو، والعمليات القديمة تُحسب بالسعر السابق لتاريخها. لا يوجد سعر حي تلقائي.</p>
      <ul class="plain">${rates.map((r) => `<li>${esc(r.date)} · 1 ${esc(r.from)} = ${esc(r.rate)} ${esc(r.to)} ${r.note ? `<span class="hint small">${esc(r.note)}</span>` : ''}</li>`).join('') || '<li class="hint">لا توجد أسعار مسجلة.</li>'}</ul>
      <form data-form="rate-add" class="form-grid">
        <label>من<select name="from">${currencyOptions(state, 'USD')}</select></label>
        <label>إلى<select name="to">${currencyOptions(state, 'AED')}</select></label>
        <label>السعر (1 من = كم من الثانية)<input name="rate" inputmode="decimal" required placeholder="3.6725" /></label>
        <label>تاريخ السعر<input name="date" type="date" required value="${todayISO()}" /></label>
        <label class="wide">ملاحظة (مصدر السعر)<input name="note" maxlength="300" /></label>
        <div class="wide actions-end"><button class="primary" type="submit">حفظ السعر</button></div>
      </form>
    </article>`;
}

// ---------- العرض الرئيسي ----------
export function renderMoney(state) {
  const sid = spaceId(state);
  const sp = getSpace(state, sid);
  const tab = ui.money.tab;
  const tabs = `<nav class="tabs" role="tablist" aria-label="أقسام أموالي">${TABS.map(
    ([id, label]) => `<button type="button" role="tab" class="tab ${tab === id ? 'active' : ''}" aria-selected="${tab === id}" data-act="money-tab" data-tab="${id}">${label}</button>`,
  ).join('')}</nav>`;
  const body = {
    accounts: () => accountsView(state, sid),
    txns: () => txnsView(state, sid),
    budgets: () => budgetsView(state, sid),
    debts: () => debtsView(state, sid),
    schedules: () => schedulesView(state, sid),
    reports: () => reportsView(state, sid),
    settings: () => settingsView(state, sid),
  }[tab]();
  return `
    <article class="card space-bar">
      <label>المساحة النشطة
        <select data-change="money-space">${options(state.finance.spaces, sid)}</select></label>
      ${badge(sp.kind === 'personal' ? 'شخصي' : 'مشروع')}
      <p class="hint small">${sp.kind === 'personal' ? 'أنت تعمل على مالك الشخصي.' : 'أنت تعمل على مساحة مشروع. التحويلات منها أو إليها تُصنَّف تمويل أو سحب مالك.'}</p>
    </article>
    ${tabs}
    <section class="stack">${body}</section>`;
}

// ---------- المعالجات ----------
function parseAmountFor(state, text, code) {
  return parseMoney(text, decimalsOf(state, code));
}

function applyTxnInput(state, d, file) {
  const sid = spaceId(state);
  const type = d.type;
  const fromAcc = d.accountId ? getAccount(state, d.accountId) : null;
  if (!fromAcc) throw new ValidationError('اختر الحساب');
  const cur = fromAcc.currency;
  const input = { type, date: d.date, accountId: d.accountId, note: d.note, party: d.party, categoryId: d.categoryId || null, debtId: d.debtId || null, refundOfId: d.refundOfId || null, dueDate: d.dueDate || null };
  if (type === 'adjust') {
    input.amountMinor = parseMoney(d.amount, decimalsOf(state, cur), { allowNegative: true });
  } else {
    input.amountMinor = parseAmountFor(state, d.amount, cur);
  }
  if (type === 'transfer') {
    if (!d.toAccountId) throw new ValidationError('اختر حساب الوجهة');
    const to = getAccount(state, d.toAccountId);
    input.toAccountId = to.id;
    if (to.currency !== cur) {
      if (!String(d.toAmount || '').trim()) throw new ValidationError('أدخل المبلغ المستلم لأن العملة مختلفة');
      input.toAmountMinor = parseMoney(d.toAmount, decimalsOf(state, to.currency));
    }
  }
  if ((type === 'transfer' || type === 'repay') && String(d.fee || '').trim()) {
    input.feeMinor = parseMoney(d.fee, decimalsOf(state, cur));
  }
  void sid;
  void file;
  return input;
}

async function attachReceipt(txnId, file) {
  if (!file || !file.size) return;
  const dataUrl = await compressImage(file, 1000, 0.8);
  ctx.store.update((s) => {
    const t = s.finance.txns.find((x) => x.id === txnId);
    if (t) t.receipt = dataUrl;
  });
}

function commitTxnForm(form, d, file) {
  const sid = spaceId(ctx.store.state);
  let createdId = null;
  const ok = runForm(
    form,
    () =>
      ctx.store.update((s) => {
        const input = applyTxnInput(s, d, file);
        const t = postTxn(s, input, newId);
        createdId = t.id;
        if (t.spaceId !== sid) throw new ValidationError('المساحة لا تطابق الحساب');
      }),
    { successMessage: 'تم تسجيل العملية' },
  );
  if (ok && file && file.size && createdId) attachReceipt(createdId, file).catch((e) => toast(e.message, 'error'));
  return ok;
}

export const handlers = {
  acts: {
    'money-tab'(el) {
      ui.money.tab = el.dataset.tab;
    },
    'acc-add'() {
      const s = ctx.store.state;
      openModal({ title: 'حساب مالي جديد', body: accountForm(s, spaceId(s)) });
    },
    'acc-edit'(el) {
      const s = ctx.store.state;
      const a = getAccount(s, el.dataset.id);
      const locked = s.finance.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id);
      openModal({ title: 'تعديل الحساب', body: accountForm(s, a.spaceId, { ...a, txnsLocked: locked }) });
    },
    'acc-reconcile'(el) {
      const s = ctx.store.state;
      const a = getAccount(s, el.dataset.id);
      openModal({
        title: `مطابقة: ${a.name}`,
        body: `<form data-form="recon-add" data-id="${esc(a.id)}" class="form-grid">
          <label>تاريخ المطابقة<input name="date" type="date" required value="${todayISO()}" /></label>
          <label>الرصيد الفعلي الآن (من البنك أو الكاش)<input name="actual" inputmode="decimal" required /></label>
          <p class="hint wide">المطابقة تُظهر الفرق فقط. لا يتغير الرصيد إلا إذا أنشأت تسوية صراحة بعدها.</p>
          <div class="wide actions-end"><button class="primary" type="submit">مطابقة</button></div></form>`,
      });
    },
    'recon-adjust'(el) {
      runAction(() => ctx.store.update((s) => createAdjustmentFromReconciliation(s, el.dataset.id, newId)), 'أُنشئت التسوية');
    },
    'acc-archive'(el) {
      runAction(() => ctx.store.update((s) => updateAccount(s, el.dataset.id, { archived: el.dataset.archived === '1' })), 'تم');
    },
    'txn-edit'(el) {
      const s = ctx.store.state;
      const t = s.finance.txns.find((x) => x.id === el.dataset.id);
      if (!t) return;
      const cats = categoriesInSpace(s, t.spaceId);
      const catField = ['income', 'expense', 'transfer', 'repay', 'refund'].includes(t.type)
        ? `<label class="wide">التصنيف<select name="categoryId" ${t.type === 'refund' ? 'disabled' : ''}>${options(cats, t.categoryId, { empty: '— بلا تصنيف —' })}</select></label>`
        : '';
      openModal({
        title: 'تعديل بيانات العملية',
        body: `<form data-form="txn-meta" data-id="${esc(t.id)}" class="form-grid">
          <label>التاريخ<input name="date" type="date" required value="${esc(t.date)}" /></label>
          <label>الجهة<input name="party" maxlength="200" value="${esc(t.party || '')}" /></label>
          ${catField}
          <label class="wide">ملاحظة<input name="note" maxlength="1000" value="${esc(t.note || '')}" /></label>
          <p class="hint wide">المبلغ والحساب لا يُعدَّلان هنا. لتصحيحهما احذف العملية (إن لم يكن لها ما يعتمد عليها) وأعد تسجيلها.</p>
          ${t.history?.length ? `<details class="wide"><summary>سجل التعديلات</summary><ul class="plain small">${t.history.map((h) => `<li>${esc(h.at.slice(0, 16).replace('T', ' '))} — ${esc(Object.keys(h.changes).join('، '))}</li>`).join('')}</ul></details>` : ''}
          <div class="wide actions-between">
            <button type="button" class="ghost danger-text" data-act="txn-delete" data-id="${esc(t.id)}">حذف العملية</button>
            <button class="primary" type="submit">حفظ</button>
          </div></form>`,
      });
    },
    async 'txn-delete'(el) {
      const ok = await confirmDialog('حذف هذه العملية؟ تُحفظ نسخة منها في سجل التدقيق. لا يمكن حذفها إذا كان لها استرداد أو سداد أو مطابقة.', 'حذف');
      if (!ok) return;
      runAction(() => ctx.store.update((s) => deleteTxn(s, el.dataset.id)), 'تم الحذف');
    },
    'budget-delete'(el) {
      runAction(() => ctx.store.update((s) => deleteBudget(s, el.dataset.id)), 'تم حذف الميزانية');
    },
    'debt-pay'(el) {
      const s = ctx.store.state;
      const d = s.finance.debts.find((x) => x.id === el.dataset.id);
      if (!d) return;
      openModal({
        title: d.direction === 'i_owe' ? `سداد لـ ${d.party}` : `تحصيل من ${d.party}`,
        wide: true,
        body: txnForm(s, { formName: 'txn-add', presetType: 'repay', presetDebtId: d.id, sid: d.spaceId }),
      });
    },
    'sch-add'() {
      const s = ctx.store.state;
      openModal({ title: 'التزام جديد', wide: true, body: scheduleForm(s, spaceId(s)) });
    },
    'sch-edit'(el) {
      const s = ctx.store.state;
      const sch = getSchedule(s, el.dataset.id);
      openModal({ title: 'تعديل الالتزام', wide: true, body: scheduleForm(s, sch.spaceId, sch) });
    },
    'sch-cancel'(el) {
      openModal({
        title: 'إلغاء الالتزام',
        body: `<form data-form="sch-cancel" data-id="${esc(el.dataset.id)}" class="form-grid">
          <label class="wide">إلغاء من تاريخ<input name="effectiveFrom" type="date" required value="${todayISO()}" /></label>
          <p class="hint wide">الدفعات المدفوعة والمتأخرة تبقى كما هي. تُحذف فقط الدفعات القادمة غير المدفوعة.</p>
          <div class="wide actions-end"><button class="danger" type="submit">إلغاء الالتزام</button></div></form>`,
      });
    },
    'occ-pay'(el) {
      const s = ctx.store.state;
      const sch = getSchedule(s, el.dataset.sch);
      const occ = sch.occurrences.find((o) => o.id === el.dataset.occ);
      if (!occ) return;
      const remaining = occ.expectedMinor - occ.paidMinor;
      openModal({
        title: `دفع: ${sch.name}`,
        body: `<form data-form="occ-pay" data-sch="${esc(sch.id)}" data-occ="${esc(occ.id)}" class="form-grid">
          <label>الحساب<select name="accountId">${accountOptions(s, sch.spaceId, sch.accountId, { onlyCurrency: sch.currency })}</select></label>
          <label>التاريخ<input name="date" type="date" required value="${todayISO()}" /></label>
          <label>المبلغ المدفوع الآن<input name="amount" inputmode="decimal" required value="${toDecimal(remaining, decimalsOf(s, sch.currency))}" /></label>
          <label>التصنيف (إن لم يكن محددًا في الالتزام)<select name="categoryId">${categoryOptions(s, sch.spaceId, sch.categoryId, 'expense')}</select></label>
          <p class="hint wide">المتبقي من هذه الدفعة ${fmt(s, remaining, sch.currency)}. الدفع الجزئي يُسجَّل كعملية واحدة، والباقي يبقى مستحقًا.</p>
          <div class="wide actions-end"><button class="primary" type="submit">تسجيل الدفع</button></div></form>`,
      });
    },
    'occ-link'(el) {
      const s = ctx.store.state;
      const sch = getSchedule(s, el.dataset.sch);
      const linkable = s.finance.txns.filter((t) => t.spaceId === sch.spaceId && t.currency === sch.currency && !t.scheduleId && (t.type === 'expense' || t.type === 'repay'));
      if (!linkable.length) {
        toast('لا توجد عمليات مناسبة للربط في نفس المساحة وبنفس العملة', 'error');
        return;
      }
      openModal({
        title: 'ربط بعملية مسجلة',
        body: `<form data-form="occ-link" data-sch="${esc(sch.id)}" data-occ="${esc(el.dataset.occ)}" class="form-grid">
          <label class="wide">العملية<select name="txnId">${linkable.map((t) => `<option value="${esc(t.id)}">${esc(txnLabel(s, t))}</option>`).join('')}</select></label>
          <p class="hint wide">الربط لا ينشئ عملية جديدة، ولا يغيّر الرصيد.</p>
          <div class="wide actions-end"><button class="primary" type="submit">ربط</button></div></form>`,
      });
    },
  },
  forms: {
    'txn-add'(form, d) {
      const file = form.querySelector('input[type=file]')?.files?.[0] || null;
      commitTxnForm(form, d, file);
    },
    'txn-meta'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => editTxnMeta(s, form.dataset.id, { date: d.date, party: d.party, note: d.note, categoryId: d.categoryId !== undefined ? d.categoryId || null : undefined })),
        { successMessage: 'تم حفظ التعديل' },
      );
    },
    'recon-add'(form) {
      const d = formData(form);
      runForm(form, () => {
        const actual = parseMoney(d.actual, decimalsOf(ctx.store.state, getAccount(ctx.store.state, form.dataset.id).currency), { allowNegative: true });
        ctx.store.update((s) => reconcileAccount(s, form.dataset.id, d.date, actual, newId));
      }, { successMessage: 'تمت المطابقة' });
    },
    'acc-add-form'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => {
          const dec = decimalsOf(s, d.currency);
          addAccount(s, { spaceId: d.spaceId, name: d.name, kind: d.kind, currency: d.currency, openingMinor: parseMoney(d.openingMinor || '0', dec, { allowNegative: true }), openingDate: d.openingDate }, newId);
        }),
        { successMessage: 'أُضيف الحساب' },
      );
    },
    'acc-save'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => {
          const a = getAccount(s, form.dataset.id);
          const locked = s.finance.txns.some((t) => t.accountId === a.id || t.toAccountId === a.id);
          const patch = { name: d.name, kind: d.kind };
          if (!locked) {
            patch.currency = d.currency;
            patch.openingMinor = parseMoney(d.openingMinor || '0', decimalsOf(s, d.currency), { allowNegative: true });
            patch.openingDate = d.openingDate;
          }
          updateAccount(s, a.id, patch);
        }),
        { successMessage: 'تم حفظ الحساب' },
      );
    },
    'budget-add'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => {
          const sid = spaceId(s);
          const dec = decimalsOf(s, d.currency);
          const lines = parseLines(d.lines).map((line) => {
            const idx = line.lastIndexOf('|');
            if (idx === -1) throw new ValidationError(`سطر غير صحيح: ${line}`);
            const name = line.slice(0, idx).trim();
            const cat = categoriesInSpace(s, sid, 'expense').find((c) => c.name === name);
            if (!cat) throw new ValidationError(`التصنيف "${name}" غير موجود كمصروف في هذه المساحة`);
            return { categoryId: cat.id, plannedMinor: parseMoney(line.slice(idx + 1), dec) };
          });
          addBudget(s, { spaceId: sid, name: d.name, start: d.start, end: d.end, currency: d.currency, lines }, newId);
        }),
        { successMessage: 'أُنشئت الميزانية' },
      );
    },
    'sch-add-form'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => {
          addSchedule(
            s,
            {
              spaceId: spaceId(s),
              kind: d.kind,
              name: d.name,
              amountMinor: parseMoney(d.amount, decimalsOf(s, d.currency)),
              currency: d.currency,
              accountId: d.accountId || null,
              categoryId: d.categoryId || null,
              debtId: d.debtId || null,
              party: d.party,
              startDate: d.startDate,
              frequency: d.frequency,
              intervalDays: d.intervalDays,
              count: d.count || null,
              endDate: d.endDate || null,
            },
            newId,
          );
        }),
        { successMessage: 'أُضيف الالتزام' },
      );
    },
    'sch-edit-save'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => {
          const sch = getSchedule(s, form.dataset.id);
          editSchedule(
            s,
            sch.id,
            {
              name: d.name,
              kind: d.kind,
              amountMinor: parseMoney(d.amount, decimalsOf(s, sch.currency)),
              accountId: d.accountId || null,
              categoryId: d.categoryId || null,
              debtId: d.debtId || null,
              party: d.party,
              frequency: d.frequency,
              intervalDays: d.intervalDays,
              count: d.count || null,
              endDate: d.endDate || null,
            },
            d.effectiveFrom,
            newId,
          );
        }),
        { successMessage: 'تم حفظ التعديل من التاريخ المحدد' },
      );
    },
    'sch-cancel'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => cancelSchedule(s, form.dataset.id, d.effectiveFrom)), { successMessage: 'أُلغي الالتزام' });
    },
    'occ-pay'(form) {
      const d = formData(form);
      runForm(form, () =>
        ctx.store.update((s) => {
          const sch = getSchedule(s, form.dataset.sch);
          const amount = parseMoney(d.amount, decimalsOf(s, sch.currency));
          payOccurrence(s, sch.id, form.dataset.occ, { accountId: d.accountId, date: d.date, amountMinor: amount, categoryId: d.categoryId || null }, newId);
        }),
        { successMessage: 'تم تسجيل الدفع' },
      );
    },
    'occ-link'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => linkExistingTxn(s, form.dataset.sch, form.dataset.occ, d.txnId)), { successMessage: 'تم الربط' });
    },
    'space-add'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => addSpace(s, d.name, newId)), { keepOpen: true, successMessage: 'أُضيفت المساحة' });
      form.reset();
    },
    'category-add'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => addCategory(s, spaceId(s), d.name, d.kind, newId)), { keepOpen: true, successMessage: 'أُضيف التصنيف' });
      form.reset();
    },
    'currency-add'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => addCurrency(s, d.code, d.name, d.decimals)), { keepOpen: true, successMessage: 'أُضيفت العملة' });
      form.reset();
    },
    'rate-add'(form) {
      const d = formData(form);
      runForm(form, () => ctx.store.update((s) => addRate(s, { from: d.from, to: d.to, rate: normalizeDigits(d.rate), date: d.date, note: d.note }, newId)), { successMessage: 'حُفظ السعر' });
    },
  },
  changes: {
    'money-space'(el) {
      ui.money.spaceId = el.value;
    },
    'money-type'(el) {
      ui.money.type = el.value;
    },
    'money-account'(el) {
      ui.money.accountId = el.value;
    },
    'money-query'(el) {
      ui.money.query = el.value;
    },
    'rep-from'(el) {
      ui.money.reportFrom = el.value;
    },
    'rep-to'(el) {
      ui.money.reportTo = el.value;
    },
    'display-cur'(el) {
      runAction(() => ctx.store.update((s) => {
        s.settings.displayCurrency = el.value;
      }));
    },
    'txn-type'(el) {
      const type = el.value;
      const form = el.closest('form');
      for (const field of form.querySelectorAll('[data-field]')) {
        const types = field.dataset.types.split(' ');
        field.hidden = !types.includes(type);
      }
      const hint = form.querySelector('[data-hint]');
      if (hint) {
        hint.textContent = {
          transfer: 'التحويل لا يُحسب دخلًا ولا مصروفًا. الرسوم فقط مصروف. إذا اختلفت العملة أدخل المبلغ المستلم.',
          repay: 'السداد يفصل الأصل عن الرسوم أو الفوائد. اختر الدين المرتبط.',
          borrow: 'الاقتراض يزيد رصيد الحساب ويُسجَّل دينًا عليك، وليس دخلًا.',
          lend: 'الإقراض ينقص رصيد الحساب ويُسجَّل دينًا لك، وليس مصروفًا.',
          refund: 'الاسترداد يُخصم من المصروف الأصلي ولا يتجاوزه.',
          adjust: 'تسوية الرصيد تغيّره بمبلغ موجب أو سالب، ويجب كتابة السبب.',
        }[type] || '';
      }
      // false: تغيير نوع العملة يخفي الحقول فقط. إعادة رسم الصفحة كانت ستمسح ما كتبه المستخدم.
      return false;
    },
  },
};
