import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppData } from '../domain/types';
import { addDays, addMonthsClamped, todayInZone } from '../domain/dates';
import { entitlements, levelFor, totalXP } from '../domain/rewards';
import { occurrencesFor } from '../domain/schedule';
import { StoreProvider } from '../data/store';
import { LocalRepo, type Repo } from '../data/repo';
import { cloudConfigured, getClient, SupabaseRepo } from '../data/supabaseRepo';
import { demoData } from '../data/demo';
import { defaultSettings, guessTimeZone, newPlanYear, nowISO } from '../data/model';
import { makeT } from '../i18n';
import { useApp } from './ctx';
import { href, useRoute } from './router';
import { ConflictDialogs, Field, SyncChip, Toasts, celebrate } from './components/common';
import { Dashboard } from './pages/Dashboard';
import { DayPage, HalfPage, MonthPage, WeekPage } from './pages/Periods';
import { YearPage } from './pages/Year';
import { AnalyticsPage } from './pages/Analytics';
import { HabitsPage } from './pages/Habits';
import { SettingsPage } from './pages/Settings';
import type { PeriodType } from '../domain/periods';

type Mode = 'local' | 'demo' | 'cloud';
const MODE_KEY = 'hg:mode';
const readMode = (): Mode | null => {
  try { return localStorage.getItem(MODE_KEY) as Mode | null; } catch { return null; }
};
const writeMode = (m: Mode | null) => {
  try { m ? localStorage.setItem(MODE_KEY, m) : localStorage.removeItem(MODE_KEY); } catch { /* ignore */ }
};
export const IS_PREVIEW = typeof window !== 'undefined' && !!(window as unknown as { __HG_PREVIEW__?: boolean }).__HG_PREVIEW__;

function applyChrome(locale: 'ar' | 'en', theme: string, motion: string) {
  const root = document.documentElement;
  root.lang = locale;
  root.dir = locale === 'en' ? 'ltr' : 'rtl';
  const dark = theme === 'system' ? !window.matchMedia?.('(prefers-color-scheme: light)').matches : theme === 'dark';
  root.dataset.theme = dark ? 'dark' : 'light';
  root.classList.toggle('reduce-motion', motion === 'on');
  root.classList.toggle('motion-system', motion === 'system');
}

export function App() {
  const [mode, setMode] = useState<Mode | null>(() => readMode() ?? (cloudConfigured() ? 'cloud' : null));
  const [boot, setBoot] = useState<{ repo: Repo; data: AppData; syncedAt: string | null; fromCache: boolean; outboxKey: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(!cloudConfigured());
  const i = makeT(boot?.data.settings.locale ?? 'ar');

  useEffect(() => applyChrome(boot?.data.settings.locale ?? 'ar', boot?.data.settings.theme ?? 'dark', boot?.data.settings.reducedMotion ?? 'system'), [boot]);

  // auth (cloud builds only)
  useEffect(() => {
    if (!cloudConfigured() || mode !== 'cloud') { setAuthReady(true); return; }
    let unsub = () => {};
    getClient().then(async (c) => {
      const { data } = await c.auth.getSession();
      setUserId(data.session?.user.id ?? null);
      setAuthReady(true);
      const sub = c.auth.onAuthStateChange((_e: string, s: { user: { id: string } } | null) => setUserId(s?.user.id ?? null));
      unsub = () => sub.data.subscription.unsubscribe();
    }).catch((e) => { setError(String(e)); setAuthReady(true); });
    return () => unsub();
  }, [mode]);

  useEffect(() => {
    setBoot(null);
    if (!mode || !authReady) return;
    (async () => {
      try {
        if (mode === 'cloud') {
          if (!userId) return;
          const repo = new SupabaseRepo(await getClient(), userId);
          const r = await repo.load();
          setBoot({ repo, ...r, outboxKey: `hg:outbox:${userId}` });
        } else {
          const repo = new LocalRepo(mode, mode === 'demo' ? () => demoData(todayInZone(guessTimeZone())) : undefined);
          const r = await repo.load();
          setBoot({ repo, ...r, outboxKey: `hg:outbox:${mode}` });
        }
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      }
    })();
  }, [mode, userId, authReady]);

  const choose = (m: Mode | null) => { writeMode(m); setMode(m); };
  const leave = () => {
    if (mode === 'demo' || mode === 'local') LocalRepo.clear(mode);
    try { localStorage.removeItem(`hg:outbox:${mode}`); } catch { /* ignore */ }
    choose(cloudConfigured() ? 'cloud' : null);
  };
  const signOut = async () => { (await getClient()).auth.signOut(); };

  if (error) return <Centered><div className="banner alert">{i.t('error_generic', { m: error })}</div><button className="btn" onClick={() => location.reload()}>{i.t('retry')}</button></Centered>;
  if (!mode) return <Welcome onPick={choose} />;
  if (mode === 'cloud' && authReady && !userId) return <AuthScreen onLocal={() => choose('local')} onDemo={() => choose('demo')} />;
  if (!boot) return <Centered><div className="skeleton" style={{ width: 220 }} /><p className="muted">{i.t('loading')}</p></Centered>;
  return (
    <StoreProvider key={boot.outboxKey} repo={boot.repo} initial={boot.data} syncedAt={boot.syncedAt} fromCache={boot.fromCache} outboxKey={boot.outboxKey}>
      <Chrome />
      <Gate onSignOut={signOut} onLeave={leave} />
    </StoreProvider>
  );
}

function Chrome() {
  const { data } = useApp();
  useEffect(() => applyChrome(data.settings.locale, data.settings.theme, data.settings.reducedMotion), [data.settings.locale, data.settings.theme, data.settings.reducedMotion]);
  return null;
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="page stack" style={{ maxWidth: 520, marginTop: '12vh', alignItems: 'center', textAlign: 'center' }}>{children}</main>;
}

function Welcome({ onPick }: { onPick: (m: Mode) => void }) {
  const i = makeT('ar');
  return (
    <Centered>
      <img src="icons/logo.svg" alt="" width={84} height={84} />
      <h1>HANTER GAMES</h1>
      <p className="muted">{i.t('welcome_sub')}</p>
      <div className="banner">{IS_PREVIEW ? i.t('preview_note') : i.t('cloud_missing')}</div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn primary" onClick={() => onPick('local')}>{i.t('use_local')}</button>
        <button className="btn" onClick={() => onPick('demo')}>{i.t('try_demo')}</button>
      </div>
      <p className="small muted" lang="en" dir="ltr">Arabic first · English available in Settings</p>
    </Centered>
  );
}

function AuthScreen({ onLocal, onDemo }: { onLocal: () => void; onDemo: () => void }) {
  const i = makeT('ar');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: (c: Awaited<ReturnType<typeof getClient>>) => Promise<{ error: { message: string } | null }>, ok?: string) => {
    setBusy(true); setMsg(null);
    try {
      const { error } = await fn(await getClient());
      setMsg(error ? i.t('auth_error', { m: error.message }) : ok ?? null);
    } catch (e) { setMsg(i.t('auth_error', { m: String(e) })); }
    setBusy(false);
  };
  return (
    <Centered>
      <img src="icons/logo.svg" alt="" width={72} height={72} />
      <h1>{i.t('welcome')}</h1>
      <form className="panel stack" style={{ width: '100%', textAlign: 'start' }} onSubmit={(e) => { e.preventDefault(); run((c) => c.auth.signInWithPassword({ email, password: pw })); }}>
        <Field label={i.t('email')}><input className="input" type="email" dir="ltr" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={i.t('password')}><input className="input" type="password" dir="ltr" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <div className="row">
          <button className="btn primary" disabled={busy || !pw}>{i.t('sign_in')}</button>
          <button type="button" className="btn" disabled={busy || !pw} onClick={() => run((c) => c.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.origin + location.pathname } }), i.t('magic_sent'))}>{i.t('sign_up')}</button>
          <button type="button" className="btn ghost" disabled={busy || !email} onClick={() => run((c) => c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } }), i.t('magic_sent'))}>{i.t('magic_link')}</button>
        </div>
        {msg && <div className="banner" role="status">{msg}</div>}
      </form>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn small ghost" onClick={onLocal}>{i.t('use_local')}</button>
        <button className="btn small ghost" onClick={onDemo}>{i.t('try_demo')}</button>
      </div>
    </Centered>
  );
}

function Onboarding() {
  const { data, saveMany, i, today } = useApp();
  const [start, setStart] = useState(today);
  const [label, setLabel] = useState('');
  const [locale, setLocale] = useState(data.settings.locale);
  const last = addDays(addMonthsClamped(start, 12), -1);
  const go = () => {
    const py = newPlanYear(start, label || `${start.slice(0, 4)}–${last.slice(0, 4)}`);
    saveMany([
      { table: 'planYears', row: py },
      { table: 'settings', row: { ...defaultSettings(), ...data.settings, locale, activePlanYearId: py.id, onboarded: true, updatedAt: nowISO() } },
    ]);
  };
  return (
    <Centered>
      <img src="icons/logo.svg" alt="" width={72} height={72} />
      <h1>{i.t('welcome')}</h1>
      <p className="muted">{i.t('welcome_sub')}</p>
      <div className="panel stack" style={{ width: '100%', textAlign: 'start' }}>
        <Field label={i.t('language')}>
          <select className="input" value={locale} onChange={(e) => setLocale(e.target.value as 'ar')}><option value="ar">العربية</option><option value="en">English</option></select>
        </Field>
        <Field label={i.t('choose_start')} hint={i.t('start_explain', { last: i.date(last) })}>
          <input type="date" className="input" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </Field>
        <Field label={i.t('plan_label')} hint={i.t('optional')}><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} dir="auto" /></Field>
        <button className="btn primary" onClick={go}>{i.t('create_plan')}</button>
      </div>
    </Centered>
  );
}

const NAV: { key: string; path: string; icon: string }[] = [
  { key: 'nav_dashboard', path: '/', icon: '◎' },
  { key: 'nav_day', path: '/day', icon: '☀' },
  { key: 'nav_week', path: '/week', icon: '▤' },
  { key: 'nav_month', path: '/month', icon: '▦' },
  { key: 'nav_half', path: '/half', icon: '◐' },
  { key: 'nav_year', path: '/year', icon: '⛰' },
  { key: 'nav_analytics', path: '/analytics', icon: '↗' },
  { key: 'nav_habits', path: '/habits', icon: '↻' },
  { key: 'nav_settings', path: '/settings', icon: '⚙' },
];

function Gate({ onSignOut, onLeave }: { onSignOut: () => void; onLeave: () => void }) {
  const { data, plan } = useApp();
  if (!plan || !data.settings.onboarded) return <Onboarding />;
  return <Shell onSignOut={onSignOut} onLeave={onLeave} />;
}

function Shell({ onSignOut, onLeave }: { onSignOut: () => void; onLeave: () => void }) {
  const { data, i, today, opt, repo, fromCache, syncedAt } = useApp();
  const route = useRoute();
  const section = route.path[0] ?? '';
  const xp = useMemo(() => (data.settings.gamification ? totalXP(entitlements(occurrencesFor(data, { range: { start: '2000-01-01', end: addDays(today, 1) }, today }, opt), data)) : 0), [data, today, opt]);
  const lv = levelFor(xp);
  const prevLevel = useRef(lv.level);
  useEffect(() => {
    if (lv.level > prevLevel.current) celebrate(i.t('xp_level', { n: lv.level }));
    prevLevel.current = lv.level;
  }, [lv.level]); // eslint-disable-line
  // focus main heading on navigation for keyboard / screen-reader users
  useEffect(() => { document.querySelector<HTMLElement>('main h1')?.setAttribute('tabindex', '-1'); }, [section]);

  const linkFor = (p: string) => (['/day', '/week', '/month', '/half'].includes(p) ? `${p}/${today}` : p);
  const isCurrent = (p: string) => (p === '/' ? section === '' : `/${section}` === p);
  const nav = NAV.map((n) => (
    <a key={n.key} className="navlink" href={href(linkFor(n.path))} aria-current={isCurrent(n.path) ? 'page' : undefined}>
      <span aria-hidden>{n.icon}</span><span>{i.t(n.key as 'nav_day')}</span>
    </a>
  ));
  const arg = route.path[1] ?? today;
  let page: React.ReactNode;
  switch (section) {
    case 'day': page = <DayPage date={arg} focus={route.query.get('focus')} />; break;
    case 'week': page = <WeekPage date={arg} monthStart={route.query.get('month')} />; break;
    case 'month': page = <MonthPage date={arg} />; break;
    case 'half': page = <HalfPage date={arg} />; break;
    case 'year': page = <YearPage focus={route.query.get('focus')} openParam={route.query.get('open')} />; break;
    case 'analytics': page = <AnalyticsPage type={(route.query.get('type') as PeriodType) || 'month'} date={route.query.get('date') ?? today} habitId={route.query.get('habit')} />; break;
    case 'habits': page = <HabitsPage focus={route.query.get('focus')} />; break;
    case 'settings': page = <SettingsPage onSignOut={onSignOut} onLeave={onLeave} />; break;
    default: page = <Dashboard />;
  }
  return (
    <div className="shell">
      <aside className="side" aria-label="navigation">
        <a className="brand" href="#/" style={{ color: 'inherit', textDecoration: 'none' }}><img src="icons/logo.svg" alt="" /> HANTER GAMES</a>
        {nav}
        <div className="spacer" />
      </aside>
      <div className="main">
        <header className="topbar">
          <SyncChip />
          {data.settings.gamification && <span className="chip gold num" title={i.t('xp_note')}>{i.t('xp_level', { n: lv.level })} · {i.t('xp', { n: xp })}</span>}
        </header>
        {repo.mode === 'demo' && <div className="banner gold" style={{ margin: '12px 28px 0' }}>{i.t('demo_banner')} <button className="btn small ghost" onClick={onLeave}>{i.t('leave_demo')}</button></div>}
        {fromCache && syncedAt && <div className="banner warn" style={{ margin: '12px 28px 0' }}>{i.t('cachedData', { t: i.dateTime(syncedAt) })}</div>}
        <main key={section}>{page}</main>
      </div>
      <nav className="mobilenav" aria-label="navigation">{nav}</nav>
      <Toasts />
      <ConflictDialogs />
    </div>
  );
}
