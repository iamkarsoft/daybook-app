import { useEffect, useRef, useState } from 'react'
import { addDays, addMonths, fmt, fmtTime, hm, parts, startOfWeek, toMin, toTime } from '../shared/dates.ts'
import { occurrences } from '../shared/repeat.ts'
import { byDate } from '../shared/tasks.ts'
import type { Task } from '../shared/types.ts'
import { reschedule, settingsOf, tasksOf, useStore } from './store.ts'
import { dragProps, Icon, useDrop } from './ui.tsx'

interface Ev { t: Task; date: string; ghost: boolean }
function eventsIn(tasks: Task[], a: string, b: string): Map<string, Ev[]> {
  const m = new Map<string, Ev[]>(), add = (e: Ev) => m.set(e.date, [...(m.get(e.date) ?? []), e])
  for (const t of tasks) {
    if (!t.due || t.deletedAt) continue
    if (t.repeat && t.status === 'open') for (const d of occurrences(t.repeat, t.due, a, b)) add({ t, date: d, ghost: d !== t.due })
    else if (t.due >= a && t.due <= b) add({ t, date: t.due, ghost: false })
  }
  for (const v of m.values()) v.sort((x, y) => Number(x.t.status === 'done') - Number(y.t.status === 'done') || byDate({ ...x.t, due: null }, { ...y.t, due: null }))
  return m
}
const pick = (id: string) => useStore.setState({ selected: id })
function Pill({ e, time }: { e: Ev; time?: boolean }) {
  const color = useStore((s) => s.data.list[e.t.listId]?.color ?? 'var(--accent)')
  // Only the real date can be dragged; later repeats are a preview.
  return <button className={`pill ${e.t.status} ${e.ghost ? 'ghosted' : ''}`} data-task={e.t.id} style={{ '--c': color } as React.CSSProperties} title={e.t.title} {...(e.ghost || e.t.status === 'done' ? {} : dragProps(e.t.id))} onClick={(x) => { x.stopPropagation(); pick(e.t.id) }}>{time && e.t.time && <small>{fmtTime(e.t.time)}</small>}<span>{e.t.title}</span></button>
}
export function Calendar() {
  const data = useStore((s) => s.data), today = useStore((s) => s.today), [mode, setMode] = useState<'month' | 'week'>('month'), [at, setAt] = useState(today)
  const ws = settingsOf(data).weekStart
  const start = mode === 'month' ? startOfWeek(addMonths(at, 0, 1), ws) : startOfWeek(at, ws), n = mode === 'month' ? 42 : 7
  const days = Array.from({ length: n }, (_, i) => addDays(start, i)), ev = eventsIn(tasksOf(data), days[0], days[n - 1])
  const step = (k: number) => setAt(mode === 'month' ? addMonths(at, k, 1) : addDays(at, 7 * k))
  return (
    <div className="page">
      <header className="head"><h1>{fmt(mode === 'month' ? addMonths(at, 0, 1) : start, { month: 'long', year: 'numeric' })}</h1><span className="grow" />
        <button className="ghost" aria-label="Previous" onClick={() => step(-1)}><Icon n="left" /></button><button onClick={() => setAt(today)}>Today</button><button className="ghost" aria-label="Next" onClick={() => step(1)}><Icon n="right" /></button>
        <div className="seg">{(['month', 'week'] as const).map((m) => <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'month' ? 'Month' : 'Week'}</button>)}</div></header>
      {mode === 'month' ? <div className="month"><div className="dow">{days.slice(0, 7).map((d) => <span key={d}>{fmt(d, { weekday: 'short' })}</span>)}</div><div className="cells">{days.map((d) => <Cell key={d} d={d} ev={ev.get(d) ?? []} out={parts(d).m !== parts(at).m} today={d === today} onMore={() => { setAt(d); setMode('week') }} />)}</div></div> : <Week days={days} ev={ev} today={today} />}
    </div>
  )
}
function Cell({ d, ev, out, today, onMore }: { d: string; ev: Ev[]; out: boolean; today: boolean; onMore(): void }) {
  const drop = useDrop((id) => { const t = useStore.getState().data.task[id]; if (t && t.due !== d) reschedule(t, d) }), max = 3
  return <div className={`cell ${out ? 'out' : ''} ${today ? 'today' : ''} ${drop.over ? 'over' : ''}`} data-date={d} {...drop.props} onDoubleClick={() => useStore.setState({ compose: { due: d } })}><b>{parts(d).d}</b>{ev.slice(0, ev.length > max ? max - 1 : max).map((e) => <Pill key={e.t.id + e.date} e={e} time />)}{ev.length > max && <button className="link" onClick={onMore}>{ev.length - max + 1} more</button>}</div>
}
const HOUR = 46
function Week({ days, ev, today }: { days: string[]; ev: Map<string, Ev[]>; today: string }) {
  const ref = useRef<HTMLDivElement>(null), minute = useStore((s) => s.minute)
  useEffect(() => { ref.current!.scrollTop = HOUR * 7.5 }, [])
  return <div className="week"><div className="wrow wh"><span />{days.map((d) => <div key={d} className={d === today ? 'today' : ''}><small>{fmt(d, { weekday: 'short' })}</small><b>{parts(d).d}</b></div>)}</div>
    <div className="wrow allday"><span className="muted">all day</span>{days.map((d) => <AllDay key={d} d={d} ev={(ev.get(d) ?? []).filter((e) => !e.t.time)} />)}</div>
    <div className="wscroll" ref={ref}><div className="wrow wgrid" style={{ height: HOUR * 24 }}><span className="hours">{Array.from({ length: 23 }, (_, i) => <small key={i} style={{ top: (i + 1) * HOUR - 7 }}>{fmtTime(toTime((i + 1) * 60)).replace(':00', '')}</small>)}</span>{days.map((d) => <DayCol key={d} d={d} ev={(ev.get(d) ?? []).filter((e) => e.t.time)} now={d === today ? toMin(hm(new Date(minute))) : null} />)}</div></div></div>
}
function AllDay({ d, ev }: { d: string; ev: Ev[] }) {
  const drop = useDrop((id) => { const t = useStore.getState().data.task[id]; if (t) reschedule(t, d, null) })
  return <div className={drop.over ? 'over' : ''} {...drop.props} onDoubleClick={() => useStore.setState({ compose: { due: d } })}>{ev.map((e) => <Pill key={e.t.id} e={e} />)}</div>
}
function DayCol({ d, ev, now }: { d: string; ev: Ev[]; now: number | null }) {
  const ref = useRef<HTMLDivElement>(null), snap = (y: number) => toTime(Math.max(0, Math.min(1425, Math.round(((y - ref.current!.getBoundingClientRect().top) / HOUR) * 4) * 15)))
  const drop = useDrop((id, e) => { const t = useStore.getState().data.task[id]; if (t) reschedule(t, d, snap(e.clientY)) })
  // Overlapping events share the width, one lane each.
  const ends: number[] = [], laid = [...ev].sort((a, b) => toMin(a.t.time!) - toMin(b.t.time!)).map((e) => { const s = toMin(e.t.time!); let lane = ends.findIndex((x) => x <= s); if (lane < 0) lane = ends.length; ends[lane] = s + Math.max(25, e.t.duration); return { e, s, lane } })
  return <div ref={ref} className={`daycol ${drop.over ? 'over' : ''}`} data-date={d} {...drop.props} onDoubleClick={(e) => useStore.setState({ compose: { due: d, time: snap(e.clientY) } })}>{laid.map(({ e, s, lane }) => <div key={e.t.id + e.date} className="slot" style={{ top: (s / 60) * HOUR, height: Math.max(20, (Math.min(e.t.duration, 1440 - s) / 60) * HOUR - 2), left: `${(lane / ends.length) * 100}%`, width: `${100 / ends.length}%` }}><Pill e={e} time /></div>)}{now !== null && <i className="now" style={{ top: (now / 60) * HOUR }} />}</div>
}
