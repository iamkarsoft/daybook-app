import { addDays, addMonths, dow, fmt, parts, startOfWeek } from './dates.ts'

export interface Repeat {
  freq: 'day' | 'week' | 'month' | 'year'
  every: number
  /** Weekly only: 0 is Sunday. */
  days?: number[]
  /** Monthly and yearly: the day of month to aim for, so Jan 31 gives Feb 28 and then Mar 31. */
  anchor?: number
  /** Count from the due date, or from the day it was completed. */
  from: 'due' | 'done'
  until?: string | null
}

function step(r: Repeat, d: string): string {
  const n = Math.max(1, Math.trunc(r.every))
  if (r.freq === 'day') return addDays(d, n)
  if (r.freq === 'month') return addMonths(d, n, r.anchor ?? parts(d).d)
  if (r.freq === 'year') return addMonths(d, 12 * n, r.anchor ?? parts(d).d)
  if (!r.days?.length) return addDays(d, 7 * n)
  // Finish this week's remaining days, then jump to the first chosen day n weeks on.
  const week = startOfWeek(d, 1), pos = r.days.map((x) => (x + 6) % 7).sort((a, b) => a - b), here = (dow(d) + 6) % 7
  const later = pos.find((x) => x > here)
  return later !== undefined ? addDays(week, later) : addDays(week, 7 * n + pos[0])
}

/** The next date after `due`, skipping any already missed, or null when the series is over. */
export function nextDue(r: Repeat, due: string, doneOn: string): string | null {
  let d = step(r, r.from === 'done' ? doneOn : due)
  if (r.from === 'due') for (let i = 0; d < doneOn && i < 40000; i++) d = step(r, d)
  return r.until && d > r.until ? null : d
}

/** Every occurrence inside [a, b], including `due` itself. Used to draw future repeats. */
export function occurrences(r: Repeat, due: string, a: string, b: string): string[] {
  const out: string[] = []
  for (let d = due, i = 0; d <= b && i < 40000; d = step(r, d), i++) {
    if (r.until && d > r.until) break
    if (d >= a) out.push(d)
    if (r.from === 'done') break
  }
  return out
}

const WK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function repeatText(r: Repeat): string {
  const weekdays = r.freq === 'week' && r.every === 1 && r.days?.length === 5 && [1, 2, 3, 4, 5].every((d) => r.days!.includes(d))
  const base = weekdays ? 'Every weekday' : r.every === 1 ? `Every ${r.freq}` : `Every ${r.every} ${r.freq}s`
  const days = r.freq === 'week' && r.days?.length && !weekdays ? ` on ${[...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WK[d]).join(', ')}` : ''
  return base + days + (r.from === 'done' ? ', after completion' : '') + (r.until ? `, until ${fmt(r.until, { month: 'short', day: 'numeric', year: 'numeric' })}` : '')
}

/** The subset of RRULE this app supports; null for anything it would get wrong. */
export function parseRRule(s: string, due: string | null): Repeat | null {
  const m = Object.fromEntries(s.replace(/^.*RRULE:/i, '').split(';').map((x) => x.split('=').map((y) => y.trim().toUpperCase())).filter((x) => x.length === 2)) as Record<string, string>
  const freq = ({ DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as Record<string, Repeat['freq'] | undefined>)[m.FREQ]
  if (!freq) return null
  if (Object.keys(m).some((k) => !['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'UNTIL', 'WKST', 'TT_SKIP'].includes(k))) return null
  const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  const days = m.BYDAY?.split(',').map((d) => CODES.indexOf(d))
  if (days && (freq !== 'week' || days.includes(-1))) return null
  const md = m.BYMONTHDAY ? Number(m.BYMONTHDAY) : due ? parts(due).d : undefined
  if (m.BYMONTHDAY && (!Number.isInteger(md) || md! < 1 || md! > 31)) return null
  const u = /^(\d{4})(\d\d)(\d\d)/.exec(m.UNTIL ?? '')
  return { freq, every: Math.max(1, Number(m.INTERVAL) || 1), from: 'due', ...(days ? { days } : {}), ...((freq === 'month' || freq === 'year') && md ? { anchor: md } : {}), ...(u ? { until: `${u[1]}-${u[2]}-${u[3]}` } : {}) }
}
