// Planning-year geometry. All ranges are half-open: [start, end).
import { addDays, addMonthsClamped, maxDate, minDate, weekday, diffDays } from './dates';
import type { ISODate, Weekday } from './types';

export interface Range {
  start: ISODate; // inclusive
  end: ISODate; // exclusive
}

export type PeriodType = 'day' | 'week' | 'month' | 'half' | 'year';

export interface Period extends Range {
  type: PeriodType;
  index: number; // month 0..11, half 0..1, year 0, week/day: ordinal within plan year (may be -1 if outside)
}

export const lastDay = (r: Range): ISODate => addDays(r.end, -1);
export const contains = (r: Range, d: ISODate) => d >= r.start && d < r.end;
export const rangeLength = (r: Range) => diffDays(r.end, r.start);

export function intersect(a: Range, b: Range): Range | null {
  const start = maxDate(a.start, b.start);
  const end = minDate(a.end, b.end);
  return start < end ? { start, end } : null;
}

export function eachDay(r: Range): ISODate[] {
  const out: ISODate[] = [];
  for (let d = r.start; d < r.end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Month i (0..11) of a plan year starting at `start`. Boundaries computed from the original anchor. */
export function planMonth(start: ISODate, i: number): Period {
  return { type: 'month', index: i, start: addMonthsClamped(start, i), end: addMonthsClamped(start, i + 1) };
}

export function planMonths(start: ISODate): Period[] {
  return Array.from({ length: 12 }, (_, i) => planMonth(start, i));
}

export function planHalf(start: ISODate, i: 0 | 1): Period {
  return { type: 'half', index: i, start: addMonthsClamped(start, i * 6), end: addMonthsClamped(start, (i + 1) * 6) };
}

export function planYearRange(start: ISODate): Period {
  return { type: 'year', index: 0, start, end: addMonthsClamped(start, 12) };
}

export function weekStartOf(d: ISODate, weekStartsOn: Weekday): ISODate {
  const delta = (weekday(d) - weekStartsOn + 7) % 7;
  return addDays(d, -delta);
}

export function weekOf(d: ISODate, weekStartsOn: Weekday): Period {
  const start = weekStartOf(d, weekStartsOn);
  return { type: 'week', index: -1, start, end: addDays(start, 7) };
}

export function dayPeriod(d: ISODate): Period {
  return { type: 'day', index: -1, start: d, end: addDays(d, 1) };
}

/** Actual calendar weeks touching a range (first may start before, last may end after). */
export function weeksTouching(r: Range, weekStartsOn: Weekday): Period[] {
  const out: Period[] = [];
  for (let s = weekStartOf(r.start, weekStartsOn); s < r.end; s = addDays(s, 7)) {
    out.push({ type: 'week', index: out.length, start: s, end: addDays(s, 7) });
  }
  return out;
}

/** Which plan month / half contains a date (or -1 if outside the plan year). */
export function locateInPlan(start: ISODate, d: ISODate): { month: number; half: number } {
  const months = planMonths(start);
  const m = months.findIndex((p) => contains(p, d));
  return { month: m, half: m < 0 ? -1 : m < 6 ? 0 : 1 };
}

export function periodFor(type: PeriodType, anchor: ISODate, planStart: ISODate, weekStartsOn: Weekday): Period {
  switch (type) {
    case 'day':
      return dayPeriod(anchor);
    case 'week':
      return weekOf(anchor, weekStartsOn);
    case 'month': {
      const { month } = locateInPlan(planStart, anchor);
      return month >= 0 ? planMonth(planStart, month) : monthContainingOutside(planStart, anchor);
    }
    case 'half': {
      const { half } = locateInPlan(planStart, anchor);
      return half >= 0 ? planHalf(planStart, half as 0 | 1) : planHalf(planStart, 0);
    }
    case 'year':
      return planYearRange(planStart);
  }
}

// For dates outside the plan year, still produce a month aligned to the plan anchor day.
function monthContainingOutside(planStart: ISODate, d: ISODate): Period {
  let i = d < planStart ? -1 : 12;
  const step = d < planStart ? -1 : 1;
  for (let guard = 0; guard < 1200; guard++) {
    const p = planMonth(planStart, i);
    if (contains(p, d)) return p;
    i += step;
  }
  return planMonth(planStart, 0);
}

export function shiftPeriod(p: Period, dir: 1 | -1, planStart: ISODate, weekStartsOn: Weekday): Period {
  switch (p.type) {
    case 'day':
      return dayPeriod(addDays(p.start, dir));
    case 'week':
      return weekOf(addDays(p.start, 7 * dir), weekStartsOn);
    case 'month':
      return periodFor('month', dir > 0 ? p.end : addDays(p.start, -1), planStart, weekStartsOn);
    case 'half':
      return dir > 0 ? { ...p, start: p.end, end: addMonthsClamped(planStart, 6 * (p.index + 2)), index: p.index + 1 } : { ...p, end: p.start, start: addMonthsClamped(planStart, 6 * (p.index - 1)), index: p.index - 1 };
    case 'year':
      return p;
  }
}

/** Preview of how changing a plan's start date moves its periods (shown before applying). */
export function startChangeImpact(oldStart: ISODate, newStart: ISODate, dates: ISODate[]) {
  const oldR = planYearRange(oldStart);
  const newR = planYearRange(newStart);
  const leaving = dates.filter((d) => contains(oldR, d) && !contains(newR, d));
  const entering = dates.filter((d) => !contains(oldR, d) && contains(newR, d));
  const movedMonth = dates.filter((d) => contains(oldR, d) && contains(newR, d) && locateInPlan(oldStart, d).month !== locateInPlan(newStart, d).month);
  return { oldRange: oldR, newRange: newR, leaving, entering, movedMonth };
}
