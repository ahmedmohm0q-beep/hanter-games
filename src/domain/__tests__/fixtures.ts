import type { AppData, Goal, Habit, HabitSchedule, LogEntry, ScheduleRule, Settings, Task } from '../types';

let n = 0;
const id = (p: string) => `${p}${++n}`;
const row = () => ({ version: 1, updatedAt: '2026-01-01T00:00:00Z', deletedAt: null });

export function settings(): Settings {
  return {
    id: 'settings', ...row(), locale: 'ar', theme: 'dark', weekStartsOn: 6, timeZone: 'Asia/Dubai',
    reducedMotion: 'system', sound: false, gamification: true,
    trend: { windowDays: 14, improveThresholdPP: 5, declineThresholdPP: -5, minDue: 6, minCoverage: 0.6 },
    reminders: { enabled: false, quietStart: '22:00', quietEnd: '07:00', maxPerDay: 3 },
    activePlanYearId: 'py', onboarded: true,
  };
}

export function emptyData(start = '2026-11-15'): AppData {
  return {
    settings: settings(),
    planYears: [{ id: 'py', ...row(), label: 'Y1', startDate: start, archived: false, startHistory: [] }],
    goals: [], goalPoints: [], habits: [], habitSchedules: [], habitExceptions: [], tasks: [], logs: [],
    outcomeResults: [], reviews: [], quoteViews: [],
  };
}

export function goal(p: Partial<Goal> = {}): Goal {
  return {
    id: id('g'), ...row(), planYearId: 'py', parentId: null, level: 'year', kind: 'outcome', title: 'G',
    description: '', startDate: '2026-11-15', deadline: null, deadlineTime: null, deadlineTimeZone: null,
    successMetric: { measure: { type: 'binary' }, target: 1 }, priority: 2, weight: null, status: 'active',
    notes: '', sortOrder: 0, periodStart: null, weeklyCapacityHours: null, deadlineHistory: [], ...p,
  };
}

export function habit(p: Partial<Habit> = {}): Habit {
  return { id: id('h'), ...row(), goalIds: [], title: 'H', cue: '', measure: { type: 'binary' }, archived: false, sortOrder: 0, weight: null, ...p };
}

export function schedule(habitId: string, rule: ScheduleRule, target = 1, effectiveFrom = '2026-01-01', minimum: number | null = null): HabitSchedule {
  return { id: id('s'), ...row(), habitId, effectiveFrom, rule, target, minimum };
}

export function log(p: Partial<LogEntry> & { date: string }): LogEntry {
  return { id: id('l'), ...row(), habitId: null, taskId: null, amount: 1, kind: 'progress', note: '', source: 'manual', ...p };
}

export function task(p: Partial<Task> & { goalId: string; dueDate: string }): Task {
  return { id: id('t'), ...row(), title: 'T', measure: { type: 'binary' }, target: 1, weight: null, sortOrder: 0, rescheduleHistory: [], ...p };
}

export const opt = { weekStartsOn: 6 as const, planStart: '2026-11-15' };
