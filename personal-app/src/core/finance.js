// المال: مساحات منفصلة، حسابات، عمليات، ديون، ميزانيات، التزامات مجدولة، مطابقة، أسعار صرف.
// القواعد الحاكمة:
// - كل المبالغ أعداد صحيحة بأصغر وحدة. لا جمع بين عملات مختلفة دون سعر صرف مسجَّل.
// - التحويل بين حساباتي لا يُحسب دخلًا ولا مصروفًا. الرسوم فقط تُحسب مصروفًا.
// - الأرصدة الافتتاحية لا تُحسب دخلًا للفترة.
// - السداد يفصل الأصل عن الرسوم/الفوائد. قبض دين لا يُحسب دخلًا، إلا الفوائد المقبوضة.
// - الالتزام المجدول لا يغيّر الرصيد حتى يُسجَّل الدفع فعليًا.

import {
  ValidationError,
  assertMinor,
  formatMoney,
  parseRate,
  invertRate,
  convertMinor,
} from './money.js';
import { assertISODate, addDays, addMonthsAnchored, todayISO } from './dates.js';
import { requireText, optionalText } from './text.js';

export const TXN_TYPES = {
  income: 'دخل',
  expense: 'مصروف',
  transfer: 'تحويل',
  borrow: 'اقتراض',
  lend: 'إقراض',
  repay: 'سداد أو تحصيل دين',
  refund: 'استرداد مشتريات',
  adjust: 'تسوية رصيد',
};

export const ACCOUNT_KINDS = { cash: 'كاش', bank: 'حساب بنكي', wallet: 'محفظة', other: 'أخرى' };
export const SCHEDULE_KINDS = { installment: 'قسط', subscription: 'اشتراك', bill: 'فاتورة' };
export const FREQUENCIES = { monthly: 'شهري', weekly: 'أسبوعي', every_days: 'كل عدد أيام' };
const HORIZON_DAYS = 730;
const MAX_OCCURRENCES = 1000;

// --- بحث ---
const F = (state) => state.finance;

export function getSpace(state, id) {
  const s = F(state).spaces.find((x) => x.id === id);
  if (!s) throw new ValidationError('المساحة المالية غير موجودة');
  return s;
}

export function getCurrency(state, code) {
  const c = F(state).currencies.find((x) => x.code === code);
  if (!c) throw new ValidationError(`العملة ${code} غير مضافة`);
  return c;
}

export function getAccount(state, id) {
  const a = F(state).accounts.find((x) => x.id === id);
  if (!a) throw new ValidationError('الحساب غير موجود');
  return a;
}

export function getDebt(state, id) {
  const d = F(state).debts.find((x) => x.id === id);
  if (!d) throw new ValidationError('الدين غير موجود');
  return d;
}

export function getTxn(state, id) {
  const t = F(state).txns.find((x) => x.id === id);
  if (!t) throw new ValidationError('العملية غير موجودة');
  return t;
}

export function getSchedule(state, id) {
  const s = F(state).schedules.find((x) => x.id === id);
  if (!s) throw new ValidationError('الالتزام غير موجود');
  return s;
}

export function accountsInSpace(state, spaceId, { includeArchived = false } = {}) {
  return F(state).accounts.filter((a) => a.spaceId === spaceId && (includeArchived || !a.archived));
}

export function categoriesInSpace(state, spaceId, kind) {
  return F(state).categories.filter((c) => c.spaceId === spaceId && (!kind || c.kind === kind));
}

function requireCategory(state, spaceId, categoryId, kind) {
  if (!categoryId) throw new ValidationError(`اختر تصنيف ${kind === 'income' ? 'الدخل' : 'المصروف'}`);
  const cat = F(state).categories.find((c) => c.id === categoryId);
  if (!cat || cat.spaceId !== spaceId) throw new ValidationError('التصنيف لا يتبع هذه المساحة');
  if (cat.kind !== kind) throw new ValidationError('نوع التصنيف لا يطابق العملية');
  return cat;
}

// --- المساحات والعملات والتصنيفات ---
export function addSpace(state, name, idFactory) {
  const space = { id: idFactory(), name: requireText(name, 'اسم المساحة', 80), kind: 'project' };
  F(state).spaces.push(space);
  return space;
}

export function addCurrency(state, code, name, decimals) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new ValidationError('رمز العملة يجب أن يكون ثلاثة أحرف لاتينية');
  if (F(state).currencies.some((x) => x.code === c)) throw new ValidationError('العملة مضافة بالفعل');
  const d = Number(decimals);
  if (!Number.isInteger(d) || d < 0 || d > 4) throw new ValidationError('عدد الخانات العشرية بين 0 و4');
  F(state).currencies.push({ code: c, name: requireText(name, 'اسم العملة', 60), decimals: d });
}

export function addCategory(state, spaceId, name, kind, idFactory) {
  getSpace(state, spaceId);
  if (kind !== 'income' && kind !== 'expense') throw new ValidationError('نوع التصنيف غير معروف');
  const clean = requireText(name, 'اسم التصنيف', 60);
  if (F(state).categories.some((c) => c.spaceId === spaceId && c.kind === kind && c.name === clean)) {
    throw new ValidationError('التصنيف موجود بالفعل');
  }
  const cat = { id: idFactory(), spaceId, name: clean, kind };
  F(state).categories.push(cat);
  return cat;
}

// --- الحسابات ---
export function addAccount(state, input, idFactory) {
  getSpace(state, input.spaceId);
  getCurrency(state, input.currency);
  assertISODate(input.openingDate, 'تاريخ بداية الحساب');
  if (!ACCOUNT_KINDS[input.kind]) throw new ValidationError('نوع الحساب غير معروف');
  const opening = input.openingMinor === undefined ? 0 : Number(input.openingMinor);
  if (!Number.isSafeInteger(opening)) throw new ValidationError('الرصيد الافتتاحي غير صحيح');
  const account = {
    id: idFactory(),
    spaceId: input.spaceId,
    name: requireText(input.name, 'اسم الحساب', 80),
    kind: input.kind,
    currency: input.currency,
    openingMinor: opening,
    openingDate: input.openingDate,
    archived: false,
  };
  F(state).accounts.push(account);
  return account;
}

function hasTxnsOn(state, accountId) {
  return F(state).txns.some((t) => t.accountId === accountId || t.toAccountId === accountId);
}

export function updateAccount(state, id, patch) {
  const a = getAccount(state, id);
  if (patch.name !== undefined) a.name = requireText(patch.name, 'اسم الحساب', 80);
  if (patch.kind !== undefined) {
    if (!ACCOUNT_KINDS[patch.kind]) throw new ValidationError('نوع الحساب غير معروف');
    a.kind = patch.kind;
  }
  const lockFinancials = hasTxnsOn(state, id);
  if (patch.currency !== undefined && patch.currency !== a.currency) {
    if (lockFinancials) throw new ValidationError('لا تُغيَّر عملة حساب فيه عمليات');
    getCurrency(state, patch.currency);
    a.currency = patch.currency;
  }
  if (patch.openingMinor !== undefined || patch.openingDate !== undefined) {
    if (lockFinancials) throw new ValidationError('لا يُغيَّر الرصيد الافتتاحي بعد وجود عمليات؛ استخدم تسوية الرصيد');
    if (patch.openingMinor !== undefined) a.openingMinor = Number(patch.openingMinor);
    if (patch.openingDate !== undefined) a.openingDate = assertISODate(patch.openingDate, 'تاريخ البداية');
  }
  if (patch.archived !== undefined) a.archived = Boolean(patch.archived);
  return a;
}

// --- أسعار الصرف (يُدخلها المستخدم يدويًا بتاريخ) ---
export function addRate(state, { from, to, rate, date, note }, idFactory) {
  getCurrency(state, from);
  getCurrency(state, to);
  if (from === to) throw new ValidationError('لا حاجة لسعر بين العملة ونفسها');
  assertISODate(date, 'تاريخ السعر');
  parseRate(rate);
  const r = { id: idFactory(), from, to, rate: String(rate).trim(), date, note: optionalText(note, 300) };
  F(state).rates.push(r);
  return r;
}

// أحدث سعر مسجَّل بتاريخ <= asOf. السعر المسجَّل لعملية لا يُستبدل لاحقًا لأن العملية تبقى مرتبطة بتاريخها.
export function findRate(state, from, to, asOf) {
  if (from === to) return { num: 1n, den: 1n, date: asOf, inverted: false };
  const rates = F(state).rates;
  const pick = (a, b) => {
    const cands = rates.filter((r) => r.from === a && r.to === b && r.date <= asOf);
    if (cands.length === 0) return null;
    cands.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    return cands[cands.length - 1];
  };
  const direct = pick(from, to);
  if (direct) return { ...parseRate(direct.rate), date: direct.date, inverted: false };
  const inverse = pick(to, from);
  if (inverse) return { ...invertRate(parseRate(inverse.rate)), date: inverse.date, inverted: true };
  return null;
}

// يُرجع المبلغ بعملة الهدف، أو null إذا لا يوجد سعر. لا يخمّن أي سعر.
export function convertAmount(state, minor, from, to, asOf) {
  if (from === to) return minor;
  const rate = findRate(state, from, to, asOf);
  if (!rate) return null;
  return convertMinor(minor, getCurrency(state, from).decimals, getCurrency(state, to).decimals, rate);
}

// --- الديون ---
export function debtRemaining(state, debt) {
  const paid = F(state).txns
    .filter((t) => t.type === 'repay' && t.debtId === debt.id)
    .reduce((sum, t) => sum + (t.amountMinor - t.feeMinor), 0);
  return debt.principalMinor - paid;
}

// --- تسجيل العمليات (المدخل الوحيد لتغيير الأرصدة) ---
function countRefunds(state, txnId) {
  return F(state).txns
    .filter((t) => t.type === 'refund' && t.refundOfId === txnId)
    .reduce((sum, t) => sum + t.amountMinor, 0);
}

export function postTxn(state, input, idFactory, now = new Date().toISOString()) {
  if (!TXN_TYPES[input.type]) throw new ValidationError('نوع العملية غير معروف');
  assertISODate(input.date, 'تاريخ العملية');
  const account = getAccount(state, input.accountId);
  if (account.archived) throw new ValidationError('الحساب مؤرشف ولا تُسجَّل عليه عمليات جديدة');
  if (input.date < account.openingDate) throw new ValidationError('تاريخ العملية يسبق تاريخ بداية الحساب');
  const spaceId = account.spaceId;
  const cur = account.currency;
  const type = input.type;

  const txn = {
    id: idFactory(),
    spaceId,
    type,
    date: input.date,
    accountId: account.id,
    toAccountId: null,
    amountMinor: 0,
    currency: cur,
    toAmountMinor: null,
    toCurrency: null,
    feeMinor: 0,
    categoryId: null,
    party: optionalText(input.party, 200),
    note: optionalText(input.note, 1000),
    receipt: null,
    refundOfId: null,
    debtId: null,
    scheduleId: null,
    occurrenceId: null,
    crossSpace: false,
    createdAt: now,
    updatedAt: now,
  };
  const newDebts = [];

  if (type === 'adjust') {
    const amt = Number(input.amountMinor);
    if (!Number.isSafeInteger(amt) || amt === 0) throw new ValidationError('مبلغ التسوية يجب أن يكون رقمًا صحيحًا غير صفري');
    txn.amountMinor = amt;
    txn.note = requireText(input.note, 'سبب التسوية', 1000);
  } else {
    txn.amountMinor = assertMinor(Number(input.amountMinor));
    const amount = txn.amountMinor;

    if (type === 'income') {
      txn.categoryId = requireCategory(state, spaceId, input.categoryId, 'income').id;
    } else if (type === 'expense') {
      txn.categoryId = requireCategory(state, spaceId, input.categoryId, 'expense').id;
    } else if (type === 'transfer') {
      const to = getAccount(state, input.toAccountId);
      if (to.id === account.id) throw new ValidationError('لا يمكن التحويل إلى الحساب نفسه');
      if (to.archived) throw new ValidationError('حساب الوجهة مؤرشف');
      txn.toAccountId = to.id;
      txn.toCurrency = to.currency;
      if (to.currency === cur) {
        txn.toAmountMinor = amount;
      } else {
        txn.toAmountMinor = assertMinor(Number(input.toAmountMinor), { label: 'المبلغ المستلم' });
      }
      const fee = input.feeMinor === undefined || input.feeMinor === '' ? 0 : Number(input.feeMinor);
      if (!Number.isSafeInteger(fee) || fee < 0) throw new ValidationError('الرسوم يجب أن تكون صفرًا أو أكبر');
      txn.feeMinor = fee;
      if (fee > 0) txn.categoryId = requireCategory(state, spaceId, input.categoryId, 'expense').id;
      txn.crossSpace = to.spaceId !== spaceId;
    } else if (type === 'borrow' || type === 'lend') {
      const debt = {
        id: idFactory(),
        spaceId,
        direction: type === 'borrow' ? 'i_owe' : 'owed_to_me',
        party: requireText(input.party, 'اسم الجهة أو الشخص', 200),
        principalMinor: amount,
        currency: cur,
        date: input.date,
        dueDate: input.dueDate ? assertISODate(input.dueDate, 'تاريخ الاستحقاق') : null,
        note: optionalText(input.note, 500),
        archived: false,
        createdAt: now,
      };
      if (debt.dueDate && debt.dueDate < debt.date) throw new ValidationError('تاريخ الاستحقاق يسبق تاريخ الدين');
      newDebts.push(debt);
      txn.debtId = debt.id;
      txn.party = debt.party;
    } else if (type === 'repay') {
      const debt = getDebt(state, input.debtId);
      if (debt.spaceId !== spaceId) throw new ValidationError('الدين لا يتبع هذه المساحة');
      if (debt.currency !== cur) throw new ValidationError('عملة الحساب مختلفة عن عملة الدين');
      const fee = input.feeMinor === undefined || input.feeMinor === '' ? 0 : Number(input.feeMinor);
      if (!Number.isSafeInteger(fee) || fee < 0) throw new ValidationError('الرسوم أو الفوائد يجب أن تكون صفرًا أو أكبر');
      if (fee >= amount) throw new ValidationError('الرسوم أو الفوائد يجب أن تكون أقل من المبلغ الكلي');
      const principal = amount - fee;
      const remaining = debtRemaining(state, debt);
      if (principal > remaining) {
        throw new ValidationError(`المبلغ يتجاوز المتبقي من الأصل (${formatMoney(remaining, cur)})`);
      }
      txn.debtId = debt.id;
      txn.feeMinor = fee;
      txn.party = debt.party;
      if (fee > 0) {
        const kind = debt.direction === 'i_owe' ? 'expense' : 'income';
        txn.categoryId = requireCategory(state, spaceId, input.categoryId, kind).id;
      }
    } else if (type === 'refund') {
      const orig = getTxn(state, input.refundOfId);
      if (orig.type !== 'expense') throw new ValidationError('الاسترداد يرتبط بمصروف فقط');
      if (orig.spaceId !== spaceId) throw new ValidationError('المصروف الأصلي في مساحة أخرى');
      if (orig.currency !== cur) throw new ValidationError('عملة الاسترداد يجب أن تطابق المصروف الأصلي');
      const already = countRefunds(state, orig.id);
      if (already + amount > orig.amountMinor) throw new ValidationError('مجموع الاستردادات يتجاوز مبلغ المصروف الأصلي');
      txn.refundOfId = orig.id;
      txn.categoryId = orig.categoryId;
    }
  }

  for (const d of newDebts) F(state).debts.push(d);
  F(state).txns.push(txn);
  return txn;
}

// أثر العملية على كل حساب: قائمة [accountId, deltaMinor].
export function txnEffects(state, txn) {
  const a = txn.amountMinor;
  switch (txn.type) {
    case 'income':
    case 'borrow':
    case 'refund':
      return [[txn.accountId, a]];
    case 'expense':
    case 'lend':
      return [[txn.accountId, -a]];
    case 'transfer':
      return [
        [txn.accountId, -(a + txn.feeMinor)],
        [txn.toAccountId, txn.toAmountMinor],
      ];
    case 'repay': {
      const debt = getDebt(state, txn.debtId);
      return [[txn.accountId, debt.direction === 'i_owe' ? -a : a]];
    }
    case 'adjust':
      return [[txn.accountId, a]];
    default:
      return [];
  }
}

// الرصيد المحسوب من الحساب الافتتاحي + كل العمليات حتى تاريخ معيّن (اختياري).
export function accountBalance(state, accountId, asOf = null) {
  const acc = getAccount(state, accountId);
  let bal = acc.openingMinor;
  for (const t of F(state).txns) {
    if (asOf && t.date > asOf) continue;
    for (const [id, delta] of txnEffects(state, t)) {
      if (id === accountId) bal += delta;
    }
  }
  return bal;
}

// --- تقرير الفترة لمساحة واحدة. لا تُجمع المساحات تلقائيًا، ولا تُجمع العملات تلقائيًا. ---
export function periodSummary(state, spaceId, from, to) {
  const byCur = {};
  const bucket = (c) => {
    if (!byCur[c]) {
      byCur[c] = {
        income: 0,
        grossExpense: 0,
        refunds: 0,
        borrowed: 0,
        lent: 0,
        debtIn: 0,
        debtOut: 0,
        adjustments: 0,
        ownerIn: 0,
        ownerOut: 0,
        netCash: 0,
      };
    }
    return byCur[c];
  };
  const inRange = (d) => d >= from && d <= to;
  const accSpace = (id) => getAccount(state, id).spaceId;
  let transfers = 0;
  const ownerMoves = [];

  for (const t of F(state).txns) {
    if (!inRange(t.date)) continue;
    if (t.spaceId === spaceId) {
      const b = bucket(t.currency);
      switch (t.type) {
        case 'income':
          b.income += t.amountMinor;
          break;
        case 'expense':
          b.grossExpense += t.amountMinor;
          break;
        case 'refund':
          b.refunds += t.amountMinor;
          break;
        case 'borrow':
          b.borrowed += t.amountMinor;
          break;
        case 'lend':
          b.lent += t.amountMinor;
          break;
        case 'repay': {
          const debt = getDebt(state, t.debtId);
          const principal = t.amountMinor - t.feeMinor;
          if (debt.direction === 'i_owe') {
            b.debtOut += principal;
            b.grossExpense += t.feeMinor;
          } else {
            b.debtIn += principal;
            b.income += t.feeMinor;
          }
          break;
        }
        case 'adjust':
          b.adjustments += t.amountMinor;
          break;
        case 'transfer':
          transfers += 1;
          if (t.feeMinor > 0) b.grossExpense += t.feeMinor;
          if (t.crossSpace) {
            const dest = getSpace(state, accSpace(t.toAccountId));
            b.ownerOut += t.amountMinor;
            ownerMoves.push({
              direction: 'out',
              label: dest.kind === 'project' ? 'تمويل مالك للمشروع' : 'سحب مالك إلى الشخصي',
              amount: t.amountMinor,
              currency: t.currency,
              date: t.date,
              otherSpace: dest.name,
            });
          }
          break;
        default:
          break;
      }
    }
    if (t.type === 'transfer' && t.crossSpace && accSpace(t.toAccountId) === spaceId) {
      const b = bucket(t.toCurrency);
      b.ownerIn += t.toAmountMinor;
      const src = getSpace(state, t.spaceId);
      ownerMoves.push({
        direction: 'in',
        label: src.kind === 'personal' ? 'تمويل مالك من الشخصي' : 'سحب مالك من المشروع',
        amount: t.toAmountMinor,
        currency: t.toCurrency,
        date: t.date,
        otherSpace: src.name,
      });
    }
  }

  // صافي الحركة النقدية: كل أثر على حسابات هذه المساحة داخل الفترة، بعملة كل حساب.
  for (const t of F(state).txns) {
    if (!inRange(t.date)) continue;
    for (const [accId, delta] of txnEffects(state, t)) {
      const acc = getAccount(state, accId);
      if (acc.spaceId !== spaceId) continue;
      bucket(acc.currency).netCash += delta;
    }
  }

  for (const c of Object.keys(byCur)) {
    const b = byCur[c];
    b.expenses = b.grossExpense - b.refunds;
    b.netOperating = b.income - b.expenses;
  }
  return { byCurrency: byCur, transfers, ownerMoves };
}

// --- الميزانيات ---
export function addBudget(state, input, idFactory) {
  getSpace(state, input.spaceId);
  assertISODate(input.start, 'بداية الميزانية');
  assertISODate(input.end, 'نهاية الميزانية');
  if (input.end < input.start) throw new ValidationError('نهاية الميزانية تسبق بدايتها');
  getCurrency(state, input.currency);
  const name = requireText(input.name, 'اسم الميزانية', 80);
  const seen = new Set();
  const lines = (input.lines || []).map((l) => {
    requireCategory(state, input.spaceId, l.categoryId, 'expense');
    if (seen.has(l.categoryId)) throw new ValidationError('تصنيف مكرر في الميزانية');
    seen.add(l.categoryId);
    return { categoryId: l.categoryId, plannedMinor: assertMinor(Number(l.plannedMinor), { label: 'المبلغ المخطط' }) };
  });
  if (lines.length === 0) throw new ValidationError('أضف تصنيفًا واحدًا على الأقل');
  const budget = { id: idFactory(), spaceId: input.spaceId, name, start: input.start, end: input.end, currency: input.currency, lines };
  F(state).budgets.push(budget);
  return budget;
}

export function deleteBudget(state, id) {
  F(state).budgets = F(state).budgets.filter((b) => b.id !== id);
}

// المدفوع فعليًا من العمليات، والالتزامات القادمة من الجداول غير المدفوعة. لا يُجمع إلا بعملة الميزانية.
export function budgetStatus(state, budgetId) {
  const budget = F(state).budgets.find((b) => b.id === budgetId);
  if (!budget) throw new ValidationError('الميزانية غير موجودة');
  const inRange = (d) => d >= budget.start && d <= budget.end;
  const rows = budget.lines.map((line) => {
    let paid = 0;
    let refunds = 0;
    let unconvertedCount = 0;
    for (const t of F(state).txns) {
      if (t.spaceId !== budget.spaceId || !inRange(t.date)) continue;
      const isCat = t.categoryId === line.categoryId;
      if (!isCat) continue;
      const amt = (() => {
        if (t.type === 'expense') return t.amountMinor;
        if ((t.type === 'transfer' || t.type === 'repay') && t.feeMinor > 0) return t.feeMinor;
        if (t.type === 'refund') return -t.amountMinor;
        return 0;
      })();
      if (amt === 0) continue;
      if (t.currency !== budget.currency) {
        unconvertedCount += 1;
        continue;
      }
      if (t.type === 'refund') refunds += t.amountMinor;
      paid += amt;
    }
    let committed = 0;
    for (const s of F(state).schedules) {
      if (s.spaceId !== budget.spaceId || s.categoryId !== line.categoryId) continue;
      if (s.currency !== budget.currency) continue;
      for (const o of s.occurrences) {
        if (!inRange(o.dueDate)) continue;
        committed += Math.max(0, o.expectedMinor - o.paidMinor);
      }
    }
    const cat = F(state).categories.find((c) => c.id === line.categoryId);
    return {
      categoryId: line.categoryId,
      categoryName: cat?.name || 'تصنيف محذوف',
      planned: line.plannedMinor,
      paid,
      committed,
      remaining: line.plannedMinor - paid,
      afterCommitted: line.plannedMinor - paid - committed,
      overrun: paid > line.plannedMinor,
      unconvertedCount,
      refunds,
    };
  });
  return { budget, rows };
}

// تحذير تداخل: ميزانيتان تغطيان نفس التصنيف في فترات متداخلة. لا تُجمعان في إجمالي.
export function budgetOverlaps(state, spaceId) {
  const list = F(state).budgets.filter((b) => b.spaceId === spaceId);
  const warnings = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      const overlapsInDates = a.start <= b.end && b.start <= a.end;
      if (!overlapsInDates) continue;
      const shared = a.lines.filter((l) => b.lines.some((m) => m.categoryId === l.categoryId));
      if (shared.length) warnings.push({ a: a.name, b: b.name, categories: shared.map((l) => l.categoryId) });
    }
  }
  return warnings;
}

// --- الالتزامات المجدولة: أقساط واشتراكات وفواتير ---
function dueDateFor(schedule, k) {
  if (schedule.frequency === 'monthly') return addMonthsAnchored(schedule.startDate, k, schedule.anchorDay);
  if (schedule.frequency === 'weekly') return addDays(schedule.startDate, 7 * k);
  return addDays(schedule.startDate, schedule.intervalDays * k);
}

// يبني تواريخ الاستحقاق حسب القاعدة. مع عدد محدد: بالضبط count. بدونه: حتى النهاية أو الأفق.
export function buildDueDates(rule, today) {
  const horizon = addDays(today, HORIZON_DAYS);
  const out = [];
  for (let k = 0; out.length < MAX_OCCURRENCES; k++) {
    if (rule.count !== null && rule.count !== undefined && k >= rule.count) break;
    const due = dueDateFor(rule, k);
    if (rule.endDate && due > rule.endDate) break;
    if ((rule.count === null || rule.count === undefined) && !rule.endDate && due > horizon) break;
    out.push(due);
  }
  return out;
}

function validateRule(state, rule) {
  if (!SCHEDULE_KINDS[rule.kind]) throw new ValidationError('نوع الالتزام غير معروف');
  if (!FREQUENCIES[rule.frequency]) throw new ValidationError('التكرار غير معروف');
  assertISODate(rule.startDate, 'تاريخ البداية');
  if (rule.frequency === 'every_days' && !(Number.isInteger(rule.intervalDays) && rule.intervalDays > 0)) {
    throw new ValidationError('عدد الأيام بين الدفعات يجب أن يكون عددًا صحيحًا موجبًا');
  }
  if (rule.count !== null && rule.count !== undefined && !(Number.isInteger(rule.count) && rule.count > 0 && rule.count <= 600)) {
    throw new ValidationError('عدد الدفعات يجب أن يكون بين 1 و600 أو فارغًا للاستمرار');
  }
  if (rule.endDate) {
    assertISODate(rule.endDate, 'تاريخ النهاية');
    if (rule.endDate < rule.startDate) throw new ValidationError('تاريخ النهاية يسبق البداية');
  }
  assertMinor(Number(rule.amountMinor), { label: 'مبلغ الدفعة' });
  getCurrency(state, rule.currency);
  getSpace(state, rule.spaceId);
  if (rule.accountId) {
    const acc = getAccount(state, rule.accountId);
    if (acc.spaceId !== rule.spaceId || acc.currency !== rule.currency) {
      throw new ValidationError('حساب الدفع يجب أن يكون في نفس المساحة وبنفس عملة الالتزام');
    }
  }
  if (rule.categoryId) requireCategory(state, rule.spaceId, rule.categoryId, 'expense');
  if (rule.debtId) {
    const debt = getDebt(state, rule.debtId);
    if (debt.spaceId !== rule.spaceId || debt.currency !== rule.currency) {
      throw new ValidationError('الدين المرتبط يجب أن يطابق المساحة والعملة');
    }
  }
}

export function addSchedule(state, input, idFactory, today = todayISO()) {
  const rule = {
    spaceId: input.spaceId,
    kind: input.kind,
    name: requireText(input.name, 'اسم الالتزام', 120),
    amountMinor: Number(input.amountMinor),
    currency: input.currency,
    accountId: input.accountId || null,
    categoryId: input.categoryId || null,
    debtId: input.debtId || null,
    party: optionalText(input.party, 200),
    startDate: input.startDate,
    frequency: input.frequency,
    intervalDays: input.frequency === 'every_days' ? Number(input.intervalDays) : null,
    count: input.count === null || input.count === undefined || input.count === '' ? null : Number(input.count),
    endDate: input.endDate || null,
  };
  validateRule(state, rule);
  const schedule = {
    id: idFactory(),
    ...rule,
    anchorDay: Number(rule.startDate.slice(8, 10)),
    cancelled: false,
    occurrences: [],
  };
  schedule.occurrences = buildDueDates(schedule, today).map((d) => ({
    id: idFactory(),
    dueDate: d,
    expectedMinor: schedule.amountMinor,
    paidMinor: 0,
    payments: [],
  }));
  F(state).schedules.push(schedule);
  return schedule;
}

// التعديل يؤثر في المستقبل فقط: الدفعات المدفوعة والمتأخرة تبقى كما هي.
export function editSchedule(state, id, patch, effectiveFrom, idFactory, today = todayISO()) {
  const s = getSchedule(state, id);
  if (s.cancelled) throw new ValidationError('الالتزام ملغى؛ أنشئ جديدًا');
  assertISODate(effectiveFrom, 'تاريخ سريان التعديل');
  const next = {
    ...s,
    ...patch,
    amountMinor: patch.amountMinor !== undefined ? Number(patch.amountMinor) : s.amountMinor,
    count: patch.count !== undefined ? (patch.count === null || patch.count === '' ? null : Number(patch.count)) : s.count,
    intervalDays: patch.frequency === 'every_days' ? Number(patch.intervalDays ?? s.intervalDays) : null,
  };
  validateRule(state, next);
  next.anchorDay = Number(next.startDate.slice(8, 10));

  const kept = s.occurrences.filter((o) => o.paidMinor > 0 || o.dueDate < effectiveFrom);
  const keptDates = new Set(kept.map((o) => o.dueDate));
  let fresh;
  if (next.count !== null) {
    const slots = next.count - kept.length;
    if (slots < 0) throw new ValidationError('عدد الدفعات أقل من الدفعات المدفوعة أو المتأخرة الموجودة');
    const series = buildDueDates(next, today).filter((d) => d >= effectiveFrom && !keptDates.has(d));
    if (series.length < slots) {
      throw new ValidationError('القاعدة الجديدة لا تنتج عدد الدفعات المتبقي؛ عدّل تاريخ السريان أو العدد');
    }
    fresh = series.slice(0, slots);
  } else {
    fresh = buildDueDates(next, today).filter((d) => d >= effectiveFrom && !keptDates.has(d));
  }

  Object.assign(s, {
    name: next.name,
    kind: next.kind,
    amountMinor: next.amountMinor,
    currency: next.currency,
    accountId: next.accountId,
    categoryId: next.categoryId,
    debtId: next.debtId,
    party: next.party,
    startDate: next.startDate,
    frequency: next.frequency,
    intervalDays: next.intervalDays,
    count: next.count,
    endDate: next.endDate,
    anchorDay: next.anchorDay,
  });
  const newOcc = fresh.map((d) => ({ id: idFactory(), dueDate: d, expectedMinor: s.amountMinor, paidMinor: 0, payments: [] }));
  s.occurrences = [...kept, ...newOcc].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  return s;
}

export function cancelSchedule(state, id, effectiveFrom) {
  const s = getSchedule(state, id);
  assertISODate(effectiveFrom, 'تاريخ الإلغاء');
  s.cancelled = true;
  s.endDate = effectiveFrom;
  s.occurrences = s.occurrences.filter((o) => o.paidMinor > 0 || o.dueDate < effectiveFrom);
}

export function occurrenceStatus(occ, today) {
  if (occ.paidMinor >= occ.expectedMinor) return 'paid';
  if (occ.paidMinor > 0) return occ.dueDate < today ? 'overdue_partial' : 'partial';
  return occ.dueDate < today ? 'overdue' : 'upcoming';
}

// دفع دفعة من التزام: ينشئ عملية واحدة ويربطها. الدفعة الجزئية تترك الباقي مستحقًا.
export function payOccurrence(state, scheduleId, occId, input, idFactory, now = new Date().toISOString()) {
  const s = getSchedule(state, scheduleId);
  const occ = s.occurrences.find((o) => o.id === occId);
  if (!occ) throw new ValidationError('الدفعة غير موجودة');
  const remaining = occ.expectedMinor - occ.paidMinor;
  if (remaining <= 0) throw new ValidationError('هذه الدفعة مسددة بالكامل');
  const amount = assertMinor(Number(input.amountMinor), { label: 'المبلغ المدفوع' });
  if (amount > remaining) throw new ValidationError(`المبلغ يتجاوز المتبقي من الدفعة (${remaining})`);
  if (input.accountId && input.accountId !== s.accountId) {
    // يُسمح بحساب مختلف في المساحة نفسها وبالعملة نفسها.
    const acc = getAccount(state, input.accountId);
    if (acc.spaceId !== s.spaceId || acc.currency !== s.currency) throw new ValidationError('حساب الدفع غير مطابق');
  }
  const accountId = input.accountId || s.accountId;
  if (!accountId) throw new ValidationError('اختر حساب الدفع');
  const txnInput = {
    type: s.debtId ? 'repay' : 'expense',
    date: input.date,
    accountId,
    amountMinor: amount,
    debtId: s.debtId,
    categoryId: s.categoryId || input.categoryId || null,
    feeMinor: 0,
    party: s.party,
    note: `دفعة: ${s.name}`,
  };
  const txn = postTxn(state, txnInput, idFactory, now);
  txn.scheduleId = s.id;
  txn.occurrenceId = occ.id;
  occ.paidMinor += amount;
  occ.payments.push({ txnId: txn.id, amountMinor: amount, date: input.date });
  return txn;
}

// ربط دفعة بعملية مسجلة موجودة دون إنشاء عملية جديدة.
export function linkExistingTxn(state, scheduleId, occId, txnId) {
  const s = getSchedule(state, scheduleId);
  const occ = s.occurrences.find((o) => o.id === occId);
  if (!occ) throw new ValidationError('الدفعة غير موجودة');
  const txn = getTxn(state, txnId);
  if (txn.spaceId !== s.spaceId) throw new ValidationError('العملية في مساحة أخرى');
  if (txn.currency !== s.currency) throw new ValidationError('عملة العملية تخالف عملة الالتزام');
  if (txn.scheduleId) throw new ValidationError('العملية مرتبطة بالفعل بالتزام آخر');
  const amount = txn.type === 'repay' ? txn.amountMinor - txn.feeMinor : txn.amountMinor;
  const remaining = occ.expectedMinor - occ.paidMinor;
  if (amount > remaining) throw new ValidationError('مبلغ العملية يتجاوز المتبقي من الدفعة');
  txn.scheduleId = s.id;
  txn.occurrenceId = occ.id;
  occ.paidMinor += amount;
  occ.payments.push({ txnId: txn.id, amountMinor: amount, date: txn.date });
}

// --- ملخص المستحق والمتأخر والقادم ---
export function scheduleOverview(state, spaceId, today = todayISO()) {
  const overdue = [];
  const upcoming = [];
  for (const s of F(state).schedules) {
    if (s.spaceId !== spaceId) continue;
    for (const o of s.occurrences) {
      const st = occurrenceStatus(o, today);
      if (st === 'paid') continue;
      const row = { scheduleId: s.id, occId: o.id, name: s.name, dueDate: o.dueDate, remaining: o.expectedMinor - o.paidMinor, currency: s.currency, status: st };
      if (st === 'overdue' || st === 'overdue_partial') overdue.push(row);
      else upcoming.push(row);
    }
  }
  const byDue = (a, b) => (a.dueDate < b.dueDate ? -1 : 1);
  return { overdue: overdue.sort(byDue), upcoming: upcoming.sort(byDue) };
}

// --- الديون: ملخص لكل دين ---
export function debtOverview(state, spaceId, today = todayISO()) {
  return F(state).debts
    .filter((d) => d.spaceId === spaceId)
    .map((d) => {
      const remaining = debtRemaining(state, d);
      const payments = F(state).txns.filter((t) => t.type === 'repay' && t.debtId === d.id).sort((a, b) => (a.date < b.date ? -1 : 1));
      return {
        ...d,
        remaining,
        paid: d.principalMinor - remaining,
        payments,
        overdue: remaining > 0 && Boolean(d.dueDate) && d.dueDate < today,
      };
    });
}

// --- المطابقة: لا تغيّر الرصيد بصمت ---
export function reconcileAccount(state, accountId, date, actualMinor, idFactory, now = new Date().toISOString()) {
  assertISODate(date, 'تاريخ المطابقة');
  const actual = Number(actualMinor);
  if (!Number.isSafeInteger(actual)) throw new ValidationError('الرصيد الفعلي غير صحيح');
  const book = accountBalance(state, accountId, date);
  const rec = { id: idFactory(), accountId, date, actualMinor: actual, bookMinor: book, diffMinor: actual - book, adjustTxnId: null, createdAt: now };
  F(state).reconciliations.push(rec);
  return rec;
}

export function createAdjustmentFromReconciliation(state, recId, idFactory, now = new Date().toISOString()) {
  const rec = F(state).reconciliations.find((r) => r.id === recId);
  if (!rec) throw new ValidationError('المطابقة غير موجودة');
  if (rec.adjustTxnId) throw new ValidationError('أُنشئت تسوية لهذه المطابقة بالفعل');
  if (rec.diffMinor === 0) throw new ValidationError('لا يوجد فرق للتسوية');
  const txn = postTxn(
    state,
    { type: 'adjust', accountId: rec.accountId, date: rec.date, amountMinor: rec.diffMinor, note: 'تسوية بعد مطابقة الرصيد مع الواقع' },
    idFactory,
    now,
  );
  rec.adjustTxnId = txn.id;
  return txn;
}

// --- صافي الثروة: الأصول والالتزامات المسجلة فقط ---
export function netWorth(state, spaceId, displayCurrency, asOf = todayISO()) {
  const byCur = {};
  const add = (c, key, v) => {
    if (!byCur[c]) byCur[c] = { assets: 0, receivables: 0, payables: 0 };
    byCur[c][key] += v;
  };
  for (const a of accountsInSpace(state, spaceId)) {
    add(a.currency, 'assets', accountBalance(state, a.id, asOf));
  }
  for (const d of F(state).debts.filter((x) => x.spaceId === spaceId)) {
    const rem = debtRemaining(state, d);
    if (rem <= 0) continue;
    add(d.currency, d.direction === 'owed_to_me' ? 'receivables' : 'payables', rem);
  }
  const rows = Object.entries(byCur).map(([currency, v]) => ({
    currency,
    ...v,
    net: v.assets + v.receivables - v.payables,
  }));
  let total = 0;
  const missing = [];
  for (const r of rows) {
    const conv = convertAmount(state, r.net, r.currency, displayCurrency, asOf);
    if (conv === null) missing.push(r.currency);
    else total += conv;
  }
  return {
    rows,
    display: { currency: displayCurrency, total: missing.length ? null : total, missing },
    scope: 'تشمل الحسابات المسجَّلة والديون المفتوحة فقط، ولا تشمل أصولًا أو التزامات غير مسجلة أو الالتزامات المجدولة.',
  };
}

