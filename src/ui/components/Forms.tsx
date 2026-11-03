import { useMemo, useState } from 'react';
import { addDays, diffDays, isValidISO } from '../../domain/dates';
import { planYearRange, weeksTouching, contains } from '../../domain/periods';
import { wouldCreateCycle, capacityCheck } from '../../domain/progress';
import { occurrencesFor } from '../../domain/schedule';
import type { Goal, GoalLevel, Habit, HabitSchedule, Measure, MeasureType, ScheduleRule, Task, Weekday, HabitException } from '../../domain/types';
import { newGoal, newHabit, newRow, newSchedule, newTask, nowISO } from '../../data/model';
import { aliveGoals, useApp } from '../ctx';
import { Dialog, Field, toast } from './common';

const MEASURES: MeasureType[] = ['binary', 'minutes', 'hours', 'count', 'pages', 'questions', 'distance', 'custom'];
const LEVELS: GoalLevel[] = ['year', 'half', 'month', 'week'];

function MeasurePicker({ value, onChange }: { value: Measure; onChange: (m: Measure) => void }) {
  const { i } = useApp();
  return (
    <div className="formgrid">
      <Field label={i.t('measure')}>
        <select className="input" value={value.type} onChange={(e) => onChange({ type: e.target.value as MeasureType, unit: e.target.value === 'distance' ? 'km' : value.unit })}>
          {MEASURES.map((m) => <option key={m} value={m}>{i.t(`m_${m}` as 'm_binary')}</option>)}
        </select>
      </Field>
      {value.type === 'distance' && (
        <Field label={i.t('unit')}>
          <select className="input" value={value.unit ?? 'km'} onChange={(e) => onChange({ ...value, unit: e.target.value })}>
            {['km', 'mi', 'm'].map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>
      )}
      {value.type === 'custom' && (
        <Field label={i.t('unit')}><input className="input" value={value.unit ?? ''} onChange={(e) => onChange({ ...value, unit: e.target.value })} dir="auto" /></Field>
      )}
    </div>
  );
}

// ---------------- Goal ----------------
export function GoalForm({ goal, defaults, onClose }: { goal?: Goal; defaults?: Partial<Goal>; onClose: () => void }) {
  const { data, save, saveMany, i, plan, today, opt } = useApp();
  const [g, setG] = useState<Goal>(() => goal ?? newGoal({ planYearId: plan!.id, level: 'year', title: '', startDate: today < plan!.startDate ? plan!.startDate : today, ...defaults }));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const set = <K extends keyof Goal>(k: K, v: Goal[K]) => setG((x) => ({ ...x, [k]: v }));
  const goals = aliveGoals(data).filter((x) => x.id !== g.id && x.planYearId === g.planYearId);
  const parent = g.parentId ? data.goals.find((x) => x.id === g.parentId) : null;
  const py = data.planYears.find((p) => p.id === g.planYearId);
  const yr = py ? planYearRange(py.startDate) : null;
  const outside = !!(yr && g.deadline && !contains(yr, g.deadline));
  const windowDays = g.deadline ? diffDays(addDays(g.deadline, 1), g.startDate) : null;

  const load = useMemo(() => {
    if (!g.deadline || g.weeklyCapacityHours == null) return [];
    const habitIds = data.habits.filter((h) => h.goalIds.includes(g.id) && !h.deletedAt && (h.measure.type === 'minutes' || h.measure.type === 'hours')).map((h) => h.id);
    if (!habitIds.length) return [];
    const range = { start: g.startDate, end: addDays(g.deadline, 1) };
    const occ = occurrencesFor(data, { range, today, habitIds, includeTasks: false }, opt);
    const m = new Map<string, number>();
    for (const w of weeksTouching(range, data.settings.weekStartsOn)) m.set(w.start, 0);
    for (const o of occ) {
      const h = data.habits.find((x) => x.id === o.habitId)!;
      const mins = (h.measure.type === 'hours' ? 60 : 1) * (o.kind === 'quota' ? o.sessionTarget * o.target : o.target);
      const ws = weeksTouching({ start: o.date, end: addDays(o.date, 1) }, data.settings.weekStartsOn)[0].start;
      m.set(ws, (m.get(ws) ?? 0) + mins);
    }
    return capacityCheck(m, g.weeklyCapacityHours);
  }, [g.deadline, g.weeklyCapacityHours, g.startDate, g.id, data, today, opt]);

  const submit = () => {
    const e: Record<string, string> = {};
    if (!g.title.trim()) e.title = i.t('validation_required');
    if (!isValidISO(g.startDate)) e.startDate = i.t('validation_required');
    if (g.deadline && g.deadline < g.startDate) e.deadline = i.t('deadline_before_start');
    if (g.parentId && wouldCreateCycle(data.goals, g.id, g.parentId)) e.parent = 'cycle';
    setErr(e);
    if (Object.keys(e).length) return;
    let row = { ...g, title: g.title.trim() };
    if (goal && goal.deadline !== g.deadline) row = { ...row, deadlineHistory: [...g.deadlineHistory, { deadline: goal.deadline, changedAt: nowISO(), reason: reason || undefined }] };
    if (save('goals', row)) {
      toast(i.t('saved_toast'));
      onClose();
    }
  };

  const moveToPlan = (pid: string) => set('planYearId', pid);
  const otherPlans = data.planYears.filter((p) => !p.deletedAt && p.id !== g.planYearId && g.deadline && contains(planYearRange(p.startDate), g.deadline));
  void saveMany;

  return (
    <Dialog title={goal ? i.t('edit') : i.t('new_goal')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{i.t('cancel')}</button><button className="btn primary" onClick={submit}>{i.t('save')}</button></>}>
      <div className="stack">
        <Field label={i.t('title')} error={err.title}><input className="input" value={g.title} onChange={(e) => set('title', e.target.value)} dir="auto" autoFocus /></Field>
        <Field label={i.t('description')}><textarea className="input" value={g.description} onChange={(e) => set('description', e.target.value)} dir="auto" /></Field>
        <div className="formgrid">
          <Field label={i.t('level')}>
            <select className="input" value={g.level} onChange={(e) => set('level', e.target.value as GoalLevel)}>
              {LEVELS.map((l) => <option key={l} value={l}>{i.t(`lv_${l}` as 'lv_year')}</option>)}
            </select>
          </Field>
          <Field label={i.t('parent')} error={err.parent}>
            <select className="input" value={g.parentId ?? ''} onChange={(e) => set('parentId', e.target.value || null)}>
              <option value="">{i.t('none')}</option>
              {goals.filter((x) => LEVELS.indexOf(x.level) < LEVELS.indexOf(g.level)).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </select>
          </Field>
          <Field label={i.t('start_date')} error={err.startDate}><input type="date" className="input" value={g.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label={i.t('deadline')} error={err.deadline}><input type="date" className="input" value={g.deadline ?? ''} onChange={(e) => set('deadline', e.target.value || null)} /></Field>
          <Field label={i.t('deadline_time')} hint={i.t('optional')}><input type="time" className="input" value={g.deadlineTime ?? ''} onChange={(e) => set('deadlineTime', e.target.value || null)} /></Field>
          <Field label={i.t('time_zone')} hint={i.t('optional')}><input className="input" value={g.deadlineTimeZone ?? ''} placeholder={data.settings.timeZone} onChange={(e) => set('deadlineTimeZone', e.target.value || null)} dir="ltr" /></Field>
        </div>
        {windowDays != null && <p className="small muted" style={{ margin: 0 }}>{i.t('window_available', { a: i.date(g.startDate), b: i.date(g.deadline!), n: windowDays })}</p>}
        {parent?.deadline && g.deadline && g.deadline > parent.deadline && <div className="banner warn">{i.t('child_after_parent', { d: i.date(parent.deadline) })}</div>}
        {outside && (
          <div className="banner warn stack">
            <span>{i.t('outside_year')}</span>
            {otherPlans.map((p) => <button key={p.id} className="btn small" onClick={() => moveToPlan(p.id)}>{i.t('move_to_plan')}: {p.label}</button>)}
          </div>
        )}
        {goal && goal.deadline !== g.deadline && <Field label={i.t('reschedule_reason')}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} dir="auto" /></Field>}
        <fieldset className="panel" style={{ margin: 0 }}>
          <legend>{i.t('success_metric')}</legend>
          <div className="stack">
            <MeasurePicker value={g.successMetric.measure} onChange={(m) => set('successMetric', { ...g.successMetric, measure: m, target: m.type === 'binary' ? 1 : g.successMetric.target })} />
            <div className="formgrid">
              {g.successMetric.measure.type !== 'binary' && (
                <Field label={i.t('target')}><input type="number" min={0} step="any" className="input" value={g.successMetric.target} onChange={(e) => set('successMetric', { ...g.successMetric, target: Number(e.target.value) })} /></Field>
              )}
              {g.successMetric.measure.type !== 'binary' && (
                <Field label={i.t('aggregate')}>
                  <select className="input" value={g.successMetric.aggregate ?? 'latest'} onChange={(e) => set('successMetric', { ...g.successMetric, aggregate: e.target.value as 'latest' })}>
                    {(['latest', 'sum', 'max'] as const).map((a) => <option key={a} value={a}>{i.t(`agg_${a}`)}</option>)}
                  </select>
                </Field>
              )}
              <Field label={i.t('success_desc')}><input className="input" value={g.successMetric.description ?? ''} onChange={(e) => set('successMetric', { ...g.successMetric, description: e.target.value })} dir="auto" /></Field>
            </div>
            <span className="small muted">{i.t('outcome_explain')}</span>
          </div>
        </fieldset>
        <div className="formgrid">
          <Field label={i.t('priority')}>
            <select className="input" value={g.priority} onChange={(e) => set('priority', Number(e.target.value) as 1)}>
              {[1, 2, 3].map((p) => <option key={p} value={p}>{i.t(`p${p}` as 'p1')}</option>)}
            </select>
          </Field>
          <Field label={i.t('weight')} hint={i.t('weight_hint')}><input type="number" min={0} step="any" className="input" value={g.weight ?? ''} onChange={(e) => set('weight', e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label={i.t('status')}>
            <select className="input" value={g.status} onChange={(e) => set('status', e.target.value as Goal['status'])}>
              {(['active', 'done', 'paused', 'archived'] as const).map((s) => <option key={s} value={s}>{i.t(`gs_${s}`)}</option>)}
            </select>
          </Field>
          <Field label={i.t('capacity')} hint={i.t('optional')}><input type="number" min={0} step="any" className="input" value={g.weeklyCapacityHours ?? ''} onChange={(e) => set('weeklyCapacityHours', e.target.value ? Number(e.target.value) : null)} /></Field>
        </div>
        {load.map((w) => <div key={w.weekStart} className="banner warn">{i.t('capacity_warn', { w: i.date(w.weekStart), p: w.plannedHours, c: w.capacityHours })}</div>)}
        <Field label={i.t('notes')}><textarea className="input" value={g.notes} onChange={(e) => set('notes', e.target.value)} dir="auto" /></Field>
        {g.deadlineHistory.length > 0 && (
          <details><summary className="small">{i.t('deadline_history')}</summary>
            <ul className="small muted">{g.deadlineHistory.map((h, k) => <li key={k}>{h.deadline ? i.date(h.deadline) : i.t('no_deadline')} — {i.dateTime(h.changedAt)} {h.reason && <bdi>({h.reason})</bdi>}</li>)}</ul>
          </details>
        )}
      </div>
    </Dialog>
  );
}

// ---------------- Task ----------------
export function TaskForm({ task, goalId, defaultDate, onClose }: { task?: Task; goalId?: string; defaultDate?: string; onClose: () => void }) {
  const { data, save, i, today } = useApp();
  const [t, setT] = useState<Task>(() => task ?? newTask({ goalId: goalId ?? '', title: '', dueDate: defaultDate ?? today }));
  const [err, setErr] = useState('');
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setT((x) => ({ ...x, [k]: v }));
  const goal = data.goals.find((g) => g.id === t.goalId);
  const submit = () => {
    if (!t.title.trim() || !t.goalId) return setErr(i.t('validation_required'));
    let row = t;
    if (task && task.dueDate !== t.dueDate) row = { ...t, rescheduleHistory: [...t.rescheduleHistory, { dueDate: task.dueDate, changedAt: nowISO() }] };
    if (save('tasks', row)) onClose();
  };
  return (
    <Dialog title={task ? i.t('edit') : i.t('new_task')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{i.t('cancel')}</button><button className="btn primary" onClick={submit}>{i.t('save')}</button></>}>
      <div className="stack">
        <Field label={i.t('title')} error={err}><input className="input" value={t.title} onChange={(e) => set('title', e.target.value)} dir="auto" /></Field>
        <Field label={i.t('goal')}>
          <select className="input" value={t.goalId} onChange={(e) => set('goalId', e.target.value)}>
            <option value="">{i.t('select_goal')}</option>
            {aliveGoals(data).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        <div className="formgrid">
          <Field label={i.t('due_date')}><input type="date" className="input" value={t.dueDate} onChange={(e) => set('dueDate', e.target.value)} /></Field>
          <Field label={i.t('weight')} hint={i.t('weight_hint')}><input type="number" min={0} step="any" className="input" value={t.weight ?? ''} onChange={(e) => set('weight', e.target.value ? Number(e.target.value) : null)} /></Field>
        </div>
        {goal?.deadline && t.dueDate > goal.deadline && <div className="banner warn">{i.t('child_after_parent', { d: i.date(goal.deadline) })}</div>}
        <MeasurePicker value={t.measure} onChange={(m) => setT((x) => ({ ...x, measure: m, target: m.type === 'binary' ? 1 : x.target }))} />
        {t.measure.type !== 'binary' && <Field label={i.t('target')}><input type="number" min={0} step="any" className="input" value={t.target} onChange={(e) => set('target', Number(e.target.value) || 1)} /></Field>}
        {t.rescheduleHistory.length > 0 && <p className="small muted">{i.t('deadline_history')}: {t.rescheduleHistory.map((h) => i.date(h.dueDate)).join('، ')}</p>}
      </div>
    </Dialog>
  );
}

// ---------------- Habit ----------------
export function HabitForm({ habit, goalId, onClose }: { habit?: Habit; goalId?: string; onClose: () => void }) {
  const { data, saveMany, i, today, plan } = useApp();
  const versions = habit ? data.habitSchedules.filter((s) => s.habitId === habit.id && !s.deletedAt).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1)) : [];
  const current = versions[versions.length - 1];
  const [h, setH] = useState<Habit>(() => habit ?? newHabit({ title: '', goalIds: goalId ? [goalId] : [] }));
  const [rule, setRule] = useState<ScheduleRule>(current?.rule ?? { kind: 'daily' });
  const [target, setTarget] = useState<number>(current?.target ?? 1);
  const [minimum, setMinimum] = useState<number | null>(current?.minimum ?? null);
  const [from, setFrom] = useState<string>(habit ? today : plan && today < plan.startDate ? plan.startDate : today);
  const [err, setErr] = useState('');
  const binary = h.measure.type === 'binary';

  const scheduleChanged = !current || JSON.stringify(current.rule) !== JSON.stringify(rule) || current.target !== target || current.minimum !== minimum;

  const submit = () => {
    if (!h.title.trim()) return setErr(i.t('validation_required'));
    const items: { table: 'habits' | 'habitSchedules'; row: Habit | HabitSchedule }[] = [{ table: 'habits', row: { ...h, title: h.title.trim() } }];
    if (scheduleChanged) {
      const same = versions.find((v) => v.effectiveFrom === from);
      const t = binary ? 1 : Math.max(target, 0.0001);
      if (same) items.push({ table: 'habitSchedules', row: { ...same, rule, target: t, minimum } });
      else items.push({ table: 'habitSchedules', row: newSchedule({ habitId: h.id, effectiveFrom: from, rule, target: t, minimum }) });
    }
    if (saveMany(items)) onClose();
  };

  const toggleDay = (d: Weekday) => rule.kind === 'weekdays' && setRule({ ...rule, days: rule.days.includes(d) ? rule.days.filter((x) => x !== d) : [...rule.days, d].sort() as Weekday[] });

  return (
    <Dialog title={habit ? i.t('edit') : i.t('new_habit')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{i.t('cancel')}</button><button className="btn primary" onClick={submit}>{i.t('save')}</button></>}>
      <div className="stack">
        <Field label={i.t('title')} error={err}><input className="input" value={h.title} onChange={(e) => setH({ ...h, title: e.target.value })} dir="auto" /></Field>
        <Field label={i.t('cue')}><input className="input" value={h.cue} onChange={(e) => setH({ ...h, cue: e.target.value })} placeholder={i.t('cue_ph')} dir="auto" /></Field>
        <MeasurePicker value={h.measure} onChange={(m) => setH({ ...h, measure: m })} />
        <fieldset className="panel" style={{ margin: 0 }}>
          <legend>{i.t('schedule')}</legend>
          <div className="stack">
            <select className="input" value={rule.kind} aria-label={i.t('schedule')} onChange={(e) => {
              const k = e.target.value as ScheduleRule['kind'];
              setRule(k === 'daily' ? { kind: 'daily' } : k === 'weekdays' ? { kind: 'weekdays', days: [0, 1, 2, 3, 4] } : k === 'perPeriod' ? { kind: 'perPeriod', period: 'week', count: 3 } : { kind: 'everyNDays', n: 8, anchor: from });
            }}>
              {(['daily', 'weekdays', 'perPeriod', 'everyNDays'] as const).map((k) => <option key={k} value={k}>{i.t(`r_${k}`)}</option>)}
            </select>
            {rule.kind === 'weekdays' && (
              <div className="row" role="group" aria-label={i.t('r_weekdays')}>
                {([6, 0, 1, 2, 3, 4, 5] as Weekday[]).map((d) => (
                  <button key={d} type="button" className={`btn small${rule.days.includes(d) ? ' primary' : ''}`} aria-pressed={rule.days.includes(d)} onClick={() => toggleDay(d)}>{i.weekdays[d]}</button>
                ))}
              </div>
            )}
            {rule.kind === 'perPeriod' && (
              <div className="row">
                <input type="number" min={1} className="input" style={{ width: 90 }} value={rule.count} aria-label={i.t('times')} onChange={(e) => setRule({ ...rule, count: Math.max(1, Number(e.target.value) || 1) })} />
                <span>{i.t('times')}</span>
                <select className="input" style={{ width: 'auto' }} value={rule.period} onChange={(e) => setRule({ ...rule, period: e.target.value as 'week' })}>
                  <option value="week">{i.t('per_week')}</option><option value="month">{i.t('per_month')}</option>
                </select>
              </div>
            )}
            {rule.kind === 'everyNDays' && (
              <div className="formgrid">
                <Field label={i.t('every_n', { n: '' }).trim()}><input type="number" min={1} className="input" value={rule.n} onChange={(e) => setRule({ ...rule, n: Math.max(1, Number(e.target.value) || 1) })} /></Field>
                <Field label={i.t('anchor')}><input type="date" className="input" value={rule.anchor} onChange={(e) => setRule({ ...rule, anchor: e.target.value })} /></Field>
              </div>
            )}
            <div className="formgrid">
              {!binary && <Field label={i.t('per_occurrence')}><input type="number" min={0} step="any" className="input" value={target} onChange={(e) => setTarget(Number(e.target.value))} /></Field>}
              {!binary && rule.kind !== 'perPeriod' && <Field label={i.t('minimum')} hint={i.t('optional')}><input type="number" min={0} step="any" className="input" value={minimum ?? ''} onChange={(e) => setMinimum(e.target.value ? Number(e.target.value) : null)} /></Field>}
              <Field label={i.t('effective_from')}><input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            </div>
            {habit && <span className="small muted">{i.t('schedule_change_note')}</span>}
            {versions.length > 0 && (
              <details><summary className="small">{i.t('schedule_history')}</summary>
                <ul className="small muted">{versions.map((v) => <li key={v.id}>{i.date(v.effectiveFrom)}: {i.t(`r_${v.rule.kind}`)} — {i.num(v.target, 2)}{v.minimum != null ? ` / ${i.num(v.minimum, 2)}` : ''}</li>)}</ul>
              </details>
            )}
          </div>
        </fieldset>
        <Field label={i.t('linked_goals')}>
          <select multiple className="input" style={{ minHeight: 96 }} value={h.goalIds} onChange={(e) => setH({ ...h, goalIds: [...e.target.selectedOptions].map((o) => o.value) })}>
            {aliveGoals(data).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        <Field label={i.t('weight')} hint={i.t('weight_hint')}><input type="number" min={0} step="any" className="input" value={h.weight ?? ''} onChange={(e) => setH({ ...h, weight: e.target.value ? Number(e.target.value) : null })} /></Field>
      </div>
    </Dialog>
  );
}

export function ExceptionForm({ habitId, onClose }: { habitId: string; onClose: () => void }) {
  const { save, i, today } = useApp();
  const [kind, setKind] = useState<'rest' | 'pause'>('rest');
  const [a, setA] = useState(today);
  const [b, setB] = useState(today);
  const [note, setNote] = useState('');
  const submit = () => {
    if (b < a) return;
    const row: HabitException = { ...newRow(), habitId, startDate: a, endDate: addDays(b, 1), kind, note };
    if (save('habitExceptions', row)) onClose();
  };
  return (
    <Dialog title={i.t('add_exception')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{i.t('cancel')}</button><button className="btn primary" onClick={submit}>{i.t('save')}</button></>}>
      <div className="stack">
        <div className="row">
          {(['rest', 'pause'] as const).map((k) => <button key={k} className={`btn small${kind === k ? ' primary' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{i.t(k)}</button>)}
        </div>
        <div className="formgrid">
          <Field label={i.t('from')}><input type="date" className="input" value={a} onChange={(e) => setA(e.target.value)} /></Field>
          <Field label={i.t('to_incl')}><input type="date" className="input" value={b} onChange={(e) => setB(e.target.value)} /></Field>
        </div>
        <Field label={i.t('note')}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} dir="auto" /></Field>
        <p className="small muted">{i.t('exception_effect')}</p>
      </div>
    </Dialog>
  );
}

export function ResultForm({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const { save, i, today } = useApp();
  const [v, setV] = useState(goal.successMetric.measure.type === 'binary' ? 1 : 0);
  const [d, setD] = useState(today);
  const [note, setNote] = useState('');
  return (
    <Dialog title={i.t('record_result')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{i.t('cancel')}</button><button className="btn primary" onClick={() => save('outcomeResults', { ...newRow(), goalId: goal.id, date: d, value: v, note }) && onClose()}>{i.t('save')}</button></>}>
      <div className="stack">
        <p className="small muted">{goal.successMetric.description || i.t('outcome_explain')}</p>
        <div className="formgrid">
          <Field label={i.t('result_value')}>
            {goal.successMetric.measure.type === 'binary'
              ? <select className="input" value={v} onChange={(e) => setV(Number(e.target.value))}><option value={1}>✓ {i.t('outcome_achieved')}</option><option value={0}>✗</option></select>
              : <input type="number" step="any" className="input" value={v} onChange={(e) => setV(Number(e.target.value))} />}
          </Field>
          <Field label={i.t('date')}><input type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} /></Field>
        </div>
        <Field label={i.t('note')}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} dir="auto" /></Field>
      </div>
    </Dialog>
  );
}

// ---------------- Reschedule overdue tasks (preview → apply) ----------------
export function RescheduleButton() {
  const { data, i, today } = useApp();
  const [open, setOpen] = useState(false);
  const overdue = data.tasks.filter((t) => !t.deletedAt && t.dueDate < today && !data.logs.some((l) => l.taskId === t.id && !l.deletedAt && l.kind === 'progress'));
  if (!overdue.length) return null;
  return (
    <>
      <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>{i.t('reschedule_overdue', { n: overdue.length })}</button>
      {open && <RescheduleDialog tasks={overdue} onClose={() => setOpen(false)} />}
    </>
  );
}

function RescheduleDialog({ tasks, onClose }: { tasks: Task[]; onClose: () => void }) {
  const { data, saveMany, i, today } = useApp();
  const [start, setStart] = useState(today);
  const [picked, setPicked] = useState(() => new Set(tasks.map((t) => t.id)));
  const sel = tasks.filter((t) => picked.has(t.id)).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  const plan = sel.map((t, k) => {
    const nd = addDays(start, k);
    const g = data.goals.find((x) => x.id === t.goalId);
    return { t, nd, late: !!(g?.deadline && nd > g.deadline) };
  });
  const apply = () => {
    if (saveMany(plan.map(({ t, nd }) => ({ table: 'tasks' as const, row: { ...t, dueDate: nd, rescheduleHistory: [...t.rescheduleHistory, { dueDate: t.dueDate, changedAt: nowISO() }] } })))) {
      toast(i.t('saved_toast'));
      onClose();
    }
  };
  return (
    <Dialog title={i.t('reschedule')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{i.t('cancel')}</button><button className="btn primary" disabled={!sel.length} onClick={apply}>{i.t('apply')}</button></>}>
      <Field label={i.t('reschedule_start')}><input type="date" className="input" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></Field>
      <h3 style={{ marginTop: 12 }}>{i.t('reschedule_preview')}</h3>
      <ul style={{ listStyle: 'none', padding: 0 }} className="stack">
        {tasks.map((t) => {
          const p = plan.find((x) => x.t.id === t.id);
          return (
            <li key={t.id} className="row">
              <input type="checkbox" checked={picked.has(t.id)} aria-label={t.title} onChange={(e) => { const n = new Set(picked); e.target.checked ? n.add(t.id) : n.delete(t.id); setPicked(n); }} />
              <bdi>{t.title}</bdi>
              <span className="small muted">{i.date(t.dueDate)}{p ? ` → ${i.date(p.nd)}` : ''}</span>
              {p?.late && <span className="chip warn">{i.t('reschedule_after_deadline')}</span>}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
