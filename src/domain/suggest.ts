// "Suggested next step" — always labeled in the UI as a suggestion from the app.
// Picks the smallest concrete action for the most urgent active goal; never invents goals.
import type { EvaluatedOccurrence } from './schedule';
import type { AppData, ISODate } from './types';

export interface Suggestion {
  kind: 'startSmall' | 'finishPartial' | 'logToday' | 'reviewLoad' | 'planFirst' | 'none';
  occurrenceKey?: string;
  habitId?: string | null;
  taskId?: string | null;
  goalId?: string;
  amount?: number;
}

export function suggestNext(data: AppData, todayOcc: EvaluatedOccurrence[], today: ISODate): Suggestion {
  const goals = data.goals.filter((g) => !g.deletedAt && g.status === 'active');
  if (!goals.length) return { kind: 'planFirst' };
  const urgency = (gid: string | undefined) => {
    const g = goals.find((x) => x.id === gid);
    if (!g) return 99_999;
    const days = g.deadline ? (Date.parse(g.deadline) - Date.parse(today)) / 86_400_000 : 9_999;
    return g.priority * 1000 + Math.max(0, days);
  };
  const goalOf = (o: EvaluatedOccurrence) =>
    o.taskId ? data.tasks.find((t) => t.id === o.taskId)?.goalId : data.habits.find((h) => h.id === o.habitId)?.goalIds[0];
  const open = todayOcc.filter((o) => !o.excluded && o.contribution < 1 && o.status !== 'notDone');
  open.sort((a, b) => urgency(goalOf(a)) - urgency(goalOf(b)));
  const partial = open.find((o) => o.amount > 0);
  if (partial) return { kind: 'finishPartial', occurrenceKey: partial.key, habitId: partial.habitId, taskId: partial.taskId, goalId: goalOf(partial), amount: partial.target - partial.amount };
  const first = open[0];
  if (first) {
    return {
      kind: first.minimum != null ? 'startSmall' : 'logToday',
      occurrenceKey: first.key, habitId: first.habitId, taskId: first.taskId, goalId: goalOf(first),
      amount: first.minimum ?? first.target,
    };
  }
  return { kind: 'none' };
}
