// The three distinct measures:
//   1. commitment  — how much of the *due* work was done (closed windows only)
//   2. plan progress — done work vs ALL planned work in the window (future included)
//   3. outcome     — whether the goal's own success metric was met (recorded results only)
import { addDays } from './dates';
import { planYearRange, type Range } from './periods';
import { occurrencesFor, type EvaluatedOccurrence, type GenOptions } from './schedule';
import type { AppData, Goal, ISODate } from './types';

export interface Ratio {
  numerator: number;
  denominator: number;
  ratio: number | null; // null → nothing to measure ("no items due")
}

export interface CommitmentResult extends Ratio {
  dueCount: number;
  recordedCount: number;
  coverage: number | null; // recorded / due
  doneCount: number;
  partialCount: number;
  unrecorded: EvaluatedOccurrence[];
  excluded: EvaluatedOccurrence[]; // rest / pause, with reason
  openCount: number; // not yet closed (today / future / current quota)
}

const r = (n: number, d: number): Ratio => ({ numerator: n, denominator: d, ratio: d > 0 ? n / d : null });

export function commitment(occ: EvaluatedOccurrence[]): CommitmentResult {
  const excluded = occ.filter((o) => o.excluded);
  const open = occ.filter((o) => !o.excluded && !o.closed);
  const due = occ.filter((o) => !o.excluded && o.closed);
  let num = 0;
  let den = 0;
  for (const o of due) {
    num += o.weight * o.contribution;
    den += o.weight;
  }
  const recorded = due.filter((o) => o.recorded).length;
  return {
    ...r(num, den),
    dueCount: due.length,
    recordedCount: recorded,
    coverage: due.length ? recorded / due.length : null,
    doneCount: due.filter((o) => o.status === 'done').length,
    partialCount: due.filter((o) => o.status === 'partial').length,
    unrecorded: due.filter((o) => o.status === 'unrecorded'),
    excluded,
    openCount: open.length,
  };
}

export interface PlanProgressResult extends Ratio {
  expected: number | null; // share of planned work whose window has closed by now (non-linear)
  gapPP: number | null; // (expected − actual) in percentage points; > 0 means behind plan
  totalCount: number;
}

export function planProgress(occ: EvaluatedOccurrence[]): PlanProgressResult {
  const items = occ.filter((o) => !o.excluded);
  let num = 0;
  let den = 0;
  let closedW = 0;
  for (const o of items) {
    num += o.weight * o.contribution;
    den += o.weight;
    if (o.closed) closedW += o.weight;
  }
  const base = r(num, den);
  const expected = den > 0 ? closedW / den : null;
  return {
    ...base,
    expected,
    gapPP: expected != null && base.ratio != null ? Math.round((expected - base.ratio) * 1000) / 10 : null,
    totalCount: items.length,
  };
}

/** Unique logged activity (each log counted once even when its habit serves several goals). */
export function activityCount(data: AppData, range: Range): number {
  const ids = new Set<string>();
  for (const l of data.logs) if (!l.deletedAt && l.kind === 'progress' && l.date >= range.start && l.date < range.end) ids.add(l.id);
  return ids.size;
}

// ---------- goals ----------

export function goalWindow(g: Goal, data: AppData): Range {
  const py = data.planYears.find((p) => p.id === g.planYearId);
  const yr = py ? planYearRange(py.startDate) : { start: g.startDate, end: addDays(g.startDate, 365) };
  const start = g.startDate || yr.start;
  const end = g.deadline ? addDays(g.deadline, 1) : yr.end; // deadline day is inclusive
  return { start, end: end > start ? end : addDays(start, 1) };
}

export interface OutcomeResultSummary {
  value: number | null;
  target: number;
  ratio: number | null;
  achieved: boolean;
  recordedCount: number;
}

/** Outcome achievement uses ONLY recorded results — study hours never mark an exam as passed. */
export function outcome(g: Goal, data: AppData): OutcomeResultSummary {
  const rs = data.outcomeResults.filter((x) => x.goalId === g.id && !x.deletedAt).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.updatedAt < b.updatedAt ? -1 : 1));
  const target = g.successMetric.target || 1;
  if (!rs.length) return { value: null, target, ratio: null, achieved: false, recordedCount: 0 };
  const agg = g.successMetric.aggregate ?? 'latest';
  const value = agg === 'sum' ? rs.reduce((s, x) => s + x.value, 0) : agg === 'max' ? Math.max(...rs.map((x) => x.value)) : rs[rs.length - 1].value;
  const ratio = Math.min(Math.max(value / target, 0), 1);
  return { value, target, ratio, achieved: value >= target, recordedCount: rs.length };
}

export interface GoalProgressNode {
  goalId: string;
  plan: PlanProgressResult; // weighted over direct children only
  commit: CommitmentResult; // over this goal's own direct tasks+habits and descendants' (unique keys)
  outcome: OutcomeResultSummary;
  children: { id: string; type: 'goal' | 'task' | 'habit'; weight: number; ratio: number | null; expected: number | null }[];
  daysLeft: number | null;
  outsidePlanYear: boolean;
}

/**
 * Parent progress = weighted mean of DIRECT children's normalized ratios.
 * Units never mix: each child is first normalized to 0..1. Parent % is never added to children %.
 */
export function goalProgress(goalId: string, data: AppData, today: ISODate, opt: GenOptions, seen = new Set<string>()): GoalProgressNode | null {
  const g = data.goals.find((x) => x.id === goalId && !x.deletedAt);
  if (!g || seen.has(goalId)) return null; // cycle guard (DB also prevents cycles)
  seen.add(goalId);
  const win = goalWindow(g, data);
  const children: GoalProgressNode['children'] = [];
  const allOcc = new Map<string, EvaluatedOccurrence>();

  for (const c of data.goals.filter((x) => x.parentId === g.id && !x.deletedAt && x.status !== 'archived')) {
    const n = goalProgress(c.id, data, today, opt, seen);
    if (!n) continue;
    children.push({ id: c.id, type: 'goal', weight: c.weight ?? 1, ratio: n.plan.ratio, expected: n.plan.expected });
    for (const o of n.commit.excluded) allOcc.set(o.key, o);
    for (const o of collectOcc(c.id, data, today, opt, new Set([g.id]))) allOcc.set(o.key, o);
  }
  const taskIds = data.tasks.filter((t) => t.goalId === g.id && !t.deletedAt).map((t) => t.id);
  if (taskIds.length) {
    const occ = occurrencesFor(data, { range: { start: '0000-01-01', end: '9999-12-31' }, today, taskIds, includeHabits: false }, opt);
    for (const o of occ) {
      const t = data.tasks.find((x) => x.id === o.taskId)!;
      children.push({ id: t.id, type: 'task', weight: t.weight ?? 1, ratio: o.contribution, expected: o.closed ? 1 : 0 });
      allOcc.set(o.key, o);
    }
  }
  for (const h of data.habits.filter((x) => x.goalIds.includes(g.id) && !x.deletedAt)) {
    const occ = occurrencesFor(data, { range: win, today, habitIds: [h.id], includeTasks: false }, opt);
    const pp = planProgress(occ);
    children.push({ id: h.id, type: 'habit', weight: h.weight ?? 1, ratio: pp.ratio, expected: pp.expected });
    for (const o of occ) allOcc.set(o.key, o);
  }

  let num = 0, den = 0, exp = 0;
  for (const c of children) {
    if (c.ratio == null) continue;
    num += c.weight * c.ratio;
    den += c.weight;
    exp += c.weight * (c.expected ?? 0);
  }
  const ratio = den > 0 ? num / den : null;
  const expected = den > 0 ? exp / den : null;
  const py = data.planYears.find((p) => p.id === g.planYearId);
  const yr = py ? planYearRange(py.startDate) : null;
  const daysLeft = g.deadline ? Math.round((Date.UTC(+g.deadline.slice(0, 4), +g.deadline.slice(5, 7) - 1, +g.deadline.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000) : null;

  return {
    goalId: g.id,
    plan: { numerator: num, denominator: den, ratio, expected, gapPP: expected != null && ratio != null ? Math.round((expected - ratio) * 1000) / 10 : null, totalCount: children.length },
    commit: commitment([...allOcc.values()]),
    outcome: outcome(g, data),
    children,
    daysLeft,
    outsidePlanYear: !!(yr && g.deadline && (g.deadline < yr.start || g.deadline >= yr.end)),
  };
}

function collectOcc(goalId: string, data: AppData, today: ISODate, opt: GenOptions, seen: Set<string>): EvaluatedOccurrence[] {
  if (seen.has(goalId)) return [];
  seen.add(goalId);
  const g = data.goals.find((x) => x.id === goalId);
  if (!g) return [];
  const out: EvaluatedOccurrence[] = [];
  const taskIds = data.tasks.filter((t) => t.goalId === goalId && !t.deletedAt).map((t) => t.id);
  if (taskIds.length) out.push(...occurrencesFor(data, { range: { start: '0000-01-01', end: '9999-12-31' }, today, taskIds, includeHabits: false }, opt));
  const habitIds = data.habits.filter((h) => h.goalIds.includes(goalId) && !h.deletedAt).map((h) => h.id);
  if (habitIds.length) out.push(...occurrencesFor(data, { range: goalWindow(g, data), today, habitIds, includeTasks: false }, opt));
  for (const c of data.goals.filter((x) => x.parentId === goalId && !x.deletedAt)) out.push(...collectOcc(c.id, data, today, opt, seen));
  return out;
}

/** Detects parent assignments that would create a cycle (UI pre-check; DB trigger enforces it too). */
export function wouldCreateCycle(goals: Goal[], goalId: string, newParentId: string | null): boolean {
  let cur = newParentId;
  const byId = new Map(goals.map((g) => [g.id, g]));
  for (let i = 0; cur && i < 10_000; i++) {
    if (cur === goalId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

/** Work-load check when splitting a goal: planned hours vs stated weekly capacity. */
export function capacityCheck(plannedMinutesPerWeek: Map<string, number>, capacityHours: number | null) {
  if (capacityHours == null) return [];
  return [...plannedMinutesPerWeek.entries()]
    .filter(([, m]) => m > capacityHours * 60)
    .map(([weekStart, m]) => ({ weekStart, plannedHours: Math.round((m / 60) * 10) / 10, capacityHours }));
}
