// Runs under Vitest (globals: true) and under `bun test` (globals built in).
import { addMonthsClamped, weekday, todayInZone, isLeapYear } from '../dates';
import { planMonths, planHalf, planYearRange, lastDay, weekOf, intersect, contains, startChangeImpact } from '../periods';
import { occurrencesFor, clipTo, habitOccurrences, scheduleOn } from '../schedule';
import { commitment, planProgress, goalProgress, outcome, activityCount, wouldCreateCycle } from '../progress';
import { trendFromWindows } from '../trend';
import { entitlements, totalXP, levelFor } from '../rewards';
import { quoteForDay, type Quote } from '../quotes';
import { emptyData, goal, habit, schedule, log, task, opt, settings } from './fixtures';

describe('plan year geometry', () => {
  it('mid-month start: 15 Nov 2026 → exclusive end 15 Nov 2027, last day 14 Nov 2027', () => {
    const y = planYearRange('2026-11-15');
    expect(y.end).toBe('2027-11-15');
    expect(lastDay(y)).toBe('2027-11-14');
    const ms = planMonths('2026-11-15');
    expect(ms).toHaveLength(12);
    expect(ms[0]).toMatchObject({ start: '2026-11-15', end: '2026-12-15' });
    expect(ms[11].end).toBe('2027-11-15');
    for (let i = 1; i < 12; i++) expect(ms[i].start).toBe(ms[i - 1].end); // contiguous, no overlap
    expect(planHalf('2026-11-15', 0)).toMatchObject({ start: '2026-11-15', end: '2027-05-15' });
    expect(planHalf('2026-11-15', 1)).toMatchObject({ start: '2027-05-15', end: '2027-11-15' });
  });

  it('31 Jan start clamps without drifting later months', () => {
    const ms = planMonths('2027-01-31');
    expect(ms.map((m) => m.start)).toEqual([
      '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30',
      '2027-07-31', '2027-08-31', '2027-09-30', '2027-10-31', '2027-11-30', '2027-12-31',
    ]);
    expect(ms[11].end).toBe('2028-01-31');
  });

  it('leap year: 31 Jan 2028 → Feb 29; 29 Feb start rolls to 28 Feb in non-leap years', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2028-02-29', 12)).toBe('2029-02-28');
    expect(addMonthsClamped('2028-02-29', 1)).toBe('2028-03-29'); // anchor day 29 kept
    const y = planYearRange('2028-02-29');
    expect(lastDay(y)).toBe('2029-02-27');
  });

  it('weeks are real calendar weeks and respect week start', () => {
    expect(weekday('2026-11-03')).toBe(2); // Tuesday
    expect(weekOf('2026-11-03', 6)).toMatchObject({ start: '2026-10-31', end: '2026-11-07' });
    expect(weekOf('2026-11-03', 1)).toMatchObject({ start: '2026-11-02', end: '2026-11-09' });
  });

  it('time zone decides "today"', () => {
    const t = new Date('2026-11-03T21:30:00Z');
    expect(todayInZone('Asia/Dubai', t)).toBe('2026-11-04');
    expect(todayInZone('America/New_York', t)).toBe('2026-11-03');
  });

  it('start-date change impact is previewed', () => {
    const imp = startChangeImpact('2026-11-15', '2026-12-01', ['2026-11-20', '2027-11-20', '2026-12-10']);
    expect(imp.leaving).toEqual(['2026-11-20']);
    expect(imp.entering).toEqual(['2027-11-20']);
  });
});

describe('goal deadline shorter than the year', () => {
  it('days left and outside-year flag come from the goal deadline, not the year end', () => {
    const d = emptyData();
    const g = goal({ title: 'Pass CMA Part 1', deadline: '2027-03-10' });
    d.goals.push(g);
    const n = goalProgress(g.id, d, '2027-03-01', opt)!;
    expect(n.daysLeft).toBe(9);
    expect(n.outsidePlanYear).toBe(false);
    const late = goal({ deadline: '2028-01-05' });
    d.goals.push(late);
    expect(goalProgress(late.id, d, '2027-03-01', opt)!.outsidePlanYear).toBe(true);
  });

  it("a habit linked to the goal generates no opportunities after the goal's deadline", () => {
    const d = emptyData();
    const g = goal({ deadline: '2026-11-20', startDate: '2026-11-15' });
    const h = habit({ goalIds: [g.id] });
    d.goals.push(g); d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }));
    const n = goalProgress(g.id, d, '2026-11-16', opt)!;
    // 15..20 inclusive = 6 opportunities, none in later months
    expect(n.commit.dueCount + n.commit.openCount).toBe(6);
  });
});

describe('week crossing two months', () => {
  it('counts each log exactly once across month aggregations', () => {
    const d = emptyData();
    const h = habit();
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }));
    for (const day of ['12', '13', '14', '15', '16', '17', '18']) d.logs.push(log({ habitId: h.id, date: `2026-12-${day}` }));
    const today = '2027-01-01';
    const week = weekOf('2026-12-15', 6);
    expect(week).toMatchObject({ start: '2026-12-12', end: '2026-12-19' });
    const [m0, m1] = planMonths('2026-11-15');
    const all = occurrencesFor(d, { range: week, today }, opt);
    const inM0 = clipTo(all, intersect(week, m0)!);
    const inM1 = clipTo(all, intersect(week, m1)!);
    expect(inM0.length).toBe(3);
    expect(inM1.length).toBe(4);
    expect(inM0.length + inM1.length).toBe(all.length);
    const keys = new Set([...inM0, ...inM1].map((o) => o.key));
    expect(keys.size).toBe(7);
    expect(activityCount(d, week)).toBe(7);
  });

  it('a weekly quota is attributed once (to its week end)', () => {
    const d = emptyData();
    const h = habit();
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'perPeriod', period: 'week', count: 3 }));
    const ms = planMonths('2026-11-15');
    const counts = ms.slice(0, 3).map((m) => occurrencesFor(d, { range: m, today: '2027-06-01' }, opt).length);
    const whole = occurrencesFor(d, { range: { start: ms[0].start, end: ms[2].end }, today: '2027-06-01' }, opt).length;
    expect(counts.reduce((a, b) => a + b, 0)).toBe(whole);
  });
});

describe('scoring', () => {
  it('3 of 4 equal opportunities = 75%', () => {
    const d = emptyData();
    const h = habit();
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }));
    ['2026-11-15', '2026-11-16', '2026-11-17'].forEach((date) => d.logs.push(log({ habitId: h.id, date })));
    d.logs.push(log({ habitId: h.id, date: '2026-11-18', kind: 'skip', amount: 0 }));
    const c = commitment(occurrencesFor(d, { range: { start: '2026-11-15', end: '2026-11-19' }, today: '2026-11-19' }, opt));
    expect(c.ratio).toBeCloseTo(0.75);
    expect(c.coverage).toBe(1);
  });

  it('20 of 40 minutes = 50% for that opportunity; sessions are summed and capped at 1', () => {
    const d = emptyData();
    const h = habit({ measure: { type: 'minutes' } });
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }, 40));
    d.logs.push(log({ habitId: h.id, date: '2026-11-15', amount: 15 }), log({ habitId: h.id, date: '2026-11-15', amount: 5 }));
    d.logs.push(log({ habitId: h.id, date: '2026-11-16', amount: 90 }));
    const occ = occurrencesFor(d, { range: { start: '2026-11-15', end: '2026-11-17' }, today: '2026-11-20' }, opt);
    expect(occ[0].contribution).toBe(0.5);
    expect(occ[0].status).toBe('partial');
    expect(occ[1].contribution).toBe(1);
  });

  it('3×/week is measured against 3, not 7; rest days and the future are not failures', () => {
    const d = emptyData();
    const h = habit();
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'perPeriod', period: 'week', count: 3 }));
    ['2026-11-21', '2026-11-23', '2026-11-25'].forEach((date) => d.logs.push(log({ habitId: h.id, date })));
    const week = weekOf('2026-11-21', 6);
    const c = commitment(occurrencesFor(d, { range: week, today: '2026-11-30' }, opt));
    expect(c.ratio).toBe(1);
    // future week: planned, not due
    const f = commitment(occurrencesFor(d, { range: weekOf('2026-12-05', 6), today: '2026-11-30' }, opt));
    expect(f.ratio).toBeNull();
    expect(f.dueCount).toBe(0);
  });

  it('planned rest is excluded with its reason; future days stay planned', () => {
    const d = emptyData();
    const h = habit();
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }));
    d.habitExceptions.push({ id: 'x', version: 1, updatedAt: '', habitId: h.id, startDate: '2026-11-16', endDate: '2026-11-17', kind: 'rest', note: '' });
    d.logs.push(log({ habitId: h.id, date: '2026-11-15' }));
    const occ = occurrencesFor(d, { range: { start: '2026-11-15', end: '2026-11-20' }, today: '2026-11-17' }, opt);
    const c = commitment(occ);
    expect(c.excluded.map((o) => o.date)).toEqual(['2026-11-16']);
    expect(c.ratio).toBe(1);
    expect(occ.find((o) => o.date === '2026-11-19')!.status).toBe('planned');
    expect(occ.find((o) => o.date === '2026-11-17')!.status).toBe('planned'); // today, nothing logged yet
  });

  it('missing records stay in the denominator and coverage is reported separately', () => {
    const d = emptyData();
    const h = habit();
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }));
    d.logs.push(log({ habitId: h.id, date: '2026-11-15' }));
    const c = commitment(occurrencesFor(d, { range: { start: '2026-11-15', end: '2026-11-19' }, today: '2026-11-19' }, opt));
    expect(c.ratio).toBeCloseTo(0.25);
    expect(c.coverage).toBeCloseTo(0.25);
    expect(c.unrecorded).toHaveLength(3);
    expect(c.unrecorded[0].status).toBe('unrecorded');
  });

  it('no due items → ratio null (UI shows "no items due"), not 0% or 100%', () => {
    const d = emptyData();
    expect(commitment(occurrencesFor(d, { range: { start: '2026-11-15', end: '2026-11-19' }, today: '2026-11-19' }, opt)).ratio).toBeNull();
  });

  it('changing a schedule does not rewrite history', () => {
    const d = emptyData();
    const h = habit({ measure: { type: 'pages' } });
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }, 10, '2026-11-01'));
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }, 30, '2026-11-20'));
    d.logs.push(log({ habitId: h.id, date: '2026-11-18', amount: 10 }), log({ habitId: h.id, date: '2026-11-21', amount: 10 }));
    const occ = occurrencesFor(d, { range: { start: '2026-11-18', end: '2026-11-22' }, today: '2026-11-25' }, opt);
    expect(occ.find((o) => o.date === '2026-11-18')!.contribution).toBe(1);
    expect(occ.find((o) => o.date === '2026-11-21')!.contribution).toBeCloseTo(1 / 3);
    expect(scheduleOn(d.habitSchedules, '2026-11-19')!.target).toBe(10);
  });

  it('every-8-days cycle', () => {
    const h = habit();
    const s = [schedule(h.id, { kind: 'everyNDays', n: 8, anchor: '2026-11-15' })];
    const occ = habitOccurrences(h, s, { start: '2026-11-15', end: '2026-12-15' }, opt);
    expect(occ.map((o) => o.date)).toEqual(['2026-11-15', '2026-11-23', '2026-12-01', '2026-12-09']);
  });

  it('small version is recorded honestly as partial, not full', () => {
    const d = emptyData();
    const h = habit({ measure: { type: 'minutes' } });
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }, 60, '2026-01-01', 10));
    d.logs.push(log({ habitId: h.id, date: '2026-11-15', amount: 10 }));
    const [o] = occurrencesFor(d, { range: { start: '2026-11-15', end: '2026-11-16' }, today: '2026-11-20' }, opt);
    expect(o.minimumMet).toBe(true);
    expect(o.status).toBe('partial');
    expect(o.contribution).toBeCloseTo(1 / 6);
  });

  it('weights are used when set', () => {
    const d = emptyData();
    const a = habit({ weight: 3 });
    const b = habit({ weight: 1 });
    d.habits.push(a, b);
    d.habitSchedules.push(schedule(a.id, { kind: 'daily' }), schedule(b.id, { kind: 'daily' }));
    d.logs.push(log({ habitId: a.id, date: '2026-11-15' }));
    const c = commitment(occurrencesFor(d, { range: { start: '2026-11-15', end: '2026-11-16' }, today: '2026-11-20' }, opt));
    expect(c.ratio).toBeCloseTo(0.75);
  });

  it('plan progress counts future work; expected share follows the planned distribution', () => {
    const d = emptyData();
    const g = goal();
    d.goals.push(g);
    d.tasks.push(task({ goalId: g.id, dueDate: '2026-11-16', weight: 1 }), task({ goalId: g.id, dueDate: '2027-01-10', weight: 3 }));
    d.logs.push(log({ taskId: d.tasks[0].id, date: '2026-11-16' }));
    const occ = occurrencesFor(d, { range: planYearRange('2026-11-15'), today: '2026-12-01' }, opt);
    const p = planProgress(occ);
    expect(p.ratio).toBeCloseTo(0.25);
    expect(p.expected).toBeCloseTo(0.25);
    expect(p.gapPP).toBe(0);
  });
});

describe('outcome vs effort', () => {
  it('completing all study hours does not mark the exam as achieved', () => {
    const d = emptyData();
    const g = goal({ title: 'Pass CMA Part 1', deadline: '2027-03-10', successMetric: { measure: { type: 'binary' }, target: 1 } });
    const h = habit({ goalIds: [g.id], measure: { type: 'hours' } });
    d.goals.push(g); d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }, 2));
    for (let i = 15; i <= 30; i++) d.logs.push(log({ habitId: h.id, date: `2026-11-${i}`, amount: 2 }));
    const n = goalProgress(g.id, d, '2026-12-01', opt)!;
    expect(n.commit.ratio).toBe(1);
    expect(n.outcome.achieved).toBe(false);
    expect(n.outcome.ratio).toBeNull();
    d.outcomeResults.push({ id: 'r', version: 1, updatedAt: '', goalId: g.id, date: '2027-03-12', value: 1, note: '' });
    expect(outcome(g, d).achieved).toBe(true);
  });

  it('parent progress = weighted mean of direct children (no unit mixing, no double counting)', () => {
    const d = emptyData();
    const p = goal();
    const c1 = goal({ parentId: p.id, level: 'half', weight: 1 });
    const c2 = goal({ parentId: p.id, level: 'half', weight: 3 });
    d.goals.push(p, c1, c2);
    d.tasks.push(task({ goalId: c1.id, dueDate: '2026-11-16' }), task({ goalId: c2.id, dueDate: '2026-11-17' }));
    d.logs.push(log({ taskId: d.tasks[0].id, date: '2026-11-16' }));
    const n = goalProgress(p.id, d, '2026-11-20', opt)!;
    expect(n.plan.ratio).toBeCloseTo(0.25);
  });

  it('cycle detection', () => {
    const a = goal(); const b = goal({ parentId: a.id }); const c = goal({ parentId: b.id });
    expect(wouldCreateCycle([a, b, c], a.id, c.id)).toBe(true);
    expect(wouldCreateCycle([a, b, c], c.id, a.id)).toBe(false);
  });
});

describe('trend', () => {
  const s = settings().trend;
  const mk = (n: number, done: number, recorded = n) => {
    const d = emptyData();
    const h = habit();
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }));
    for (let i = 0; i < recorded; i++) d.logs.push(log({ habitId: h.id, date: `2026-12-${String(i + 1).padStart(2, '0')}`, amount: i < done ? 1 : 0, kind: i < done ? 'progress' : 'skip' }));
    return occurrencesFor(d, { range: { start: '2026-12-01', end: `2026-12-${String(n + 1).padStart(2, '0')}` }, today: '2027-01-01' }, opt);
  };
  const ranges = { recent: ['a', 'b'] as [string, string], previous: ['c', 'd'] as [string, string] };

  it('reports the difference in percentage points', () => {
    const t = trendFromWindows(mk(14, 12), mk(14, 7), s, ranges);
    expect(t.deltaPP).toBeCloseTo(35.7, 1);
    expect(t.verdict).toBe('improving');
  });
  it('declining', () => {
    expect(trendFromWindows(mk(14, 5), mk(14, 10), s, ranges).verdict).toBe('declining');
  });
  it('insufficient data when the sample is small or recording is incomplete', () => {
    expect(trendFromWindows(mk(3, 3), mk(14, 7), s, ranges).verdict).toBe('insufficient');
    expect(trendFromWindows(mk(14, 4, 4), mk(14, 7), s, ranges).verdict).toBe('insufficient');
  });
});

describe('rewards', () => {
  it('undo/redo cannot farm XP: entitlements are keyed by the unique occurrence', () => {
    const d = emptyData();
    const h = habit();
    d.habits.push(h);
    d.habitSchedules.push(schedule(h.id, { kind: 'daily' }));
    const range = { start: '2026-11-15', end: '2026-11-16' };
    const xpNow = () => totalXP(entitlements(occurrencesFor(d, { range, today: '2026-11-20' }, opt), d));
    expect(xpNow()).toBe(0);
    const l = log({ habitId: h.id, date: '2026-11-15' });
    d.logs.push(l);
    const once = xpNow();
    expect(once).toBe(10);
    for (let i = 0; i < 5; i++) {
      d.logs.forEach((x) => (x.deletedAt = 'undo')); // undo every completion of that day
      expect(xpNow()).toBe(0);
      d.logs.push(log({ habitId: h.id, date: '2026-11-15' })); // complete again
      expect(xpNow()).toBe(once);
      d.logs.push(log({ habitId: h.id, date: '2026-11-15' })); // a duplicate completion adds nothing
      expect(xpNow()).toBe(once);
    }
    void l;
    expect(levelFor(0).level).toBe(1);
    expect(levelFor(100).level).toBe(2);
  });
});

describe('quotes', () => {
  const q = (id: string, lang: 'ar' | 'en'): Quote => ({ id, lang, text: id, translation: '', translationBy: 'app', author: '', authorAlt: '', work: '', year: '', sourceUrl: '', sourceNote: '', verifiedOn: '2026-11-03' });
  const lib = [q('a', 'en'), q('b', 'en'), q('c', 'en'), q('x', 'ar')];
  it('stable within a day, changes on the next day, flags repeats honestly', () => {
    const d1 = quoteForDay(lib, 'en', '2026-11-15', '2026-11-15', []);
    const d1b = quoteForDay(lib, 'en', '2026-11-15', '2026-11-15', []);
    const d2 = quoteForDay(lib, 'en', '2026-11-16', '2026-11-15', []);
    expect(d1.quote!.id).toBe(d1b.quote!.id);
    expect(d2.quote!.id).not.toBe(d1.quote!.id);
    const ids = [0, 1, 2].map((i) => quoteForDay(lib, 'en', `2026-11-${15 + i}`, '2026-11-15', []).quote!.id);
    expect(new Set(ids).size).toBe(3); // no repeat while the library lasts
    expect(quoteForDay(lib, 'en', '2026-11-18', '2026-11-15', []).repeated).toBe(true);
  });
  it('a synced view wins so all devices agree', () => {
    const v = { id: 'v', version: 1, updatedAt: '', date: '2026-11-15', lang: 'en' as const, quoteId: 'c' };
    expect(quoteForDay(lib, 'en', '2026-11-15', '2026-11-15', [v]).quote!.id).toBe('c');
  });
});

describe('misc', () => {
  it('contains uses half-open ranges', () => {
    expect(contains({ start: '2026-11-15', end: '2026-11-16' }, '2026-11-16')).toBe(false);
  });
});
