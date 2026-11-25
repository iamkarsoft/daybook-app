import { addDays, addMonths, dow, hm, make, parts, valid, ymd } from './dates.ts'
import type { Repeat } from './repeat.ts'
import type { Priority } from './types.ts'

export interface Chip { type: 'date' | 'time' | 'repeat' | 'priority' | 'tag' | 'list' | 'reminder'; text: string }
export interface Parsed { title: string; due: string | null; time: string | null; repeat: Repeat | null; priority: Priority | null; tags: string[]; list: string | null; reminders: number[]; chips: Chip[] }

const DAY = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const dayIdx = (s: string) => DAY.findIndex((d) => d.startsWith(s.slice(0, 3).toLowerCase()))
const FULL = DAY.join('|')
// Short names need a word in front: "sat" and "sun" are ordinary words on their own.
const SHORT = 'sun|mon|tues?|wed|thu(?:rs?)?|fri|sat'
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }
const num = (s: string) => NUM[s.toLowerCase()] ?? Number(s)
const N = '(\\d{1,3}|an?|one|two|three|four|five|six|seven)'

/**
 * Reads dates, times, repeats, #tags, !priority and ~list out of a typed line.
 * Phrases in `ignore` are left in the title as plain words.
 */
export function parseTask(input: string, now: Date, lists: string[] = [], ignore: string[] = []): Parsed {
  const today = ymd(now), out: Parsed = { title: '', due: null, time: null, repeat: null, priority: null, tags: [], list: null, reminders: [], chips: [] }
  // Claimed characters are blanked in place with \u0001 so later patterns cannot straddle them.
  let s = ` ${input} `
  const skip = new Set(ignore.map((x) => x.toLowerCase()))
  const take = (re: RegExp, type: Chip['type'], fn: (m: RegExpExecArray) => boolean, many = false) => {
    const g = new RegExp(`(?<=[\\s\\u0001])(?:${re.source})(?=[\\s\\u0001,.;!?])`, 'giu')
    let m: RegExpExecArray | null
    while ((m = g.exec(s))) {
      const text = m[0].trim()
      if (skip.has(text.toLowerCase()) || !fn(m)) continue
      out.chips.push({ type, text })
      s = s.slice(0, m.index) + '\u0001'.repeat(m[0].length) + s.slice(m.index + m[0].length)
      if (!many) return true
    }
    return false
  }
  const setDue = (d: string) => { if (out.due) return false; out.due = d; return true }
  const nextDow = (i: number, after = 0) => { let d = addDays(today, 1 + after); while (dow(d) !== i) d = addDays(d, 1); return d }

  take(/#[\p{L}\p{N}_-]+/u, 'tag', (m) => { const t = m[0].slice(1).toLowerCase(); if (/^\d+$/.test(t)) return false; if (!out.tags.includes(t)) out.tags.push(t); return true }, true)
  take(/!(high|med(?:ium)?|low|[123])/, 'priority', (m) => { out.priority = ({ h: 3, m: 2, l: 1, 1: 1, 2: 2, 3: 3 } as Record<string, Priority>)[m[1][0].toLowerCase()]; return true })
  for (const l of [...lists].sort((a, b) => b.length - a.length)) {
    if (take(new RegExp(`~${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}`), 'list', () => { out.list = l; return true })) break
  }
  take(new RegExp(`remind(?: me)? (\\d{1,4}) ?(m|min|mins|minutes?|h|hours?|days?)(?: before)?`), 'reminder', (m) => { out.reminders = [Number(m[1]) * (m[2][0].toLowerCase() === 'm' ? 1 : m[2][0].toLowerCase() === 'h' ? 60 : 1440)]; return true })

  const rep = (r: Omit<Repeat, 'from'>, due?: string) => { if (out.repeat) return false; out.repeat = { from: 'due', ...r }; if (due && !out.due) out.due = due; return true }
  take(/every weekday|weekdays/, 'repeat', () => rep({ freq: 'week', every: 1, days: [1, 2, 3, 4, 5] }, [1, 2, 3, 4, 5].includes(dow(today)) ? today : nextDow(1)))
  take(new RegExp(`every ((?:${FULL}|${SHORT})(?:(?:,| and|, and) ?(?:${FULL}|${SHORT}))*)`), 'repeat', (m) => {
    const days = [...new Set(m[1].toLowerCase().split(/,| and |\s+/).filter((x) => x && x !== 'and').map(dayIdx))]
    let d = today
    while (!days.includes(dow(d))) d = addDays(d, 1)
    return rep({ freq: 'week', every: 1, days }, d)
  })
  take(new RegExp(`every (?:(other|\\d{1,2}) )?(day|week|month|year)s?|daily|weekly|monthly|yearly`), 'repeat', (m) => {
    const freq = (m[2] ?? { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[m[0].trim().toLowerCase() as 'daily'])!.toLowerCase() as Repeat['freq']
    const every = m[1]?.toLowerCase() === 'other' ? 2 : Number(m[1] ?? 1)
    return every > 0 && rep({ freq, every })
  })

  take(/(?:on |by |due )?(today|tonight|tomorrow|tmrw)/, 'date', (m) => { const w = m[1].toLowerCase(); if (!setDue(w[1] === 'm' || w.startsWith('tom') ? addDays(today, 1) : today)) return false; if (w === 'tonight') out.time = '20:00'; return true })
  take(/(?:on |by |due )?(\d{4})-(\d{1,2})-(\d{1,2})/, 'date', (m) => valid(+m[1], +m[2], +m[3]) && setDue(make(+m[1], +m[2], +m[3])))
  const monthDay = (mon: string, d: string, y?: string) => {
    const mi = MON.indexOf(mon.slice(0, 3).toLowerCase()) + 1
    let yy = y ? +y : parts(today).y
    if (!y && valid(yy, mi, +d) && make(yy, mi, +d) < today) yy++
    if (!y && mi === 2 && +d === 29) while (!valid(yy, 2, 29)) yy++
    return valid(yy, mi, +d) && setDue(make(yy, mi, +d))
  }
  take(new RegExp(`(?:on |by |due )?(${MONTH})\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (20\\d\\d))?`), 'date', (m) => monthDay(m[1], m[2], m[3]))
  take(new RegExp(`(?:on |by |due )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?(${MONTH})(?:,? (20\\d\\d))?`), 'date', (m) => monthDay(m[2], m[1], m[3]))
  take(new RegExp(`in ${N} (day|week|month|year)s?`), 'date', (m) => { const n = num(m[1]), u = m[2][0].toLowerCase(); return setDue(u === 'd' ? addDays(today, n) : u === 'w' ? addDays(today, 7 * n) : addMonths(today, u === 'm' ? n : 12 * n)) })
  take(new RegExp(`in ${N} (min(?:ute)?|hour|hr)s?`), 'time', (m) => { if (out.due) return false; const t = new Date(now.getTime() + num(m[1]) * (m[2][0].toLowerCase() === 'm' ? 60000 : 3600000)); out.due = ymd(t); out.time = hm(t); if (!out.reminders.length) out.reminders = [0]; return true })
  take(/next (week|month|year)/, 'date', (m) => setDue(m[1][0].toLowerCase() === 'w' ? nextDow(1) : addMonths(today, m[1][0].toLowerCase() === 'm' ? 1 : 12)))
  take(/this weekend/, 'date', () => setDue([0, 6].includes(dow(today)) ? today : nextDow(6)))
  take(new RegExp(`next (${FULL}|${SHORT})`), 'date', (m) => { const d = nextDow(dayIdx(m[1])); return setDue(d) })
  take(new RegExp(`(?:(?:on|by|due|this) )(${FULL}|${SHORT})|(${FULL})`), 'date', (m) => setDue(nextDow(dayIdx(m[1] ?? m[2]))))

  const setTime = (h: number, mi: number) => { if (out.time || h > 23 || mi > 59) return false; out.time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; return true }
  take(/(?:at |@ ?)?(\d{1,2})(?::(\d\d))? ?(am|pm|a\.m\.|p\.m\.)/, 'time', (m) => { const h = +m[1]; return h >= 1 && h <= 12 && setTime((h % 12) + (m[3][0].toLowerCase() === 'p' ? 12 : 0), +(m[2] ?? 0)) })
  take(/(?:at |@ ?)?([01]?\d|2[0-3]):([0-5]\d)/, 'time', (m) => setTime(+m[1], +m[2]))
  take(/(?:at )?(noon|midnight)/, 'time', (m) => setTime(m[1][0].toLowerCase() === 'n' ? 12 : 0, 0))
  // A bare "at 5" only reads as a time, and as the afternoon, up to 6.
  take(/at (\d{1,2})/, 'time', (m) => { const h = +m[1]; return h >= 1 && h <= 23 && setTime(h <= 6 ? h + 12 : h, 0) })

  if (out.time && !out.due) out.due = out.time > hm(now) ? today : addDays(today, 1)
  if (out.repeat && !out.due) out.due = today
  if (out.repeat && (out.repeat.freq === 'month' || out.repeat.freq === 'year')) out.repeat.anchor = parts(out.due!).d
  if (out.time && !out.reminders.length) out.reminders = [0]
  if (out.reminders.length && !out.due) out.due = today
  out.title = s.replaceAll('\u0001', '').replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').trim()
  return out
}
