// Calendar-day arithmetic on "YYYY-MM-DD" strings.
// Days are civil dates (no time component), so DST and UTC offsets can never shift them.
import type { ISODate, Weekday } from './types';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toISO(y: number, m: number, d: number): ISODate {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

export function parseISO(s: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${s}`);
  return { y, m, d };
}

export function isValidISO(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Days since 1970-01-01 (proleptic Gregorian). */
export function dayNumber(s: ISODate): number {
  const { y, m, d } = parseISO(s);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromDayNumber(n: number): ISODate {
  const dt = new Date(n * 86_400_000);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: ISODate, n: number): ISODate {
  return fromDayNumber(dayNumber(s) + n);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return dayNumber(a) - dayNumber(b);
}

export function weekday(s: ISODate): Weekday {
  // 1970-01-01 was a Thursday (4)
  return (((dayNumber(s) + 4) % 7) + 7) % 7 as Weekday;
}

/**
 * Adds calendar months to an *anchor* day, clamping to the last valid day.
 * Always computed from the original anchor, so Jan 31 → Feb 28/29 → Mar 31 (no drift).
 */
export function addMonthsClamped(anchor: ISODate, months: number): ISODate {
  const { y, m, d } = parseISO(anchor);
  const total = (y * 12 + (m - 1)) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function cmp(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);
export const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);

/** Calendar day "now" in an IANA time zone. */
export function todayInZone(timeZone: string, now: Date = new Date()): ISODate {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }
}

/** Milliseconds until the next local midnight in a time zone (used to refresh "today"). */
export function msUntilNextDay(timeZone: string, now: Date = new Date()): number {
  const today = todayInZone(timeZone, now);
  // Probe forward in 1-minute steps from a coarse estimate; robust across DST.
  let lo = now.getTime();
  let hi = lo + 26 * 3_600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (todayInZone(timeZone, new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return hi - now.getTime();
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
