import { ar, en, type Strings } from './strings';
import type { Locale } from '../domain/types';

export type StrKey = { [K in keyof Strings]: Strings[K] extends string ? K : never }[keyof Strings];

export function makeT(locale: Locale) {
  const dict = locale === 'en' ? en : ar;
  const tag = locale === 'en' ? 'en-US' : 'ar-EG-u-nu-latn'; // Latin digits keep mixed AR/EN text readable
  const t = (k: StrKey, vars?: Record<string, string | number>) => {
    let s = (dict[k] as string) ?? (ar[k] as string) ?? k;
    if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(String(b));
    return s;
  };
  const date = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat(tag, { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
  };
  const dateTime = (ts: string) => {
    try {
      return new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
    } catch {
      return ts;
    }
  };
  const num = (n: number, digits = 0) => new Intl.NumberFormat(tag, { maximumFractionDigits: digits }).format(n);
  // LRI…PDI isolates keep "56%" in the right order inside Arabic sentences
  const pct = (r: number | null) => (r == null ? '—' : `\u2066${num(r * 100, 0)}%\u2069`);
  return { t, date, dateTime, num, pct, dir: locale === 'en' ? 'ltr' : 'rtl', locale, weekdays: dict.weekdays };
}

export type T = ReturnType<typeof makeT>;
