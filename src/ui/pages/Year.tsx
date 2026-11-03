import { useEffect, useMemo, useRef, useState } from 'react';
import { goalProgress } from '../../domain/progress';
import { planYearRange, lastDay } from '../../domain/periods';
import type { Goal, GoalPoint, PointBox } from '../../domain/types';
import { newRow } from '../../data/model';
import { aliveGoals, goalPath, useApp } from '../ctx';
import { go, href } from '../router';
import { Empty, Trail } from '../components/common';
import { GoalForm, HabitForm, ResultForm, TaskForm } from '../components/Forms';

const BOXES: PointBox[] = ['fears', 'benefits', 'obstacles'];

function PointItem({ p, first, last, onMove }: { p: GoalPoint; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const { save, remove, i, sync } = useApp();
  const [text, setText] = useState(p.text);
  const [ifThen, setIfThen] = useState(p.ifThen);
  const [nextStep, setNextStep] = useState(p.nextStep);
  const [state, setState] = useState<'idle' | 'dirty' | 'saved'>('idle');
  const timer = useRef(0);
  useEffect(() => {
    // accept remote updates when not editing
    if (state !== 'dirty') { setText(p.text); setIfThen(p.ifThen); setNextStep(p.nextStep); }
  }, [p.version, p.text, p.ifThen, p.nextStep]); // eslint-disable-line
  const commit = (patch: Partial<GoalPoint>) => {
    clearTimeout(timer.current);
    if (save('goalPoints', { ...p, text, ifThen, nextStep, ...patch })) setState('saved');
  };
  const schedule = () => {
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit({}), 800);
  };
  return (
    <li className="point">
      <textarea value={text} dir="auto" rows={1} aria-label={i.t('point_ph')} placeholder={i.t('point_ph')}
        onChange={(e) => { setText(e.target.value); schedule(); }} onBlur={() => state === 'dirty' && commit({})} />
      <div className="ctl">
        <button onClick={() => onMove(-1)} disabled={first} aria-label={i.t('move_up')}>▲</button>
        <button onClick={() => onMove(1)} disabled={last} aria-label={i.t('move_down')}>▼</button>
        <button onClick={() => remove('goalPoints', p.id)} aria-label={i.t('delete')}>✕</button>
      </div>
      <div className="extra">
        {p.box === 'obstacles' && (
          <input value={ifThen} dir="auto" placeholder={i.t('if_then_ph')} aria-label={i.t('if_then')} onChange={(e) => { setIfThen(e.target.value); schedule(); }} onBlur={() => state === 'dirty' && commit({})} />
        )}
        <input value={nextStep} dir="auto" placeholder={i.t('next_step')} aria-label={i.t('next_step')} onChange={(e) => { setNextStep(e.target.value); schedule(); }} onBlur={() => state === 'dirty' && commit({})} />
        <span className="savestate" aria-live="polite">{state === 'dirty' ? '…' : state === 'saved' ? (sync === 'saved' ? i.t('sync_saved') : i.t(`sync_${sync}` as 'sync_saved')) : ''}</span>
      </div>
    </li>
  );
}

function PointBoxView({ goal, box }: { goal: Goal; box: PointBox }) {
  const { data, save, saveMany, i } = useApp();
  const points = data.goalPoints.filter((p) => p.goalId === goal.id && p.box === box && !p.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder);
  const add = () => save('goalPoints', { ...newRow(), goalId: goal.id, box, text: '', ifThen: '', nextStep: '', sortOrder: (points[points.length - 1]?.sortOrder ?? 0) + 1 });
  const move = (idx: number, dir: -1 | 1) => {
    const a = points[idx];
    const b = points[idx + dir];
    if (!a || !b) return;
    saveMany([{ table: 'goalPoints', row: { ...a, sortOrder: b.sortOrder } }, { table: 'goalPoints', row: { ...b, sortOrder: a.sortOrder } }]);
  };
  return (
    <section className={`box ${box}`} onClick={(e) => e.stopPropagation()} aria-label={i.t(box)}>
      <h3><span>{i.t(box)}</span><button className="btn small ghost" onClick={add} aria-label={`${i.t('add_point')}: ${i.t(box)}`}>＋</button></h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {points.map((p, k) => <PointItem key={p.id} p={p} first={k === 0} last={k === points.length - 1} onMove={(d) => move(k, d)} />)}
      </ul>
      {!points.length && <button className="btn small ghost" onClick={add}>{i.t('add_point')}</button>}
    </section>
  );
}

function SubTree({ goal, open, toggle, depth }: { goal: Goal; open: Set<string>; toggle: (id: string) => void; depth: number }) {
  const { data, i, today, opt } = useApp();
  const [taskForm, setTaskForm] = useState(false);
  const [goalForm, setGoalForm] = useState(false);
  const [habitForm, setHabitForm] = useState(false);
  const children = aliveGoals(data).filter((g) => g.parentId === goal.id && g.status !== 'archived');
  const tasks = data.tasks.filter((t) => t.goalId === goal.id && !t.deletedAt).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const habits = data.habits.filter((h) => h.goalIds.includes(goal.id) && !h.deletedAt && !h.archived);
  const nextLevel = goal.level === 'year' ? 'half' : goal.level === 'half' ? 'month' : 'week';
  return (
    <div className="stack" style={{ gap: 6 }}>
      <ul>
        {children.map((c) => {
          const n = goalProgress(c.id, data, today, opt);
          const isOpen = open.has(c.id);
          return (
            <li key={c.id} className="subnode" id={`goal-${c.id}`}>
              <div className="row between">
                <button className="btn ghost small" aria-expanded={isOpen} onClick={() => toggle(c.id)} style={{ fontWeight: 600 }}>
                  {isOpen ? '▾' : '▸'} <bdi>{c.title}</bdi> <span className="chip">{i.t(`lv_${c.level}` as 'lv_half')}</span>
                </button>
                <span className="small num muted">{c.deadline ? i.date(c.deadline) : ''} · {i.pct(n?.plan.ratio ?? null)}</span>
              </div>
              <Trail ratio={n?.plan.ratio ?? null} expected={n?.plan.expected} label={c.title} />
              {isOpen && <div className="children" style={{ marginTop: 8 }}><SubTree goal={c} open={open} toggle={toggle} depth={depth + 1} /></div>}
            </li>
          );
        })}
        {tasks.map((t) => {
          const done = data.logs.some((l) => l.taskId === t.id && !l.deletedAt && l.kind === 'progress');
          return (
            <li key={t.id} className="row between subnode">
              <a href={href(`/day/${t.dueDate}`, { focus: `t:${t.id}` })}>{done ? '✓ ' : '○ '}<bdi>{t.title}</bdi></a>
              <span className="small num muted">{i.date(t.dueDate)}</span>
            </li>
          );
        })}
        {habits.map((h) => (
          <li key={h.id} className="row between subnode">
            <a href={href('/habits', { focus: h.id })}>↻ <bdi>{h.title}</bdi></a>
            {h.cue && <span className="small muted"><bdi>{h.cue}</bdi></span>}
          </li>
        ))}
      </ul>
      {!children.length && !tasks.length && !habits.length && <p className="small muted" style={{ margin: 0 }}>{i.t('no_children')}</p>}
      <div className="row">
        {goal.level !== 'week' && <button className="btn small" onClick={() => setGoalForm(true)}>＋ {i.t('sub_goal')}</button>}
        <button className="btn small" onClick={() => setTaskForm(true)}>＋ {i.t('task')}</button>
        <button className="btn small" onClick={() => setHabitForm(true)}>＋ {i.t('habit')}</button>
      </div>
      {goalForm && <GoalForm defaults={{ parentId: goal.id, level: nextLevel, startDate: goal.startDate, planYearId: goal.planYearId }} onClose={() => setGoalForm(false)} />}
      {taskForm && <TaskForm goalId={goal.id} defaultDate={goal.deadline && goal.deadline < today ? goal.deadline : undefined} onClose={() => setTaskForm(false)} />}
      {habitForm && <HabitForm goalId={goal.id} onClose={() => setHabitForm(false)} />}
    </div>
  );
}

function Camp({ goal, open, toggle, onMove, first, last }: { goal: Goal; open: Set<string>; toggle: (id: string) => void; onMove: (d: -1 | 1) => void; first: boolean; last: boolean }) {
  const { data, i, today, opt, save } = useApp();
  const [edit, setEdit] = useState(false);
  const [result, setResult] = useState(false);
  const n = goalProgress(goal.id, data, today, opt);
  const isOpen = open.has(goal.id);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div className="camp" id={`goal-${goal.id}`}>
      <div className={`goalcard${isOpen ? ' open' : ''}`} role="button" tabIndex={0} aria-expanded={isOpen}
        onClick={() => toggle(goal.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), toggle(goal.id))}>
        <div className="row between">
          <h2 style={{ margin: 0 }}><bdi>{goal.title}</bdi></h2>
          <span className={`chip ${goal.status === 'done' ? 'gold' : goal.status === 'active' ? 'green' : ''}`}>{i.t(`gs_${goal.status}` as 'gs_active')}</span>
        </div>
        <div className="meta">
          {goal.deadline ? (
            <span className={`chip ${n && n.daysLeft != null && n.daysLeft < 0 ? 'alert' : 'info'}`}>
              {i.date(goal.deadline)} · {n?.daysLeft != null && (n.daysLeft >= 0 ? i.t('days_left', { n: n.daysLeft }) : i.t('overdue_days', { n: -n.daysLeft }))}
            </span>
          ) : <button className="chip warn" onClick={(e) => { stop(e); setEdit(true); }}>{i.t('set_deadline')}</button>}
          <span className="chip">{i.t(`p${goal.priority}` as 'p1')}</span>
          {n?.outcome.achieved ? <span className="chip gold">★ {i.t('outcome_achieved')}</span> : <span className="chip">{i.t('outcome_not_yet')}</span>}
        </div>
        {n?.outsidePlanYear && <div className="banner warn small" style={{ marginBottom: 8 }}>{i.t('outside_year')}</div>}
        <Trail ratio={n?.plan.ratio ?? null} expected={n?.plan.expected} label={i.t('plan_progress')} />
        <div className="row between small" style={{ marginTop: 6 }}>
          <span>{i.t('plan_progress')}: <span className="num">{i.pct(n?.plan.ratio ?? null)}</span> · {i.t('commitment')}: <span className="num">{n?.commit.ratio == null ? i.t('no_items') : i.pct(n.commit.ratio)}</span></span>
          <span className="row" style={{ gap: 4 }} onClick={stop}>
            <button className="btn small ghost" onClick={() => setResult(true)}>{i.t('record_result')}</button>
            <button className="btn small ghost" onClick={() => setEdit(true)}>{i.t('edit')}</button>
            <button className="btn small ghost" disabled={first} onClick={() => onMove(-1)} aria-label={i.t('move_up')}>▲</button>
            <button className="btn small ghost" disabled={last} onClick={() => onMove(1)} aria-label={i.t('move_down')}>▼</button>
            <button className="btn small ghost" onClick={() => save('goals', { ...goal, status: 'archived' })}>{i.t('archive')}</button>
          </span>
        </div>
      </div>
      <div className="branches">
        {BOXES.map((b) => <PointBoxView key={b} goal={goal} box={b} />)}
      </div>
      {isOpen && (
        <div className="drill panel">
          <SubTree goal={goal} open={open} toggle={toggle} depth={1} />
        </div>
      )}
      {edit && <GoalForm goal={goal} onClose={() => setEdit(false)} />}
      {result && <ResultForm goal={goal} onClose={() => setResult(false)} />}
    </div>
  );
}

export function YearPage({ focus, openParam }: { focus: string | null; openParam: string | null }) {
  const { data, i, plan, saveMany } = useApp();
  const [form, setForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const open = useMemo(() => new Set((openParam ?? '').split(',').filter(Boolean)), [openParam]);
  // deep link: open all ancestors of the focused goal
  useEffect(() => {
    if (!focus) return;
    const path = goalPath(data, focus).map((g) => g.id);
    const want = new Set([...open, ...path.slice(0, -1), ...(path.length === 1 ? [focus] : [])]);
    if ([...want].some((x) => !open.has(x))) go('/year', { focus, open: [...want].join(',') }, true);
    setTimeout(() => document.getElementById(`goal-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  }, [focus]); // eslint-disable-line
  const toggle = (id: string) => {
    const next = new Set(open);
    next.has(id) ? next.delete(id) : next.add(id);
    go('/year', { focus: null, open: [...next].join(',') || null }, true);
  };
  const goals = aliveGoals(data).filter((g) => g.level === 'year' && g.planYearId === plan!.id && (showArchived ? g.status === 'archived' : g.status !== 'archived'));
  const move = (k: number, d: -1 | 1) => {
    const a = goals[k], b = goals[k + d];
    if (a && b) saveMany([{ table: 'goals', row: { ...a, sortOrder: b.sortOrder } }, { table: 'goals', row: { ...b, sortOrder: a.sortOrder === b.sortOrder ? a.sortOrder + d : a.sortOrder } }]);
  };
  const yr = planYearRange(plan!.startDate);
  const crumbs = focus ? goalPath(data, focus) : [];
  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 6 }}>
        <div>
          <h1><bdi>{plan!.label || i.t('year_plan')}</bdi></h1>
          <p className="muted small" style={{ margin: 0 }}>{i.date(yr.start)} → {i.date(lastDay(yr))}</p>
        </div>
        <div className="row">
          <button className="btn small ghost" onClick={() => setShowArchived((x) => !x)} aria-pressed={showArchived}>{i.t('gs_archived')}</button>
          <button className="btn primary" onClick={() => setForm(true)}>＋ {i.t('new_goal')}</button>
        </div>
      </div>
      {crumbs.length > 1 && (
        <nav className="crumbs" aria-label={i.t('goal_path')} style={{ marginBottom: 12 }}>
          <a href={href('/year')}>{i.t('year_plan')}</a>
          {crumbs.map((g) => <span key={g.id}> / <a href={href('/year', { focus: g.id, open: openParam })}><bdi>{g.title}</bdi></a></span>)}
        </nav>
      )}
      {!goals.length ? (
        <Empty action={<button className="btn primary" onClick={() => setForm(true)}>{i.t('new_goal')}</button>}>{i.t('empty_goals')}</Empty>
      ) : (
        <div className="yeartrail">
          {goals.map((g, k) => (
            showArchived
              ? <div key={g.id} className="camp"><div className="goalcard"><div className="row between"><bdi>{g.title}</bdi><button className="btn small" onClick={() => saveMany([{ table: 'goals', row: { ...g, status: 'active' } }])}>{i.t('unarchive')}</button></div></div></div>
              : <Camp key={g.id} goal={g} open={open} toggle={toggle} onMove={(d) => move(k, d)} first={k === 0} last={k === goals.length - 1} />
          ))}
        </div>
      )}
      {form && <GoalForm onClose={() => setForm(false)} />}
    </div>
  );
}
