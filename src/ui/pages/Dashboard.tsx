import { useEffect, useMemo, useState } from 'react';
import library from '../../../quotes/library.json';
import { addDays } from '../../domain/dates';
import { dayPeriod } from '../../domain/periods';
import { commitment, goalProgress, planProgress } from '../../domain/progress';
import { planYearRange } from '../../domain/periods';
import { recoveries, trend } from '../../domain/trend';
import { badges, entitlements, levelFor, totalXP } from '../../domain/rewards';
import { occurrencesFor } from '../../domain/schedule';
import { quoteForDay, type Quote } from '../../domain/quotes';
import { suggestNext } from '../../domain/suggest';
import { newRow } from '../../data/model';
import { aliveGoals, useApp } from '../ctx';
import { href } from '../router';
import { Trail } from '../components/common';
import { HeatStrip, Reveal, Ring, Sparkline } from '../components/viz';

export const QUOTES = (library as { quotes: Quote[] }).quotes;

export function QuoteCard({ lang }: { lang: 'ar' | 'en' }) {
  const { data, i, today, plan, save } = useApp();
  const dq = quoteForDay(QUOTES, lang, today, plan!.startDate, data.quoteViews);
  // record what was shown, so every device shows the same quote today
  useEffect(() => {
    if (!dq.quote) return;
    if (data.quoteViews.some((v) => v.date === today && v.lang === lang && !v.deletedAt)) return;
    save('quoteViews', { ...newRow(), date: today, lang, quoteId: dq.quote.id });
  }, [today, lang, dq.quote?.id]); // eslint-disable-line
  if (!dq.quote) return <div className="panel"><p className="muted small">{i.t('quote_none')}</p></div>;
  const q = dq.quote;
  return (
    <figure className="panel quote" style={{ margin: 0 }}>
      <blockquote lang={q.lang} dir={q.lang === 'ar' ? 'rtl' : 'ltr'}>{q.text.split(/ \/ | \.\.\. /).map((l, k) => <span key={k} style={{ display: 'block' }}>{l}</span>)}</blockquote>
      <p className="tr" lang={q.lang === 'ar' ? 'en' : 'ar'} dir={q.lang === 'ar' ? 'ltr' : 'rtl'} style={{ margin: 0 }}>{q.translation}</p>
      <figcaption>
        <cite>
          <bdi>{q.author}</bdi> — <bdi>{q.work}</bdi> (<bdi>{q.year}</bdi>) · <a href={q.sourceUrl} target="_blank" rel="noopener noreferrer">{i.t('source')}</a> · {i.t(q.translationBy === 'app' ? 'translation_app' : 'translation_published')}
        </cite>
      </figcaption>
      {dq.repeated && <span className="small muted">{i.t('quote_repeated', { n: dq.librarySize })}</span>}
    </figure>
  );
}

function ReminderBanner({ open }: { open: number }) {
  const { data, i, today } = useApp();
  const r = data.settings.reminders;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!r.enabled || open === 0) return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const quiet = r.quietStart > r.quietEnd ? hm >= r.quietStart || hm < r.quietEnd : hm >= r.quietStart && hm < r.quietEnd;
    if (quiet) return;
    const k = `hg:rem:${today}`;
    let n = 0;
    try { n = Number(localStorage.getItem(k) ?? 0); } catch { /* storage unavailable */ }
    if (n >= r.maxPerDay) return;
    try { localStorage.setItem(k, String(n + 1)); } catch { /* ignore */ }
    setShown(true);
  }, [r.enabled, open, today]); // eslint-disable-line
  if (!shown) return null;
  return <div className="banner warn row between" role="status" style={{ marginBottom: 14 }}><span>{i.t('reminder_banner', { n: open })}</span><button className="btn small ghost" onClick={() => setShown(false)}>{i.t('close')}</button></div>;
}

function QuoteWords({ text }: { text: string }) {
  // each line, then each word, fades in with a small stagger (skipped with reduced motion)
  let k = 0;
  return (
    <>
      {text.split(/ \/ | \.\.\. /).map((line, li) => (
        <span key={li} className="qline">
          {line.split(' ').map((w, wi) => <span key={wi} className="qword" style={{ ['--w' as string]: k++ }}>{w}{' '}</span>)}
        </span>
      ))}
    </>
  );
}

function HeroQuote({ lang }: { lang: 'ar' | 'en' }) {
  const { data, i, today, plan, save } = useApp();
  const dq = quoteForDay(QUOTES, lang, today, plan!.startDate, data.quoteViews);
  useEffect(() => {
    if (!dq.quote) return;
    if (data.quoteViews.some((v) => v.date === today && v.lang === lang && !v.deletedAt)) return;
    save('quoteViews', { ...newRow(), date: today, lang, quoteId: dq.quote.id });
  }, [today, lang, dq.quote?.id]); // eslint-disable-line
  if (!dq.quote) return null;
  const q = dq.quote;
  return (
    <figure className={`hero-quote ${lang}`} key={q.id + today}>
      <span className="qmark" aria-hidden>{lang === 'ar' ? '«' : '“'}</span>
      <blockquote lang={q.lang} dir={q.lang === 'ar' ? 'rtl' : 'ltr'}><QuoteWords text={q.text} /></blockquote>
      <p className="tr" lang={q.lang === 'ar' ? 'en' : 'ar'} dir={q.lang === 'ar' ? 'ltr' : 'rtl'}>{q.translation}</p>
      <figcaption>
        <bdi>{q.author}</bdi> · <bdi>{q.work}</bdi> · <a href={q.sourceUrl} target="_blank" rel="noopener noreferrer">{i.t('source')}</a>
        <span className="muted"> · {i.t(q.translationBy === 'app' ? 'translation_app' : 'translation_published')}</span>
        {dq.repeated && <span className="muted"> · {i.t('quote_repeated', { n: dq.librarySize })}</span>}
      </figcaption>
    </figure>
  );
}

export function Dashboard() {
  const { data, i, today, opt, plan } = useApp();
  const todayOcc = useMemo(() => {
    const day = occurrencesFor(data, { range: dayPeriod(today), today }, opt).filter((o) => o.kind !== 'quota');
    const quotas = occurrencesFor(data, { range: { start: addDays(today, -31), end: addDays(today, 32) }, today, includeTasks: false }, opt).filter((o) => o.kind === 'quota' && o.range.start <= today && today < o.range.end);
    return [...day, ...quotas];
  }, [data, today, opt]);
  const sg = suggestNext(data, todayOcc, today);
  const titleOf = (h?: string | null, t?: string | null) => (h ? data.habits.find((x) => x.id === h)?.title : data.tasks.find((x) => x.id === t)?.title) ?? '';
  const sgText = sg.kind === 'planFirst' || sg.kind === 'none' || sg.kind === 'reviewLoad' ? i.t(`sg_${sg.kind}`) : i.t(`sg_${sg.kind}`, { t: titleOf(sg.habitId, sg.taskId), n: i.num(sg.amount ?? 0, 2) });
  const openCount = todayOcc.filter((o) => !o.excluded && o.contribution < 1 && !o.recorded).length;

  const a = useMemo(() => {
    const win = { start: addDays(today, -28), end: today };
    const occ = occurrencesFor(data, { range: win, today }, opt);
    const recent = occ.filter((o) => o.date >= addDays(today, -14));
    const c14 = commitment(recent);
    const year = planYearRange(plan!.startDate);
    const pp = planProgress(occurrencesFor(data, { range: year, today }, opt));
    const days = Array.from({ length: 28 }, (_, k) => addDays(today, k - 28)).map((d) => {
      const c = commitment(occ.filter((o) => o.date === d && o.kind !== 'quota'));
      return { date: d, ratio: c.ratio, recorded: c.recordedCount > 0 || c.dueCount === 0, due: c.dueCount };
    });
    const tr = trend(data, today, data.settings.trend, opt);
    const ents = entitlements(occurrencesFor(data, { range: { start: '2000-01-01', end: addDays(today, 1) }, today }, opt), data);
    const goals = aliveGoals(data).filter((g) => g.planYearId === plan!.id && g.level === 'year' && g.status !== 'archived').map((g) => ({ g, n: goalProgress(g.id, data, today, opt) }));
    const habits = data.habits.filter((h) => !h.deletedAt && !h.archived).map((h) => ({ h, c: commitment(occ.filter((o) => o.habitId === h.id)) }));
    const recs = recoveries(occ);
    return { c14, pp, days, tr, ents, goals, habits, recs, xp: totalXP(ents) };
  }, [data, today, opt, plan]);
  const lv = levelFor(a.xp);
  const verdictTone = a.tr.verdict === 'improving' ? 'green' : a.tr.verdict === 'declining' ? 'warn' : a.tr.verdict === 'steady' ? 'info' : '';

  return (
    <div className="page home">
      <ReminderBanner open={openCount} />
      <p className="home-date">{i.date(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>

      <section className="quotes" aria-label={i.t('quotes_title')}>
        <HeroQuote lang="ar" />
        <HeroQuote lang="en" />
      </section>

      <Reveal>
        <section className="rings" aria-label={i.t('nav_analytics')}>
          <Ring value={a.c14.ratio} label={i.t('commitment')} sub={a.c14.ratio == null ? i.t('no_items') : i.t('last_n_days', { n: 14 })} />
          <Ring value={a.pp.ratio} expected={a.pp.expected} label={i.t('plan_progress')} sub={a.pp.expected != null ? `${i.t('expected_by_now')} ${i.pct(a.pp.expected)}` : undefined} tone="info" />
          <Ring value={a.c14.coverage} label={i.t('coverage')} sub={i.t('due_count') + ' ' + a.c14.dueCount} tone="gold" />
        </section>
      </Reveal>

      <Reveal delay={60}>
        <section className="panel trendcard">
          <div className="row between">
            <h2 style={{ margin: 0 }}>{i.t('trend')}</h2>
            <span className={`chip ${verdictTone}`}>{i.t(`tr_${a.tr.verdict}`)}{a.tr.deltaPP != null && a.tr.verdict !== 'insufficient' ? ` ${a.tr.deltaPP > 0 ? '+' : ''}${i.num(a.tr.deltaPP, 1)}` : ''}</span>
          </div>
          <Sparkline points={a.days.map((d) => d.ratio)} label={i.t('trend')} />
          <HeatStrip days={a.days.map((d) => ({ ...d, label: `${i.date(d.date, { day: 'numeric', month: 'short' })}: ${d.ratio == null ? i.t('no_items') : i.pct(d.ratio)}` }))} />
          <p className="small muted" style={{ margin: 0 }}>
            {i.t('trend_detail', { n: data.settings.trend.windowDays, a: i.pct(a.tr.recent.ratio), ad: a.tr.recent.dueCount, b: i.pct(a.tr.previous.ratio), bd: a.tr.previous.dueCount, d: a.tr.deltaPP == null ? '—' : `${a.tr.deltaPP > 0 ? '+' : ''}${i.num(a.tr.deltaPP, 1)}` })}
          </p>
          {a.tr.verdict === 'declining' && <div className="banner warn">{i.t('tr_msg_declining')}</div>}
          {a.tr.verdict === 'improving' && <div className="banner gold">{i.t('tr_msg_improving')}</div>}
        </section>
      </Reveal>

      <Reveal delay={90}>
        <section className="panel">
          <div className="row between"><h2 style={{ margin: 0 }}>{i.t('goals')}</h2><a className="small" href={href('/year')}>{i.t('nav_year')}</a></div>
          {!a.goals.length && <p className="muted small"><a href={href('/year')}>{i.t('empty_goals')}</a></p>}
          <div className="goalbars">
            {a.goals.map(({ g, n }) => (
              <a key={g.id} className="goalbar" href={href('/year', { focus: g.id })}>
                <span className="gb-head">
                  <bdi className="gb-title">{g.title}</bdi>
                  <span className="gb-meta num">
                    {n?.outcome.achieved ? <span className="chip gold">★</span> : null}
                    {i.pct(n?.plan.ratio ?? null)}
                    {g.deadline && n?.daysLeft != null && <span className="muted"> · {n.daysLeft >= 0 ? i.t('days_left', { n: n.daysLeft }) : i.t('overdue_days', { n: -n.daysLeft })}</span>}
                  </span>
                </span>
                <Trail ratio={n?.plan.ratio ?? null} expected={n?.plan.expected} label={g.title} />
              </a>
            ))}
          </div>
        </section>
      </Reveal>

      <Reveal delay={120}>
        <section className="panel">
          <div className="row between"><h2 style={{ margin: 0 }}>{i.t('habits')}</h2><a className="small" href={href('/habits')}>{i.t('nav_habits')}</a></div>
          <div className="habitbars">
            {a.habits.map(({ h, c }) => (
              <a key={h.id} className="habitbar" href={href('/analytics', { type: 'month', habit: h.id })}>
                <bdi>{h.title}</bdi>
                <span className="hb-track"><span className="hb-fill" style={{ ['--v' as string]: c.ratio ?? 0 }} /></span>
                <span className="num small">{c.ratio == null ? '—' : i.pct(c.ratio)}</span>
              </a>
            ))}
          </div>
          {a.recs.slice(-2).map((r) => <p key={r.habitId + r.date} className="small" style={{ margin: '10px 0 0', color: 'var(--gold)' }}>★ {i.t('recovery_item', { t: data.habits.find((h) => h.id === r.habitId)?.title ?? '', n: r.gap })}</p>)}
        </section>
      </Reveal>

      {data.settings.gamification && (
        <Reveal delay={150}>
          <section className="panel levelcard">
            <Ring value={lv.into / lv.needed} label={i.t('xp_level', { n: lv.level })} sub={i.t('xp', { n: a.xp })} tone="gold" size={110} />
            <div className="stack" style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0 }}>{i.t('badges')}</h2>
              <div className="row">
                {badges(a.ents).map((b) => (
                  <span key={b.id} className={`chip ${b.earned ? 'gold' : ''}`}>{b.earned ? '★' : '☆'} {i.t(`b_${b.id.replace(/-/g, '_')}` as 'b_comeback')}</span>
                ))}
              </div>
              <p className="small muted" style={{ margin: 0 }}>{i.t('xp_note')}</p>
            </div>
          </section>
        </Reveal>
      )}

      <Reveal delay={180}>
        <section className="panel suggest">
          <div className="row between"><h2 style={{ margin: 0 }}>{i.t('suggested_step')}</h2><span className="chip">{i.t('suggestion_label')}</span></div>
          <p style={{ margin: '8px 0 14px' }}><bdi>{sgText}</bdi></p>
          <a className="btn primary" href={href(`/day/${today}`, sg.occurrenceKey ? { focus: sg.occurrenceKey } : undefined)}>{i.t('open_day')}</a>
        </section>
      </Reveal>
    </div>
  );
}
