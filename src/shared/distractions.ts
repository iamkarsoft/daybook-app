import { addDays, ymd } from './dates.ts'
import { uid } from './tasks.ts'
import type { Distraction, FocusLog, Timer } from './types.ts'

/** A distraction caught during the running focus session. Its note can be added afterwards. */
export function newDistraction(timer: Timer, note = '', at = Date.now()): Distraction {
  return { id: uid(), at, date: ymd(new Date(at)), note, taskId: timer.taskId, title: timer.title, session: timer.phase === 'focus' ? timer.startedAt : null, penalty: 0 }
}
/** How many distractions the session that started at `startedAt` has so far. */
export const inSession = (ds: Distraction[], startedAt: number) => ds.filter((d) => d.session === startedAt).length

const STOP = new Set('a an and are as at be but by for from got had has have i im i\'m in into is it its it\'s just me my of on or so that the then this to too was were with you your about again kept started'.split(' '))
/** Words that keep coming up in notes, most frequent first. */
export function themes(ds: Distraction[], n = 8): [string, number][] {
  const c = new Map<string, number>()
  for (const d of ds) for (const w of new Set(d.note.toLowerCase().match(/[\p{L}\p{N}'#@.-]+/gu)?.map((w) => w.replace(/^[.'-]+|[.'-]+$/g, '')).filter((w) => w.length > 2 && !STOP.has(w)) ?? [])) c.set(w, (c.get(w) ?? 0) + 1)
  return [...c].filter(([, k]) => k > 1).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n)
}

export interface DistractionStats {
  days: string[]; perDay: number[]; perHour: number[]; total: number; prevTotal: number
  focusMin: number; perHourFocused: number | null; sessions: number; clean: number
  byTask: [string, number][]; themes: [string, number][]; noted: number; penaltyMin: number
}
/** Analytics for the `range` days ending today, compared with the `range` days before. */
export function stats(ds: Distraction[], focus: FocusLog[], today: string, range: number): DistractionStats {
  const days = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1)), from = days[0], prevFrom = addDays(from, -range)
  const inRange = ds.filter((d) => d.date >= from && d.date <= today), sessions = focus.filter((f) => f.date >= from && f.date <= today)
  const perDay = days.map((day) => inRange.filter((d) => d.date === day).length), perHour = Array(24).fill(0)
  for (const d of inRange) perHour[new Date(d.at).getHours()]++
  const bySession = new Map<number, number>()
  for (const d of ds) if (d.session !== null) bySession.set(d.session, (bySession.get(d.session) ?? 0) + 1)
  const focusMin = sessions.reduce((a, f) => a + f.minutes, 0), inLogged = sessions.reduce((a, f) => a + (bySession.get(f.startedAt) ?? 0), 0)
  const tasks = new Map<string, number>()
  for (const d of inRange) { const k = d.title || 'No task'; tasks.set(k, (tasks.get(k) ?? 0) + 1) }
  return {
    days, perDay, perHour, total: inRange.length, prevTotal: ds.filter((d) => d.date >= prevFrom && d.date < from).length,
    focusMin, perHourFocused: focusMin >= 1 ? (inLogged / focusMin) * 60 : null,
    sessions: sessions.length, clean: sessions.filter((f) => !bySession.get(f.startedAt)).length,
    byTask: [...tasks].sort((a, b) => b[1] - a[1]).slice(0, 5), themes: themes(inRange), noted: inRange.filter((d) => d.note.trim()).length, penaltyMin: inRange.reduce((a, d) => a + (d.penalty ?? 0), 0),
  }
}
