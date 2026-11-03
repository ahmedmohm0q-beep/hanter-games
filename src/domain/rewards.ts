// XP is DERIVED from unique source records, never incremented by button presses.
// Undo removes the entitlement; redo restores the *same* key — so toggling cannot farm XP.
// Game points are kept separate from goal metrics and never feed analytics.
import { recoveries } from './trend';
import { outcome } from './progress';
import type { EvaluatedOccurrence } from './schedule';
import type { AppData } from './types';

export interface Entitlement {
  sourceKey: string; // unique per real achievement
  xp: number;
  kind: 'done' | 'partial' | 'minimum' | 'recovery' | 'goalAchieved' | 'review';
  date: string;
}

export const XP = { done: 10, minimum: 4, partial: 3, recovery: 15, goalAchieved: 100, review: 8 } as const;

export function entitlements(occ: EvaluatedOccurrence[], data: AppData): Entitlement[] {
  const out = new Map<string, Entitlement>();
  for (const o of occ) {
    if (o.excluded) continue;
    if (o.contribution >= 1) out.set(`occ:${o.key}`, { sourceKey: `occ:${o.key}`, xp: XP.done, kind: 'done', date: o.date });
    else if (o.minimumMet) out.set(`occ:${o.key}`, { sourceKey: `occ:${o.key}`, xp: XP.minimum, kind: 'minimum', date: o.date });
    else if (o.amount > 0) out.set(`occ:${o.key}`, { sourceKey: `occ:${o.key}`, xp: XP.partial, kind: 'partial', date: o.date });
  }
  for (const r of recoveries(occ)) {
    const k = `rec:${r.habitId}:${r.date}`;
    out.set(k, { sourceKey: k, xp: XP.recovery, kind: 'recovery', date: r.date });
  }
  for (const g of data.goals) {
    if (g.deletedAt) continue;
    if (outcome(g, data).achieved) out.set(`goal:${g.id}`, { sourceKey: `goal:${g.id}`, xp: XP.goalAchieved, kind: 'goalAchieved', date: g.deadline ?? g.startDate });
  }
  for (const rv of data.reviews) {
    if (rv.deletedAt || !(rv.achieved || rv.blocker || rv.adjustment)) continue;
    const k = `review:${rv.periodType}:${rv.periodStart}`;
    out.set(k, { sourceKey: k, xp: XP.review, kind: 'review', date: rv.periodStart });
  }
  return [...out.values()];
}

export function totalXP(ents: Entitlement[]): number {
  return ents.reduce((s, e) => s + e.xp, 0);
}

/** Level n requires 50·n·(n+1) total XP (gentle quadratic curve). */
export function levelFor(xp: number): { level: number; into: number; needed: number } {
  let level = 0;
  while (50 * (level + 1) * (level + 2) <= xp) level++;
  const base = 50 * level * (level + 1);
  const next = 50 * (level + 1) * (level + 2);
  return { level: level + 1, into: xp - base, needed: next - base };
}

export interface Badge { id: string; earned: boolean; progress: number; goal: number }

export function badges(ents: Entitlement[]): Badge[] {
  const count = (k: Entitlement['kind']) => ents.filter((e) => e.kind === k).length;
  const defs: [string, Entitlement['kind'], number][] = [
    ['first-step', 'done', 1],
    ['ten-done', 'done', 10],
    ['hundred-done', 'done', 100],
    ['comeback', 'recovery', 1],
    ['small-wins', 'minimum', 5],
    ['reflector', 'review', 4],
    ['goal-achieved', 'goalAchieved', 1],
  ];
  return defs.map(([id, kind, goal]) => {
    const p = count(kind);
    return { id, earned: p >= goal, progress: Math.min(p, goal), goal };
  });
}
