// Factories, defaults and (de)serialization shared by every repository.
import type { AppData, EntityTable, Goal, Habit, HabitSchedule, ISODate, PlanYear, Settings, Task } from '../domain/types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const nowISO = () => new Date().toISOString();
const base = () => ({ id: uid(), version: 0, updatedAt: nowISO(), deletedAt: null });

export function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai';
  } catch {
    return 'Asia/Dubai';
  }
}

export function defaultSettings(): Settings {
  return {
    ...base(),
    locale: 'ar',
    theme: 'dark',
    weekStartsOn: 6,
    timeZone: guessTimeZone(),
    reducedMotion: 'system',
    sound: false,
    gamification: true,
    trend: { windowDays: 14, improveThresholdPP: 5, declineThresholdPP: -5, minDue: 6, minCoverage: 0.6 },
    reminders: { enabled: false, quietStart: '22:00', quietEnd: '07:00', maxPerDay: 3 },
    activePlanYearId: null,
    onboarded: false,
  };
}

export function emptyAppData(): AppData {
  return {
    settings: defaultSettings(),
    planYears: [], goals: [], goalPoints: [], habits: [], habitSchedules: [], habitExceptions: [],
    tasks: [], logs: [], outcomeResults: [], reviews: [], quoteViews: [],
  };
}

export const TABLES: EntityTable[] = ['planYears', 'goals', 'goalPoints', 'habits', 'habitSchedules', 'habitExceptions', 'tasks', 'logs', 'outcomeResults', 'reviews', 'quoteViews'];

export const SQL_TABLE: Record<EntityTable | 'settings', string> = {
  settings: 'settings', planYears: 'plan_years', goals: 'goals', goalPoints: 'goal_points', habits: 'habits',
  habitSchedules: 'habit_schedules', habitExceptions: 'habit_exceptions', tasks: 'tasks', logs: 'logs',
  outcomeResults: 'outcome_results', reviews: 'reviews', quoteViews: 'quote_views',
};

export function newPlanYear(startDate: ISODate, label: string): PlanYear {
  return { ...base(), label, startDate, archived: false, startHistory: [] };
}

export function newGoal(p: Partial<Goal> & Pick<Goal, 'planYearId' | 'level' | 'title' | 'startDate'>): Goal {
  return {
    ...base(), parentId: null, kind: 'outcome', description: '', deadline: null, deadlineTime: null, deadlineTimeZone: null,
    successMetric: { measure: { type: 'binary' }, target: 1, aggregate: 'latest' }, priority: 2, weight: null,
    status: 'active', notes: '', sortOrder: Date.now() % 1e9, periodStart: null, weeklyCapacityHours: null, deadlineHistory: [], ...p,
  };
}

export function newHabit(p: Partial<Habit> & Pick<Habit, 'title'>): Habit {
  return { ...base(), goalIds: [], cue: '', measure: { type: 'binary' }, archived: false, sortOrder: Date.now() % 1e9, weight: null, ...p };
}

export function newSchedule(p: Omit<HabitSchedule, 'id' | 'version' | 'updatedAt' | 'deletedAt'>): HabitSchedule {
  return { ...base(), ...p };
}

export function newTask(p: Partial<Task> & Pick<Task, 'goalId' | 'title' | 'dueDate'>): Task {
  return { ...base(), measure: { type: 'binary' }, target: 1, weight: null, sortOrder: Date.now() % 1e9, rescheduleHistory: [], ...p };
}

export const newRow = base;

// ---------- camelCase ⇄ snake_case for the database ----------
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function toDbRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snake(k)] = v;
  return out;
}

export function fromDbRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'user_id' || k === 'last_mutation_id') continue;
    let val = v;
    if (k === 'deadline_time' && typeof v === 'string') val = v.slice(0, 5);
    out[camel(k)] = val;
  }
  return out as T;
}

/** Basic structural validation for imported backups. */
export function validateImport(x: unknown): { ok: true; data: AppData } | { ok: false; error: string } {
  if (!x || typeof x !== 'object') return { ok: false, error: 'notObject' };
  const o = x as Record<string, unknown>;
  const d = (o.data ?? o) as Record<string, unknown>;
  for (const t of TABLES) if (!Array.isArray(d[t])) return { ok: false, error: `missing:${t}` };
  for (const t of TABLES) for (const r of d[t] as Record<string, unknown>[]) if (typeof r?.id !== 'string') return { ok: false, error: `badRow:${t}` };
  return { ok: true, data: { ...emptyAppData(), ...(d as unknown as AppData) } };
}
