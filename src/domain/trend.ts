// Trend = recent window vs the previous window, in percentage points of commitment.
// It describes recorded activity only and never claims more than the data supports.
import { addDays } from './dates';
import { commitment, type CommitmentResult } from './progress';
import { occurrencesFor, type EvaluatedOccurrence, type GenOptions } from './schedule';
import type { AppData, ISODate, TrendSettings } from './types';

export type TrendVerdict = 'improving' | 'steady' | 'declining' | 'insufficient';

export interface TrendResult {
  verdict: TrendVerdict;
  reasons: string[]; // machine-readable reason codes for the UI (i18n)
  recent: CommitmentResult & { start: ISODate; end: ISODate };
  previous: CommitmentResult & { start: ISODate; end: ISODate };
  deltaPP: number | null;
}

export function trendFromWindows(recent: EvaluatedOccurrence[], previous: EvaluatedOccurrence[], s: TrendSettings, ranges: { recent: [ISODate, ISODate]; previous: [ISODate, ISODate] }): TrendResult {
  const a = commitment(recent);
  const b = commitment(previous);
  const reasons: string[] = [];
  if (a.dueCount < s.minDue) reasons.push('fewDueRecent');
  if (b.dueCount < s.minDue) reasons.push('fewDuePrevious');
  if (a.coverage != null && a.coverage < s.minCoverage) reasons.push('lowCoverageRecent');
  if (b.coverage != null && b.coverage < s.minCoverage) reasons.push('lowCoveragePrevious');
  const deltaPP = a.ratio != null && b.ratio != null ? Math.round((a.ratio - b.ratio) * 1000) / 10 : null;
  let verdict: TrendVerdict = 'insufficient';
  if (!reasons.length && deltaPP != null) {
    verdict = deltaPP >= s.improveThresholdPP ? 'improving' : deltaPP <= s.declineThresholdPP ? 'declining' : 'steady';
  }
  return {
    verdict,
    reasons,
    deltaPP,
    recent: { ...a, start: ranges.recent[0], end: ranges.recent[1] },
    previous: { ...b, start: ranges.previous[0], end: ranges.previous[1] },
  };
}

/** Last N closed days (ending yesterday) vs the N before. */
export function trend(data: AppData, today: ISODate, s: TrendSettings, opt: GenOptions, filter?: { habitIds?: string[]; taskIds?: string[] }): TrendResult {
  const n = Math.max(1, s.windowDays);
  const rEnd = today; // exclusive → yesterday is the last day
  const rStart = addDays(today, -n);
  const pStart = addDays(rStart, -n);
  const recent = occurrencesFor(data, { range: { start: rStart, end: rEnd }, today, ...filter }, opt);
  const previous = occurrencesFor(data, { range: { start: pStart, end: rStart }, today, ...filter }, opt);
  return trendFromWindows(recent, previous, s, { recent: [rStart, addDays(rEnd, -1)], previous: [pStart, addDays(rStart, -1)] });
}

/**
 * Recovery = a completed opportunity right after a run of ≥ `minGap` due-but-missed
 * opportunities of the same habit. Returning is treated as an achievement.
 */
export function recoveries(occ: EvaluatedOccurrence[], minGap = 3): { habitId: string; date: ISODate; gap: number }[] {
  const byHabit = new Map<string, EvaluatedOccurrence[]>();
  for (const o of occ) if (o.habitId && !o.excluded) (byHabit.get(o.habitId) ?? byHabit.set(o.habitId, []).get(o.habitId)!).push(o);
  const out: { habitId: string; date: ISODate; gap: number }[] = [];
  for (const [habitId, list] of byHabit) {
    list.sort((x, y) => (x.date < y.date ? -1 : 1));
    let gap = 0;
    for (const o of list) {
      if (o.contribution > 0) {
        if (gap >= minGap) out.push({ habitId, date: o.date, gap });
        gap = 0;
      } else if (o.closed) gap++;
    }
  }
  return out;
}
