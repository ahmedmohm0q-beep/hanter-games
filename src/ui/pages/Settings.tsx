import { useState } from 'react';
import { addMonthsClamped, isValidTimeZone, addDays } from '../../domain/dates';
import { startChangeImpact } from '../../domain/periods';
import type { Settings, Weekday } from '../../domain/types';
import { newPlanYear, nowISO } from '../../data/model';
import { download, exportJSON, importRows, previewImport, toCSV, type ImportPreview } from '../../data/exportImport';
import { useApp } from '../ctx';
import { IS_PREVIEW } from '../App';
import { Dialog, Field, toast } from '../components/common';

export function SettingsPage({ onSignOut, onLeave }: { onSignOut?: () => void; onLeave: () => void }) {
  const { data, save, saveMany, i, repo, plan } = useApp();
  const s = data.settings;
  const set = (patch: Partial<Settings>) => save('settings', { ...s, ...patch });
  const [tz, setTz] = useState(s.timeZone);
  const [startEdit, setStartEdit] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [newYear, setNewYear] = useState(false);
  const [armed, setArmed] = useState(false);

  const allDates = [...data.logs.filter((l) => !l.deletedAt).map((l) => l.date)];
  const impact = startEdit && plan ? startChangeImpact(plan.startDate, startEdit, allDates) : null;

  const applyStart = () => {
    if (!plan || !startEdit) return;
    save('planYears', { ...plan, startDate: startEdit, startHistory: [...plan.startHistory, { startDate: plan.startDate, changedAt: nowISO() }] });
    setStartEdit(null);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setPreview(previewImport(await f.text(), data));
  };
  const applyImport = () => {
    if (!preview?.data) return;
    const rows = importRows(preview.data, data);
    if (rows.length) saveMany(rows as never);
    toast(`${i.t('import_done')}: ${rows.length}`);
    setPreview(null);
  };

  const logsCSV = () => {
    const rows = data.logs.filter((l) => !l.deletedAt).map((l) => ({
      date: l.date, habit: data.habits.find((h) => h.id === l.habitId)?.title ?? '', task: data.tasks.find((t) => t.id === l.taskId)?.title ?? '',
      amount: l.amount, kind: l.kind, note: l.note, source: l.source, updatedAt: l.updatedAt, id: l.id,
    }));
    download(`hanter-logs-${addDays(new Date().toISOString().slice(0, 10), 0)}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  };

  return (
    <div className="page">
      <h1>{i.t('nav_settings')}</h1>
      <section className="panel">
        <div className="formgrid">
          <Field label={i.t('language')}>
            <select className="input" value={s.locale} onChange={(e) => set({ locale: e.target.value as 'ar' })}><option value="ar">العربية</option><option value="en">English</option></select>
          </Field>
          <Field label={i.t('theme')}>
            <select className="input" value={s.theme} onChange={(e) => set({ theme: e.target.value as 'dark' })}>
              {(['dark', 'light', 'system'] as const).map((x) => <option key={x} value={x}>{i.t(`th_${x}`)}</option>)}
            </select>
          </Field>
          <Field label={i.t('week_start')}>
            <select className="input" value={s.weekStartsOn} onChange={(e) => set({ weekStartsOn: Number(e.target.value) as Weekday })}>
              {i.weekdays.map((w, k) => <option key={k} value={k}>{w}</option>)}
            </select>
          </Field>
          <Field label={i.t('time_zone')} error={tz && !isValidTimeZone(tz) ? 'IANA?' : undefined}>
            <input className="input" dir="ltr" value={tz} onChange={(e) => setTz(e.target.value)} onBlur={() => isValidTimeZone(tz) && tz !== s.timeZone && set({ timeZone: tz })} list="tzlist" />
            <datalist id="tzlist">{['Asia/Dubai', 'Africa/Cairo', 'Asia/Riyadh', 'Europe/London', 'America/New_York', 'UTC'].map((z) => <option key={z} value={z} />)}</datalist>
          </Field>
          <Field label={i.t('motion')}>
            <select className="input" value={s.reducedMotion} onChange={(e) => set({ reducedMotion: e.target.value as 'on' })}>
              {(['system', 'on', 'off'] as const).map((x) => <option key={x} value={x}>{i.t(`mo_${x}`)}</option>)}
            </select>
          </Field>
          <label className="field"><span>{i.t('sound')}</span><input type="checkbox" checked={s.sound} onChange={(e) => set({ sound: e.target.checked })} style={{ width: 24, height: 24 }} /></label>
          <label className="field"><span>{i.t('gamification')}</span><input type="checkbox" checked={s.gamification} onChange={(e) => set({ gamification: e.target.checked })} style={{ width: 24, height: 24 }} /></label>
        </div>
      </section>

      <section className="panel">
        <h2>{i.t('plan_years')}</h2>
        <div className="stack">
          {data.planYears.filter((p) => !p.deletedAt).map((p) => (
            <div key={p.id} className="row between">
              <span><bdi>{p.label}</bdi> — {i.date(p.startDate)} → {i.date(addDays(addMonthsClamped(p.startDate, 12), -1))} {p.id === plan?.id && <span className="chip green">{i.t('active')}</span>} {p.archived && <span className="chip">{i.t('gs_archived')}</span>}</span>
              <span className="row">
                {p.id !== plan?.id && <button className="btn small" onClick={() => set({ activePlanYearId: p.id })}>{i.t('make_active')}</button>}
                {p.id === plan?.id && <button className="btn small" onClick={() => setStartEdit(p.startDate)}>{i.t('change_start')}</button>}
                <button className="btn small ghost" onClick={() => save('planYears', { ...p, archived: !p.archived })}>{p.archived ? i.t('unarchive') : i.t('archive')}</button>
              </span>
            </div>
          ))}
          <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setNewYear(true)}>＋ {i.t('new_year')}</button>
        </div>
      </section>

      <section className="panel stack">
        <h2>{i.t('trend_settings')}</h2>
        <div className="formgrid">
          {([['windowDays', 'window_days', 1], ['improveThresholdPP', 'improve_pp', 1], ['declineThresholdPP', 'decline_pp', 1], ['minDue', 'min_due', 1]] as const).map(([k, label]) => (
            <Field key={k} label={i.t(label)}><input type="number" className="input" value={s.trend[k]} onChange={(e) => set({ trend: { ...s.trend, [k]: Number(e.target.value) } })} /></Field>
          ))}
          <Field label={i.t('min_coverage')}><input type="number" min={0} max={100} className="input" value={Math.round(s.trend.minCoverage * 100)} onChange={(e) => set({ trend: { ...s.trend, minCoverage: Number(e.target.value) / 100 } })} /></Field>
        </div>
      </section>

      <section className="panel stack">
        <h2>{i.t('reminders')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{i.t('reminders_note')}</p>
        <div className="formgrid">
          <label className="field"><span>{i.t('reminders')}</span><input type="checkbox" checked={s.reminders.enabled} onChange={(e) => set({ reminders: { ...s.reminders, enabled: e.target.checked } })} style={{ width: 24, height: 24 }} /></label>
          <Field label={`${i.t('quiet_hours')} (${i.t('from')})`}><input type="time" className="input" value={s.reminders.quietStart} onChange={(e) => set({ reminders: { ...s.reminders, quietStart: e.target.value } })} /></Field>
          <Field label={`${i.t('quiet_hours')} (${i.t('to_incl')})`}><input type="time" className="input" value={s.reminders.quietEnd} onChange={(e) => set({ reminders: { ...s.reminders, quietEnd: e.target.value } })} /></Field>
          <Field label={i.t('max_per_day')}><input type="number" min={0} className="input" value={s.reminders.maxPerDay} onChange={(e) => set({ reminders: { ...s.reminders, maxPerDay: Number(e.target.value) } })} /></Field>
        </div>
      </section>

      <section className="panel stack">
        <h2>{i.t('data')}</h2>
        {IS_PREVIEW && <p className="small muted" style={{ margin: 0 }}>{i.t('preview_files_note')}</p>}
        <div className="row">
          <button className="btn" onClick={() => download('hanter-games-backup.json', exportJSON(data), 'application/json')}>{i.t('export_json')}</button>
          <button className="btn" onClick={logsCSV}>{i.t('export_csv')}</button>
          <label className="btn">{i.t('import_json')}<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </div>
      </section>

      <section className="panel stack">
        <h2>{i.t('account')}</h2>
        <p className="small" style={{ margin: 0 }}>{i.t('storage_mode')}: {i.t(repo.mode === 'cloud' ? 'mode_cloud' : repo.mode === 'demo' ? 'mode_demo' : 'mode_local')}</p>
        <div className="row">
          {repo.mode === 'cloud' && onSignOut && <button className="btn" onClick={onSignOut}>{i.t('sign_out')}</button>}
          {repo.mode === 'demo' && <button className="btn" onClick={onLeave}>{i.t('leave_demo')}</button>}
          {repo.mode === 'local' && (armed
            ? <><span className="small">{i.t('confirm_reset')}</span><button className="btn danger" onClick={onLeave}>{i.t('reset_local')}</button><button className="btn" onClick={() => setArmed(false)}>{i.t('cancel')}</button></>
            : <button className="btn danger" onClick={() => setArmed(true)}>{i.t('reset_local')}</button>)}
        </div>
      </section>

      {startEdit && impact && (
        <Dialog title={i.t('change_start')} onClose={() => setStartEdit(null)} footer={<><button className="btn" onClick={() => setStartEdit(null)}>{i.t('cancel')}</button><button className="btn primary" onClick={applyStart}>{i.t('apply')}</button></>}>
          <Field label={i.t('start_date')}><input type="date" className="input" value={startEdit} onChange={(e) => e.target.value && setStartEdit(e.target.value)} /></Field>
          <h3 style={{ marginTop: 12 }}>{i.t('impact_title')}</h3>
          <p className="small">{i.date(impact.oldRange.start)} → {i.date(impact.newRange.start)}</p>
          <ul className="small">
            {impact.leaving.length > 0 && <li>{i.t('impact_leaving', { n: impact.leaving.length })}</li>}
            {impact.entering.length > 0 && <li>{i.t('impact_entering', { n: impact.entering.length })}</li>}
            {impact.movedMonth.length > 0 && <li>{i.t('impact_moved', { n: impact.movedMonth.length })}</li>}
            {!impact.leaving.length && !impact.entering.length && !impact.movedMonth.length && <li>{i.t('impact_none')}</li>}
          </ul>
        </Dialog>
      )}
      {newYear && <NewYearDialog onClose={() => setNewYear(false)} />}
      {preview && (
        <Dialog title={i.t('import_preview')} onClose={() => setPreview(null)} footer={preview.ok ? <><button className="btn" onClick={() => setPreview(null)}>{i.t('cancel')}</button><button className="btn primary" onClick={applyImport}>{i.t('import_apply')}</button></> : undefined}>
          {!preview.ok ? <div className="banner alert">{i.t('import_error', { e: preview.error ?? '' })}</div> : (
            <div className="tablewrap"><table className="data">
              <thead><tr><th></th><th>{i.t('import_new')}</th><th>{i.t('import_dup')}</th><th>{i.t('import_newer')}</th></tr></thead>
              <tbody>{Object.entries(preview.counts).filter(([, c]) => c.incoming).map(([t, c]) => <tr key={t}><td>{t}</td><td className="num">{c.newRows}</td><td className="num">{c.duplicates}</td><td className="num">{c.newerIncoming}</td></tr>)}</tbody>
            </table></div>
          )}
        </Dialog>
      )}
    </div>
  );
}

function NewYearDialog({ onClose }: { onClose: () => void }) {
  const { data, saveMany, i, plan } = useApp();
  const [start, setStart] = useState(plan ? addMonthsClamped(plan.startDate, 12) : new Date().toISOString().slice(0, 10));
  const [label, setLabel] = useState('');
  const create = () => {
    const py = newPlanYear(start, label || start.slice(0, 4));
    if (saveMany([{ table: 'planYears', row: py }, { table: 'settings', row: { ...data.settings, activePlanYearId: py.id } }])) onClose();
  };
  return (
    <Dialog title={i.t('new_year')} onClose={onClose} footer={<><button className="btn" onClick={onClose}>{i.t('cancel')}</button><button className="btn primary" onClick={create}>{i.t('create_plan')}</button></>}>
      <div className="formgrid">
        <Field label={i.t('plan_label')}><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} dir="auto" /></Field>
        <Field label={i.t('start_date')} hint={i.t('start_explain', { last: i.date(addDays(addMonthsClamped(start, 12), -1)) })}><input type="date" className="input" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
