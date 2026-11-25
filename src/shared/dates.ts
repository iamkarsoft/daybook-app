// Calendar dates are "YYYY-MM-DD" strings. Arithmetic goes through UTC so DST can never shift a day.
const p2 = (n: number) => String(n).padStart(2, '0')
export const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
export const hm = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`
export const toTime = (min: number) => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`
export const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
export const parts = (s: string) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d } }
const utc = (s: string) => { const { y, m, d } = parts(s); return Date.UTC(y, m - 1, d) }
const from = (t: number) => new Date(t).toISOString().slice(0, 10)
export const addDays = (s: string, n: number) => from(utc(s) + n * 86400000)
export const diffDays = (a: string, b: string) => Math.round((utc(a) - utc(b)) / 86400000)
/** 0 is Sunday. */
export const dow = (s: string) => new Date(utc(s)).getUTCDay()
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
/** `day` is the day of month to aim for, clamped, so a 31st survives short months. */
export function addMonths(s: string, n: number, day = parts(s).d) {
  const { y, m } = parts(s), k = y * 12 + (m - 1) + n, ny = Math.floor(k / 12), nm = (k % 12) + 1
  return `${ny}-${p2(nm)}-${p2(Math.min(day, daysIn(ny, nm)))}`
}
export const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m)
export const make = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`
export const startOfWeek = (s: string, weekStart: number) => addDays(s, -((dow(s) - weekStart + 7) % 7))
/** The instant a local date and time fall on, for reminders. */
export const instant = (date: string, time: string) => { const { y, m, d } = parts(date), [h, i] = time.split(':').map(Number); return new Date(y, m - 1, d, h, i).getTime() }

const local = (s: string) => { const { y, m, d } = parts(s); return new Date(y, m - 1, d, 12) }
export const fmt = (s: string, o: Intl.DateTimeFormatOptions) => local(s).toLocaleDateString(undefined, o)
export function dayLabel(s: string, today: string) {
  const n = diffDays(s, today)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n > 1 && n < 7) return fmt(s, { weekday: 'long' })
  return fmt(s, { month: 'short', day: 'numeric', ...(parts(s).y === parts(today).y ? {} : { year: 'numeric' }) })
}
export const fmtTime = (t: string) => { const [h, m] = t.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }
