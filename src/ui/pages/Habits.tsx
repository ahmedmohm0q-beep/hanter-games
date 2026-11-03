import { useEffect, useState } from 'react';
import { addDays } from '../../domain/dates';
import { commitment, planProgress } from '../../domain/progress';
import { occurrencesFor, scheduleOn } from '../../domain/schedule';
import type { Habit } from '../../domain/types';
import { useApp, measureLabel } from '../ctx';
import { href } from '../router';
import { Empty, Trail } from '../components/common';
import { ExceptionForm, HabitForm } from '../components/Forms';

export function HabitsPage({ focus }: { focus: string | null }) {
  const { data, i, today, opt, save } = useApp();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<Habit | 'new' | null>(null);
  const [ex, setEx] = useState<string | null>(null);
  useEffect(() => {
    if (focus) setTimeout(() => document.getElementById(`habit-${focus}`)?.scrollIntoView({ block: 'center' }), 50);
  }, [focus]);
  const habits = data.habits
    .filter((h) => !h.deletedAt && h.archived === archived && (!q || h.title.toLowerCase().includes(q.toLowerCase()) || h.cue.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const range = { start: addDays(today, -28), end: today };
  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>{i.t('nav_habits')}</h1>
        <button className="btn primary" onClick={() => setEdit('new')}>＋ {i.t('new_habit')}</button>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 320 }} type="search" placeholder={i.t('search')} aria-label={i.t('search')} value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
        <button className={`btn small${archived ? ' primary' : ''}`} aria-pressed={archived} onClick={() => setArchived((x) => !x)}>{i.t('archived_habits')}</button>
      </div>
      {!habits.length && <Empty action={<button className="btn primary" onClick={() => setEdit('new')}>{i.t('new_habit')}</button>}>{i.t('empty_habits')}</Empty>}
      <div className="grid two">
        {habits.map((h) => {
          const occ = occurrencesFor(data, { range, today, habitIds: [h.id], includeTasks: false }, opt);
          const c = commitment(occ);
          const v = scheduleOn(data.habitSchedules.filter((s) => s.habitId === h.id && !s.deletedAt), today);
          const exs = data.habitExceptions.filter((e) => e.habitId === h.id && !e.deletedAt && e.endDate > today);
          const goals = data.goals.filter((g) => h.goalIds.includes(g.id));
          return (
            <article key={h.id} id={`habit-${h.id}`} className="panel stack" style={focus === h.id ? { borderColor: 'var(--gold)' } : undefined}>
              <div className="row between">
                <h2 style={{ margin: 0 }}><bdi>{h.title}</bdi></h2>
                <span className="chip">{measureLabel(i, h.measure)}</span>
              </div>
              {h.cue && <span className="muted small"><bdi>{h.cue}</bdi></span>}
              {v && (
                <span className="small">
                  {v.rule.kind === 'perPeriod' ? `${v.rule.count} ${i.t('times')} ${i.t(v.rule.period === 'week' ? 'per_week' : 'per_month')}`
                    : v.rule.kind === 'everyNDays' ? i.t('every_n', { n: v.rule.n })
                      : v.rule.kind === 'weekdays' ? v.rule.days.map((d) => i.weekdays[d]).join('، ') : i.t('r_daily')}
                  {h.measure.type !== 'binary' && <> · {i.num(v.target, 2)} {measureLabel(i, h.measure)}</>}
                  {v.minimum != null && <> · {i.t('small_version', { n: i.num(v.minimum, 2) })}</>}
                </span>
              )}
              {goals.length > 0 && <span className="small">{goals.map((g) => <a key={g.id} href={href('/year', { focus: g.id })} style={{ marginInlineEnd: 8 }}><bdi>{g.title}</bdi></a>)}</span>}
              <Trail ratio={c.ratio} label={i.t('commitment')} />
              <span className="small muted">{i.t('commit_today', { n: 28 })}: <span className="num">{c.ratio == null ? i.t('no_items') : i.pct(c.ratio)}</span> · {i.t('coverage')} <span className="num">{i.pct(c.coverage)}</span> · {i.t('plan_progress')} <span className="num">{i.pct(planProgress(occ).ratio)}</span></span>
              {exs.map((e) => (
                <span key={e.id} className="chip" style={{ alignSelf: 'flex-start' }}>
                  {i.t(e.kind)}: {i.date(e.startDate)} → {i.date(addDays(e.endDate, -1))}
                  <button className="btn small ghost" onClick={() => save('habitExceptions', { ...e, deletedAt: new Date().toISOString() })} aria-label={i.t('delete')}>✕</button>
                </span>
              ))}
              <div className="row">
                <button className="btn small" onClick={() => setEdit(h)}>{i.t('edit')}</button>
                <button className="btn small" onClick={() => setEx(h.id)}>{i.t('add_exception')}</button>
                <a className="btn small" href={href('/analytics', { type: 'month', habit: h.id })}>{i.t('nav_analytics')}</a>
                <button className="btn small ghost" onClick={() => save('habits', { ...h, archived: !h.archived })}>{h.archived ? i.t('unarchive') : i.t('archive')}</button>
              </div>
            </article>
          );
        })}
      </div>
      {edit && <HabitForm habit={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {ex && <ExceptionForm habitId={ex} onClose={() => setEx(null)} />}
    </div>
  );
}
