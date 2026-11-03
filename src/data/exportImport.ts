import type { AppData, EntityTable } from '../domain/types';
import { TABLES, validateImport } from './model';

export function exportJSON(data: AppData): string {
  return JSON.stringify({ app: 'HANTER GAMES', format: 1, exportedAt: new Date().toISOString(), data }, null, 2);
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(rows: Record<string, unknown>[]): string {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

export function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ImportPreview {
  ok: boolean;
  error?: string;
  counts: Record<string, { incoming: number; newRows: number; duplicates: number; newerIncoming: number }>;
  data?: AppData;
}

/** Duplicate check by id; an incoming row replaces a local one only if it is newer (by updatedAt). */
export function previewImport(raw: string, current: AppData): ImportPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'json', counts: {} };
  }
  const v = validateImport(parsed);
  if (!v.ok) return { ok: false, error: v.error, counts: {} };
  const counts: ImportPreview['counts'] = {};
  for (const t of TABLES) {
    const mine = new Map((current[t] as { id: string; updatedAt: string }[]).map((r) => [r.id, r]));
    const inc = v.data[t] as { id: string; updatedAt: string }[];
    const dup = inc.filter((r) => mine.has(r.id));
    counts[t] = { incoming: inc.length, newRows: inc.length - dup.length, duplicates: dup.length, newerIncoming: dup.filter((r) => r.updatedAt > mine.get(r.id)!.updatedAt).length };
  }
  return { ok: true, counts, data: v.data };
}

/** Rows to write: new ids + duplicates where the incoming copy is newer. */
export function importRows(incoming: AppData, current: AppData): { table: EntityTable; row: Record<string, unknown> & { id: string; version: number; updatedAt: string } }[] {
  const out: { table: EntityTable; row: Record<string, unknown> & { id: string; version: number; updatedAt: string } }[] = [];
  // parents before children so database foreign keys are satisfied in order
  const byId = new Map(incoming.goals.map((g) => [g.id, g]));
  const depth = (id: string | null, n = 0): number => (id && n < 100 ? depth(byId.get(id)?.parentId ?? null, n + 1) : n);
  const sorted = { ...incoming, goals: [...incoming.goals].sort((a, b) => depth(a.parentId) - depth(b.parentId)) };
  for (const t of TABLES) {
    const mine = new Map((current[t] as { id: string; updatedAt: string; version: number }[]).map((r) => [r.id, r]));
    for (const r of sorted[t] as unknown as (Record<string, unknown> & { id: string; updatedAt: string; version: number })[]) {
      const m = mine.get(r.id);
      if (!m) out.push({ table: t, row: { ...r, version: 0 } });
      else if (r.updatedAt > m.updatedAt) out.push({ table: t, row: { ...r, version: m.version } });
    }
  }
  return out;
}
