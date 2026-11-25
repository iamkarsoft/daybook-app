import { addDays, dow } from './dates.ts'
import type { Habit, HabitLog } from './types.ts'
export const logId = (habitId: string, date: string) => `${habitId}:${date}`
export const scheduled = (h: Habit, d: string) => h.days.includes(dow(d))
/** Consecutive scheduled days met. Today only counts once done, and never breaks a streak. */
export function streak(h: Habit, logs: Map<string, HabitLog>, today: string): number {
  if (!h.days.length) return 0
  const met = (d: string) => (logs.get(logId(h.id, d))?.count ?? 0) >= h.goal
  let n = met(today) ? 1 : 0
  for (let d = addDays(today, -1), i = 0; i < 4000; d = addDays(d, -1), i++) { if (met(d)) n++; else if (scheduled(h, d)) break }
  return n
}
