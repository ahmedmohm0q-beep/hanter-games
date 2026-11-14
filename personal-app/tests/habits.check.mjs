// اختبارات العادات. تشغيل: node --test personal-app/tests/habits.check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, newId } from '../src/core/state.js';
import { addLevel, addChallenge, settlePlan, findLevel } from '../src/core/plan.js';
import {
  addHabit,
  setHabitAmount,
  setHabitArchived,
  weekStartISO,
  weeklyDoneDays,
  weeklyProgress,
  habitsOverview,
  linkedTotal,
} from '../src/core/habits.js';
import { addDays, fromISO } from '../src/core/dates.js';
import { ValidationError } from '../src/core/money.js';

const ID = () => newId();

test('بداية الأسبوع هي الاثنين دائمًا، والأحد يتبع الأسبوع السابق', () => {
  const sample = '2026-11-18';
  const ws = weekStartISO(sample);
  assert.equal(fromISO(ws).getUTCDay(), 1, 'يوم الاثنين');
  const diff = (fromISO(sample) - fromISO(ws)) / 86400000;
  assert.ok(diff >= 0 && diff <= 6);
  // الأحد يقع في الأسبوع الذي يبدأ قبله بستة أيام
  let sunday = sample;
  while (fromISO(sunday).getUTCDay() !== 0) sunday = addDays(sunday, 1);
  assert.equal(weekStartISO(sunday), addDays(sunday, -6));
});

test('الهدف الأسبوعي يقبل من 1 إلى 7 فقط', () => {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  assert.throws(() => addHabit(s, { title: 'قراءة', weeklyTarget: 0 }, ID), ValidationError);
  assert.throws(() => addHabit(s, { title: 'قراءة', weeklyTarget: 8 }, ID), ValidationError);
  assert.throws(() => addHabit(s, { title: 'قراءة', weeklyTarget: 2.5 }, ID), ValidationError);
  const h = addHabit(s, { title: 'قراءة', weeklyTarget: 3 }, ID);
  assert.equal(h.weeklyTarget, 3);
  assert.equal(h.link, null);
});

test('تسجيل الكمية: الصفر يلغي التسجيل، والقيم السالبة مرفوضة', () => {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  const h = addHabit(s, { title: 'قراءة', weeklyTarget: 7 }, ID);
  setHabitAmount(s, h.id, '2026-11-10', 20);
  assert.equal(h.logs['2026-11-10'], 20);
  setHabitAmount(s, h.id, '2026-11-10', 0);
  assert.equal(h.logs['2026-11-10'], undefined);
  assert.throws(() => setHabitAmount(s, h.id, '2026-11-10', -5), ValidationError);
});

test('أيام الأسبوع: الأحد لا يُحسب مع الأسبوع الذي بعده', () => {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  const h = addHabit(s, { title: 'مشي', weeklyTarget: 3 }, ID);
  let monday = '2026-11-16';
  while (fromISO(monday).getUTCDay() !== 1) monday = addDays(monday, 1);
  const sunday = addDays(monday, -1);
  setHabitAmount(s, h.id, sunday, 1); // الأحد قبل الاثنين
  setHabitAmount(s, h.id, monday, 1);
  setHabitAmount(s, h.id, addDays(monday, 2), 1);
  assert.equal(weeklyDoneDays(h, monday), 2, 'الاثنين والأربعاء فقط في هذا الأسبوع');
  assert.equal(weeklyDoneDays(h, addDays(monday, -7)), 1, 'الأحد يتبع الأسبوع السابق');
  assert.ok(Math.abs(weeklyProgress(h, monday) - 2 / 3) < 1e-12);
});

test('التقدم الأسبوعي لا يتجاوز 100% حتى لو زادت الأيام عن الهدف', () => {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  const h = addHabit(s, { title: 'مشي', weeklyTarget: 2 }, ID);
  const ws = weekStartISO('2026-11-18');
  for (let i = 0; i < 5; i++) setHabitAmount(s, h.id, addDays(ws, i), 1);
  assert.equal(weeklyProgress(h, ws), 1);
});

test('ربط العادة بتحدٍّ رقمي في المستوى الحالي يحدّث تقدّمه تلقائيًا', () => {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  const lvl = addLevel(s, { name: 'القراءة' }, ID);
  const ch = addChallenge(s, lvl.id, { title: 'قراءة 60 صفحة', type: 'numeric', target: 60, weight: 1, unit: 'صفحة' }, ID);
  settlePlan(s);
  assert.equal(findLevel(s, lvl.id).status, 'current');

  const h = addHabit(s, { title: 'قراءة يومية', weeklyTarget: 5, linkChallengeId: ch.id }, ID);
  setHabitAmount(s, h.id, '2026-11-10', 10);
  setHabitAmount(s, h.id, '2026-11-11', 15);
  settlePlan(s);
  assert.equal(ch.done, 25, 'مجموع التسجيلات يصبح تقدم التحدي');
  assert.equal(linkedTotal(s, ch.id), 25);

  setHabitArchived(s, h.id, true);
  settlePlan(s);
  assert.equal(ch.done, 0, 'العادة المؤرشفة لا تُحسب');
});

test('الربط بتحدٍّ غير رقمي مرفوض', () => {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  const lvl = addLevel(s, { name: 'عام' }, ID);
  const ch = addChallenge(s, lvl.id, { title: 'تم أو لم يتم', type: 'binary', weight: 1 }, ID);
  assert.throws(() => addHabit(s, { title: 'x', weeklyTarget: 1, linkChallengeId: ch.id }, ID), ValidationError);
});

test('تحدٍّ في مستوى قادم لا يتغيّر بالعادات قبل أن يصبح حاليًا', () => {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  const first = addLevel(s, { name: 'الأول' }, ID);
  addChallenge(s, first.id, { title: 'تمرين', type: 'binary', weight: 1 }, ID);
  settlePlan(s);
  const second = addLevel(s, { name: 'الثاني' }, ID);
  const ch2 = addChallenge(s, second.id, { title: 'صفحات', type: 'numeric', target: 50, weight: 1 }, ID);
  const h = addHabit(s, { title: 'قراءة', weeklyTarget: 4, linkChallengeId: ch2.id }, ID);
  setHabitAmount(s, h.id, '2026-11-12', 12);
  settlePlan(s);
  assert.equal(ch2.done, 0, 'المستوى الثاني ليس حاليًا بعد');
});

test('نظرة عامة على العادات تعرض التقدم وتسجيل اليوم', () => {
  const s = defaultState('2026-01-01T00:00:00.000Z');
  const h1 = addHabit(s, { title: 'قراءة', weeklyTarget: 3 }, ID);
  addHabit(s, { title: 'مشي', weeklyTarget: 7 }, ID);
  setHabitArchived(s, h1.id, true);
  const today = '2026-11-18';
  setHabitAmount(s, s.habits[1].id, today, 30);
  const list = habitsOverview(s, today);
  assert.equal(list.length, 1, 'المؤرشفة لا تظهر');
  assert.equal(list[0].todayAmount, 30);
  assert.equal(list[0].doneDays, 1);
});
