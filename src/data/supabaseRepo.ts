// Cloud repository: Supabase Auth + Postgres (RLS) + Realtime.
// NOT exercised in the chat preview (no project/keys there). See README → "Verify the cloud build".
import type { AppData } from '../domain/types';
import { emptyAppData, fromDbRow, nowISO, SQL_TABLE, TABLES, toDbRow } from './model';
import type { AnyRow, Mutation, Repo, TableName, WriteResult } from './repo';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any;

const env = ((import.meta as unknown as { env?: Record<string, string> }).env ?? {}) as Record<string, string>;
export const SUPABASE_URL = env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
export const cloudConfigured = () => !!(SUPABASE_URL && SUPABASE_KEY);

let clientPromise: Promise<Client> | null = null;
export function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }),
    );
  }
  return clientPromise;
}

const TABLE_BY_SQL = Object.fromEntries(Object.entries(SQL_TABLE).map(([k, v]) => [v, k])) as Record<string, TableName>;

export class SupabaseRepo implements Repo {
  readonly mode = 'cloud' as const;
  constructor(private client: Client, private userId: string) {}

  private cacheKey = () => `hg:cloud:${this.userId}`;

  async load() {
    try {
      const data = emptyAppData();
      const results = await Promise.all(
        (['settings', ...TABLES] as TableName[]).map(async (t) => {
          const all: Record<string, unknown>[] = [];
          for (let from = 0; ; from += 1000) {
            const { data: rows, error } = await this.client.from(SQL_TABLE[t]).select('*').range(from, from + 999);
            if (error) throw error;
            all.push(...rows);
            if (rows.length < 1000) break;
          }
          return [t, all] as const;
        }),
      );
      for (const [t, rows] of results) {
        if (t === 'settings') {
          if (rows[0]) data.settings = { ...data.settings, ...fromDbRow(rows[0]) };
        } else (data as unknown as Record<string, unknown[]>)[t] = rows.map((r) => fromDbRow(r));
      }
      const syncedAt = nowISO();
      this.saveSnapshot(data, syncedAt);
      return { data, syncedAt, fromCache: false };
    } catch (e) {
      const cached = this.readSnapshot();
      if (cached) return { data: cached.data, syncedAt: cached.syncedAt, fromCache: true };
      throw e;
    }
  }

  async write(m: Mutation): Promise<WriteResult> {
    if (!navigator.onLine) return { ok: false, kind: 'network', message: 'offline' };
    const table = SQL_TABLE[m.table];
    const payload = { ...toDbRow(m.row as unknown as Record<string, unknown>), version: Math.max(1, m.baseVersion), last_mutation_id: m.mutationId, user_id: this.userId };
    delete (payload as Record<string, unknown>).updated_at;
    const { data, error } = await this.client.from(table).upsert(payload, { onConflict: 'id' }).select().single();
    if (!error) return { ok: true, row: fromDbRow<AnyRow>(data) };
    const msg = String(error.message ?? error);
    if (error.code === '23505' && m.table === 'quoteViews') {
      const r = m.row as unknown as { date: string; lang: string };
      const { data: existing } = await this.client.from(table).select('*').eq('date', r.date).eq('lang', r.lang).maybeSingle();
      if (existing) return { ok: true, row: fromDbRow<AnyRow>(existing) };
    }
    if (msg.includes('version_conflict')) {
      const { data: server } = await this.client.from(table).select('*').eq('id', m.row.id).maybeSingle();
      return { ok: false, kind: 'conflict', server: server ? fromDbRow<AnyRow>(server) : null };
    }
    if (error.code === '42501' || error.code === 'PGRST301' || /JWT|auth/i.test(msg)) return { ok: false, kind: 'auth', message: msg };
    if (/fetch|network|Failed to/i.test(msg)) return { ok: false, kind: 'network', message: msg };
    return { ok: false, kind: 'rejected', message: msg };
  }

  subscribe(onRemote: (table: TableName, row: AnyRow) => void) {
    const ch = this.client.channel(`hg-${this.userId}`);
    for (const t of ['settings', ...TABLES] as TableName[]) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: SQL_TABLE[t], filter: `user_id=eq.${this.userId}` }, (p: { new: Record<string, unknown>; table: string }) => {
        if (p.new && p.new.id) onRemote(TABLE_BY_SQL[p.table], fromDbRow<AnyRow>(p.new));
      });
    }
    ch.subscribe();
    return () => {
      this.client.removeChannel(ch);
    };
  }

  saveSnapshot(data: AppData, syncedAt?: string) {
    try {
      const prev = this.readSnapshot();
      localStorage.setItem(this.cacheKey(), JSON.stringify({ data, syncedAt: syncedAt ?? prev?.syncedAt ?? null }));
    } catch {
      /* cache is best-effort */
    }
  }

  readSnapshot(): { data: AppData; syncedAt: string | null } | null {
    try {
      const raw = localStorage.getItem(this.cacheKey());
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  canWrite() {
    return navigator.onLine;
  }
}
