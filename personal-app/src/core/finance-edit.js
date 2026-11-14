// تعديل وحذف العمليات مع سجل تغييرات وسجل تدقيق.
// - التعديل يقتصر على التاريخ والبيانات الوصفية (الملاحظة، الجهة، التصنيف). المبلغ والحسابات لا تُعدَّل:
//   التصحيح يتم بحذف العملية الخاطئة وإعادة تسجيلها، أو بتسوية الرصيد.
// - الحذف محظور إذا كانت هناك سجلات تعتمد عليها (استرداد، سداد دين، مطابقة).
// - كل حذف يُحفظ نسخته في finance.audit.

import { ValidationError } from './money.js';
import { assertISODate } from './dates.js';
import { optionalText } from './text.js';
import { newId } from './state.js';
import { getTxn, getAccount, getSchedule, getDebt } from './finance.js';

const F = (state) => state.finance;

function getCategory(state, id) {
  const cat = F(state).categories.find((c) => c.id === id);
  if (!cat) throw new ValidationError('التصنيف غير موجود');
  return cat;
}

export function editTxnMeta(state, id, patch, now = new Date().toISOString()) {
  const t = getTxn(state, id);
  const changes = {};
  if (patch.date !== undefined && patch.date !== t.date) {
    assertISODate(patch.date, 'تاريخ العملية');
    const acc = getAccount(state, t.accountId);
    if (patch.date < acc.openingDate) throw new ValidationError('تاريخ العملية يسبق تاريخ بداية الحساب');
    if (t.refundOfId) {
      const orig = getTxn(state, t.refundOfId);
      if (patch.date < orig.date) throw new ValidationError('تاريخ الاسترداد لا يسبق تاريخ المصروف الأصلي');
    }
    changes.date = [t.date, patch.date];
    t.date = patch.date;
  }
  if (patch.note !== undefined) {
    const note = optionalText(patch.note, 1000);
    if (note !== (t.note || '')) {
      changes.note = [t.note || '', note];
      t.note = note;
    }
  }
  if (patch.party !== undefined) {
    const party = optionalText(patch.party, 200);
    if (party !== (t.party || '')) {
      changes.party = [t.party || '', party];
      t.party = party;
    }
  }
  if (patch.categoryId !== undefined && patch.categoryId !== t.categoryId) {
    if (t.type !== 'income' && t.type !== 'expense' && t.type !== 'transfer' && t.type !== 'repay' && t.type !== 'refund') {
      throw new ValidationError('هذه العملية لا تقبل تصنيفًا');
    }
    if (patch.categoryId) {
      const cat = getCategory(state, patch.categoryId);
      if (cat.spaceId !== t.spaceId) throw new ValidationError('التصنيف لا يتبع هذه المساحة');
      // الدخل وفوائد الدين المقبوضة تُصنَّف دخلًا، والباقي مصروفًا.
      const debt = t.debtId ? getDebt(state, t.debtId) : null;
      const needKind = t.type === 'income' || (debt && debt.direction === 'owed_to_me') ? 'income' : 'expense';
      if (cat.kind !== needKind) throw new ValidationError('نوع التصنيف لا يطابق العملية');
    }
    changes.categoryId = [t.categoryId, patch.categoryId || null];
    t.categoryId = patch.categoryId || null;
  }
  if (Object.keys(changes).length === 0) return t;
  t.history = [...(t.history || []), { at: now, changes }];
  t.updatedAt = now;
  return t;
}

export function deleteTxn(state, id, now = new Date().toISOString()) {
  const t = getTxn(state, id);
  if (F(state).txns.some((x) => x.refundOfId === id)) {
    throw new ValidationError('للعملية استردادات مسجلة؛ احذف الاسترداد أولًا');
  }
  if ((t.type === 'borrow' || t.type === 'lend') && t.debtId) {
    if (F(state).txns.some((x) => x.type === 'repay' && x.debtId === t.debtId)) {
      throw new ValidationError('للدين سدادات مسجلة؛ لا يُحذف إنشاؤه قبل حذف السدادات');
    }
  }
  if (F(state).reconciliations.some((r) => r.adjustTxnId === id)) {
    throw new ValidationError('العملية تسوية مرتبطة بمطابقة؛ أعد المطابقة بدل حذفها');
  }
  if (t.scheduleId && t.occurrenceId) {
    const s = getSchedule(state, t.scheduleId);
    const occ = s.occurrences.find((o) => o.id === t.occurrenceId);
    if (occ) {
      const pay = occ.payments.find((p) => p.txnId === id);
      if (pay) {
        occ.paidMinor -= pay.amountMinor;
        occ.payments = occ.payments.filter((p) => p.txnId !== id);
      }
    }
  }
  if (t.debtId && (t.type === 'borrow' || t.type === 'lend')) {
    F(state).debts = F(state).debts.filter((d) => d.id !== t.debtId);
  }
  F(state).txns = F(state).txns.filter((x) => x.id !== id);
  F(state).audit = [...(F(state).audit || []), { id: newId(), at: now, action: 'delete_txn', snapshot: t }];
  return true;
}
