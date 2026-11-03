// Turns habits (with versioned schedules) and tasks into concrete "opportunities" (occurrences),
// then evaluates each against the logs. This is the single source of truth for every page.
import { addDays, diffDays, weekday } from './dates';
import { contains, intersect, lastDay, planMonth, rangeLength, weekStartOf, type Range } from './periods';
import type { AppData, Habit, HabitException, HabitSchedule, ISODate, LogEntry, Task, Weekday } from './types';

export type OccStatus =
  | 'planned' // future, or today with nothing logged yet
  | 'inProgress' // today / current quota period with some progress
  | 'done'
  | 'partial' // past, some progress but below target
  | 'notDone' // explicitly recorded as not done
  | 'unrecorded' // past and due, nothing recorded
  | 'rest' // planned rest (excluded)
  | 'paused'; // paused (excluded)

export interface Occurrence {
  key: string; // stable identity, e.g. "h:<habitId>:2026-11-03" or "q:<habitId>:2026-11-02" or "t:<taskId>"
  source: 'habit' | 'task';
  habitId: string | null;
  taskId: string | null;
  kind: 'day' | 'quota' | 'task';
  date: ISODate; // attribution date (quota → last day of its period; task → due date)
  range: Range; // the window this opportunity covers
  target: number; // amount per opportunity (quota → number of sessions)
  sessionTarget: number; // quota: amount per session counted as one session
  minimum: number | null;
  weight: number;
  scheduleId: string | null;
}

export interface EvaluatedOccurrence extends Occurrence {
  amount: number; // summed valid progress (quota → qualifying sessions)
  contribution: number; // min(amount / target, 1); binary → 0 or 1
  status: OccStatus;
  recorded: boolean; // any explicit record exists (progress or "not done")
  closed: boolean; // its window has fully elapsed → counts as "due" for commitment-to-date
  excluded: null | 'rest' | 'paused';
  minimumMet: boolean;
  logIds: string[];
}

const alive = <T extends { deletedAt?: string | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);

/** The schedule version in force on a date (latest effectiveFrom ≤ date). History is never rewritten. */
export function scheduleOn(versions: HabitSchedule[], d: ISODate): HabitSchedule | null {
  let best: HabitSchedule | null = null;
  for (const v of versions) if (v.effectiveFrom <= d && (!best || v.effectiveFrom > best.effectiveFrom)) best = v;
  return best;
}

function exceptionOn(exs: HabitException[], d: ISODate): HabitException | null {
  return exs.find((e) => d >= e.startDate && d < e.endDate) ?? null;
}

export interface GenOptions {
  weekStartsOn: Weekday;
  planStart: ISODate | null; // monthly quotas follow plan months when a plan exists
}

function monthPeriodContaining(d: ISODate, planStart: ISODate | null): Range {
  if (planStart) {
    // find plan-aligned month (may be outside the plan year)
    let i = Math.floor(diffDays(d, planStart) / 31) - 1;
    for (let k = 0; k < 40; k++, i++) {
      const p = planMonth(planStart, i);
      if (contains(p, d)) return p;
    }
  }
  const [y, m] = d.split('-').map(Number);
  const start = `${d.slice(0, 8)}01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { start, end: `${String(ny).padStart(4, '0')}-${String(nm).padStart(2, '0')}-01` };
}

export function habitOccurrences(habit: Habit, versions: HabitSchedule[], range: Range, opt: GenOptions): Occurrence[] {
  const vs = alive(versions).filter((v) => v.habitId === habit.id);
  if (!vs.length) return [];
  const out: Occurrence[] = [];
  const weight = habit.weight ?? 1;
  const seenQuota = new Set<string>();

  for (let d = range.start; d < range.end; d = addDays(d, 1)) {
    const v = scheduleOn(vs, d);
    if (!v) continue;
    const r = v.rule;
    if (r.kind === 'perPeriod') {
      const pr: Range = r.period === 'week'
        ? { start: weekStartOf(d, opt.weekStartsOn), end: addDays(weekStartOf(d, opt.weekStartsOn), 7) }
        : monthPeriodContaining(d, opt.planStart);
      const anchor = lastDay(pr);
      // attribute each quota exactly once: to the last day of its period
      if (!contains(range, anchor) || seenQuota.has(pr.start)) continue;
      seenQuota.add(pr.start);
      const vq = scheduleOn(vs, pr.start) ?? v; // version in force when the period started
      if (vq.rule.kind !== 'perPeriod') continue;
      out.push({
        key: `q:${habit.id}:${pr.start}`, source: 'habit', habitId: habit.id, taskId: null, kind: 'quota',
        date: anchor, range: pr, target: vq.rule.count, sessionTarget: vq.target, minimum: vq.minimum,
        weight: weight * vq.rule.count, scheduleId: vq.id,
      });
      continue;
    }
    let due = false;
    if (r.kind === 'daily') due = true;
    else if (r.kind === 'weekdays') due = r.days.includes(weekday(d));
    else if (r.kind === 'everyNDays') {
      const k = diffDays(d, r.anchor);
      due = k >= 0 && k % Math.max(1, r.n) === 0;
    }
    if (!due) continue;
    out.push({
      key: `h:${habit.id}:${d}`, source: 'habit', habitId: habit.id, taskId: null, kind: 'day',
      date: d, range: { start: d, end: addDays(d, 1) }, target: v.target, sessionTarget: v.target,
      minimum: v.minimum, weight, scheduleId: v.id,
    });
  }
  return out;
}

export function taskOccurrence(t: Task): Occurrence {
  return {
    key: `t:${t.id}`, source: 'task', habitId: null, taskId: t.id, kind: 'task', date: t.dueDate,
    range: { start: t.dueDate, end: addDays(t.dueDate, 1) }, target: t.target, sessionTarget: t.target,
    minimum: null, weight: t.weight ?? 1, scheduleId: null,
  };
}

export interface LogIndex {
  byHabitDate: Map<string, LogEntry[]>;
  byTask: Map<string, LogEntry[]>;
}

export function indexLogs(logs: LogEntry[]): LogIndex {
  const byHabitDate = new Map<string, LogEntry[]>();
  const byTask = new Map<string, LogEntry[]>();
  for (const l of alive(logs)) {
    if (l.habitId) {
      const k = `${l.habitId}|${l.date}`;
      (byHabitDate.get(k) ?? byHabitDate.set(k, []).get(k)!).push(l);
    } else if (l.taskId) {
      (byTask.get(l.taskId) ?? byTask.set(l.taskId, []).get(l.taskId)!).push(l);
    }
  }
  return { byHabitDate, byTask };
}

const sumProgress = (ls: LogEntry[]) => ls.filter((l) => l.kind === 'progress').reduce((s, l) => s + Math.max(0, l.amount), 0);

export function evaluate(o: Occurrence, idx: LogIndex, exceptions: HabitException[], today: ISODate): EvaluatedOccurrence {
  const habitEx = o.habitId ? alive(exceptions).filter((e) => e.habitId === o.habitId) : [];
  let amount = 0;
  let recorded = false;
  let skipped = false;
  const logIds: string[] = [];
  let excluded: EvaluatedOccurrence['excluded'] = null;
  let target = o.target;

  if (o.kind === 'day') {
    const ex = exceptionOn(habitEx, o.date);
    if (ex) excluded = ex.kind === 'pause' ? 'paused' : 'rest';
    const ls = idx.byHabitDate.get(`${o.habitId}|${o.date}`) ?? [];
    amount = sumProgress(ls);
    recorded = ls.length > 0;
    skipped = ls.some((l) => l.kind === 'skip') && amount === 0;
    logIds.push(...ls.map((l) => l.id));
  } else if (o.kind === 'quota') {
    // Days covered by rest/pause shrink the quota proportionally (documented in analytics help).
    let available = 0;
    let sessions = 0;
    for (let d = o.range.start; d < o.range.end; d = addDays(d, 1)) {
      const ex = exceptionOn(habitEx, d);
      if (!ex) available++;
      const ls = idx.byHabitDate.get(`${o.habitId}|${d}`) ?? [];
      if (ls.length) recorded = true;
      logIds.push(...ls.map((l) => l.id));
      if (sumProgress(ls) >= o.sessionTarget) sessions++;
    }
    const len = rangeLength(o.range);
    target = Math.round((o.target * available) / len);
    if (target === 0) {
      const k = exceptionOn(habitEx, o.range.start)?.kind ?? 'rest';
      excluded = k === 'pause' ? 'paused' : 'rest';
    }
    amount = sessions;
  } else {
    const ls = idx.byTask.get(o.taskId!) ?? [];
    amount = sumProgress(ls);
    recorded = ls.length > 0;
    skipped = ls.some((l) => l.kind === 'skip') && amount === 0;
    logIds.push(...ls.map((l) => l.id));
  }

  const contribution = target > 0 ? Math.min(amount / target, 1) : 0;
  const closed = o.range.end <= today; // window fully elapsed ("today" itself is still open)
  const current = contains(o.range, today);
  const minimumMet = o.minimum != null && o.kind !== 'quota' && amount >= o.minimum;

  let status: OccStatus;
  if (excluded) status = excluded === 'rest' ? 'rest' : 'paused';
  else if (contribution >= 1) status = 'done';
  else if (!closed && !current) status = 'planned';
  else if (current) status = amount > 0 ? 'inProgress' : skipped ? 'notDone' : 'planned';
  else if (amount > 0) status = 'partial';
  else if (skipped) status = 'notDone';
  else status = 'unrecorded';

  const weight = o.kind === 'quota' && o.target > 0 ? (o.weight * target) / o.target : o.weight;
  return { ...o, weight, target, amount, contribution: excluded ? 0 : contribution, status, recorded, closed, excluded, minimumMet, logIds };
}

export interface OccurrenceQuery {
  range: Range;
  today: ISODate;
  habitIds?: string[];
  taskIds?: string[];
  includeTasks?: boolean;
  includeHabits?: boolean;
}

/** All evaluated opportunities for a range — the one function every page and analytic uses. */
export function occurrencesFor(data: AppData, q: OccurrenceQuery, opt: GenOptions): EvaluatedOccurrence[] {
  const idx = indexLogs(data.logs);
  const out: EvaluatedOccurrence[] = [];
  if (q.includeHabits !== false) {
    for (const h of alive(data.habits)) {
      if (q.habitIds && !q.habitIds.includes(h.id)) continue;
      for (const o of habitOccurrences(h, data.habitSchedules, q.range, opt)) out.push(evaluate(o, idx, data.habitExceptions, q.today));
    }
  }
  if (q.includeTasks !== false) {
    for (const t of alive(data.tasks)) {
      if (q.taskIds && !q.taskIds.includes(t.id)) continue;
      if (!contains(q.range, t.dueDate)) continue;
      out.push(evaluate(taskOccurrence(t), idx, data.habitExceptions, q.today));
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Restrict to opportunities whose attribution date lies in a sub-range (e.g. week ∩ month). */
export function clipTo(occ: EvaluatedOccurrence[], r: Range): EvaluatedOccurrence[] {
  return occ.filter((o) => contains(r, o.date));
}

export { intersect };
