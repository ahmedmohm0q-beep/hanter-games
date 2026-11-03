import { useMemo } from 'react';
import { addDays, isValidISO } from '../../domain/dates';
import { lastDay, periodFor, type PeriodType } from '../../domain/periods';
import { activityCount, commitment, goalProgress, planProgress } from '../../domain/progress';
import { occurrencesFor, type EvaluatedOccurrence } from '../../domain/schedule';
import { recoveries, trend } from '../../domain/trend';
import { badges, entitlements, levelFor, totalXP } from '../../domain/rewards';
import { aliveGoals, useApp } from '../ctx';
import { go, href } from '../router';
import { Trail } from '../components/common';
import { IS_PREVIEW } from '../App';
import { RescheduleButton } from '../components/Forms';

export function MetricCards({ occ }: { occ: EvaluatedOccurrence[] }) {
  const { i, data } = useApp();
  const c = commitment(occ);
  const p = planProgress(occ);
  const name = (o: EvaluatedOccurrence) => (o.habitId ? data.habits.find((h) => h.id === o.habitId)?.title : data.tasks.find((t) => t.id === o.taskId)?.title) ?? '';
  return (
    <div className="grid two" style={{ marginBottom: 14 }}>
      <section className="panel metric" aria-label={i.t('commitment')}>
        <h2>{i.t('commitment')}</h2>
        {c.ratio == null ? <span className="big empty">{i.t('no_items')}</span> : <span className="big">{i.pct(c.ratio)}</span>}
        <Trail ratio={c.ratio} label={i.t('commitment')} />
        <span className="small muted">{i.t('commitment_help')}</span>
        <span className="small">{i.t('coverage')}: <span className="num">{i.pct(c.coverage)}</span> · {i.t('due_count')}: <span className="num">{c.dueCount}</span> · {i.t('open_count')}: <span className="num">{c.openCount}</span></span>
        <details>
          <summary className="small">{i.t('breakdown')}</summary>
          <div className="small stack" style={{ marginTop: 6 }}>
            <span className="num">{i.t('numerator')}: {i.num(c.numerator, 2)} · {i.t('denominator')}: {i.num(c.denominator, 2)}</span>
            <span>{i.t('calc_text')}</span>
            {c.unrecorded.length > 0 && <div><strong>{i.t('unrecorded_list')} ({c.unrecorded.length})</strong><ul>{c.unrecorded.slice(0, 30).map((o) => <li key={o.key}><a href={href(`/day/${o.kind === 'quota' ? o.range.start : o.date}`, { focus: o.key })}>{i.date(o.date)}</a> — <bdi>{name(o)}</bdi></li>)}</ul></div>}
            {c.excluded.length > 0 && <div><strong>{i.t('excluded')} ({c.excluded.length})</strong><ul>{c.excluded.slice(0, 30).map((o) => <li key={o.key}>{i.date(o.date)} — <bdi>{name(o)}</bdi> ({i.t(o.excluded === 'paused' ? 'st_paused' : 'st_rest')})</li>)}</ul></div>}
          </div>
        </details>
      </section>
      <section className="panel metric" aria-label={i.t('plan_progress')}>
        <h2>{i.t('plan_progress')}</h2>
        {p.ratio == null ? <span className="big empty">{i.t('no_items')}</span> : <span className="big">{i.pct(p.ratio)}</span>}
        <Trail ratio={p.ratio} expected={p.expected} label={i.t('plan_progress')} />
        <span className="small muted">{i.t('plan_help')}</span>
        {p.gapPP != null && (
          <span className={`chip ${p.gapPP > 2 ? 'warn' : p.gapPP < -2 ? 'green' : ''}`} style={{ alignSelf: 'flex-start' }}>
            {p.gapPP > 2 ? i.t('gap_behind', { n: i.num(p.gapPP, 1) }) : p.gapPP < -2 ? i.t('gap_ahead', { n: i.num(-p.gapPP, 1) }) : i.t('on_plan')}
          </span>
        )}
        <span className="small">{i.t('expected_by_now')}: <span className="num">{i.pct(p.expected)}</span></span>
      </section>
    </div>
  );
}

export function TrendCard({ filter }: { filter?: { habitIds?: string[] } }) {
  const { data, i, today, opt } = useApp();
  const s = data.settings.trend;
  const tr = trend(data, today, s, opt, filter);
  const cls = tr.verdict === 'improving' ? 'green' : tr.verdict === 'declining' ? 'warn' : tr.verdict === 'steady' ? 'info' : '';
  const plan = planProgress(occurrencesFor(data, { range: periodFor('month', today, opt.planStart ?? today, data.settings.weekStartsOn), today, ...filter }, opt));
  return (
    <section className="panel stack" aria-label={i.t('trend')}>
      <div className="row between"><h2>{i.t('trend')}</h2><span className={`chip ${cls}`}>{i.t(`tr_${tr.verdict}`)}</span></div>
      <p className="small" style={{ margin: 0 }}>
        {i.t('trend_detail', { n: s.windowDays, a: i.pct(tr.recent.ratio), ad: tr.recent.dueCount, b: i.pct(tr.previous.ratio), bd: tr.previous.dueCount, d: tr.deltaPP == null ? '—' : `${tr.deltaPP > 0 ? '+' : ''}${i.num(tr.deltaPP, 1)}` })}
      </p>
      <p className="small muted" style={{ margin: 0 }}>{i.date(tr.recent.start)} → {i.date(tr.recent.end)} · {i.date(tr.previous.start)} → {i.date(tr.previous.end)}</p>
      {tr.reasons.map((r) => <span key={r} className="small muted">• {i.t(`reason_${r}` as 'reason_fewDueRecent')}</span>)}
      {tr.verdict === 'improving' && <div className="banner gold">{i.t('tr_msg_improving')}</div>}
      {tr.verdict === 'declining' && <div className="banner warn">{i.t('tr_msg_declining')} <a href={href(`/day/${today}`)}>{i.t('open_day')}</a></div>}
      {plan.gapPP != null && plan.gapPP > 10 && <div className="banner warn">{i.t('tr_msg_behind', { n: i.num(plan.gapPP, 1) })}</div>}
      <RescheduleButton />
    </section>
  );
}

export function AnalyticsPage({ type, date, habitId }: { type: PeriodType; date: string; habitId: string | null }) {
  const { data, i, today, opt, plan } = useApp();
  const d = isValidISO(date) ? date : today;
  const p = periodFor(type, d, plan!.startDate, data.settings.weekStartsOn);
  const filter = habitId ? { habitIds: [habitId] } : undefined;
  const occ = useMemo(() => occurrencesFor(data, { range: p, today, ...filter, includeTasks: !habitId }, opt), [data, p.start, p.end, today, opt, habitId]); // eslint-disable-line
  const habits = data.habits.filter((h) => !h.deletedAt);
  const goals = aliveGoals(data).filter((g) => g.level === 'year' && g.planYearId === plan!.id);
  const recs = recoveries(occurrencesFor(data, { range: { start: p.start, end: today < p.end ? today : p.end }, today, includeTasks: false }, opt));
  const ents = entitlements(occurrencesFor(data, { range: { start: '2000-01-01', end: addDays(today, 1) }, today }, opt), data);
  const xp = totalXP(ents);
  const lv = levelFor(xp);
  const set = (q: Record<string, string | null>) => go('/analytics', { type, date: d, habit: habitId, ...q });

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 12 }}>
        <h1>{i.t('nav_analytics')}</h1>
        {!IS_PREVIEW && <button className="btn small noprint" onClick={() => window.print()}>{i.t('print')}</button>}
      </div>
      <div className="row noprint" style={{ marginBottom: 12 }}>
        {(['day', 'week', 'month', 'half', 'year'] as PeriodType[]).map((z) => (
          <button key={z} className={`btn small${z === type ? ' primary' : ''}`} aria-pressed={z === type} onClick={() => set({ type: z })}>{i.t(`nav_${z}` as 'nav_day')}</button>
        ))}
        <input type="date" className="input" style={{ width: 'auto' }} value={d} onChange={(e) => e.target.value && set({ date: e.target.value })} aria-label={i.t('range')} />
        <select className="input" style={{ width: 'auto' }} value={habitId ?? ''} onChange={(e) => set({ habit: e.target.value || null })} aria-label={i.t('habit')}>
          <option value="">{i.t('filter_all')}</option>
          {habits.map((h) => <option key={h.id} value={h.id}>{h.title}</option>)}
        </select>
      </div>
      <p className="muted small">{i.t('range')}: {i.date(p.start)} → {i.date(lastDay(p))} · {i.t('activity')}: <span className="num">{activityCount(data, p)}</span></p>
      <MetricCards occ={occ} />
      <TrendCard filter={filter} />

      <section className="panel">
        <h2>{i.t('per_habit')}</h2>
        <div className="tablewrap">
          <table className="data">
            <thead><tr><th>{i.t('habit')}</th><th>{i.t('commitment')}</th><th>{i.t('coverage')}</th><th>{i.t('plan_progress')}</th><th>{i.t('due_count')}</th></tr></thead>
            <tbody>
              {habits.map((h) => {
                const ho = occ.filter((o) => o.habitId === h.id);
                const c = commitment(ho);
                const pp = planProgress(ho);
                return (
                  <tr key={h.id}>
                    <td><a href={href('/analytics', { type, date: d, habit: h.id })}><bdi>{h.title}</bdi></a></td>
                    <td className="num">{c.ratio == null ? i.t('no_items') : i.pct(c.ratio)}</td>
                    <td className="num">{i.pct(c.coverage)}</td>
                    <td className="num">{i.pct(pp.ratio)}</td>
                    <td className="num">{c.dueCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {!habitId && (
        <section className="panel">
          <h2>{i.t('per_goal')}</h2>
          <p className="small muted">{i.t('outcome_help')}</p>
          <div className="tablewrap">
            <table className="data">
              <thead><tr><th>{i.t('goal')}</th><th>{i.t('commitment')}</th><th>{i.t('plan_progress')}</th><th>{i.t('expected_by_now')}</th><th>{i.t('outcome')}</th></tr></thead>
              <tbody>
                {goals.map((g) => {
                  const n = goalProgress(g.id, data, today, opt);
                  if (!n) return null;
                  return (
                    <tr key={g.id}>
                      <td><a href={href('/year', { focus: g.id })}><bdi>{g.title}</bdi></a></td>
                      <td className="num">{n.commit.ratio == null ? i.t('no_items') : i.pct(n.commit.ratio)}</td>
                      <td className="num">{i.pct(n.plan.ratio)}</td>
                      <td className="num">{i.pct(n.plan.expected)}</td>
                      <td>{n.outcome.achieved ? <span className="chip gold">{i.t('outcome_achieved')}</span> : n.outcome.ratio != null ? <span className="num">{i.pct(n.outcome.ratio)}</span> : <span className="muted small">{i.t('outcome_not_yet')}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {recs.length > 0 && (
        <section className="panel">
          <h2>{i.t('recoveries')}</h2>
          <ul className="small">{recs.map((r) => <li key={r.habitId + r.date}>{i.date(r.date)} — {i.t('recovery_item', { t: data.habits.find((h) => h.id === r.habitId)?.title ?? '', n: r.gap })}</li>)}</ul>
        </section>
      )}

      {data.settings.gamification && (
        <section className="panel">
          <div className="row between"><h2>{i.t('badges')}</h2><span className="chip gold num">{i.t('xp_level', { n: lv.level })} · {i.t('xp', { n: xp })}</span></div>
          <Trail ratio={lv.into / lv.needed} gold label="XP" />
          <p className="small muted">{i.t('xp_note')}</p>
          <div className="row">
            {badges(ents).map((b) => (
              <span key={b.id} className={`chip ${b.earned ? 'gold' : ''}`} title={`${b.progress}/${b.goal}`}>{b.earned ? '★' : '☆'} {i.t(`b_${b.id.replace(/-/g, '_')}` as 'b_comeback')} <span className="num">{b.progress}/{b.goal}</span></span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
