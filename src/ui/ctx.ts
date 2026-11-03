import { useMemo } from 'react';
import { useStore } from '../data/store';
import { makeT } from '../i18n';
import type { GenOptions } from '../domain/schedule';
import type { AppData, Goal, PlanYear } from '../domain/types';

export function activePlan(data: AppData): PlanYear | null {
  const alive = data.planYears.filter((p) => !p.deletedAt);
  return alive.find((p) => p.id === data.settings.activePlanYearId) ?? alive.find((p) => !p.archived) ?? alive[0] ?? null;
}

export function useApp() {
  const store = useStore();
  const { data } = store;
  const i = useMemo(() => makeT(data.settings.locale), [data.settings.locale]);
  const plan = activePlan(data);
  const opt: GenOptions = useMemo(() => ({ weekStartsOn: data.settings.weekStartsOn, planStart: plan?.startDate ?? null }), [data.settings.weekStartsOn, plan?.startDate]);
  return { ...store, i, plan, opt };
}

export function aliveGoals(data: AppData): Goal[] {
  return data.goals.filter((g) => !g.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function goalPath(data: AppData, id: string | null): Goal[] {
  const out: Goal[] = [];
  const seen = new Set<string>();
  let cur = id ? data.goals.find((g) => g.id === id) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    cur = cur.parentId ? data.goals.find((g) => g.id === cur!.parentId) : undefined;
  }
  return out;
}

export function measureLabel(i: ReturnType<typeof makeT>, m: { type: string; unit?: string }): string {
  if (m.type === 'distance' || m.type === 'custom') return m.unit || i.t(`m_${m.type}` as 'm_custom');
  return i.t(`m_${m.type}` as 'm_minutes');
}
