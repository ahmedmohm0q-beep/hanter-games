// العادات: تتبّع يومي بأسبوع يبدأ يوم الاثنين. كل عادة لها هدف أسبوعي (عدد الأيام).
// العادة ممكن تتربط بتحدٍّ رقمي في المستوى الحالي، فيُحسب تقدّمه تلقائيًا من مجموع تسجيلات العادة.
// التذكير هنا داخل التطبيق فقط (قائمة اليوم)، ومن غير إشعارات في الخلفية.

import { ValidationError } from './money.js';
import { requireText } from './text.js';
import { assertISODate, fromISO, addDays } from './dates.js';

export const MAX_HABIT_AMOUNT = 100000;

function findHabit(state, id) {
  const h = (state.habits || []).find((x) => x.id === id);
  if (!h) throw new ValidationError('العادة غير موجودة');
  return h;
}

// بداية الأسبوع (الاثنين) للتاريخ المعطى.
export function weekStartISO(iso) {
  const dow = fromISO(iso).getUTCDay(); // الأحد = 0
  const offset = (dow + 6) % 7; // الاثنين = 0
  return addDays(iso, -offset);
}

// عدد الأيام اللي فيها تسجيل داخل الأسبوع الذي يبدأ بـweekStart.
export function weeklyDoneDays(habit, weekStart) {
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStart, i);
    if ((habit.logs[d] || 0) > 0) count += 1;
  }
  return count;
}

// نسبة التقدم الأسبوعي للعرض فقط: أيام منجزة ÷ الهدف، بحد أقصى 1.
export function weeklyProgress(habit, weekStart) {
  return Math.min(weeklyDoneDays(habit, weekStart) / habit.weeklyTarget, 1);
}

// يجد التحديات الرقمية في المستويات غير المكتملة، لربط العادة بواحد منها.
function findLinkableChallenge(state, challengeId) {
  for (const lvl of state.plan.levels) {
    if (lvl.status === 'completed') continue;
    const ch = (lvl.challenges || []).find((c) => c.id === challengeId);
    if (ch) {
      if (ch.type !== 'numeric') throw new ValidationError('الربط يكون بتحدٍّ رقمي فقط');
      if (ch.status === 'replaced') throw new ValidationError('التحدي مستبدل ولا يُربط به');
      return { lvl, ch };
    }
  }
  throw new ValidationError('التحدي المختار غير موجود في مستوى مفتوح');
}

export function addHabit(state, input, idFactory, now = new Date().toISOString()) {
  const title = requireText(input.title, 'اسم العادة', 200);
  const weeklyTarget = Number(input.weeklyTarget);
  if (!Number.isInteger(weeklyTarget) || weeklyTarget < 1 || weeklyTarget > 7) {
    throw new ValidationError('عدد الأيام في الأسبوع يكون من 1 إلى 7');
  }
  let link = null;
  if (input.linkChallengeId) {
    findLinkableChallenge(state, input.linkChallengeId);
    link = { challengeId: input.linkChallengeId };
  }
  const habit = {
    id: idFactory(),
    title,
    weeklyTarget,
    link,
    logs: {},
    archived: false,
    createdAt: now,
  };
  state.habits = [...(state.habits || []), habit];
  return habit;
}

// تسجيل كمية اليوم (وحدات مثل الصفحات أو الدقائق). صفر يعني إلغاء التسجيل.
export function setHabitAmount(state, habitId, date, amount) {
  const h = findHabit(state, habitId);
  assertISODate(date, 'تاريخ التسجيل');
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0 || n > MAX_HABIT_AMOUNT) {
    throw new ValidationError('الكمية يجب أن تكون رقمًا صفرًا أو أكبر');
  }
  if (n === 0) delete h.logs[date];
  else h.logs[date] = n;
  return h;
}

export function setHabitArchived(state, habitId, archived) {
  const h = findHabit(state, habitId);
  h.archived = Boolean(archived);
  return h;
}

// مجموع كل تسجيلات العادات المربوطة بتحدٍّ معيّن.
export function linkedTotal(state, challengeId) {
  return (state.habits || [])
    .filter((h) => !h.archived && h.link && h.link.challengeId === challengeId)
    .reduce((sum, h) => sum + Object.values(h.logs).reduce((s, v) => s + v, 0), 0);
}

// يحدّث التحديات الرقمية المربوطة في المستوى الحالي فقط، لأن المستويات المكتملة محفوظة كما هي.
export function syncHabitLinks(state) {
  const cur = state.plan.levels.find((l) => l.status === 'current');
  if (!cur) return;
  for (const ch of cur.challenges || []) {
    if (ch.type !== 'numeric' || ch.status === 'replaced') continue;
    // نفحص كل العادات المرتبطة (حتى المؤرشفة) حتى ينزل التقدم إلى الصفر عند أرشفة آخر عادة مرتبطة.
    const linked = (state.habits || []).some((h) => h.link && h.link.challengeId === ch.id);
    if (!linked) continue;
    const total = linkedTotal(state, ch.id);
    if (ch.done !== total) ch.done = total;
  }
}

// قائمة العادات النشطة مع حالة كل واحدة لهذا الأسبوع واليوم.
export function habitsOverview(state, today) {
  const ws = weekStartISO(today);
  return (state.habits || [])
    .filter((h) => !h.archived)
    .map((h) => ({
      id: h.id,
      title: h.title,
      weeklyTarget: h.weeklyTarget,
      doneDays: weeklyDoneDays(h, ws),
      progress: weeklyProgress(h, ws),
      todayAmount: h.logs[today] || 0,
      linkedChallengeId: h.link ? h.link.challengeId : null,
      totalAmount: Object.values(h.logs).reduce((s, v) => s + v, 0),
    }));
}
