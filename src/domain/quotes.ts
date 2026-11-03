// Daily quote selection: deterministic per (plan year, date, language), so every device
// shows the same quote all day. A recorded view (synced) always wins over recomputation.
import { diffDays } from './dates';
import type { ISODate, QuoteView } from './types';

export interface Quote {
  id: string;
  lang: 'ar' | 'en';
  text: string; // original text, exactly as in the cited source
  translation: string; // into the other language
  translationBy: 'app' | 'published'; // 'app' = translated for HANTER GAMES
  author: string;
  authorAlt: string; // name in the other language
  work: string;
  year: string;
  sourceUrl: string;
  sourceNote: string; // edition / variant notes
  verifiedOn: ISODate;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable shuffle seeded by the plan year, so order differs by year but never by device. */
export function orderFor(lib: Quote[], seed: string): Quote[] {
  return [...lib].sort((a, b) => hash(seed + a.id) - hash(seed + b.id) || (a.id < b.id ? -1 : 1));
}

export interface DailyQuote {
  quote: Quote | null;
  repeated: boolean; // library smaller than days elapsed → honest "repeat" label
  dayIndex: number;
  librarySize: number;
}

export function quoteForDay(lib: Quote[], lang: 'ar' | 'en', date: ISODate, planStart: ISODate, views: QuoteView[]): DailyQuote {
  const pool = lib.filter((q) => q.lang === lang);
  const dayIndex = Math.max(0, diffDays(date, planStart)) % 366;
  const v = views.find((x) => x.date === date && x.lang === lang && !x.deletedAt);
  const ordered = orderFor(pool, planStart);
  if (v) {
    const q = pool.find((x) => x.id === v.quoteId) ?? null;
    if (q) return { quote: q, repeated: dayIndex >= pool.length, dayIndex, librarySize: pool.length };
  }
  if (!pool.length) return { quote: null, repeated: false, dayIndex, librarySize: 0 };
  return { quote: ordered[dayIndex % ordered.length], repeated: dayIndex >= ordered.length, dayIndex, librarySize: pool.length };
}
