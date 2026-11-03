import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { goalProgress } from '../../domain/progress';
import { eachDay, planMonths, planYearRange, lastDay } from '../../domain/periods';
import type { Goal, GoalPoint, Habit, PointBox } from '../../domain/types';
import { addDays } from '../../domain/dates';
import { commitment } from '../../domain/progress';
import { occurrencesFor } from '../../domain/schedule';
import { newRow } from '../../data/model';
import { aliveGoals, goalPath, useApp } from '../ctx';
import { go, href } from '../router';
import { Empty, StatusChip, Trail } from '../components/common';
import { GoalForm, HabitForm, ResultForm, TaskForm } from '../components/Forms';


function PointItem({ p, first, last, onMove }: { p: GoalPoint; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const { save, remove, i, sync } = useApp();
  const [text, setTextState] = useState(p.text);
  const [ifThen, setIfThenState] = useState(p.ifThen);
  const [nextStep, setNextStepState] = useState(p.nextStep);
  const [state, setState] = useState<'idle' | 'dirty' | 'saved'>('idle');
  const timer = useRef(0);
  // Latest typed values live in a ref, so a delayed save never sends a stale copy
  // (a stale copy used to drop the last typed character, space or line break).
  const latest = useRef({ text: p.text, ifThen: p.ifThen, nextStep: p.nextStep });
  const focused = useRef(false);
  const dirty = useRef(false);
  const rowRef = useRef(p);
  rowRef.current = p;
  useEffect(() => {
    // accept updates from other devices only while this point is not being edited
    if (dirty.current || focused.current) return;
    latest.current = { text: p.text, ifThen: p.ifThen, nextStep: p.nextStep };
    setTextState(p.text); setIfThenState(p.ifThen); setNextStepState(p.nextStep);
  }, [p.version, p.text, p.ifThen, p.nextStep]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    if (save('goalPoints', { ...rowRef.current, ...latest.current })) {
      dirty.current = false;
      setState('saved');
    }
  };
  const change = (k: 'text' | 'ifThen' | 'nextStep', v: string) => {
    latest.current = { ...latest.current, [k]: v };
    (k === 'text' ? setTextState : k === 'ifThen' ? setIfThenState : setNextStepState)(v);
    dirty.current = true;
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(commit, 800);
  };
  const onFocus = () => { focused.current = true; };
  const onBlur = () => { focused.current = false; commit(); };
  return (
    <li className="point">
      <textarea value={text} dir="auto" rows={1} aria-label={i.t('point_ph')} placeholder={i.t('point_ph')}
        onChange={(e) => change('text', e.target.value)} onFocus={onFocus} onBlur={onBlur} />
      <div className="ctl">
        <button onClick={() => onMove(-1)} disabled={first} aria-label={i.t('move_up')}>▲</button>
        <button onClick={() => onMove(1)} disabled={last} aria-label={i.t('move_down')}>▼</button>
        <button onClick={() => remove('goalPoints', p.id)} aria-label={i.t('delete')}>✕</button>
      </div>
      <div className="extra">
        {p.box === 'obstacles' && (
          <input value={ifThen} dir="auto" placeholder={i.t('if_then_ph')} aria-label={i.t('if_then')} onChange={(e) => change('ifThen', e.target.value)} onFocus={onFocus} onBlur={onBlur} />
        )}
        <input value={nextStep} dir="auto" placeholder={i.t('next_step')} aria-label={i.t('next_step')} onChange={(e) => change('nextStep', e.target.value)} onFocus={onFocus} onBlur={onBlur} />
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
    <section className={`box thought node ${box}`} onClick={(e) => e.stopPropagation()} aria-label={i.t(box)}>
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
  // the root goal already shows its habits as clouds on the road
  const habits = depth > 1 ? data.habits.filter((h) => h.goalIds.includes(goal.id) && !h.deletedAt && !h.archived) : [];
  const nextLevel = goal.level === 'year' ? 'half' : goal.level === 'half' ? 'month' : 'week';
  return (
    <>
      <ul className="tree">
        {children.map((c) => {
          const n = goalProgress(c.id, data, today, opt);
          const isOpen = open.has(c.id);
          return (
            <li key={c.id} className={`tnode lv-${c.level}`} id={`goal-${c.id}`}>
              <button className="tcard" aria-expanded={isOpen} onClick={() => toggle(c.id)}>
                <span className="tcard-head">
                  <span className="tlevel">{i.t(`lv_${c.level}` as 'lv_half')}</span>
                  <bdi className="ttitle">{c.title}</bdi>
                  <span className="tpct num">{i.pct(n?.plan.ratio ?? null)}</span>
                  <span className="tcaret" aria-hidden>{isOpen ? '−' : '+'}</span>
                </span>
                <Trail ratio={n?.plan.ratio ?? null} expected={n?.plan.expected} label={c.title} />
                {c.deadline && <span className="tdate">{i.date(c.deadline, { day: 'numeric', month: 'short' })}</span>}
              </button>
              {isOpen && <SubTree goal={c} open={open} toggle={toggle} depth={depth + 1} />}
            </li>
          );
        })}
        {habits.map((h) => (
          <li key={h.id} className="tnode leaf">
            <a className="tleaf habit" href={href('/habits', { focus: h.id })}>↻ <bdi>{h.title}</bdi>{h.cue && <span className="muted"> · <bdi>{h.cue}</bdi></span>}</a>
          </li>
        ))}
        {tasks.map((t) => {
          const done = data.logs.some((l) => l.taskId === t.id && !l.deletedAt && l.kind === 'progress');
          return (
            <li key={t.id} className="tnode leaf">
              <a className={`tleaf task${done ? ' done' : ''}`} href={href(`/day/${t.dueDate}`, { focus: `t:${t.id}` })}>{done ? '✓' : '○'} <bdi>{t.title}</bdi> <span className="muted num">{i.date(t.dueDate, { day: 'numeric', month: 'short' })}</span></a>
            </li>
          );
        })}
        <li className="tnode leaf tadd">
          {goal.level !== 'week' && <button className="tleaf add" onClick={() => setGoalForm(true)}>＋ {i.t(`lv_${nextLevel}` as 'lv_half')}</button>}
          <button className="tleaf add" onClick={() => setTaskForm(true)}>＋ {i.t('task')}</button>
          {depth > 1 && <button className="tleaf add" onClick={() => setHabitForm(true)}>＋ {i.t('habit')}</button>}
        </li>
      </ul>
      {goalForm && <GoalForm defaults={{ parentId: goal.id, level: nextLevel, startDate: goal.startDate, planYearId: goal.planYearId }} onClose={() => setGoalForm(false)} />}
      {taskForm && <TaskForm goalId={goal.id} defaultDate={goal.deadline && goal.deadline < today ? goal.deadline : undefined} onClose={() => setTaskForm(false)} />}
      {habitForm && <HabitForm goalId={goal.id} onClose={() => setHabitForm(false)} />}
    </>
  );
}

/** 366-day map of one annual goal: a row per plan month, a cell per day, coloured by what was done for this goal. */
function YearGrid({ goal }: { goal: Goal }) {
  const { data, i, today, opt, plan } = useApp();
  const cells = useMemo(() => {
    const ids = new Set<string>([goal.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const g of data.goals) if (!g.deletedAt && g.parentId && ids.has(g.parentId) && !ids.has(g.id)) { ids.add(g.id); grew = true; }
    }
    const habitIds = data.habits.filter((h) => !h.deletedAt && h.goalIds.some((x) => ids.has(x))).map((h) => h.id);
    const taskIds = data.tasks.filter((t) => !t.deletedAt && ids.has(t.goalId)).map((t) => t.id);
    const yr = planYearRange(plan!.startDate);
    const occ = habitIds.length || taskIds.length ? occurrencesFor(data, { range: yr, today, habitIds, taskIds }, opt) : [];
    const byDay = new Map<string, typeof occ>();
    for (const o of occ) (byDay.get(o.date) ?? byDay.set(o.date, []).get(o.date)!).push(o);
    return planMonths(plan!.startDate).map((m) => ({
      m,
      days: eachDay(m).map((d) => {
        const list = byDay.get(d) ?? [];
        const c = commitment(list);
        const p = list.length ? list.reduce((s, o) => s + o.contribution, 0) / list.length : null;
        return { d, due: list.length, ratio: d < today ? c.ratio : p, future: d > today, unrec: d < today && c.dueCount > 0 && c.recordedCount === 0 };
      }),
    }));
  }, [data, goal.id, today, opt, plan]);
  const doneDays = cells.flatMap((r) => r.days).filter((c) => !c.future && c.ratio != null && c.ratio >= 1).length;
  return (
    <section className="yeargrid noswipe" aria-label={i.t('year_map')}>
      <div className="yg-head"><span>{i.t('year_map')}</span><span className="num muted">{i.t('full_days', { n: doneDays })}</span></div>
      {cells.map(({ m, days }) => (
        <div key={m.start} className="yg-row">
          <span className="yg-label num">{m.index + 1}</span>
          <div className="yg-cells">
            {days.map((c) => (
              <a key={c.d} href={href(`/day/${c.d}`)} title={`${i.date(c.d)}: ${c.due ? i.pct(c.ratio) : i.t('no_items')}`}
                className={`yg-cell${c.d === today ? ' today' : ''}${c.future ? ' future' : ''}${!c.due ? ' none' : ''}${c.unrec ? ' unrec' : ''}`}
                style={{ ['--v' as string]: c.ratio ?? 0 }} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

// ---------- habit clouds branching from a goal (the "station" on the road) ----------

function HabitCloud({ h }: { h: Habit }) {
  const { data, i, today, opt } = useApp();
  const recent = occurrencesFor(data, { range: { start: addDays(today, -28), end: today }, today, habitIds: [h.id], includeTasks: false }, opt);
  const c = commitment(recent);
  const now = occurrencesFor(data, { range: { start: addDays(today, -31), end: addDays(today, 32) }, today, habitIds: [h.id], includeTasks: false }, opt)
    .find((o) => (o.kind === 'day' ? o.date === today : o.range.start <= today && today < o.range.end));
  const link = now ? href(`/day/${today}`, { focus: now.key }) : href('/habits', { focus: h.id });
  return (
    <a className={`cloud node${now && now.contribution >= 1 ? ' done' : ''}`} href={link} onClick={(e) => e.stopPropagation()}>
      <span className="cloud-title"><bdi>{h.title}</bdi></span>
      {h.cue && <span className="cloud-cue"><bdi>{h.cue}</bdi></span>}
      <span className="cloud-meta">
        {now ? <StatusChip s={now.status} /> : null}
        <span className="num" title={i.t('commit_today', { n: 28 })}>{c.ratio == null ? '—' : i.pct(c.ratio)}</span>
      </span>
    </a>
  );
}

interface Link { d: string; x: number; y: number }

/** Draws curved branches from the goal card to each habit cloud, measured from the real layout. */
function useBranches(ref: React.RefObject<HTMLDivElement | null>, key: string) {
  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const card = box.querySelector<HTMLElement>(':scope > .goalcard');
      if (!card) return;
      const b = box.getBoundingClientRect();
      const r = (el: Element) => { const q = el.getBoundingClientRect(); return { l: q.left - b.left, t: q.top - b.top, r: q.right - b.left, b: q.bottom - b.top, w: q.width, h: q.height }; };
      const c = r(card);
      const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
      const out: Link[] = [];
      const sides: Record<'l' | 'r', { k: ReturnType<typeof r> }[]> = { l: [], r: [] };
      box.querySelectorAll(':scope > .clouds > .node, :scope > .habits > .node').forEach((el) => {
        const k = r(el);
        const cx = k.l + k.w / 2;
        const below = k.t >= c.b - 4;
        if (!below && k.r <= c.l + 4) sides.l.push({ k });
        else if (!below && k.l >= c.r - 4) sides.r.push({ k });
        else {
          // phone layout: cloud sits under the card → branch drops from the card's bottom edge
          const sx = clamp(cx, c.l + 28, c.r - 28);
          const sy = c.b;
          const ey = k.t + 6;
          const my = (sy + ey) / 2;
          out.push({ d: `M ${sx} ${sy} C ${sx} ${my + 6}, ${cx} ${my - 6}, ${cx} ${ey}`, x: sx, y: sy });
        }
      });
      // wide layout: branches leave the card's sides at spread-out points and bend out to each cloud
      (['l', 'r'] as const).forEach((side) => {
        const list = sides[side].sort((a, b) => a.k.t - b.k.t);
        list.forEach(({ k }, idx) => {
          const n = list.length;
          const sx = side === 'l' ? c.l : c.r;
          const sy = n === 1 ? c.t + c.h * 0.4 : c.t + c.h * (0.22 + (0.56 * idx) / (n - 1));
          const ex = side === 'l' ? k.r - 6 : k.l + 6;
          const ey = k.t + k.h / 2;
          const dx = ex - sx;
          out.push({ d: `M ${sx} ${sy} C ${sx + dx * 0.55} ${sy}, ${ex - dx * 0.35} ${ey}, ${ex} ${ey}`, x: sx, y: sy });
        });
      });
      setLinks(out);
      setSize({ w: b.width, h: b.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    box.querySelectorAll(':scope > *').forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [ref, key]);
  return { links, size };
}

function Station({ goal, card }: { goal: Goal; card: React.ReactNode }) {
  const { data, i } = useApp();
  const [form, setForm] = useState(false);
  const habits = data.habits.filter((h) => !h.deletedAt && !h.archived && h.goalIds.includes(goal.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  const ref = useRef<HTMLDivElement>(null);
  const points = data.goalPoints.filter((x) => x.goalId === goal.id && !x.deletedAt).map((x) => x.id + x.version).join(',');
  const { links, size } = useBranches(ref, habits.map((h) => h.id).join(',') + '|' + points);
  return (
    <div className="station" ref={ref}>
      <svg className="branch-lines" width={size.w} height={size.h} aria-hidden>
        {links.map((l, k) => <g key={k}><path d={l.d} pathLength={1} /><circle cx={l.x} cy={l.y} r={3.5} /></g>)}
      </svg>
      {/* sides of the road: motivation on one side, fears and obstacles on the other */}
      <div className="clouds side-a"><PointBoxView goal={goal} box="benefits" /></div>
      {card}
      <div className="clouds side-b"><PointBoxView goal={goal} box="fears" /><PointBoxView goal={goal} box="obstacles" /></div>
      {/* habits hang below the goal; a goal can have as many as you like */}
      <div className="habits">
        {habits.map((h) => <HabitCloud key={h.id} h={h} />)}
        <button className="cloud add node" onClick={(e) => { e.stopPropagation(); setForm(true); }}>＋ {i.t('habit')}</button>
      </div>
      {form && <HabitForm goalId={goal.id} onClose={() => setForm(false)} />}
    </div>
  );
}

export function Camp({ goal, open, toggle, onMove, first, last }: { goal: Goal; open: Set<string>; toggle: (id: string) => void; onMove: (d: -1 | 1) => void; first: boolean; last: boolean }) {
  const { data, i, today, opt, save } = useApp();
  const [edit, setEdit] = useState(false);
  const [result, setResult] = useState(false);
  const [menu, setMenu] = useState(false);
  const n = goalProgress(goal.id, data, today, opt);
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const card = (
      <div className="goalcard">
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
          {goal.priority === 1 && <span className="chip">{i.t('p1')}</span>}
          {n?.outcome.achieved && <span className="chip gold">★ {i.t('outcome_achieved')}</span>}
        </div>
        {n?.outsidePlanYear && <div className="banner warn small" style={{ marginBottom: 8 }}>{i.t('outside_year')}</div>}
        <Trail ratio={n?.plan.ratio ?? null} expected={n?.plan.expected} label={i.t('plan_progress')} />
        <div className="cardfoot">
          <span className="small muted">{i.t('plan_progress')} <b className="num">{i.pct(n?.plan.ratio ?? null)}</b> · {i.t('commitment')} <b className="num">{n?.commit.ratio == null ? '—' : i.pct(n.commit.ratio)}</b></span>
          <div className="menuwrap" onClick={stop}>
            <button className="btn small ghost icon" aria-label={i.t('more_actions')} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>⋯</button>
            {menu && (
              <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
                <button role="menuitem" onClick={() => { setMenu(false); setResult(true); }}>{i.t('record_result')}</button>
                <button role="menuitem" onClick={() => { setMenu(false); setEdit(true); }}>{i.t('edit')}</button>
                <button role="menuitem" disabled={first} onClick={() => { setMenu(false); onMove(-1); }}>▲ {i.t('move_up')}</button>
                <button role="menuitem" disabled={last} onClick={() => { setMenu(false); onMove(1); }}>▼ {i.t('move_down')}</button>
                <button role="menuitem" onClick={() => { setMenu(false); save('goals', { ...goal, status: 'archived' }); }}>{i.t('archive')}</button>
              </div>
            )}
          </div>
        </div>
      </div>
  );
  return (
    <div className="camp" id={`goal-${goal.id}`}>
      <Station goal={goal} card={card} />

      {/* the goal branches into its sub-goals, tasks and (deeper down) habits */}
      <div className="treewrap">
        <SubTree goal={goal} open={open} toggle={toggle} depth={1} />
      </div>
      {goal.level === 'year' && <YearGrid goal={goal} />}
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
