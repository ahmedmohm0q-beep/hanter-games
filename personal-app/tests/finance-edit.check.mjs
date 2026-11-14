// اختبارات تعديل وحذف العمليات. تشغيل: node --test personal-app/tests/finance-edit.check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newId } from '../src/core/state.js';
import { addAccount, addCategory, postTxn, accountBalance, debtRemaining, addSchedule, payOccurrence, reconcileAccount, createAdjustmentFromReconciliation } from '../src/core/finance.js';
import { editTxnMeta, deleteTxn } from '../src/core/finance-edit.js';
import { ValidationError } from '../src/core/money.js';

const ID = () => newId();

function setup() {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  const sp = s.finance.spaces[0];
  const cash = addAccount(s, { spaceId: sp.id, name: 'كاش', kind: 'cash', currency: 'AED', openingMinor: 100000, openingDate: '2026-01-01' }, ID);
  const bank = addAccount(s, { spaceId: sp.id, name: 'بنك', kind: 'bank', currency: 'AED', openingMinor: 0, openingDate: '2026-01-01' }, ID);
  const food = addCategory(s, sp.id, 'طعام', 'expense', ID);
  const salary = addCategory(s, sp.id, 'راتب', 'income', ID);
  return { s, sp, cash, bank, food, salary };
}

test('تعديل الملاحظة والجهة يُسجَّل في سجل التغييرات، والمبلغ لا يتغير', () => {
  const { s, cash, food } = setup();
  const t = postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-05', amountMinor: 2000, categoryId: food.id, note: 'قديمة' }, ID);
  editTxnMeta(s, t.id, { note: 'جديدة', party: 'بقالة' }, '2026-01-06T00:00:00.000Z');
  assert.equal(t.note, 'جديدة');
  assert.equal(t.party, 'بقالة');
  assert.equal(t.amountMinor, 2000);
  assert.equal(t.history.length, 1);
  assert.deepEqual(Object.keys(t.history[0].changes).sort(), ['note', 'party']);
  assert.equal(accountBalance(s, cash.id), 98000);
});

test('تعديل التاريخ لا يسمح بما يسبق بداية الحساب', () => {
  const { s, cash, food } = setup();
  const t = postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-05', amountMinor: 2000, categoryId: food.id }, ID);
  assert.throws(() => editTxnMeta(s, t.id, { date: '2025-12-01' }), ValidationError);
  assert.equal(t.date, '2026-01-05');
});

test('التصنيف يجب أن يطابق نوع العملية', () => {
  const { s, cash, salary, food } = setup();
  const t = postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-05', amountMinor: 2000, categoryId: food.id }, ID);
  assert.throws(() => editTxnMeta(s, t.id, { categoryId: salary.id }), ValidationError);
  editTxnMeta(s, t.id, { categoryId: food.id }); // بلا تغيير: لا سجل جديد
  assert.equal(t.history, undefined);
});

test('حذف عملية بسيطة يحفظ نسخة في سجل التدقيق ويعيد الرصيد', () => {
  const { s, cash, food } = setup();
  const t = postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-05', amountMinor: 2000, categoryId: food.id }, ID);
  assert.equal(accountBalance(s, cash.id), 98000);
  deleteTxn(s, t.id, '2026-01-07T00:00:00.000Z');
  assert.equal(accountBalance(s, cash.id), 100000);
  assert.equal(s.finance.audit.length, 1);
  assert.equal(s.finance.audit[0].snapshot.amountMinor, 2000);
});

test('حذف استرداد مرتبط بالمصروف يبقى محظورًا حتى يُحذف الاسترداد', () => {
  const { s, cash, food } = setup();
  const exp = postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-05', amountMinor: 2000, categoryId: food.id }, ID);
  postTxn(s, { type: 'refund', accountId: cash.id, date: '2026-01-06', amountMinor: 500, refundOfId: exp.id }, ID);
  assert.throws(() => deleteTxn(s, exp.id), ValidationError);
});

test('حذف إنشاء الدين محظور إذا كانت له سدادات، ومسموح بعد حذفها', () => {
  const { s, bank } = setup();
  const borrow = postTxn(s, { type: 'borrow', accountId: bank.id, date: '2026-01-03', amountMinor: 50000, party: 'بنك' }, ID);
  const debt = s.finance.debts[0];
  const repay = postTxn(s, { type: 'repay', accountId: bank.id, date: '2026-01-10', amountMinor: 10000, debtId: debt.id, feeMinor: 0 }, ID);
  assert.throws(() => deleteTxn(s, borrow.id), ValidationError);
  deleteTxn(s, repay.id);
  assert.equal(debtRemaining(s, debt), 50000);
  deleteTxn(s, borrow.id);
  assert.equal(s.finance.debts.length, 0);
  assert.equal(accountBalance(s, bank.id), 0);
});

test('حذف عملية مرتبطة بدفعة التزام يفك الربط ويعيد المبلغ المتبقي', () => {
  const { s, cash, food, sp } = setup();
  const sch = addSchedule(s, { spaceId: sp.id, kind: 'bill', name: 'فاتورة', amountMinor: 5000, currency: 'AED', accountId: cash.id, categoryId: food.id, startDate: '2026-01-05', frequency: 'monthly', count: 1 }, ID, '2026-01-01');
  const occ = sch.occurrences[0];
  const t = payOccurrence(s, sch.id, occ.id, { amountMinor: 5000, date: '2026-01-05' }, ID);
  assert.equal(occ.paidMinor, 5000);
  deleteTxn(s, t.id);
  assert.equal(occ.paidMinor, 0);
  assert.equal(occ.payments.length, 0);
});

test('عملية محسوبة في مطابقة مكتملة التسوية لا تُحذف', () => {
  const { s, cash } = setup();
  const rec = reconcileAccount(s, cash.id, '2026-01-10', 98000, ID);
  const adj = createAdjustmentFromReconciliation(s, rec.id, ID);
  assert.throws(() => deleteTxn(s, adj.id), ValidationError);
});
