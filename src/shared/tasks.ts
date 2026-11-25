import { instant, ymd } from './dates.ts'
import { nextDue } from './repeat.ts'
import type { Op, Task } from './types.ts'

export const uid = () => crypto.randomUUID()
export function newTask(x: Partial<Task>): Task {
  const now = Date.now()
  return { id: uid(), title: '', notes: '', listId: 'inbox', sectionId: null, status: 'open', priority: 0, tags: [], due: null, time: null, duration: 60, reminders: [], snoozeUntil: null, repeat: null, subtasks: [], pinned: false, order: now, createdAt: now, completedAt: null, deletedAt: null, ...x }
}
/** A repeating task leaves a finished copy behind and moves itself to its next date. */
export function completeOps(t: Task, now = new Date()): Op[] {
  const done: Partial<Task> = { status: 'done', completedAt: now.getTime(), snoozeUntil: null }
  const next = t.repeat && t.due ? nextDue(t.repeat, t.due, ymd(now)) : null
  if (!next) return [{ kind: 'task', put: [{ ...t, ...done }] }]
  return [{ kind: 'task', put: [
    { ...t, ...done, id: uid(), repeat: null, subtasks: t.subtasks.map((s) => ({ ...s, id: uid() })) },
    { ...t, due: next, snoozeUntil: null, subtasks: t.subtasks.map((s) => ({ ...s, done: false })) },
  ] }]
}
export function reminderTimes(t: Task, allDayTime: string): number[] {
  if (t.status !== 'open' || t.deletedAt) return []
  const out = t.due ? t.reminders.map((m) => instant(t.due!, t.time ?? allDayTime) - m * 60000) : []
  return t.snoozeUntil ? [...out, t.snoozeUntil] : out
}
const key = (t: Task) => `${t.due ?? '9999'} ${t.time ?? '99:99'}`
export const byDate = (a: Task, b: Task) => key(a).localeCompare(key(b)) || b.priority - a.priority || a.order - b.order
export const byPriority = (a: Task, b: Task) => b.priority - a.priority || byDate(a, b)
export const byManual = (a: Task, b: Task) => a.order - b.order || a.createdAt - b.createdAt
export const byTitle = (a: Task, b: Task) => a.title.localeCompare(b.title)
/** An order value that lands between two neighbours. */
export const between = (a?: number, b?: number) => (a === undefined ? (b === undefined ? Date.now() : b - 1000) : b === undefined ? a + 1000 : (a + b) / 2)
