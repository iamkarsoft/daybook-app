import { useState } from 'react'
import { addDays, dow, fmt, parts } from '../shared/dates.ts'
import { logId, scheduled, streak } from '../shared/habits.ts'
import type { Habit } from '../shared/types.ts'
import { bumpHabit, COLORS, mutate, newId, useStore } from './store.ts'
import { Icon, MenuButton, Modal } from './ui.tsx'

const D = [['S', 'Sunday'], ['M', 'Monday'], ['T', 'Tuesday'], ['W', 'Wednesday'], ['T', 'Thursday'], ['F', 'Friday'], ['S', 'Saturday']]
export function Habits() {
  const data = useStore((s) => s.data), today = useStore((s) => s.today), [edit, setEdit] = useState<Habit | null>(null), [open, setOpen] = useState<string | null>(null)
  const habits = Object.values(data.habit).filter((h) => !h.archived).sort((a, b) => a.order - b.order), logs = new Map(Object.entries(data.log)), days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const blank = (): Habit => ({ id: newId(), name: '', color: COLORS[habits.length % COLORS.length], goal: 1, unit: '', days: [0, 1, 2, 3, 4, 5, 6], order: Date.now(), createdOn: today, archived: false })
  const count = (h: Habit, d: string) => logs.get(logId(h.id, d))?.count ?? 0
  return <div className="page"><header className="head"><h1>Habits</h1><span className="grow" /><button className="primary" onClick={() => setEdit(blank())}><Icon n="plus" s={13} /> New Habit</button></header>
    <div className="scroll">{!habits.length && <p className="nothing">Add something you want to do regularly.</p>}
      {habits.length > 0 && <div className="hrow hh"><span />{days.map((d) => <span key={d} className={d === today ? 'today' : ''}>{fmt(d, { weekday: 'short' })}<b>{parts(d).d}</b></span>)}<span>Streak</span><span /></div>}
      {habits.map((h) => <div key={h.id} className="habit" style={{ '--c': h.color } as React.CSSProperties}><div className="hrow"><button className="hname" aria-expanded={open === h.id} onClick={() => setOpen(open === h.id ? null : h.id)}><b>{h.name}</b>{h.goal > 1 && <small>{count(h, today)} of {h.goal} {h.unit}</small>}</button>
        {days.map((d) => { const c = count(h, d), f = Math.min(1, c / h.goal); return <button key={d} className={`ring ${f >= 1 ? 'full' : ''} ${scheduled(h, d) ? '' : 'off'}`} aria-label={`${h.name}, ${fmt(d, { weekday: 'long' })}: ${c} of ${h.goal}`} style={{ '--f': `${f * 360}deg` } as React.CSSProperties} onClick={() => bumpHabit(h, d)}>{f >= 1 ? <Icon n="done" s={14} /> : c > 0 ? c : ''}</button> })}
        <span className="streak">{streak(h, logs, today)}</span><MenuButton label={`Options for ${h.name}`} items={[{ label: 'Edit', run: () => setEdit(h) }, { label: 'Archive', run: () => mutate('Archived habit', [{ kind: 'habit', put: [{ ...h, archived: true }] }], { toast: true }) }, { label: 'Delete', danger: true, run: () => mutate('Deleted habit', [{ kind: 'habit', del: [h.id] }, { kind: 'log', del: Object.values(data.log).filter((l) => l.habitId === h.id).map((l) => l.id) }], { toast: true }) }]}><Icon n="more" /></MenuButton></div>
        {open === h.id && <Heat h={h} count={(d) => count(h, d)} today={today} />}</div>)}</div>
    {edit && <Modal title={data.habit[edit.id] ? 'Edit habit' : 'New habit'} onClose={() => setEdit(null)}><form className="form" onSubmit={(e) => { e.preventDefault(); if (!edit.name.trim() || !edit.days.length) return; mutate('Save habit', [{ kind: 'habit', put: [{ ...edit, name: edit.name.trim() }] }]); setEdit(null) }}>
      <label>Name<input autoFocus value={edit.name} placeholder="Read" onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
      <div className="two"><label>Times a day<input type="number" min={1} max={99} value={edit.goal} onChange={(e) => setEdit({ ...edit, goal: Math.max(1, Math.min(99, Math.trunc(Number(e.target.value)) || 1)) })} /></label><label>Unit<input value={edit.unit} placeholder="glasses" onChange={(e) => setEdit({ ...edit, unit: e.target.value })} /></label></div>
      <div className="days">{[1, 2, 3, 4, 5, 6, 0].map((d) => <button type="button" key={d} aria-label={D[d][1]} aria-pressed={edit.days.includes(d)} className={edit.days.includes(d) ? 'on' : ''} onClick={() => setEdit({ ...edit, days: edit.days.includes(d) ? edit.days.filter((x) => x !== d) : [...edit.days, d] })}>{D[d][0]}</button>)}</div>
      <div className="swatches">{COLORS.map((c) => <button type="button" key={c} aria-label={`Color ${c}`} aria-pressed={edit.color === c} className={edit.color === c ? 'on' : ''} style={{ background: c }} onClick={() => setEdit({ ...edit, color: c })} />)}</div>
      <div className="actions"><button type="button" onClick={() => setEdit(null)}>Cancel</button><button className="primary" disabled={!edit.name.trim() || !edit.days.length}>Save Habit</button></div></form></Modal>}</div>
}
function Heat({ h, count, today }: { h: Habit; count(d: string): number; today: string }) {
  const start = addDays(today, -7 * 17 - ((dow(today) + 6) % 7)), days = Array.from({ length: 18 * 7 }, (_, i) => addDays(start, i))
  return <div className="heat">{days.map((d) => <i key={d} title={`${fmt(d, { month: 'short', day: 'numeric' })}: ${count(d)}`} className={d > today ? 'future' : ''} style={{ '--o': `${Math.min(1, count(d) / h.goal) * 100}%` } as React.CSSProperties} />)}</div>
}
