import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { OccStatus } from '../../domain/schedule';
import { useApp } from '../ctx';

// ---------- tiny event bus for toasts / celebrations ----------
export function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('hg-toast', { detail: msg }));
}
export function celebrate(msg: string) {
  window.dispatchEvent(new CustomEvent('hg-celebrate', { detail: msg }));
}

export function Toasts() {
  const [msg, setMsg] = useState<string | null>(null);
  const [burst, setBurst] = useState<string | null>(null);
  const { data } = useApp();
  const reduce = data.settings.reducedMotion === 'on' || (data.settings.reducedMotion === 'system' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    let t = 0;
    let b = 0;
    const onT = (e: Event) => {
      setMsg((e as CustomEvent).detail);
      clearTimeout(t);
      t = window.setTimeout(() => setMsg(null), 2600);
    };
    const onB = (e: Event) => {
      const text = (e as CustomEvent).detail as string;
      if (data.settings.sound) chime();
      if (reduce) return onT(new CustomEvent('x', { detail: `★ ${text}` }));
      setBurst(text);
      clearTimeout(b);
      b = window.setTimeout(() => setBurst(null), 1700);
    };
    window.addEventListener('hg-toast', onT);
    window.addEventListener('hg-celebrate', onB);
    return () => {
      window.removeEventListener('hg-toast', onT);
      window.removeEventListener('hg-celebrate', onB);
    };
  }, [reduce, data.settings.sound]);
  return (
    <>
      <div aria-live="polite" className="sr-only">{msg ?? burst ?? ''}</div>
      {msg && <div className="toast" role="status">{msg}</div>}
      {burst && (
        <div className="burst" aria-hidden>
          {Array.from({ length: 14 }, (_, k) => (
            <i key={k} style={{ ['--x' as string]: `${Math.cos(k) * 180}px`, ['--y' as string]: `${Math.sin(k * 1.7) * 140 - 60}px` }} />
          ))}
          <div className="badge">{burst}</div>
        </div>
      )}
    </>
  );
}

function chime() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + i * 0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.12);
      o.stop(ctx.currentTime + i * 0.12 + 0.32);
    });
  } catch {
    /* audio unavailable */
  }
}

// ---------- dialog ----------
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="row between">
          <h2>{title}</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="×">✕</button>
        </div>
        {children}
        {footer && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>{footer}</div>}
      </div>
    </div>
  );
}

// ---------- progress ----------
export function Trail({ ratio, expected, gold, label }: { ratio: number | null; expected?: number | null; gold?: boolean; label: string }) {
  const pct = Math.round((ratio ?? 0) * 100);
  return (
    <div className={`trail${gold ? ' gold' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio == null ? undefined : pct}>
      <div className="fill" style={{ width: `${pct}%` }} />
      {expected != null && <div className="expected" style={{ insetInlineStart: `calc(${Math.round(expected * 100)}% - 1px)` }} title="expected" />}
    </div>
  );
}

const statusClass: Record<OccStatus, string> = {
  planned: '', inProgress: 'info', done: 'green', partial: 'warn', notDone: 'alert', unrecorded: 'alert', rest: '', paused: '',
};
export function StatusChip({ s }: { s: OccStatus }) {
  const { i } = useApp();
  return <span className={`chip ${statusClass[s]}`}>{i.t(`st_${s}` as 'st_done')}</span>;
}

export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="panel stack" style={{ alignItems: 'flex-start' }}>
      <p className="muted" style={{ margin: 0 }}>{children}</p>
      {action}
    </div>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="err" role="alert">{error}</span>}
    </label>
  );
}

// ---------- sync status ----------
export function SyncChip() {
  const { sync, i, syncedAt, pending, retry, repo, fromCache, lastError } = useApp();
  const cls = sync === 'saved' ? 'green' : sync === 'saving' ? 'info' : sync === 'conflict' || sync === 'error' ? 'alert' : 'warn';
  return (
    <div className="row" style={{ gap: 6 }}>
      <span className="chip">{i.t(repo.mode === 'cloud' ? 'mode_cloud' : repo.mode === 'demo' ? 'mode_demo' : 'mode_local')}</span>
      <span className={`chip ${cls}`} role="status" title={[syncedAt ? i.t('lastSynced', { t: i.dateTime(syncedAt) }) : '', lastError ?? '', fromCache ? 'cache' : ''].filter(Boolean).join(' | ')}>
        {i.t(`sync_${sync}` as 'sync_saved')}
        {pending > 0 && sync !== 'saved' ? <span className="num"> ({pending})</span> : null}
      </span>
      {(sync === 'error' || sync === 'offline') && <button className="btn small" onClick={retry}>{i.t('retry')}</button>}
    </div>
  );
}

export function ConflictDialogs() {
  const { conflicts, resolve, i } = useApp();
  const c = conflicts[0];
  if (!c) return null;
  const label = (r: Record<string, unknown> | null) => (r ? String(r.title ?? r.text ?? r.note ?? r.label ?? r.id) : i.t('conflict_deleted'));
  return (
    <Dialog title={i.t('conflict_title')} onClose={() => resolve(c, 'theirs')}>
      <p>{i.t('conflict_body')}</p>
      <div className="grid two">
        <div className="panel"><h3>{i.t('conflict_mine')}</h3><bdi>{label(c.local)}</bdi></div>
        <div className="panel"><h3>{i.t('conflict_theirs')}</h3><bdi>{label(c.server)}</bdi></div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
        <button className="btn" onClick={() => resolve(c, 'theirs')}>{i.t('conflict_theirs')}</button>
        <button className="btn primary" onClick={() => resolve(c, 'mine')}>{i.t('conflict_mine')}</button>
      </div>
    </Dialog>
  );
}
