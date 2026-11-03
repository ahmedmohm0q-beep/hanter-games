import { useEffect, useState } from 'react';
import type { EvaluatedOccurrence } from '../../domain/schedule';
import type { LogEntry } from '../../domain/types';
import { newRow } from '../../data/model';
import { useApp, measureLabel } from '../ctx';
import { StatusChip, Trail, celebrate, toast } from './common';

interface TimerState { key: string; habitId: string | null; taskId: string | null; date: string; startedAt: number }
const TIMER_KEY = 'hg:timer';
export function readTimer(): TimerState | null {
  try { return JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null'); } catch { return null; }
}
function writeTimer(t: TimerState | null) {
  try { t ? localStorage.setItem(TIMER_KEY, JSON.stringify(t)) : localStorage.removeItem(TIMER_KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event('hg-timer'));
}

export function useTimer() {
  const [t, setT] = useState(readTimer);
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => setT(readTimer());
    window.addEventListener('hg-timer', on);
    const iv = window.setInterval(() => tick((x) => x + 1), 1000);
    return () => { window.removeEventListener('hg-timer', on); clearInterval(iv); };
  }, []);
  return t;
}

const quickSteps: Record<string, number[]> = { minutes: [5, 15], hours: [0.5, 1], count: [1, 5], pages: [1, 5], questions: [5, 10], distance: [1], custom: [1] };

export function OccurrenceRow({ o, date, highlight }: { o: EvaluatedOccurrence; date: string; highlight?: boolean }) {
  const { data, save, saveMany, i, today } = useApp();
  const habit = o.habitId ? data.habits.find((h) => h.id === o.habitId) : null;
  const task = o.taskId ? data.tasks.find((t) => t.id === o.taskId) : null;
  const title = habit?.title ?? task?.title ?? '';
  const measure = habit?.measure ?? task?.measure ?? { type: 'binary' as const };
  const binary = measure.type === 'binary';
  const logDate = o.kind === 'quota' ? date : o.kind === 'task' ? date : o.date;
  const timer = useTimer();
  const timing = timer?.key === o.key;
  const [note, setNote] = useState('');

  const myLogs = data.logs.filter((l) => !l.deletedAt && (o.taskId ? l.taskId === o.taskId : l.habitId === o.habitId && (o.kind === 'quota' ? l.date === date : l.date === o.date)));
  const dayAmount = myLogs.filter((l) => l.kind === 'progress').reduce((s, l) => s + l.amount, 0);
  const done = o.contribution >= 1;

  const addLog = (amount: number, kind: LogEntry['kind'] = 'progress', source: LogEntry['source'] = 'quick') => {
    const row: LogEntry = { ...newRow(), habitId: o.habitId, taskId: o.taskId, date: logDate, amount, kind, note: '', source };
    if (save('logs', row) && kind === 'progress') {
      const after = o.kind === 'quota' ? o.amount + (dayAmount + amount >= o.sessionTarget && dayAmount < o.sessionTarget ? 1 : 0) : o.amount + amount;
      if (after >= o.target && o.amount < o.target && o.kind === 'task') celebrate(i.t('celebrate'));
    }
  };

  const complete = () => {
    if (o.kind === 'quota') return addLog(Math.max(o.sessionTarget - dayAmount, binary ? 1 : 0.0001));
    const remaining = Math.max(o.target - o.amount, 0);
    addLog(binary ? 1 : remaining || o.target);
  };

  const undo = () => {
    const now = new Date().toISOString();
    saveMany(myLogs.map((l) => ({ table: 'logs' as const, row: { ...l, deletedAt: now } })));
  };

  const saveNote = () => {
    const last = myLogs[myLogs.length - 1];
    if (!last || !note.trim()) return;
    save('logs', { ...last, note: note.trim() });
    setNote('');
    toast(i.t('saved_toast'));
  };

  const startTimer = () => writeTimer({ key: o.key, habitId: o.habitId, taskId: o.taskId, date: logDate, startedAt: Date.now() });
  const stopTimer = () => {
    if (!timer) return;
    const mins = Math.max(1, Math.round((Date.now() - timer.startedAt) / 60000));
    const amount = measure.type === 'hours' ? Math.round((mins / 60) * 100) / 100 : mins;
    // logged to the date the session started on — never moved to "today"
    save('logs', { ...newRow(), habitId: timer.habitId, taskId: timer.taskId, date: timer.date, amount, kind: 'progress', note: '', source: 'timer' } as LogEntry);
    writeTimer(null);
  };
  const elapsed = timing && timer ? Math.floor((Date.now() - timer.startedAt) / 1000) : 0;

  const unit = measureLabel(i, measure);
  const target = o.kind === 'quota' ? o.target : o.target;
  return (
    <article className={`occ${highlight ? ' hl' : ''}`} id={`occ-${o.key}`} aria-label={title}>
      <div className="stack" style={{ gap: 2 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="title"><bdi>{title}</bdi></span>
          <StatusChip s={o.status} />
          {highlight && <span className="chip gold">{i.t('highlighted')}</span>}
        </div>
        {habit?.cue && <span className="cue"><bdi>{habit.cue}</bdi></span>}
        <span className="small muted">
          {o.kind === 'quota'
            ? i.t('quota_progress', { a: i.num(o.amount), b: i.num(o.target) })
            : binary ? '' : <span className="num">{i.num(o.amount, 2)} / {i.num(target, 2)} {unit}</span>}
          {o.minimum != null && o.kind !== 'quota' && !binary && <> · {i.t('small_version', { n: `${i.num(o.minimum)} ${unit}` })}</>}
        </span>
        {o.minimumMet && o.contribution < 1 && <span className="small" style={{ color: 'var(--warn)' }}>{i.t('min_met')}</span>}
      </div>
      <div className="actions">
        {!binary && !done && (quickSteps[measure.type] ?? [1]).map((s) => (
          <button key={s} className="btn small" onClick={() => addLog(s)} aria-label={`+${s} ${unit}`}>+{i.num(s, 2)}</button>
        ))}
        {!binary && o.minimum != null && o.amount === 0 && o.kind !== 'quota' && (
          <button className="btn small" onClick={() => addLog(o.minimum!)}>{i.t('small_version', { n: i.num(o.minimum) })}</button>
        )}
        {(measure.type === 'minutes' || measure.type === 'hours') && !done && (
          timing ? <button className="btn small primary" onClick={stopTimer}>{i.t('stop_focus', { m: Math.max(1, Math.round(elapsed / 60)) })}</button>
            : <button className="btn small" onClick={startTimer} disabled={!!timer}>{i.t('start_focus')}</button>
        )}
        {myLogs.length > 0 ? (
          <button className={`check${done ? ' on' : ''}`} onClick={undo} aria-label={`${i.t('undo')}: ${title}`} title={i.t('undo')}>{done ? '✓' : '↺'}</button>
        ) : (
          <button className="check" onClick={complete} aria-label={`${i.t('complete')}: ${title}`} title={i.t('complete')}>✓</button>
        )}
      </div>
      {o.kind !== 'quota' && <div className="bar"><Trail ratio={o.contribution} label={title} /></div>}
      {timing && <div className="bar small" style={{ color: 'var(--info)' }}>{i.t('focus_running', { t: `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` })}</div>}
      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>{i.t('details')}</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          {date < today && <span className="small muted">{i.t('past_day_note')}</span>}
          {!myLogs.length && <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => addLog(0, 'skip', 'manual')}>{i.t('mark_not_done')}</button>}
          {myLogs.map((l) => (
            <div key={l.id} className="row small muted">
              <span className="num">{l.kind === 'skip' ? i.t('st_notDone') : `+${i.num(l.amount, 2)} ${binary ? '' : unit}`}</span>
              <span>{i.t('edited_at', { t: i.dateTime(l.updatedAt) })}</span>
              {l.note && <bdi>“{l.note}”</bdi>}
            </div>
          ))}
          {myLogs.length > 0 && (
            <div className="row">
              <input className="input" style={{ flex: 1, minWidth: 160 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder={i.t('add_note')} aria-label={i.t('note')} dir="auto" />
              <button className="btn small" onClick={saveNote}>{i.t('save')}</button>
            </div>
          )}
        </div>
      </details>
    </article>
  );
}
