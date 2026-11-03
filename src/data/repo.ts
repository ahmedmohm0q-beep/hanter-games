// Repository contract + the local (this-device-only / demo / preview) implementation.
import type { AppData, EntityTable } from '../domain/types';
import { emptyAppData, nowISO, TABLES } from './model';

export type TableName = EntityTable | 'settings';
// Structural base shared by every stored row (interfaces like Task satisfy it without an index signature).
export interface AnyRow { id: string; version: number; updatedAt: string; deletedAt?: string | null }

export interface Mutation {
  mutationId: string; // idempotency key; a retry re-sends the same id
  table: TableName;
  row: AnyRow; // full row (soft delete = deletedAt set)
  baseVersion: number; // server version this edit was based on (0 = new)
  attempts: number;
  createdAt: string;
}

export type WriteResult =
  | { ok: true; row: AnyRow }
  | { ok: false; kind: 'conflict'; server: AnyRow | null }
  | { ok: false; kind: 'network' | 'auth' | 'rejected'; message: string };

export interface Repo {
  readonly mode: 'local' | 'demo' | 'cloud';
  load(): Promise<{ data: AppData; syncedAt: string | null; fromCache: boolean }>;
  write(m: Mutation): Promise<WriteResult>;
  subscribe(onRemote: (table: TableName, row: AnyRow) => void): () => void;
  saveSnapshot(data: AppData): void;
  canWrite(): boolean; // false when cloud mode is offline (read-only)
}

const key = (ns: string) => `hg:${ns}:data`;

/** Stores everything in this browser only. Used for "this device only", the demo, and the chat preview. */
export class LocalRepo implements Repo {
  constructor(readonly mode: 'local' | 'demo', private seed?: () => AppData) {}

  private read(): AppData | null {
    try {
      const raw = localStorage.getItem(key(this.mode));
      return raw ? (JSON.parse(raw) as AppData) : null;
    } catch {
      return null;
    }
  }

  async load() {
    let data = this.read();
    if (!data) {
      data = this.seed ? this.seed() : emptyAppData();
      this.saveSnapshot(data);
    }
    for (const t of TABLES) if (!Array.isArray(data[t])) (data as unknown as Record<string, unknown[]>)[t] = [];
    return { data, syncedAt: null, fromCache: false };
  }

  async write(m: Mutation): Promise<WriteResult> {
    return { ok: true, row: { ...m.row, version: m.baseVersion + 1, updatedAt: nowISO() } };
  }

  subscribe(onRemote: (table: TableName, row: AnyRow) => void) {
    // cross-tab sync on the same device
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(`hg-${this.mode}`);
      bc.onmessage = (e) => onRemote(e.data.table, e.data.row);
    } catch {
      /* not supported */
    }
    this.bc = bc;
    return () => bc?.close();
  }
  private bc: BroadcastChannel | null = null;
  announce(table: TableName, row: AnyRow) {
    try {
      this.bc?.postMessage({ table, row });
    } catch {
      /* ignore */
    }
  }

  saveSnapshot(data: AppData) {
    try {
      localStorage.setItem(key(this.mode), JSON.stringify(data));
    } catch {
      /* storage full or unavailable — the store surfaces a save error */
      throw new Error('storage');
    }
  }

  canWrite() {
    return true;
  }

  static clear(mode: 'local' | 'demo') {
    try {
      localStorage.removeItem(key(mode));
    } catch {
      /* ignore */
    }
  }
}
