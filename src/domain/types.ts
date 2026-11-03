// Core data model. Pure types: no UI, no storage concerns.
// Every row carries id / version / updatedAt so the same objects map 1:1 to the database.

export type ISODate = string; // "YYYY-MM-DD" — a calendar day in the user's chosen time zone

export interface Row {
  id: string;
  version: number; // optimistic concurrency counter (server-side increments)
  updatedAt: string; // ISO timestamp
  deletedAt?: string | null; // soft delete keeps history and makes sync idempotent
}

export type Locale = 'ar' | 'en';
export type ThemeMode = 'dark' | 'light' | 'system';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export interface Settings extends Row {
  locale: Locale;
  theme: ThemeMode;
  weekStartsOn: Weekday;
  timeZone: string; // IANA, e.g. "Asia/Dubai"
  reducedMotion: 'system' | 'on' | 'off';
  sound: boolean;
  gamification: boolean;
  trend: TrendSettings;
  reminders: { enabled: boolean; quietStart: string; quietEnd: string; maxPerDay: number };
  activePlanYearId: string | null;
  onboarded: boolean;
}

export interface TrendSettings {
  windowDays: number; // default 14
  improveThresholdPP: number; // e.g. +5 percentage points
  declineThresholdPP: number; // e.g. -5 percentage points
  minDue: number; // minimum due opportunities per window for a verdict
  minCoverage: number; // minimum recording coverage (0..1) for a verdict
}

export interface PlanYear extends Row {
  label: string;
  startDate: ISODate;
  archived: boolean;
  startHistory: { startDate: ISODate; changedAt: string }[];
}

export type GoalLevel = 'year' | 'half' | 'month' | 'week';
export type GoalKind = 'outcome' | 'milestone';
export type GoalStatus = 'active' | 'done' | 'paused' | 'archived';
export type MeasureType = 'binary' | 'minutes' | 'hours' | 'count' | 'pages' | 'questions' | 'distance' | 'custom';

export interface Measure {
  type: MeasureType;
  unit?: string; // for distance (km/mi/m) and custom
}

export interface SuccessMetric {
  measure: Measure;
  target: number; // binary → 1
  aggregate?: 'latest' | 'sum' | 'max'; // how recorded results combine (default latest)
  description?: string; // e.g. "Score ≥ 360 on Part 1"
}

export interface Goal extends Row {
  planYearId: string;
  parentId: string | null;
  level: GoalLevel;
  kind: GoalKind;
  title: string;
  description: string;
  startDate: ISODate;
  deadline: ISODate | null; // independent of the plan year end
  deadlineTime: string | null; // "HH:MM"
  deadlineTimeZone: string | null;
  successMetric: SuccessMetric;
  priority: 1 | 2 | 3; // 1 = highest
  weight: number | null; // null → equal weight among siblings
  status: GoalStatus;
  notes: string;
  sortOrder: number;
  periodStart: ISODate | null; // the half/month/week this sub-goal is placed in
  weeklyCapacityHours: number | null;
  deadlineHistory: { deadline: ISODate | null; changedAt: string; reason?: string }[];
}

export type PointBox = 'fears' | 'benefits' | 'obstacles';
export interface GoalPoint extends Row {
  goalId: string;
  box: PointBox;
  text: string;
  ifThen: string; // optional implementation intention: "If X, then I will Y"
  nextStep: string; // optional actionable step
  sortOrder: number;
}

export type ScheduleRule =
  | { kind: 'daily' }
  | { kind: 'weekdays'; days: Weekday[] }
  | { kind: 'perPeriod'; period: 'week' | 'month'; count: number }
  | { kind: 'everyNDays'; n: number; anchor: ISODate };

export interface Habit extends Row {
  goalIds: string[]; // a habit may serve several goals; activity is still counted once
  title: string;
  cue: string; // "after breakfast"
  measure: Measure;
  archived: boolean;
  sortOrder: number;
  weight: number | null;
}

export interface HabitSchedule extends Row {
  habitId: string;
  effectiveFrom: ISODate; // inclusive. Versions never overwrite history.
  rule: ScheduleRule;
  target: number; // per occurrence (binary → 1)
  minimum: number | null; // the "small version" for hard days
}

export interface HabitException extends Row {
  habitId: string;
  startDate: ISODate;
  endDate: ISODate; // exclusive
  kind: 'rest' | 'pause';
  note: string;
}

export interface Task extends Row {
  goalId: string;
  title: string;
  dueDate: ISODate;
  measure: Measure;
  target: number;
  weight: number | null;
  sortOrder: number;
  rescheduleHistory: { dueDate: ISODate; changedAt: string }[];
}

export interface LogEntry extends Row {
  // exactly one of habitId / taskId
  habitId: string | null;
  taskId: string | null;
  date: ISODate;
  amount: number; // binary → 1
  kind: 'progress' | 'skip'; // skip = explicitly recorded "not done"
  note: string;
  source: 'manual' | 'timer' | 'quick';
}

export interface OutcomeResult extends Row {
  goalId: string;
  date: ISODate;
  value: number;
  note: string;
}

export interface Review extends Row {
  periodType: 'week' | 'month';
  periodStart: ISODate;
  achieved: string;
  blocker: string;
  adjustment: string;
}

export interface QuoteView extends Row {
  date: ISODate;
  lang: 'ar' | 'en';
  quoteId: string;
}

export interface AppData {
  settings: Settings;
  planYears: PlanYear[];
  goals: Goal[];
  goalPoints: GoalPoint[];
  habits: Habit[];
  habitSchedules: HabitSchedule[];
  habitExceptions: HabitException[];
  tasks: Task[];
  logs: LogEntry[];
  outcomeResults: OutcomeResult[];
  reviews: Review[];
  quoteViews: QuoteView[];
}

export type EntityTable = Exclude<keyof AppData, 'settings'>;
