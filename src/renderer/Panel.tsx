import { useEffect, useRef, useState } from 'react'
import { addDays, dayLabel, fmt, fmtTime, hm, toMin, ymd } from '../shared/dates.ts'
import { scheduled } from '../shared/habits.ts'
import { byDate, byManual } from '../shared/tasks.ts'
import type { Habit, Task } from '../shared/types.ts'
import { AddBar } from './Add.tsx'
import { clock, useLeft } from './Focus.tsx'
import { Capture } from './Distractions.tsx'
import { Check } from './Row.tsx'
import { bumpHabit, call, fail, inView, menuHandlers, reschedule, tasksOf, undo, useStore, type View } from './store.ts'
import { Icon, Menu, Toast } from './ui.tsx'

const TABS = [['today', 'Today'], ['week', '7 Days'], ['inbox', 'Inbox']] as const
const run = (p: Promise<unknown>) => p.catch(fail)

/** The menu bar panel: today at a glance, without opening the app. */
export function Panel() {
  const { ready, data, today, minute } = useStore()
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('today'), [opened, setOpened] = useState(0), list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    document.body.classList.add('panelwin')
    menuHandlers.undo = () => (/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '') ? call('app.nativeUndo') : undo())
    menuHandlers.panel = () => { useStore.setState({ today: ymd(new Date()), minute: Date.now() }); setOpened((n) => n + 1); list.current?.scrollTo(0, 0) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.menu')) call('panel.close') }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  if (!ready) return null
  const view = { t: tab } as View, tasks = tasksOf(data).filter((t) => inView(view, t, today))
  const groups: [string, Task[], boolean?][] = tab === 'inbox' ? [['', tasks.sort(byManual)]] : [
    ['Overdue', tasks.filter((t) => t.due! < today).sort(byDate), true],
    ...Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d): [string, Task[]] => [tab === 'today' ? '' : dayLabel(d, today), tasks.filter((t) => t.due === d).sort(byDate)]),
  ]
  const done = tasksOf(data).filter((t) => t.status === 'done' && !t.deletedAt && t.completedAt && ymd(new Date(t.completedAt)) === today).length
  const next = tasksOf(data).filter((t) => inView({ t: 'today' }, t, today) && t.due === today && t.time && t.time >= hm(new Date(minute))).sort(byDate)[0]
  const habits = Object.values(data.habit).filter((h) => !h.archived && scheduled(h, today)).sort((a, b) => a.order - b.order)
  return (
    <div className="panel">
      <header><h1>{fmt(today, { weekday: 'long' })}</h1><span>{fmt(today, { month: 'short', day: 'numeric' })}</span><span className="grow" /><button className="ghost" aria-label="Open Daybook" title="Open Daybook" onClick={() => call('app.show', null)}><Icon n="board" /></button></header>
      <FocusStrip />
      <Capture className="inpanel" />
      {next && tab === 'today' && <p className="nextup">Next: {next.title} <b>{until(toMin(next.time!) - toMin(hm(new Date(minute))))}</b></p>}
      <AddBar key={`${opened}${tab}`} auto preset={tab === 'inbox' ? {} : { due: today }} placeholder={tab === 'inbox' ? 'Add to Inbox' : 'Add for today'} onEscape={() => call('panel.close')} />
      <div className="seg" role="tablist">{TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}<small>{tasksOf(data).filter((t) => inView({ t: k } as View, t, today)).length || ''}</small></button>)}</div>
      <div className="scroll" ref={list}>
        {groups.filter(([, ts]) => ts.length).map(([label, ts, late]) => <section key={label || 'x'}>{label && <h3 className={late ? 'late' : ''}>{label}</h3>}{ts.map((t) => <PanelRow key={t.id} t={t} today={today} late={late} />)}</section>)}
        {!tasks.length && <p className="nothing">{tab === 'inbox' ? 'Inbox is clear.' : done && tab === 'today' ? 'All done for today.' : 'Nothing due.'}</p>}
      </div>
      {habits.length > 0 && <div className="phabits">{habits.map((h) => <HabitDot key={h.id} h={h} today={today} />)}</div>}
      <footer className="muted"><span>{done ? `${done} done today` : 'Nothing finished yet today'}</span><button className="link" onClick={() => call('app.show', null)}>Open Daybook</button></footer>
      <Toast />
    </div>
  )
}
const until = (m: number) => (m < 1 ? 'now' : m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`)

function PanelRow({ t, today, late }: { t: Task; today: string; late?: boolean }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null), list = useStore((s) => s.data.list[t.listId])
  return <div className="prow" data-task={t.id} onContextMenu={(e) => { e.preventDefault(); setAt({ x: e.clientX, y: e.clientY }) }}><Check t={t} />
    <button className="ptitle" title="Open in Daybook" onClick={() => call('app.show', t.id)}><span>{t.title}</span>{list && <i style={{ background: list.color }} title={list.name} />}</button>
    {(t.time || late) && <small className={late ? 'late' : ''}>{late ? dayLabel(t.due!, today) : fmtTime(t.time!)}</small>}
    <button className="ghost small hov" aria-label={`Focus on ${t.title}`} title="Start focus" onClick={() => run(call('timer.start', t.id, t.title))}><Icon n="play" s={12} /></button>
    <button className="ghost small hov" aria-label={`Reschedule ${t.title}`} title="Reschedule" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.right - 150, y: r.bottom + 2 }) }}><Icon n="cal" s={13} /></button>
    {at && <Menu at={at} onClose={() => setAt(null)} items={[{ label: 'Today', run: () => reschedule(t, today) }, { label: 'Tomorrow', run: () => reschedule(t, addDays(today, 1)) }, { label: 'Next week', run: () => reschedule(t, addDays(today, 7)) }, { label: 'No date', run: () => reschedule(t, null) }]} />}</div>
}
function FocusStrip() {
  const t = useStore((s) => s.timer), left = useLeft()
  if (t.phase === 'idle') return <div className="strip"><Icon n="focus" /><span>{t.done ? `${t.done} focus ${t.done === 1 ? 'session' : 'sessions'}` : 'Focus'}</span>{t.done > 0 && <button onClick={() => run(call('timer.break'))}>Break</button>}<button onClick={() => run(call('timer.start', null, ''))}>Start</button></div>
  return <div className={`strip on ph-${t.phase}`} style={{ '--f': `${t.total ? (1 - left / t.total) * 100 : 0}%` } as React.CSSProperties}><b>{clock(left)}</b><span>{t.phase === 'break' ? 'Break' : t.title || 'Focusing'}</span>
    {t.endsAt ? <button className="ghost" aria-label="Pause" onClick={() => run(call('timer.pause'))}><Icon n="pause" s={14} /></button> : <button className="ghost" aria-label="Resume" onClick={() => run(call('timer.resume'))}><Icon n="play" s={13} /></button>}<button className="ghost" aria-label={t.phase === 'break' ? 'Skip break' : 'End focus'} onClick={() => run(call('timer.stop'))}><Icon n="x" s={14} /></button></div>
}
function HabitDot({ h, today }: { h: Habit; today: string }) {
  const c = useStore((s) => s.data.log[`${h.id}:${today}`]?.count ?? 0), f = Math.min(1, c / h.goal)
  return <button className="hdot" style={{ '--c': h.color } as React.CSSProperties} aria-label={`${h.name}: ${c} of ${h.goal}`} title={`${h.name}: ${c} of ${h.goal} ${h.unit}`} onClick={() => bumpHabit(h, today)}><i className={`ring ${f >= 1 ? 'full' : ''}`} style={{ '--f': `${f * 360}deg` } as React.CSSProperties}>{f >= 1 ? <Icon n="done" s={12} /> : c || ''}</i><span>{h.name}</span></button>
}
