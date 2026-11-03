// Hash router: every view is a URL (#/day/2026-11-03?focus=…), so reloads and deep links
// work on any static host and inside the preview without server rewrites.
import { useEffect, useState } from 'react';

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [p, q = ''] = h.split('?');
  return { path: p.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function href(path: string, query?: Record<string, string | undefined | null>): string {
  const q = new URLSearchParams();
  if (query) for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

export function go(path: string, query?: Record<string, string | undefined | null>, replace = false) {
  const h = href(path, query);
  if (replace) history.replaceState(null, '', h);
  else window.location.hash = h.slice(1);
  if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
}
