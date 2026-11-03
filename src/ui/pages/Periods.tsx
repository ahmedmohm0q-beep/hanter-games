import { useEffect, useMemo, useState } from 'react';
import { addDays, isValidISO } from '../../domain/dates';
import { contains, eachDay, intersect, lastDay, periodFor, planMonths, shiftPeriod, weeksTouching, type Period, type PeriodType } from '../../domain/periods';
import { commitment, planProgress } from '../../domain/progress';
import { clipTo, occurrencesFor } from '../../domain/schedule';
import type { GoalLevel, Review } from '../../domain/types';
import { newRow } from '../../data/model';
import { aliveGoals, useApp } from '../ctx';
import { href } from '../router';
import { Empty, Field, Trail, toast } from '../components/common';
import { OccurrenceRow } from '../components/OccurrenceRow';
import { GoalForm, TaskForm } from '../components/Forms';
import { MetricCards } from './Analytics';
import { Camp } from './Year';

const LEVEL_OF: Record<PeriodType, GoalLevel | null> = { day: null, week: 'week', month: 'month', half: 'half', year: 'year' };

export function PeriodNav({ type, p, anchor, extra }: { type: PeriodType; p: Period; anchor: string; extra?: Record<string, string> }) {
  const { i, plan, data, today } = useApp();
  const ws = data.settings.weekStartsOn;
  const prev = shiftPeriod(p, -1, plan!.startDate, ws);
  const next = shiftPeriod(p, 1, plan!.startDate, ws);
  const title =
    type === 'day' ? i.date(p.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      : type === 'week' ? i.t('week_of', { a: i.date(p.start, { day: 'numeric', month: 'short' }), b: i.date(lastDay(p), { day: 'numeric', month: 'short', year: 'numeric' }) })
        : type === 'month' ? `${p.index >= 0 && p.index < 12 ? i.t('month_n', { n: p.index + 1 }) + ' — ' : ''}${i.date(p.start, { day: 'numeric', month: 'short' })} → ${i.date(lastDay(p), { day: 'numeric', month: 'short', year: 'numeric' })}`
          : `${i.t('half_n', { n: p.index + 1 })} — ${i.date(p.start, { month: 'short', year: 'numeric' })} → ${i.date(lastDay(p), { month: 'short', year: 'numeric' })}`;
  const keep = (d: string) => (contains(p, anchor) ? anchor : d);
  return (
    <div className="stack" style={{ marginBottom: 16 }}>
      <div className="row between">
        <h1><bdi>{title}</bdi></h1>
        <div className="row">
          {type !== 'year' && <a className="btn icon" href={href(`/${type}/${prev.start}`, extra)} aria-label={i.t('prev')}>{i.dir === 'rtl' ? '→' : '←'}</a>}
          <a className="btn small" href={href(`/${type}/${today}`)}>{i.t('today')}</a>
          {type !== 'year' && <a className="btn icon" href={href(`/${type}/${next.start}`, extra)} aria-label={i.t('next')}>{i.dir === 'rtl' ? '←' : '→'}</a>}
        </div>
      </div>
      <nav className="row" aria-label={i.t('zoom')}>
        {(['day', 'week', 'month', 'half', 'year'] as PeriodType[]).map((z) => (
          <a key={z} className={`btn small${z === type ? ' primary' : ''}`} aria-current={z === type ? 'page' : undefined} href={z === 'year' ? href('/year') : href(`/${z}/${keep(p.start)}`)}>{i.t(`nav_${z}` as 'nav_day')}</a>
        ))}
      </nav>
    </div>
  );
}

function PeriodGoals({ type, p }: { type: PeriodType; p: Period }) {
  const { data, i, saveMany } = useApp();
  const [form, setForm] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const level = LEVEL_OF[type];
  if (!level) return null;
  const goals = aliveGoals(data).filter((g) => g.level === level && g.status !== 'archived' && (g.periodStart ? contains(p, g.periodStart) : contains(p, g.startDate)));
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const move = (k: number, d: -1 | 1) => {
    const a = goals[k], b = goals[k + d];
    if (a && b) saveMany([{ table: 'goals', row: { ...a, sortOrder: b.sortOrder } }, { table: 'goals', row: { ...b, sortOrder: a.sortOrder === b.sortOrder ? a.sortOrder + d : a.sortOrder } }]);
  };
  return (
    <section style={{ marginBottom: 18 }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{i.t('goals_in_period')}</h2>
        <button className="btn small primary" onClick={() => setForm(true)}>＋ {i.t('add_in_period')}</button>
      </div>
      {!goals.length ? <Empty>{i.t('no_children')}</Empty> : (
        <div className="yeartrail">
          {goals.map((g, k) => <Camp key={g.id} goal={g} open={open} toggle={toggle} onMove={(d) => move(k, d)} first={k === 0} last={k === goals.length - 1} />)}
        </div>
      )}
      {form && <GoalForm defaults={{ level, startDate: p.start, periodStart: p.start, deadline: lastDay(p) }} onClose={() => setForm(false)} />}
    </section>
  );
}

// ---------------- Day ----------------
export function DayPage({ date, focus }: { date: string; focus: string | null }) {
  const { data, i, today, opt, plan } = useApp();
  const [taskForm, setTaskForm] = useState(false);
  const d = isValidISO(date) ? date : today;
  const p = periodFor('day', d, plan!.startDate, data.settings.weekStartsOn);
  // day occurrences on this date + quota periods containing this date + tasks due today
  const occ = useMemo(() => {
    const dayOcc = occurrencesFor(data, { range: p, today }, opt).filter((o) => o.kind !== 'quota');
    const wide = { start: addDays(d, -31), end: addDays(d, 32) };
    const quotas = occurrencesFor(data, { range: wide, today, includeTasks: false }, opt).filter((o) => o.kind === 'quota' && contains(o.range, d));
    return [...dayOcc, ...quotas];
  }, [data, d, today, opt, p]);
  useEffect(() => {
    if (focus) setTimeout(() => document.getElementById(`occ-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
  }, [focus]);
  const c = commitment(occ.filter((o) => o.kind !== 'quota'));
  return (
    <div className="page">
      <PeriodNav type="day" p={p} anchor={d} />
      {d < today && <div className="banner" style={{ marginBottom: 12 }}>{i.t('past_day_note')}</div>}
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2>{i.t('due_today')}</h2>
        <button className="btn small" onClick={() => setTaskForm(true)}>{i.t('new_task')}</button>
      </div>
      {!occ.length ? <Empty>{i.t('nothing_due')}</Empty> : occ.map((o) => <OccurrenceRow key={o.key} o={o} date={d} highlight={focus === o.key} />)}
      {d < today && c.dueCount > 0 && <p className="small muted" style={{ marginTop: 12 }}>{i.t('commitment')}: <span className="num">{i.pct(c.ratio)}</span> · {i.t('coverage')}: <span className="num">{i.pct(c.coverage)}</span></p>}
      {taskForm && <TaskForm defaultDate={d} onClose={() => setTaskForm(false)} />}
    </div>
  );
}

// ---------------- Week ----------------
export function WeekPage({ date, monthStart }: { date: string; monthStart: string | null }) {
  const { data, i, today, opt, plan } = useApp();
  const d = isValidISO(date) ? date : today;
  const p = periodFor('week', d, plan!.startDate, data.settings.weekStartsOn);
  const month = monthStart && isValidISO(monthStart) ? periodFor('month', monthStart, plan!.startDate, data.settings.weekStartsOn) : null;
  const clip = month ? intersect(p, month) : null;
  const all = occurrencesFor(data, { range: p, today }, opt);
  const occ = clip ? clipTo(all, clip) : all;
  return (
    <div className="page">
      <PeriodNav type="week" p={p} anchor={d} extra={month ? { month: month.start } : undefined} />
      <PeriodGoals type="week" p={p} />
      {clip && <div className="banner" style={{ marginBottom: 12 }}>{i.t('week_in_month_note')} ({i.date(clip.start)} → {i.date(lastDay(clip))}) <a href={href(`/week/${p.start}`)}>{i.t('filter_all')}</a></div>}
      <MetricCards occ={occ} />
      <section className="panel">
        <h2>{i.t('days')}</h2>
        <div className="stack">
          {eachDay(p).map((day) => {
            const inClip = !clip || contains(clip, day);
            const dayOcc = occ.filter((o) => o.date === day && o.kind !== 'quota');
            return (
              <a key={day} href={href(`/day/${day}`)} className="row between" style={{ textDecoration: 'none', color: 'inherit', opacity: inClip ? 1 : 0.4, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <span>{i.date(day, { weekday: 'long', day: 'numeric', month: 'short' })}{day === today ? ' •' : ''}</span>
                <span className="steps" style={{ width: 160 }} aria-hidden>
                  {dayOcc.map((o) => <i key={o.key} className={o.status === 'done' ? 'done' : o.status === 'partial' || o.status === 'inProgress' ? 'partial' : o.excluded ? 'rest' : o.status === 'unrecorded' ? 'unrecorded' : ''} />)}
                </span>
              </a>
            );
          })}
        </div>
        {occ.filter((o) => o.kind === 'quota').map((o) => {
          const h = data.habits.find((x) => x.id === o.habitId);
          return <p key={o.key} className="small" style={{ marginBottom: 0 }}><bdi>{h?.title}</bdi>: {i.t('quota_progress', { a: o.amount, b: o.target })}</p>;
        })}
      </section>
      <ReviewPanel type="week" start={p.start} />
    </div>
  );
}

// ---------------- Month ----------------
export function MonthPage({ date }: { date: string }) {
  const { data, i, today, opt, plan } = useApp();
  const d = isValidISO(date) ? date : today;
  const ws = data.settings.weekStartsOn;
  const p = periodFor('month', d, plan!.startDate, ws);
  const occ = occurrencesFor(data, { range: p, today }, opt);
  const weeks = weeksTouching(p, ws);
  return (
    <div className="page">
      <PeriodNav type="month" p={p} anchor={d} />
      <PeriodGoals type="month" p={p} />
      <MetricCards occ={occ} />
      <section className="panel">
        <div className="monthgrid" role="grid" aria-label={i.t('nav_month')}>
          {Array.from({ length: 7 }, (_, k) => <div key={k} className="small muted" style={{ textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem' }}>{i.weekdays[(ws + k) % 7]}</div>)}
          {weeks.flatMap((w) => eachDay(w)).map((day) => {
            const dayOcc = occ.filter((o) => o.date === day && o.kind === 'day');
            const c = commitment(dayOcc);
            return (
              <a key={day} href={href(`/day/${day}`)} className={`daycell${contains(p, day) ? '' : ' out'}${day === today ? ' today' : ''}`} aria-label={i.date(day)}>
                <span className="d">{Number(day.slice(8))}</span>
                {contains(p, day) && dayOcc.length > 0 && <Trail ratio={c.ratio ?? planProgress(dayOcc).ratio} label={i.date(day)} />}
              </a>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <h2>{i.t('weeks')}</h2>
        <p className="small muted">{i.t('week_in_month_note')}</p>
        <div className="stack">
          {weeks.map((w) => {
            const clip = intersect(w, p)!;
            const c = commitment(clipTo(occ, clip));
            return (
              <a key={w.start} className="row between" href={href(`/week/${w.start}`, { month: p.start })} style={{ color: 'inherit', textDecoration: 'none' }}>
                <span>{i.date(clip.start, { day: 'numeric', month: 'short' })} – {i.date(lastDay(clip), { day: 'numeric', month: 'short' })}</span>
                <span className="num">{c.ratio == null ? i.t('no_items') : i.pct(c.ratio)}</span>
              </a>
            );
          })}
        </div>
      </section>
      <ReviewPanel type="month" start={p.start} />
    </div>
  );
}

// ---------------- Half ----------------
export function HalfPage({ date }: { date: string }) {
  const { data, i, today, opt, plan } = useApp();
  const d = isValidISO(date) ? date : today;
  const p = periodFor('half', d, plan!.startDate, data.settings.weekStartsOn);
  const occ = occurrencesFor(data, { range: p, today }, opt);
  const months = planMonths(plan!.startDate).filter((m) => contains(p, m.start));
  return (
    <div className="page">
      <PeriodNav type="half" p={p} anchor={d} />
      <PeriodGoals type="half" p={p} />
      <MetricCards occ={occ} />
      <section className="panel">
        <div className="grid three">
          {months.map((m) => {
            const mo = clipTo(occ, m);
            const pp = planProgress(mo);
            return (
              <a key={m.start} href={href(`/month/${m.start}`)} className="panel" style={{ color: 'inherit', textDecoration: 'none' }}>
                <h3>{i.t('month_n', { n: m.index + 1 })}</h3>
                <p className="small muted" style={{ margin: '0 0 8px' }}>{i.date(m.start, { day: 'numeric', month: 'short' })} → {i.date(lastDay(m), { day: 'numeric', month: 'short' })}</p>
                <Trail ratio={pp.ratio} expected={pp.expected} label={i.t('plan_progress')} />
                <p className="small num" style={{ margin: '6px 0 0' }}>{i.t('commitment')}: {commitment(mo).ratio == null ? i.t('no_items') : i.pct(commitment(mo).ratio)}</p>
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ---------------- Reviews ----------------
export function ReviewPanel({ type, start }: { type: 'week' | 'month'; start: string }) {
  const { data, save, i, today, opt } = useApp();
  const existing = data.reviews.find((r) => r.periodType === type && r.periodStart === start && !r.deletedAt);
  const [r, setR] = useState<Review>(existing ?? { ...newRow(), periodType: type, periodStart: start, achieved: '', blocker: '', adjustment: '' });
  useEffect(() => setR(existing ?? { ...newRow(), periodType: type, periodStart: start, achieved: '', blocker: '', adjustment: '' }), [existing?.id, existing?.version, type, start]); // eslint-disable-line
  // effect of the most recent earlier adjustment: commitment 14 days after vs 14 days before
  const prior = data.reviews.filter((x) => !x.deletedAt && x.adjustment && x.periodStart < start).sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1))[0];
  let effect: { a: number | null; b: number | null } | null = null;
  if (prior) {
    const pivot = prior.updatedAt.slice(0, 10) < today ? prior.updatedAt.slice(0, 10) : prior.periodStart;
    const after = commitment(occurrencesFor(data, { range: { start: pivot, end: addDays(pivot, 14) }, today }, opt));
    const before = commitment(occurrencesFor(data, { range: { start: addDays(pivot, -14), end: pivot }, today }, opt));
    effect = { a: after.ratio, b: before.ratio };
  }
  return (
    <section className="panel stack">
      <h2>{i.t(type === 'week' ? 'review_week' : 'review_month')}</h2>
      {(['achieved', 'blocker', 'adjustment'] as const).map((k) => (
        <Field key={k} label={i.t(`rv_${k}`)}><textarea className="input" value={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.value })} dir="auto" /></Field>
      ))}
      <div className="row between">
        {effect && <span className="small muted">{i.t('rv_effect', { a: i.pct(effect.a), b: i.pct(effect.b) })} <bdi>({prior!.adjustment.slice(0, 60)})</bdi></span>}
        <button className="btn primary" onClick={() => save('reviews', r) && toast(i.t('rv_saved'))}>{i.t('save')}</button>
      </div>
    </section>
  );
}
