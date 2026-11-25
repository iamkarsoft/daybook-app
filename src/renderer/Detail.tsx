import { useState } from 'react'
import { addDays, dayLabel, dow, parts } from '../shared/dates.ts'
import { repeatText, type Repeat } from '../shared/repeat.ts'
import { uid } from '../shared/tasks.ts'
import type { Priority, Task } from '../shared/types.ts'
import { Check } from './Row.tsx'
import { call, listsOf, move, mutate, patch, PRIO, reschedule, trash, useStore } from './store.ts'
import { Draft, Icon } from './ui.tsx'

const REM: [number, string][] = [[0, 'On time'], [5, '5 min before'], [15, '15 min before'], [30, '30 min before'], [60, '1 hour before'], [1440, '1 day before']]
const remText = (m: number) => REM.find(([x]) => x === m)?.[1] ?? (m % 1440 === 0 ? `${m / 1440} days before` : m % 60 === 0 ? `${m / 60} hours before` : `${m} min before`)
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function Detail() {
  const id = useStore((s) => s.selected), t = useStore((s) => (id ? s.data.task[id] : undefined))
  if (!t) return null
  return <Inner key={t.id} t={t} />
}
function Inner({ t }: { t: Task }) {
  const data = useStore((s) => s.data), today = useStore((s) => s.today)
  const [sub, setSub] = useState(''), [tag, setTag] = useState('')
  const up = (x: Partial<Task>, l?: string) => patch(t, x, l), close = () => useStore.setState({ selected: null })
  const sections = Object.values(data.section).filter((s) => s.listId === t.listId).sort((a, b) => a.order - b.order)
  const setRepeat = (r: Repeat | null) => up({ repeat: r && { ...r, ...(r.freq === 'month' || r.freq === 'year' ? { anchor: r.anchor ?? parts(t.due!).d } : { anchor: undefined }) } }, 'Change repeat')
  const focused = Object.values(data.focus).filter((f) => f.taskId === t.id).reduce((a, f) => a + f.minutes, 0)
  return (
    <aside className="detail" aria-label="Task details">
      <header><Check t={t} /><span className="muted">{t.deletedAt ? 'In Trash' : t.status === 'done' ? 'Completed' : t.due ? dayLabel(t.due, today) : 'No date'}</span><span className="grow" />
        <button className="ghost" title="Start focus" aria-label="Start focus" onClick={() => call('timer.start', t.id, t.title)}><Icon n="focus" /></button>
        <button className="ghost" title="Move to Trash" aria-label="Move to Trash" onClick={() => trash(t)}><Icon n="trash" /></button><button className="ghost" aria-label="Close details" onClick={close}><Icon n="x" /></button></header>
      <div className="scroll">
        <Draft className="dtitle" aria-label="Title" value={t.title} onSave={(v) => { if (v.trim()) up({ title: v.trim() }, 'Edit title') }} />
        <div className="fields">
          <label>Date<span><input type="date" aria-label="Due date" value={t.due ?? ''} onChange={(e) => { if (!e.target.value || /^[12]\d{3}-/.test(e.target.value)) reschedule(t, e.target.value || null) }} />{t.due && <input type="time" aria-label="Time" value={t.time ?? ''} onChange={(e) => reschedule(t, t.due, e.target.value || null)} />}</span></label>
          <div className="quickdates">{([['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', addDays(today, 7)]] as const).map(([l, d]) => <button key={l} className={t.due === d ? 'on' : ''} onClick={() => reschedule(t, d)}>{l}</button>)}{t.due && <button onClick={() => reschedule(t, null)}>Clear</button>}</div>
          {t.due && <>
            {t.time && <label>Length<select aria-label="Duration" value={t.duration} onChange={(e) => up({ duration: Number(e.target.value) })}>{[...new Set([15, 30, 45, 60, 90, 120, 180, 240, t.duration])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}</select></label>}
            <label>Repeat<select aria-label="Repeat" value={t.repeat ? t.repeat.freq : ''} onChange={(e) => setRepeat(e.target.value ? { freq: e.target.value as Repeat['freq'], every: 1, from: 'due' } : null)}><option value="">Never</option><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="year">Yearly</option></select></label>
            {t.repeat && <div className="sub">
              <div>Every <input type="number" min={1} max={99} aria-label="Interval" value={t.repeat.every} onChange={(e) => setRepeat({ ...t.repeat!, every: Math.max(1, Math.min(99, Math.trunc(Number(e.target.value)) || 1)) })} /> {t.repeat.freq}{t.repeat.every > 1 ? 's' : ''}</div>
              {t.repeat.freq === 'week' && <div className="days">{[1, 2, 3, 4, 5, 6, 0].map((d) => { const days = t.repeat!.days ?? [dow(t.due!)], on = days.includes(d); return <button key={d} aria-label={NAMES[d]} aria-pressed={on} className={on ? 'on' : ''} onClick={() => { const n = on ? days.filter((x) => x !== d) : [...days, d]; if (n.length) setRepeat({ ...t.repeat!, days: n }) }}>{DAYS[d]}</button> })}</div>}
              <div>Count from <select aria-label="Count from" value={t.repeat.from} onChange={(e) => setRepeat({ ...t.repeat!, from: e.target.value as 'due' })}><option value="due">due date</option><option value="done">completion</option></select></div>
              <div>Until <input type="date" aria-label="Repeat until" value={t.repeat.until ?? ''} onChange={(e) => setRepeat({ ...t.repeat!, until: e.target.value || null })} /></div><small className="muted">{repeatText(t.repeat)}</small></div>}
            <label>Remind<select aria-label="Add reminder" value="" onChange={(e) => { const m = Number(e.target.value); if (!t.reminders.includes(m)) up({ reminders: [...t.reminders, m].sort((a, b) => a - b) }, 'Add reminder') }}><option value="" disabled>Add a reminder</option>{REM.map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select></label>
            {t.reminders.length > 0 && <div className="chips">{t.reminders.map((m) => <button key={m} className="chip" onClick={() => up({ reminders: t.reminders.filter((x) => x !== m) }, 'Remove reminder')}>{remText(m)}<Icon n="x" s={10} /></button>)}</div>}
          </>}
          <label>Priority<span className="seg">{([0, 1, 2, 3] as Priority[]).map((p) => <button key={p} className={t.priority === p ? 'on' : ''} onClick={(e) => { e.preventDefault(); up({ priority: p }, 'Set priority') }}>{PRIO[p]}</button>)}</span></label>
          <label>List<select aria-label="List" value={t.listId} onChange={(e) => move(t, e.target.value)}><option value="inbox">Inbox</option>{listsOf(data).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          {sections.length > 0 && <label>Section<select aria-label="Section" value={t.sectionId ?? ''} onChange={(e) => up({ sectionId: e.target.value || null })}><option value="">None</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <label>Tags<input aria-label="Add tag" placeholder="Add a tag" value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { const x = tag.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase(); if (x && !t.tags.includes(x)) up({ tags: [...t.tags, x] }, 'Add tag'); setTag('') } }} /></label>
          {t.tags.length > 0 && <div className="chips">{t.tags.map((x) => <button key={x} className="chip tag" onClick={() => up({ tags: t.tags.filter((y) => y !== x) }, 'Remove tag')}>#{x}<Icon n="x" s={10} /></button>)}</div>}
        </div>
        <h4>Checklist</h4>
        {t.subtasks.map((s) => <div className={`subrow ${s.done ? 'done' : ''}`} key={s.id}><input type="checkbox" aria-label={s.title} checked={s.done} onChange={() => up({ subtasks: t.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) }, 'Check item')} /><Draft aria-label="Checklist item" value={s.title} onSave={(v) => { const cur = useStore.getState().data.task[t.id]?.subtasks ?? []; up({ subtasks: v.trim() ? cur.map((x) => (x.id === s.id ? { ...x, title: v.trim() } : x)) : cur.filter((x) => x.id !== s.id) }, 'Edit item') }} /><button className="ghost small" aria-label={`Remove ${s.title}`} onClick={() => up({ subtasks: t.subtasks.filter((x) => x.id !== s.id) }, 'Remove item')}><Icon n="x" s={11} /></button></div>)}
        <input className="subadd" aria-label="Add checklist item" placeholder="Add an item" value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && sub.trim()) { up({ subtasks: [...t.subtasks, { id: uid(), title: sub.trim(), done: false }] }, 'Add item'); setSub('') } }} />
        <h4>Notes</h4><Draft area className="notes" aria-label="Notes" placeholder="Anything worth remembering" value={t.notes} onSave={(v) => up({ notes: v }, 'Edit notes')} />
        <footer className="muted">Added {new Date(t.createdAt).toLocaleDateString()}{focused > 0 && `. ${focused} min of focus`}{t.deletedAt && <> <button className="link" onClick={() => up({ deletedAt: null }, 'Restore')}>Restore</button> <button className="link bad" onClick={() => { close(); mutate('Deleted forever', [{ kind: 'task', del: [t.id] }], { toast: true }) }}>Delete forever</button></>}</footer>
      </div>
    </aside>
  )
}
