import { useEffect, useMemo, useState } from 'react';
import library from '../../../quotes/library.json';
import { addDays } from '../../domain/dates';
import { dayPeriod } from '../../domain/periods';
import { goalProgress } from '../../domain/progress';
import { occurrencesFor } from '../../domain/schedule';
import { quoteForDay, type Quote } from '../../domain/quotes';
import { suggestNext } from '../../domain/suggest';
import { newRow } from '../../data/model';
import { aliveGoals, useApp } from '../ctx';
import { href } from '../router';
import { Empty, Trail } from '../components/common';
import { OccurrenceRow } from '../components/OccurrenceRow';
import { TrendCard } from './Analytics';

export const QUOTES = (library as { quotes: Quote[] }).quotes;

function QuoteCard({ lang }: { lang: 'ar' | 'en' }) {
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
  const goals = aliveGoals(data).filter((g) => g.planYearId === plan!.id && g.level === 'year' && g.status === 'active').sort((a, b) => a.priority - b.priority || (a.deadline ?? '9999') .localeCompare(b.deadline ?? '9999'));
  const upcoming = [
    ...aliveGoals(data).filter((g) => g.deadline && g.deadline >= today && g.deadline <= addDays(today, 30) && g.status === 'active').map((g) => ({ id: g.id, title: g.title, date: g.deadline!, link: href('/year', { focus: g.id }) })),
    ...data.tasks.filter((t) => !t.deletedAt && t.dueDate >= today && t.dueDate <= addDays(today, 14) && !data.logs.some((l) => l.taskId === t.id && !l.deletedAt && l.kind === 'progress')).map((t) => ({ id: t.id, title: t.title, date: t.dueDate, link: href(`/day/${t.dueDate}`, { focus: `t:${t.id}` }) })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const openCount = todayOcc.filter((o) => !o.excluded && o.contribution < 1 && !o.recorded).length;

  return (
    <div className="page">
      <div className="row between" style={{ marginBottom: 14 }}>
        <div>
          <h1>{i.date(today, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h1>
          <p className="muted small" style={{ margin: 0 }}>{data.settings.timeZone}</p>
        </div>
        <a className="btn primary" href={href(`/day/${today}`)}>{i.t('nav_day')}</a>
      </div>
      <ReminderBanner open={openCount} />

      <section className="panel" style={{ borderColor: 'var(--green)' }}>
        <div className="row between"><h2>{i.t('suggested_step')}</h2><span className="chip">{i.t('suggestion_label')}</span></div>
        <p style={{ margin: 0 }}>
          {sg.occurrenceKey ? <a href={href(`/day/${today}`, { focus: sg.occurrenceKey })}><bdi>{sgText}</bdi></a> : sg.kind === 'planFirst' ? <a href={href('/year')}>{sgText}</a> : sgText}
        </p>
      </section>

      <div className="grid two" style={{ marginTop: 14 }}>
        <section>
          <h2>{i.t('due_today')}</h2>
          {todayOcc.length ? todayOcc.slice(0, 6).map((o) => <OccurrenceRow key={o.key} o={o} date={today} />) : <Empty>{i.t('nothing_due')}</Empty>}
          {todayOcc.length > 6 && <a className="btn small" href={href(`/day/${today}`)} style={{ marginTop: 8 }}>{i.t('nav_day')} (+{todayOcc.length - 6})</a>}
        </section>
        <div className="stack" style={{ gap: 14 }}>
          <section className="panel">
            <h2>{i.t('priorities')}</h2>
            {!goals.length && <p className="muted small"><a href={href('/year')}>{i.t('empty_goals')}</a></p>}
            <div className="stack">
              {goals.slice(0, 4).map((g) => {
                const n = goalProgress(g.id, data, today, opt);
                return (
                  <a key={g.id} href={href('/year', { focus: g.id })} style={{ color: 'inherit', textDecoration: 'none' }} className="stack">
                    <div className="row between">
                      <bdi style={{ fontWeight: 600 }}>{g.title}</bdi>
                      <span className={`chip ${n?.daysLeft != null && n.daysLeft < 14 ? 'warn' : ''}`}>
                        {g.deadline ? (n!.daysLeft! >= 0 ? i.t('days_left', { n: n!.daysLeft! }) : i.t('overdue_days', { n: -n!.daysLeft! })) : i.t('no_deadline')}
                      </span>
                    </div>
                    <Trail ratio={n?.plan.ratio ?? null} expected={n?.plan.expected} label={g.title} />
                  </a>
                );
              })}
            </div>
          </section>
          <section className="panel">
            <h2>{i.t('upcoming')}</h2>
            {!upcoming.length ? <p className="muted small" style={{ margin: 0 }}>{i.t('nothing_due')}</p> : (
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {upcoming.map((u) => <li key={u.id}><a href={u.link}><bdi>{u.title}</bdi></a> <span className="small muted num">{i.date(u.date)}</span></li>)}
              </ul>
            )}
          </section>
        </div>
      </div>

      <h2 style={{ marginTop: 22 }}>{i.t('quotes_title')}</h2>
      <div className="grid two">
        <QuoteCard lang="ar" />
        <QuoteCard lang="en" />
      </div>
      <section className="panel" style={{ marginTop: 14 }}>
        <div className="row between"><h3>{i.t('daily_action')}</h3><span className="chip">{i.t('suggestion_label')}</span></div>
        <p style={{ margin: 0 }}><bdi>{sgText}</bdi></p>
      </section>
      <div style={{ marginTop: 14 }}><TrendCard /></div>
    </div>
  );
}
