// اختبارات المنطق الخالص. تشغيل: node --test personal-app/tests/domain.check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMoney, formatMoney, parseRate, invertRate, convertMinor, ValidationError } from '../src/core/money.js';
import { isISODate, addMonthsAnchored, addDays, daysBetween } from '../src/core/dates.js';
import { challengeProgress, levelProgress, levelComplete, challengeComplete, newChallenge } from '../src/core/levels.js';
import { defaultState, newId, normalizeState } from '../src/core/state.js';
import {
  addLevel,
  addChallenge,
  setChallengeDone,
  setSubtaskDone,
  addSubtask,
  stopChallenge,
  resumeChallenge,
  replaceChallenge,
  removeChallenge,
  setTargetLevels,
  updateLevelMeta,
  deleteUpcomingLevel,
  settlePlan,
  currentLevel,
  completedLevels,
  previewPlanChange,
  instantiateFromBank,
  distributeGoal,
  findLevel,
} from '../src/core/plan.js';
import { quickAddBank, archiveBank, updateBank, filterBank } from '../src/core/bank.js';
import {
  addAccount,
  addCategory,
  addSpace,
  addCurrency,
  addRate,
  postTxn,
  accountBalance,
  periodSummary,
  addBudget,
  budgetStatus,
  budgetOverlaps,
  addSchedule,
  editSchedule,
  payOccurrence,
  linkExistingTxn,
  reconcileAccount,
  createAdjustmentFromReconciliation,
  netWorth,
  convertAmount,
  debtRemaining,
  scheduleOverview,
} from '../src/core/finance.js';
import { addService } from '../src/core/services.js';
import { addPoint, addEvaluation, pointTrend, addDomain, buildAnalytics } from '../src/core/growth.js';
import { exportBackup, parseBackup } from '../src/core/backup.js';

const ID = () => newId();

// ---------- المال ----------
test('parseMoney: أرقام إنجليزية وعربية وفواصل، بلا أخطاء عشرية', () => {
  assert.equal(parseMoney('1,234.50', 2), 123450);
  assert.equal(parseMoney('١٬٢٣٤٫٥٠', 2), 123450);
  assert.equal(parseMoney('7', 0), 7);
  assert.throws(() => parseMoney('1.234', 2), ValidationError);
  assert.throws(() => parseMoney('', 2), ValidationError);
  assert.throws(() => parseMoney('-5', 2), ValidationError);
  assert.equal(parseMoney('-5', 2, { allowNegative: true }), -500);
});

test('formatMoney: تنسيق للعرض بلا تقريب عشري خاطئ', () => {
  assert.equal(formatMoney(123450, 'AED', 2), '1,234.50 AED');
  assert.equal(formatMoney(-5, 'EGP', 2), '-0.05 EGP');
  assert.equal(formatMoney(1500, 'JPY', 0), '1,500 JPY');
});

test('convertMinor: تحويل بسعر كسري وتقريب نصف لأعلى', () => {
  // 100.00 درهم × 0.2723 = 27.23 دولار
  assert.equal(convertMinor(10000, 2, 2, parseRate('0.2723')), 2723);
  // 0.01 × 0.5 = 0.005 → يُقرَّب إلى 0.01
  assert.equal(convertMinor(1, 2, 2, parseRate('0.5')), 1);
  // عكس السعر
  const inv = invertRate(parseRate('4'));
  assert.equal(convertMinor(100, 2, 2, inv), 25);
});

// ---------- التواريخ ----------
test('التواريخ: تثبيت يوم الشهر ولا انجراف، ورفض التواريخ غير الموجودة', () => {
  assert.equal(addMonthsAnchored('2026-01-31', 1, 31), '2026-02-28');
  assert.equal(addMonthsAnchored('2026-01-31', 2, 31), '2026-03-31');
  assert.equal(addMonthsAnchored('2028-01-31', 1, 31), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(isISODate('2026-02-30'), false);
  assert.equal(isISODate('2026-02-28'), true);
  assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
});

// ---------- التقدم والإكمال ----------
test('مثال المواصفات: تحدٍّ وزنه 2 تقدمه 50% وآخر وزنه 1 تقدمه 100% → المستوى 66.67%', () => {
  const lvl = {
    challenges: [
      newChallenge({ title: 'أ', type: 'numeric', target: 10, weight: 2, subtasks: [] }, ID),
      newChallenge({ title: 'ب', type: 'binary', weight: 1 }, ID),
    ],
  };
  lvl.challenges[0].done = 5;
  lvl.challenges[1].done = true;
  assert.ok(Math.abs(levelProgress(lvl) - 2 / 3) < 1e-12);
  assert.equal(levelComplete(lvl), false);
});

test('التحدي المركب: الوزن على المهام، ولا يكتمل بلا مهام', () => {
  const empty = newChallenge({ title: 'م', type: 'composite', subtasks: [] }, ID);
  assert.equal(challengeProgress(empty), 0);
  assert.equal(challengeComplete(empty), false);

  const ch = newChallenge(
    {
      title: 'م',
      type: 'composite',
      subtasks: [
        { title: 'س1', type: 'binary', weight: 1 },
        { title: 'س2', type: 'numeric', target: 4, weight: 3 },
      ],
    },
    ID,
  );
  ch.subtasks[0].done = true;
  ch.subtasks[1].done = 2;
  assert.ok(Math.abs(challengeProgress(ch) - 0.625) < 1e-12);
  assert.equal(challengeComplete(ch), false);
  ch.subtasks[1].done = 4;
  assert.equal(challengeComplete(ch), true);
});

test('تجاوز هدف لا يعوّض نقص تحدٍّ آخر', () => {
  const lvl = {
    challenges: [
      newChallenge({ title: 'أ', type: 'numeric', target: 5, weight: 1 }, ID),
      newChallenge({ title: 'ب', type: 'binary', weight: 1 }, ID),
    ],
  };
  lvl.challenges[0].done = 50;
  assert.equal(challengeProgress(lvl.challenges[0]), 1);
  assert.equal(levelComplete(lvl), false);
  assert.equal(levelProgress(lvl), 0.5);
});

// ---------- الخطة والترقية ----------
function planState() {
  return defaultState('2026-01-01T00:00:00.000Z');
}

function addBinaryChallenge(s, levelId, title = 'تحدٍّ') {
  return addChallenge(s, levelId, { title, type: 'binary', weight: 1 }, ID);
}

test('الترقية عند 100% فقط، مع مكافأة وشارة تُمنحان مرة واحدة', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'المستوى الأول', reward: { title: 'قهوة مختصة' }, badge: { name: 'البداية', icon: '🌱' } }, ID);
  const l2 = addLevel(s, { name: 'المستوى الثاني' }, ID);
  const c1 = addBinaryChallenge(s, l1.id);
  addBinaryChallenge(s, l2.id);
  settlePlan(s);
  assert.equal(currentLevel(s).id, l1.id);

  setChallengeDone(s, l1.id, c1.id, true);
  settlePlan(s);
  assert.equal(findLevel(s, l1.id).status, 'completed');
  assert.equal(currentLevel(s).id, l2.id);
  assert.equal(s.awards.length, 2);

  // إعادة الترقية أو تكرار الطلب لا يكرر الجوائز ولا السجل.
  settlePlan(s);
  settlePlan(s);
  assert.equal(s.awards.length, 2);
  assert.equal(s.log.filter((e) => e.kind === 'level_completed').length, 1);
});

test('المستوى الفارغ لا يُكمَل تلقائيًا، وتسجيل التقدم في المستوى الحالي فقط', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  settlePlan(s);
  assert.equal(currentLevel(s), null, 'لا يصبح حاليًا بلا تحديات');
  assert.equal(completedLevels(s).length, 0);

  const l2 = addLevel(s, { name: 'ثانٍ' }, ID);
  const c2 = addBinaryChallenge(s, l2.id);
  settlePlan(s);
  assert.equal(currentLevel(s).id, l2.id);
  assert.throws(() => setChallengeDone(s, l1.id, s.plan.levels[0].challenges[0]?.id ?? 'x', true), ValidationError);
  assert.throws(() => setChallengeDone(s, l2.id, c2.id, 'نعم'), ValidationError);
});

test('التحدي المتوقف يمنع الإكمال حتى يُستأنف', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const c = addBinaryChallenge(s, l1.id);
  settlePlan(s);
  setChallengeDone(s, l1.id, c.id, true);
  stopChallenge(s, l1.id, c.id, 'انشغال');
  settlePlan(s);
  assert.equal(currentLevel(s)?.id, l1.id, 'المتوقف لا يكتمل');
  assert.throws(() => setChallengeDone(s, l1.id, c.id, false), ValidationError);
  resumeChallenge(s, l1.id, c.id);
  settlePlan(s);
  assert.equal(findLevel(s, l1.id).status, 'completed');
});

test('الاستبدال يحفظ القديم مع تقدمه وسببه، والبديل يبدأ من الصفر', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const c = addChallenge(s, l1.id, { title: 'قراءة', type: 'numeric', target: 10, weight: 1 }, ID);
  settlePlan(s);
  setChallengeDone(s, l1.id, c.id, 4);
  const repl = replaceChallenge(s, l1.id, c.id, { title: 'قراءة مبسطة', type: 'numeric', target: 5, weight: 1 }, 'الهدف كان كبيرًا', ID);
  const level = findLevel(s, l1.id);
  const old = level.challenges.find((x) => x.id === c.id);
  assert.equal(old.status, 'replaced');
  assert.equal(old.done, 4, 'التقدم القديم محفوظ');
  assert.equal(old.replaceReason, 'الهدف كان كبيرًا');
  assert.equal(repl.done, 0);
  assert.equal(levelProgress(level), 0, 'المستبدل لا يدخل الحساب');
});

test('معاينة التعديل لا تغيّر الحالة، والتعديل الجماعي يُقيَّم بعد اكتماله', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const a = addBinaryChallenge(s, l1.id, 'أ');
  const b = addBinaryChallenge(s, l1.id, 'ب');
  settlePlan(s);
  setChallengeDone(s, l1.id, a.id, true);
  const before = JSON.stringify(s);
  const preview = previewPlanChange(s, (d) => {
    removeChallenge(d, l1.id, b.id);
  });
  assert.equal(JSON.stringify(s), before, 'المعاينة لا تعدّل الحالة');
  assert.equal(preview.before.completedCount, 0);
  assert.equal(preview.after.completedCount, 1, 'بعد الحذف يكتمل المستوى في المعاينة');
  assert.equal(preview.after.currentName, null);

  // حذف المهمة ثم إضافة بديلها في دفعة واحدة: لا ترقية مؤقتة بينهما.
  const batch = structuredClone(s);
  removeChallenge(batch, l1.id, b.id);
  addBinaryChallenge(batch, l1.id, 'بديل');
  settlePlan(batch);
  assert.equal(findLevel(batch, l1.id).status, 'current');
});

test('المستوى المكتمل محفوظ ولا يُعدَّل، ولا يُحذف مستوى فيه تحديات', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const c = addBinaryChallenge(s, l1.id);
  settlePlan(s);
  setChallengeDone(s, l1.id, c.id, true);
  settlePlan(s);
  assert.throws(() => updateLevelMeta(s, l1.id, { name: 'اسم جديد' }), ValidationError);
  assert.equal(findLevel(s, l1.id).snapshot.name, 'أول');
  assert.throws(() => deleteUpcomingLevel(s, l1.id), ValidationError);
});

test('عدد المستهدف مستقل عن المجهز، ولا ينزل عن المكتمل', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const c = addBinaryChallenge(s, l1.id);
  settlePlan(s);
  setChallengeDone(s, l1.id, c.id, true);
  settlePlan(s);
  assert.throws(() => setTargetLevels(s, 0), ValidationError);
  assert.throws(() => setTargetLevels(s, 0 + 0), ValidationError);
  const r = setTargetLevels(s, 10);
  assert.equal(s.plan.targetLevels, 10);
  assert.equal(r.exceedsPrepared, false);
});

test('نسبة الإنجاز المعروضة لا تُقرّب إلى 100% للترقية', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const c = addChallenge(s, l1.id, { title: 'كبير', type: 'numeric', target: 1000000, weight: 1 }, ID);
  settlePlan(s);
  setChallengeDone(s, l1.id, c.id, 999999);
  settlePlan(s);
  assert.equal(findLevel(s, l1.id).status, 'current', '99.9999% لا تكفي');
});

// ---------- البنك ----------
test('البنك: الإضافة السريعة بعنوان فقط، والنسخة التنفيذية مستقلة عن القالب', () => {
  const s = planState();
  const item = quickAddBank(s, 'قراءة 20 دقيقة', ID);
  assert.equal(item.status, 'draft');
  assert.equal(item.type, 'idea');

  const l1 = addLevel(s, { name: 'أول' }, ID);
  const inst = instantiateFromBank(s, item.id, l1.id, ID);
  assert.equal(inst.sourceBankId, item.id);
  updateBank(s, item.id, { title: 'تغيير الاسم لاحقًا' });
  assert.equal(findLevel(s, l1.id).challenges[0].title, 'قراءة 20 دقيقة', 'النسخة لا تتغير مع القالب');
  assert.equal(s.bank[0].status, 'used');
});

test('أرشفة المصدر لا تحذف التحديات المرتبطة به، ومعلومات البنك لا تدخل التقدم', () => {
  const s = planState();
  const item = quickAddBank(s, 'هدف', ID);
  const l1 = addLevel(s, { name: 'أول' }, ID);
  instantiateFromBank(s, item.id, l1.id, ID);
  archiveBank(s, item.id);
  assert.equal(findLevel(s, l1.id).challenges.length, 1);
  assert.equal(filterBank(s.bank, {}).length, 0, 'المؤرشف مخفي افتراضيًا');
});

test('المكافأة من البنك تنتقل إلى المستوى ولا تُحسب تحديًا', () => {
  const s = planState();
  const r = quickAddBank(s, 'نزهة', ID);
  updateBank(s, r.id, { type: 'reward' });
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const inst = instantiateFromBank(s, r.id, l1.id, ID);
  assert.equal(inst, null);
  assert.equal(findLevel(s, l1.id).reward.title, 'نزهة');
  assert.equal(findLevel(s, l1.id).challenges.length, 0);
});

test('توزيع الهدف الكبير على مستويات مختلفة', () => {
  const s = planState();
  const g = quickAddBank(s, 'قراءة 12 كتابًا', ID);
  updateBank(s, g.id, { type: 'big_goal' });
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const l2 = addLevel(s, { name: 'ثانٍ' }, ID);
  const parts = distributeGoal(
    s,
    g.id,
    [
      { levelId: l1.id, title: 'ستة كتب', measure: 'numeric', target: 6, weight: 1 },
      { levelId: l2.id, title: 'ستة كتب أخرى', measure: 'numeric', target: 6, weight: 1 },
    ],
    ID,
  );
  assert.equal(parts.length, 2);
  assert.equal(findLevel(s, l1.id).challenges[0].partOfGoalId, g.id);
  assert.equal(findLevel(s, l2.id).challenges[0].partOfGoalId, g.id);
});

// ---------- الفكر والتطور ----------
test('تقييم الضعف: الدرجة الأعلى = وضع أفضل، والمقارنة بالتقييم الأولي', () => {
  const s = planState();
  const p = addPoint(s, { kind: 'weakness', name: 'تأجيل المهام', initialScore: 4, date: '2026-01-05' }, ID);
  addEvaluation(s, p.id, { date: '2026-02-01', score: 7, note: 'تحسن' }, ID);
  const t = pointTrend(p);
  assert.equal(t.initial, 4);
  assert.equal(t.latest, 7);
  assert.equal(t.change, 3);
  assert.throws(() => addEvaluation(s, p.id, { date: '2026-03-01', score: 11 }, ID), ValidationError);
  assert.throws(() => addEvaluation(s, p.id, { date: '2025-12-01', score: 5 }, ID), ValidationError);
});

test('التحليلات تفصل إكمال التحديات عن التقييم، وتعدّ فقط ما اكتمل فعلًا', () => {
  const s = planState();
  const d = addDomain(s, 'الدراسة', ID);
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const c = addChallenge(s, l1.id, { title: 'مراجعة', type: 'binary', weight: 1, domainId: d.id }, ID);
  settlePlan(s);
  setChallengeDone(s, l1.id, c.id, true);
  settlePlan(s);
  const a = buildAnalytics(s);
  assert.equal(a.levels.completed, 1);
  assert.equal(a.levels.target, 100);
  assert.equal(a.byDomain[0].name, 'الدراسة');
  assert.equal(a.completedChallengeCount, 1);
});

// ---------- الحسابات الرقمية والنسخ ----------
test('حساباتي: يرفض الحقول السرية والروابط غير الآمنة', () => {
  const s = planState();
  assert.throws(() => addService(s, { name: 'بنك', url: 'https://bank.example', password: 'x' }, ID), ValidationError);
  assert.throws(() => addService(s, { name: 'بنك', url: 'javascript:alert(1)' }, ID), ValidationError);
  const svc = addService(s, { name: 'بريد', url: 'https://mail.example', managerRef: 'Bitwarden / Personal / mail' }, ID);
  assert.equal(svc.archived, false);
  assert.equal(svc.managerRef, 'Bitwarden / Personal / mail');
});

test('النسخ الاحتياطي: تصدير ثم استعادة متطابقة، ورفض الملفات الغريبة', () => {
  const s = planState();
  quickAddBank(s, 'فكرة', ID);
  const text = exportBackup(s, '2026-01-02T00:00:00.000Z');
  const restored = parseBackup(text);
  assert.deepEqual(restored.bank.map((b) => b.title), ['فكرة']);
  assert.throws(() => parseBackup('{"x":1}'), ValidationError);
  assert.throws(() => parseBackup('not json'), ValidationError);
  const future = JSON.parse(text);
  future.formatVersion = 99;
  assert.throws(() => parseBackup(JSON.stringify(future)), ValidationError);
});

test('normalizeState يكمل الحقول الناقصة ولا يقبل الأنواع الخاطئة', () => {
  const s = normalizeState({ schemaVersion: 1 });
  assert.ok(Array.isArray(s.bank));
  assert.ok(s.finance.activeSpaceId);
  assert.throws(() => normalizeState({ schemaVersion: 1, bank: 'x' }), ValidationError);
  assert.throws(() => normalizeState({ schemaVersion: 7 }), ValidationError);
});

// ---------- المال: الحسابات والعمليات ----------
function financeSetup() {
  const s = planState();
  const space = s.finance.spaces[0];
  const cash = addAccount(s, { spaceId: space.id, name: 'كاش', kind: 'cash', currency: 'AED', openingMinor: 100000, openingDate: '2026-01-01' }, ID);
  const bank = addAccount(s, { spaceId: space.id, name: 'بنك', kind: 'bank', currency: 'AED', openingMinor: 0, openingDate: '2026-01-01' }, ID);
  const food = addCategory(s, space.id, 'طعام', 'expense', ID);
  const salary = addCategory(s, space.id, 'راتب', 'income', ID);
  return { s, space, cash, bank, food, salary };
}

test('الرصيد الافتتاحي ليس دخلًا، والدخل والمصروف يغيّران الرصيد', () => {
  const { s, space, cash, salary, food } = financeSetup();
  postTxn(s, { type: 'income', accountId: cash.id, date: '2026-01-10', amountMinor: 50000, categoryId: salary.id }, ID);
  postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-11', amountMinor: 2500, categoryId: food.id }, ID);
  assert.equal(accountBalance(s, cash.id), 100000 + 50000 - 2500);
  const sum = periodSummary(s, space.id, '2026-01-01', '2026-01-31');
  assert.equal(sum.byCurrency.AED.income, 50000);
  assert.equal(sum.byCurrency.AED.expenses, 2500);
  assert.equal(sum.byCurrency.AED.netOperating, 47500);
});

test('تاريخ العملية قبل بداية الحساب مرفوض', () => {
  const { s, cash, food } = financeSetup();
  assert.throws(() => postTxn(s, { type: 'expense', accountId: cash.id, date: '2025-12-31', amountMinor: 100, categoryId: food.id }, ID), ValidationError);
});

test('التحويل بين حساباتي لا يُحسب دخلًا ولا مصروفًا، والرسوم فقط مصروف', () => {
  const { s, space, cash, bank, food } = financeSetup();
  postTxn(s, { type: 'transfer', accountId: cash.id, toAccountId: bank.id, date: '2026-01-05', amountMinor: 20000, feeMinor: 500, categoryId: food.id }, ID);
  assert.equal(accountBalance(s, cash.id), 100000 - 20000 - 500);
  assert.equal(accountBalance(s, bank.id), 20000);
  const sum = periodSummary(s, space.id, '2026-01-01', '2026-01-31');
  assert.equal(sum.byCurrency.AED.income, 0);
  assert.equal(sum.byCurrency.AED.expenses, 500, 'الرسوم فقط');
});

test('تحويل عملات: يسجّل المرسل والمستلم بسعر العملية', () => {
  const { s, space, cash } = financeSetup();
  // USD مضافة افتراضيًا
  const usd = addAccount(s, { spaceId: space.id, name: 'USD', kind: 'bank', currency: 'USD', openingMinor: 0, openingDate: '2026-01-01' }, ID);
  postTxn(s, { type: 'transfer', accountId: cash.id, toAccountId: usd.id, date: '2026-01-06', amountMinor: 36725, toAmountMinor: 10000 }, ID);
  assert.equal(accountBalance(s, cash.id), 100000 - 36725);
  assert.equal(accountBalance(s, usd.id), 10000);
});

test('السعر التاريخي: سعر لاحق لا يغيّر تحويل قديم', () => {
  const { s } = financeSetup();
  addRate(s, { from: 'USD', to: 'AED', rate: '3.6725', date: '2026-01-01' }, ID);
  const early = convertAmount(s, 10000, 'USD', 'AED', '2026-01-15');
  addRate(s, { from: 'USD', to: 'AED', rate: '3.7000', date: '2026-02-01' }, ID);
  assert.equal(convertAmount(s, 10000, 'USD', 'AED', '2026-01-15'), early);
  assert.equal(convertAmount(s, 10000, 'USD', 'AED', '2026-02-10'), 37000);
  assert.equal(convertAmount(s, 10000, 'EGP', 'AED', '2026-02-10'), null, 'لا سعر = لا تحويل مخمَّن');
});

test('الديون: الأصل منفصل عن الرسوم، والقبض لا يُحسب دخلًا', () => {
  const { s, space, cash, bank, food } = financeSetup();
  // اقتراض 2000 إلى البنك
  postTxn(s, { type: 'borrow', accountId: bank.id, date: '2026-01-03', amountMinor: 200000, party: 'بنك التمويل' }, ID);
  const debt = s.finance.debts[0];
  assert.equal(debtRemaining(s, debt), 200000);
  assert.equal(accountBalance(s, bank.id), 200000, 'الاقتراض يزيد الرصيد وليس دخلًا');

  // سداد 1000 منها 50 رسوم
  postTxn(s, { type: 'repay', accountId: bank.id, date: '2026-01-20', amountMinor: 100000, debtId: debt.id, feeMinor: 5000, categoryId: food.id }, ID);
  assert.equal(debtRemaining(s, debt), 200000 - 95000);
  const sum = periodSummary(s, space.id, '2026-01-01', '2026-01-31');
  assert.equal(sum.byCurrency.AED.income, 0);
  assert.equal(sum.byCurrency.AED.debtOut, 95000);
  assert.equal(sum.byCurrency.AED.expenses, 5000, 'الفائدة/الرسوم فقط مصروف');

  // سداد أكثر من المتبقي مرفوض
  assert.throws(() => postTxn(s, { type: 'repay', accountId: bank.id, date: '2026-01-21', amountMinor: 999999999, debtId: debt.id, feeMinor: 0 }, ID), ValidationError);

  // إقراض: لا يُحسب مصروفًا
  postTxn(s, { type: 'lend', accountId: cash.id, date: '2026-01-22', amountMinor: 30000, party: 'أحمد' }, ID);
  const sum2 = periodSummary(s, space.id, '2026-01-01', '2026-01-31');
  assert.equal(sum2.byCurrency.AED.lent, 30000);
  assert.equal(sum2.byCurrency.AED.expenses, 5000);
});

test('الاسترداد مرتبط بالمصروف الأصلي ولا يتجاوزه', () => {
  const { s, cash, food } = financeSetup();
  const exp = postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-04', amountMinor: 20000, categoryId: food.id }, ID);
  postTxn(s, { type: 'refund', accountId: cash.id, date: '2026-01-05', amountMinor: 15000, refundOfId: exp.id }, ID);
  assert.throws(() => postTxn(s, { type: 'refund', accountId: cash.id, date: '2026-01-06', amountMinor: 6000, refundOfId: exp.id }, ID), ValidationError);
  assert.equal(accountBalance(s, cash.id), 100000 - 20000 + 15000);
});

test('تسوية الرصيد تُسجَّل صراحة، والمطابقة لا تغيّر الرصيد بصمت', () => {
  const { s, cash } = financeSetup();
  const rec = reconcileAccount(s, cash.id, '2026-01-10', 98000, ID);
  assert.equal(rec.bookMinor, 100000);
  assert.equal(rec.diffMinor, -2000);
  assert.equal(accountBalance(s, cash.id), 100000, 'لم يتغير الرصيد بعد');
  createAdjustmentFromReconciliation(s, rec.id, ID);
  assert.equal(accountBalance(s, cash.id), 98000);
  assert.throws(() => createAdjustmentFromReconciliation(s, rec.id, ID), ValidationError);
});

// ---------- الميزانيات ----------
test('الميزانية: المدفوع فعليًا منفصل عن الالتزامات القادمة، والعملة الأخرى لا تُجمع', () => {
  const { s, space, cash, food } = financeSetup();
  // USD مضافة افتراضيًا
  const usd = addAccount(s, { spaceId: space.id, name: 'USD', kind: 'bank', currency: 'USD', openingMinor: 100000, openingDate: '2026-01-01' }, ID);
  const b = addBudget(s, { spaceId: space.id, name: 'يناير', start: '2026-01-01', end: '2026-01-31', currency: 'AED', lines: [{ categoryId: food.id, plannedMinor: 100000 }] }, ID);
  postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-02', amountMinor: 30000, categoryId: food.id }, ID);
  postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-02-02', amountMinor: 99999, categoryId: food.id }, ID);
  postTxn(s, { type: 'expense', accountId: usd.id, date: '2026-01-03', amountMinor: 5000, categoryId: food.id }, ID);
  addSchedule(s, { spaceId: space.id, kind: 'bill', name: 'فاتورة طعام', amountMinor: 20000, currency: 'AED', accountId: cash.id, categoryId: food.id, startDate: '2026-01-15', frequency: 'monthly', count: 1 }, ID, '2026-01-01');
  const st = budgetStatus(s, b.id).rows[0];
  assert.equal(st.paid, 30000);
  assert.equal(st.committed, 20000);
  assert.equal(st.remaining, 70000);
  assert.equal(st.afterCommitted, 50000);
  assert.equal(st.unconvertedCount, 1);
});

test('تحذير تداخل الميزانيات يظهر ولا تُجمع الميزانيات', () => {
  const { s, space, food } = financeSetup();
  addBudget(s, { spaceId: space.id, name: 'أ', start: '2026-01-01', end: '2026-01-31', currency: 'AED', lines: [{ categoryId: food.id, plannedMinor: 1000 }] }, ID);
  addBudget(s, { spaceId: space.id, name: 'ب', start: '2026-01-15', end: '2026-02-15', currency: 'AED', lines: [{ categoryId: food.id, plannedMinor: 1000 }] }, ID);
  assert.equal(budgetOverlaps(s, space.id).length, 1);
});

// ---------- الالتزامات المجدولة ----------
test('الجدول الشهري يثبت يوم الشهر، والدفع الجزئي يترك الباقي مستحقًا', () => {
  const { s, space, cash, food } = financeSetup();
  const sch = addSchedule(s, { spaceId: space.id, kind: 'installment', name: 'قسط', amountMinor: 30000, currency: 'AED', accountId: cash.id, categoryId: food.id, startDate: '2026-01-31', frequency: 'monthly', count: 3 }, ID, '2026-01-01');
  assert.deepEqual(sch.occurrences.map((o) => o.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31']);
  // المجدول لا يغيّر الرصيد
  assert.equal(accountBalance(s, cash.id), 100000);
  payOccurrence(s, sch.id, sch.occurrences[0].id, { amountMinor: 10000, date: '2026-01-31' }, ID);
  assert.equal(accountBalance(s, cash.id), 90000);
  assert.equal(sch.occurrences[0].paidMinor, 10000);
  assert.throws(() => payOccurrence(s, sch.id, sch.occurrences[0].id, { amountMinor: 25000, date: '2026-01-31' }, ID), ValidationError);
  const ov = scheduleOverview(s, space.id, '2026-02-10');
  assert.equal(ov.overdue.length, 1, 'الجزئي المتأخر يظهر في المتأخرات');
});

test('تعديل الالتزام يؤثر في المستقبل فقط، والدفعات السابقة لا تتغير', () => {
  const { s, space, cash, food } = financeSetup();
  const sch = addSchedule(s, { spaceId: space.id, kind: 'subscription', name: 'اشتراك', amountMinor: 1000, currency: 'AED', accountId: cash.id, categoryId: food.id, startDate: '2026-01-10', frequency: 'monthly', count: 3 }, ID, '2026-01-01');
  payOccurrence(s, sch.id, sch.occurrences[0].id, { amountMinor: 1000, date: '2026-01-10' }, ID);
  editSchedule(s, sch.id, { amountMinor: 1500 }, '2026-02-01', ID, '2026-01-20');
  assert.equal(sch.occurrences[0].expectedMinor, 1000, 'المدفوعة لا تتغير');
  assert.equal(sch.occurrences[1].expectedMinor, 1500);
  assert.equal(sch.occurrences.length, 3);
});

test('ربط دفعة بعملية موجودة لا ينشئ عملية مكررة', () => {
  const { s, space, cash, food } = financeSetup();
  const sch = addSchedule(s, { spaceId: space.id, kind: 'bill', name: 'كهرباء', amountMinor: 5000, currency: 'AED', accountId: cash.id, categoryId: food.id, startDate: '2026-01-05', frequency: 'monthly', count: 1 }, ID, '2026-01-01');
  const existing = postTxn(s, { type: 'expense', accountId: cash.id, date: '2026-01-05', amountMinor: 5000, categoryId: food.id }, ID);
  const before = s.finance.txns.length;
  linkExistingTxn(s, sch.id, sch.occurrences[0].id, existing.id);
  assert.equal(s.finance.txns.length, before);
  assert.equal(sch.occurrences[0].paidMinor, 5000);
  assert.equal(accountBalance(s, cash.id), 95000);
});

test('الالتزام بعملة مختلفة عن الحساب مرفوض، والعملة الأصلية محفوظة', () => {
  const { s, space, cash, food } = financeSetup();
  assert.throws(() => addSchedule(s, { spaceId: space.id, kind: 'bill', name: 'x', amountMinor: 100, currency: 'USD', accountId: cash.id, categoryId: food.id, startDate: '2026-01-05', frequency: 'monthly', count: 1 }, ID), ValidationError);
});

// ---------- صافي الثروة ----------
test('صافي الثروة: يوضح النطاق ولا يعرض إجمالًا إذا غاب سعر صرف', () => {
  const { s, space, cash, bank } = financeSetup();
  postTxn(s, { type: 'borrow', accountId: bank.id, date: '2026-01-03', amountMinor: 50000, party: 'x' }, ID);
  // USD مضافة افتراضيًا
  addAccount(s, { spaceId: space.id, name: 'USD', kind: 'bank', currency: 'USD', openingMinor: 1000, openingDate: '2026-01-01' }, ID);
  const nw = netWorth(s, space.id, 'AED', '2026-01-10');
  const aed = nw.rows.find((r) => r.currency === 'AED');
  // كاش 100000 + بنك 50000 (بعد الاقتراض)
  assert.equal(aed.assets, 150000);
  assert.equal(aed.payables, 50000);
  assert.equal(aed.net, 100000);
  assert.equal(nw.display.total, null, 'USD بلا سعر');
  assert.deepEqual(nw.display.missing, ['USD']);
  assert.ok(nw.scope.length > 0);
});

// ---------- عمليات السطح ----------
test('الحقول المعرّفة بـ ID: العناصر الحالية تُعاد بنفس الشكل بعد الإعادة', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const c = addBinaryChallenge(s, l1.id);
  settlePlan(s);
  setChallengeDone(s, l1.id, c.id, true);
  settlePlan(s);
  const restored = parseBackup(exportBackup(s));
  assert.equal(restored.plan.levels[0].status, 'completed');
  assert.equal(restored.plan.levels[0].snapshot.name, 'أول');
});

test('إضافة مهام صغيرة لتحدٍّ مركب وتسجيلها', () => {
  const s = planState();
  const l1 = addLevel(s, { name: 'أول' }, ID);
  const c = addChallenge(s, l1.id, { title: 'مركب', type: 'composite', weight: 1, subtasks: [] }, ID);
  addSubtask(s, l1.id, c.id, { title: 'خطوة', type: 'binary', weight: 1 }, ID);
  settlePlan(s);
  const sub = findLevel(s, l1.id).challenges[0].subtasks[0];
  setSubtaskDone(s, l1.id, c.id, sub.id, true);
  settlePlan(s);
  assert.equal(findLevel(s, l1.id).status, 'completed');
});

test('إضافة الحساب: حقل الرصيد الافتتاحي يقبل صفرًا وسالبًا، والتاريخ إلزامي', () => {
  const { s, space } = financeSetup();
  assert.throws(() => addAccount(s, { spaceId: space.id, name: 'x', kind: 'cash', currency: 'AED', openingMinor: 0, openingDate: '' }, ID), ValidationError);
  const ok = addAccount(s, { spaceId: space.id, name: 'قرض', kind: 'other', currency: 'AED', openingMinor: -5000, openingDate: '2026-01-01' }, ID);
  assert.equal(accountBalance(s, ok.id), -5000);
});

test('المساحة الثانية للمشروع: لا تُجمع تلقائيًا مع الشخصي', () => {
  const { s, space, cash, food } = financeSetup();
  const proj = addSpace(s, 'مشروع جانبي', ID);
  const pAcc = addAccount(s, { spaceId: proj.id, name: 'مشروع', kind: 'bank', currency: 'AED', openingMinor: 0, openingDate: '2026-01-01' }, ID);
  postTxn(s, { type: 'transfer', accountId: cash.id, toAccountId: pAcc.id, date: '2026-01-08', amountMinor: 10000 }, ID);
  const personal = periodSummary(s, space.id, '2026-01-01', '2026-01-31');
  const project = periodSummary(s, proj.id, '2026-01-01', '2026-01-31');
  assert.equal(personal.byCurrency.AED.ownerOut, 10000);
  assert.equal(project.byCurrency.AED.ownerIn, 10000);
  assert.equal(personal.byCurrency.AED.income, 0);
  assert.equal(project.byCurrency.AED.income, 0);
  assert.equal(personal.ownerMoves[0].label, 'تمويل مالك للمشروع');
  void food;
});
