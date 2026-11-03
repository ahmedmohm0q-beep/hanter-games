// Small animated visualizations for the home screen. Every animation is skipped
// under reduced motion (global .reduce-motion / prefers-reduced-motion rules).
import { useEffect, useRef, useState } from 'react';

function reduced(): boolean {
  if (typeof window === 'undefined') return true;
  const root = document.documentElement;
  if (root.classList.contains('reduce-motion')) return true;
  return root.classList.contains('motion-system') && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Counts from the previous value to the new one. */
export function useCountUp(target: number | null, ms = 900): number | null {
  const [v, setV] = useState<number | null>(target == null ? null : reduced() ? target : 0);
  const from = useRef(0);
  useEffect(() => {
    if (target == null) { setV(null); return; }
    if (reduced()) { setV(target); from.current = target; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(a + (target - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Ring gauge: value 0..1 (null = nothing to measure), optional expected marker. */
export function Ring({ value, expected, label, sub, tone = 'green', size = 132 }: {
  value: number | null; expected?: number | null; label: string; sub?: string; tone?: 'green' | 'gold' | 'info'; size?: number;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const shown = useCountUp(value == null ? null : value * 100);
  const [drawn, setDrawn] = useState(reduced() ? value ?? 0 : 0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(value ?? 0));
    return () => cancelAnimationFrame(id);
  }, [value]);
  const ex = expected != null ? expected * 2 * Math.PI - Math.PI / 2 : null;
  return (
    <figure className={`ring tone-${tone}`} style={{ width: size }} aria-label={`${label}: ${value == null ? '—' : Math.round(value * 100) + '%'}`}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
        <circle className="ring-track" cx="60" cy="60" r={r} />
        <circle className="ring-fill" cx="60" cy="60" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, drawn)))} transform="rotate(-90 60 60)" />
        {ex != null && <line className="ring-mark" x1={60 + Math.cos(ex) * 44} y1={60 + Math.sin(ex) * 44} x2={60 + Math.cos(ex) * 62} y2={60 + Math.sin(ex) * 62} />}
      </svg>
      <div className="ring-center">
        <span className="ring-value num">{shown == null ? '—' : `${Math.round(shown)}%`}</span>
      </div>
      <figcaption>
        <span className="ring-label">{label}</span>
        {sub && <span className="ring-sub">{sub}</span>}
      </figcaption>
    </figure>
  );
}

/** Line of daily ratios (null = no items due that day); draws itself in. */
export function Sparkline({ points, height = 64, label }: { points: (number | null)[]; height?: number; label: string }) {
  const w = 300;
  const n = points.length;
  const x = (k: number) => (n <= 1 ? w / 2 : (k / (n - 1)) * (w - 12) + 6);
  const y = (v: number) => height - 8 - v * (height - 16);
  let d = '';
  let pen = false;
  points.forEach((v, k) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'} ${x(k).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });
  const lastK = points.map((v, k) => (v == null ? -1 : k)).reduce((a, b) => Math.max(a, b), -1);
  const area = d ? `${d} L ${x(lastK).toFixed(1)} ${height - 4} L ${x(points.findIndex((v) => v != null)).toFixed(1)} ${height - 4} Z` : '';
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line className="spark-grid" x1="0" x2={w} y1={y(0.5)} y2={y(0.5)} />
      {area && <path className="spark-area" d={area} />}
      {d && <path className="spark-line" d={d} pathLength={1} />}
    </svg>
  );
}

/** One cell per day: filled by ratio, dashed when nothing was recorded, empty when nothing was due. */
export function HeatStrip({ days }: { days: { date: string; ratio: number | null; recorded: boolean; label: string }[] }) {
  return (
    <div className="heat" role="list">
      {days.map((d, k) => (
        <span key={d.date} role="listitem" title={d.label}
          className={`heat-cell${d.ratio == null ? ' none' : !d.recorded ? ' unrec' : ''}`}
          style={{ ['--v' as string]: d.ratio ?? 0, ['--i' as string]: k }} />
      ))}
    </div>
  );
}

/** Reveals children with a soft rise when they scroll into view (visible by default). */
export function Reveal({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'wait' | 'in'>('idle');
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced() || typeof IntersectionObserver === 'undefined') return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) { setState('in'); return; }
    setState('wait');
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) { setState('in'); io.disconnect(); }
    }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${state} ${className}`} style={{ ['--d' as string]: `${delay}ms` }}>{children}</div>;
}
