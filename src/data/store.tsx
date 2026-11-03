// App store: one in-memory dataset, optimistic edits, a persistent outbox with idempotent
// retries, explicit conflict resolution, and realtime updates from other devices.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppData, EntityTable } from '../domain/types';
import { msUntilNextDay, todayInZone } from '../domain/dates';
import { nowISO, uid } from './model';
import type { AnyRow, Mutation, Repo, TableName } from './repo';

export type SyncState = 'saved' | 'saving' | 'error' | 'offline' | 'conflict' | 'readOnly';

export interface Conflict {
  mutation: Mutation;
  local: AnyRow;
  server: AnyRow | null;
}

interface StoreValue {
  data: AppData;
  today: string;
  repo: Repo;
  sync: SyncState;
  syncedAt: string | null;
  fromCache: boolean;
  pending: number;
  lastError: string | null;
  conflicts: Conflict[];
  online: boolean;
  save: <T extends AnyRow>(table: TableName, row: T) => boolean;
  saveMany: (items: { table: TableName; row: AnyRow }[]) => boolean;
  remove: (table: EntityTable, id: string) => boolean;
  retry: () => void;
  resolve: (c: Conflict, keep: 'mine' | 'theirs') => void;
  replaceAll: (data: AppData) => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}

function getRows(data: AppData, table: TableName): AnyRow[] {
  return table === 'settings' ? [data.settings as unknown as AnyRow] : (data[table] as unknown as AnyRow[]);
}

function putRow(data: AppData, table: TableName, row: AnyRow): AppData {
  if (table === 'settings') return { ...data, settings: row as unknown as AppData['settings'] };
  const rows = data[table] as unknown as AnyRow[];
  const i = rows.findIndex((r) => r.id === row.id);
  const next = i >= 0 ? rows.map((r, k) => (k === i ? row : r)) : [...rows, row];
  return { ...data, [table]: next };
}

export function StoreProvider({ repo, initial, syncedAt: initialSynced, fromCache, outboxKey, children }: {
  repo: Repo; initial: AppData; syncedAt: string | null; fromCache: boolean; outboxKey: string; children: ReactNode;
}) {
  const [data, setData] = useState<AppData>(initial);
  const dataRef = useRef(data);
  dataRef.current = data;
  const [outbox, setOutbox] = useState<Mutation[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(outboxKey) ?? '[]');
    } catch {
      return [];
    }
  });
  const outboxRef = useRef(outbox);
  outboxRef.current = outbox;
  const [sync, setSync] = useState<SyncState>('saved');
  const [syncedAt, setSyncedAt] = useState(initialSynced);
  const [lastError, setLastError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [today, setToday] = useState(() => todayInZone(initial.settings.timeZone));
  const flushing = useRef(false);
  const retryTimer = useRef<number | null>(null);

  // "today" follows the chosen time zone and refreshes at local midnight
  useEffect(() => {
    const tz = data.settings.timeZone;
    setToday(todayInZone(tz));
    let t = 0;
    const arm = () => {
      t = window.setTimeout(() => {
        setToday(todayInZone(tz));
        arm();
      }, Math.min(msUntilNextDay(tz) + 500, 2 ** 31 - 1));
    };
    arm();
    const onVis = () => document.visibilityState === 'visible' && setToday(todayInZone(tz));
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [data.settings.timeZone]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const persistOutbox = useCallback(
    (next: Mutation[]) => {
      outboxRef.current = next;
      setOutbox(next);
      try {
        localStorage.setItem(outboxKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [outboxKey],
  );

  const commitLocal = useCallback(
    (next: AppData) => {
      dataRef.current = next;
      setData(next);
      try {
        repo.saveSnapshot(next);
      } catch {
        setSync('error');
        setLastError('storage');
      }
    },
    [repo],
  );

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      while (outboxRef.current.length) {
        const m = outboxRef.current[0];
        setSync('saving');
        const res = await repo.write(m);
        if (res.ok) {
          // rebase later edits of the same row on the new server version
          const rest = outboxRef.current.slice(1).map((x) => (x.row.id === m.row.id && x.table === m.table ? { ...x, baseVersion: res.row.version } : x));
          persistOutbox(rest);
          const cur = getRows(dataRef.current, m.table).find((r) => r.id === m.row.id);
          const stillPending = rest.some((x) => x.row.id === m.row.id && x.table === m.table);
          if (res.row.id !== m.row.id) {
            // server kept an equivalent existing row (unique constraint) → drop our duplicate
            const base = m.table === 'settings' ? dataRef.current : { ...dataRef.current, [m.table]: (dataRef.current[m.table] as unknown as AnyRow[]).filter((r) => r.id !== m.row.id) };
            commitLocal(putRow(base as AppData, m.table, res.row));
          } else if (!stillPending) commitLocal(putRow(dataRef.current, m.table, { ...(cur ?? m.row), ...res.row }));
          else if (cur) commitLocal(putRow(dataRef.current, m.table, { ...cur, version: res.row.version }));
          (repo as { announce?: (t: TableName, r: AnyRow) => void }).announce?.(m.table, res.row);
          setSyncedAt(nowISO());
          setLastError(null);
          continue;
        }
        if (res.kind === 'conflict') {
          persistOutbox(outboxRef.current.slice(1));
          const local = getRows(dataRef.current, m.table).find((r) => r.id === m.row.id) ?? m.row;
          setConflicts((c) => [...c, { mutation: m, local, server: res.server }]);
          setSync('conflict');
          continue;
        }
        // network / auth / rejected: keep it queued, surface the error, back off
        const attempts = m.attempts + 1;
        persistOutbox([{ ...m, attempts }, ...outboxRef.current.slice(1)]);
        setLastError(res.message);
        setSync(res.kind === 'network' && !navigator.onLine ? 'offline' : 'error');
        if (res.kind === 'network') {
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = window.setTimeout(() => void flush(), Math.min(60_000, 2000 * 2 ** Math.min(attempts, 5)));
        }
        return;
      }
      setSync((s) => (s === 'conflict' ? s : 'saved'));
    } finally {
      flushing.current = false;
    }
  }, [repo, persistOutbox, commitLocal]);

  useEffect(() => {
    if (outboxRef.current.length) void flush();
    const unsub = repo.subscribe((table, row) => {
      if (!table) return;
      const cur = getRows(dataRef.current, table).find((r) => r.id === row.id);
      const pending = outboxRef.current.some((m) => m.row.id === row.id && m.table === table);
      if (pending) return; // our own edit is in flight; any real conflict is caught by the version check
      if (!cur || row.version > cur.version) commitLocal(putRow(dataRef.current, table, row));
    });
    return unsub;
  }, [repo, flush, commitLocal]);

  useEffect(() => {
    if (online && outboxRef.current.length) void flush();
    if (!online && repo.mode === 'cloud') setSync('readOnly');
    else if (online) setSync((s) => (s === 'readOnly' ? (outboxRef.current.length ? 'saving' : 'saved') : s));
  }, [online, flush, repo.mode]);

  const saveMany = useCallback(
    (items: { table: TableName; row: AnyRow }[]) => {
      if (!repo.canWrite()) {
        setSync('readOnly');
        return false;
      }
      let next = dataRef.current;
      const muts: Mutation[] = [];
      for (const { table, row } of items) {
        const prev = getRows(next, table).find((r) => r.id === row.id);
        const pendingBase = [...outboxRef.current, ...muts].filter((m) => m.row.id === row.id && m.table === table).pop()?.baseVersion;
        const baseVersion = pendingBase ?? prev?.version ?? 0;
        const updated = { ...row, updatedAt: nowISO(), version: prev?.version ?? row.version ?? 0 };
        next = putRow(next, table, updated);
        muts.push({ mutationId: uid(), table, row: updated, baseVersion, attempts: 0, createdAt: nowISO() });
      }
      commitLocal(next);
      persistOutbox([...outboxRef.current, ...muts]);
      void flush();
      return true;
    },
    [repo, commitLocal, persistOutbox, flush],
  );

  const save = useCallback(<T extends AnyRow>(table: TableName, row: T) => saveMany([{ table, row }]), [saveMany]);

  const remove = useCallback(
    (table: EntityTable, id: string) => {
      const cur = getRows(dataRef.current, table).find((r) => r.id === id);
      if (!cur) return false;
      return save(table, { ...cur, deletedAt: nowISO() });
    },
    [save],
  );

  const resolve = useCallback(
    (c: Conflict, keep: 'mine' | 'theirs') => {
      setConflicts((cs) => cs.filter((x) => x !== c));
      if (keep === 'theirs' && c.server) commitLocal(putRow(dataRef.current, c.mutation.table, c.server));
      if (keep === 'mine') {
        const base = c.server?.version ?? 0;
        const row = { ...c.local, version: base };
        commitLocal(putRow(dataRef.current, c.mutation.table, row));
        persistOutbox([...outboxRef.current, { ...c.mutation, mutationId: uid(), row, baseVersion: base, attempts: 0 }]);
        void flush();
      }
      setSync('saved');
    },
    [commitLocal, persistOutbox, flush],
  );

  const replaceAll = useCallback((d: AppData) => commitLocal(d), [commitLocal]);

  const value = useMemo<StoreValue>(
    () => ({
      data, today, repo, sync: !online && repo.mode === 'cloud' ? 'readOnly' : sync, syncedAt, fromCache, pending: outbox.length,
      lastError, conflicts, online, save, saveMany, remove, retry: () => void flush(), resolve, replaceAll,
    }),
    [data, today, repo, sync, syncedAt, fromCache, outbox.length, lastError, conflicts, online, save, saveMany, remove, flush, resolve, replaceAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
