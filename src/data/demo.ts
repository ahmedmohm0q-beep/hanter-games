// Demo dataset — lives in its own storage namespace ("hg:demo"), never mixed with account data.
// The CMA exam date is intentionally empty: the user sets it inside the app.
import { addDays } from '../domain/dates';
import { planHalf, planMonth } from '../domain/periods';
import type { AppData, GoalPoint, LogEntry } from '../domain/types';
import { emptyAppData, newGoal, newHabit, newPlanYear, newRow, newSchedule, newTask } from './model';

export function demoData(today: string): AppData {
  const d = emptyAppData();
  const start = addDays(today, -30);
  const py = { ...newPlanYear(start, 'Demo'), version: 1 };
  d.planYears.push(py);
  d.settings = { ...d.settings, activePlanYearId: py.id, onboarded: true, version: 1 };

  const v1 = <T extends object>(x: T) => ({ ...x, version: 1 });
  const cma = v1(newGoal({
    planYearId: py.id, level: 'year', title: 'اجتياز CMA Part 1 (مثال)', startDate: start,
    description: 'مثال قابل للتحرير. حدّد تاريخ امتحانك من زر التعديل.', priority: 1,
    successMetric: { measure: { type: 'binary' }, target: 1, aggregate: 'latest', description: 'نتيجة النجاح الرسمية' },
  }));
  const fit = v1(newGoal({
    planYearId: py.id, level: 'year', title: 'لياقة أفضل (مثال)', startDate: start, priority: 2,
    successMetric: { measure: { type: 'distance', unit: 'km' }, target: 10, aggregate: 'max', description: 'أجري 10 كم متواصلة' },
  }));
  const h0 = planHalf(start, 0);
  const half = v1(newGoal({ planYearId: py.id, parentId: cma.id, level: 'half', title: 'إنهاء المنهج والمراجعة الأولى', startDate: h0.start, periodStart: h0.start }));
  const m0 = planMonth(start, 0);
  const m1 = planMonth(start, 1);
  const month0 = v1(newGoal({ planYearId: py.id, parentId: half.id, level: 'month', title: 'Section A–B', startDate: m0.start, periodStart: m0.start }));
  const month1 = v1(newGoal({ planYearId: py.id, parentId: half.id, level: 'month', title: 'Section C–D', startDate: m1.start, periodStart: m1.start }));
  d.goals.push(cma, fit, half, month0, month1);

  d.tasks.push(
    v1(newTask({ goalId: month0.id, title: 'حل 60 سؤال MCQ — Section A', dueDate: addDays(today, -10), measure: { type: 'questions' }, target: 60 })),
    v1(newTask({ goalId: month0.id, title: 'ملخص Section B', dueDate: addDays(today, 2) })),
    v1(newTask({ goalId: month1.id, title: 'اختبار تجريبي قصير', dueDate: addDays(today, 12) })),
  );

  const study = v1(newHabit({ title: 'مذاكرة CMA', cue: 'بعد صلاة الفجر', measure: { type: 'minutes' }, goalIds: [cma.id] }));
  const run = v1(newHabit({ title: 'جري', cue: 'بعد العمل', measure: { type: 'distance', unit: 'km' }, goalIds: [fit.id] }));
  const read = v1(newHabit({ title: 'قراءة', cue: 'قبل النوم', measure: { type: 'pages' } }));
  d.habits.push(study, run, read);
  d.habitSchedules.push(
    v1(newSchedule({ habitId: study.id, effectiveFrom: start, rule: { kind: 'daily' }, target: 60, minimum: 15 })),
    v1(newSchedule({ habitId: run.id, effectiveFrom: start, rule: { kind: 'perPeriod', period: 'week', count: 3 }, target: 3, minimum: null })),
    v1(newSchedule({ habitId: read.id, effectiveFrom: start, rule: { kind: 'weekdays', days: [0, 2, 4] }, target: 10, minimum: 3 })),
  );

  const L = (p: Partial<LogEntry> & { date: string }): LogEntry => ({ ...newRow(), version: 1, habitId: null, taskId: null, amount: 1, kind: 'progress', note: '', source: 'manual', ...p });
  // a believable history: some full days, some small versions, a gap, then a comeback
  for (let i = 1; i <= 28; i++) {
    const day = addDays(today, -i);
    if (i >= 12 && i <= 15) continue; // gap → shows as unrecorded, then a recovery
    const amt = i % 5 === 0 ? 15 : i % 3 === 0 ? 40 : 60;
    d.logs.push(L({ habitId: study.id, date: day, amount: amt }));
    if (i % 2 === 0) d.logs.push(L({ habitId: run.id, date: day, amount: 3 + (i % 3) }));
    if (i % 4 === 1) d.logs.push(L({ habitId: read.id, date: day, amount: 12 }));
  }
  d.logs.push(L({ taskId: d.tasks[0].id, date: addDays(today, -11), amount: 45 }));

  const P = (box: GoalPoint['box'], text: string, ifThen = '', nextStep = ''): GoalPoint => ({ ...newRow(), version: 1, goalId: cma.id, box, text, ifThen, nextStep, sortOrder: Date.now() + Math.random() });
  d.goalPoints.push(
    P('fears', 'أن يضيق الوقت قبل الامتحان', '', 'أحدد تاريخ الامتحان وأوزع الأقسام عليه'),
    P('benefits', 'فرص أفضل في المحاسبة الإدارية'),
    P('obstacles', 'ضغط الشغل آخر الشهر', 'إذا تأخرت في العمل، فسأذاكر 15 دقيقة فقط قبل النوم'),
  );
  return d;
}
