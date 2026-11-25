import { useState } from 'react'
import { addDays, dayLabel, fmt, fmtTime, hm, toMin, ymd } from '../shared/dates.ts'
import { between, byDate, byManual, byPriority, byTitle } from '../shared/tasks.ts'
import type { SortKey, Task } from '../shared/types.ts'
import { AddBar } from './Add.tsx'
import { Check, Meta, Row, taskMenu } from './Row.tsx'
import { ask, deleteList, inView, listsOf, mutate, newId, patch, PRIO, setSort, settingsOf, tasksOf, toast, useStore, type View } from './store.ts'
import { Draft, dragProps, Icon, Menu, MenuButton, useDrop } from './ui.tsx'

const NAMES: Record<string, string> = { today: 'Today', week: 'Next 7 Days', inbox: 'Inbox', all: 'All Tasks', done: 'Completed', trash: 'Trash' }
interface Group { key: string; label: string; tasks: Task[]; section?: string | null; late?: boolean }

function groupsFor(v: View, tasks: Task[], sort: SortKey, today: string, sections: { id: string; name: string }[]): Group[] {
  const pinned = v.t === 'done' || v.t === 'trash' ? [] : tasks.filter((t) => t.pinned), rest = tasks.filter((t) => !pinned.includes(t))
  const out: Group[] = pinned.length ? [{ key: 'pin', label: 'Pinned', tasks: pinned.sort(byDate) }] : []
  const add = (key: string, label: string, ts: Task[], x: Partial<Group> = {}) => { if (ts.length || x.section !== undefined) out.push({ key, label, tasks: ts, ...x }) }
  if (v.t === 'done' || v.t === 'trash') {
    const stamp = (t: Task) => (v.t === 'done' ? t.completedAt : t.deletedAt) ?? 0, m = new Map<string, Task[]>()
    for (const t of rest.sort((a, b) => stamp(b) - stamp(a)).slice(0, 500)) { const d = ymd(new Date(stamp(t))); m.set(d, [...(m.get(d) ?? []), t]) }
    for (const [d, ts] of m) add(d, dayLabel(d, today), ts)
  } else if (sort === 'manual') {
    if (v.t !== 'list') add('m', '', rest.sort(byManual))
    else { add('none', sections.length ? 'No section' : '', rest.filter((t) => !sections.some((s) => s.id === t.sectionId)).sort(byManual), { section: null }); for (const s of sections) add(s.id, s.name, rest.filter((t) => t.sectionId === s.id).sort(byManual), { section: s.id }) }
  } else if (sort === 'priority') for (const p of [3, 2, 1, 0] as const) add('p' + p, p ? `${PRIO[p]} priority` : 'No priority', rest.filter((t) => t.priority === p).sort(byPriority))
  else if (sort === 'title') add('t', '', rest.sort(byTitle))
  else {
    const wk = addDays(today, 6)
    add('late', 'Overdue', rest.filter((t) => t.due && t.due < today).sort(byDate), { late: true })
    for (let i = 0; i < 7; i++) { const d = addDays(today, i); add(d, v.t === 'today' ? '' : i < 2 ? dayLabel(d, today) : fmt(d, { weekday: 'long', month: 'short', day: 'numeric' }), rest.filter((t) => t.due === d).sort(byDate)) }
    add('later', 'Later', rest.filter((t) => t.due && t.due > wk).sort(byDate)); add('nodate', 'No date', rest.filter((t) => !t.due).sort(byManual))
  }
  return out
}

/** Today's timed tasks on one strip, with a marker for now. */
function DayBar({ tasks }: { tasks: Task[] }) {
  const minute = useStore((s) => s.minute), timed = tasks.filter((t) => t.time).sort(byDate)
  if (!timed.length) return null
  const now = toMin(hm(new Date(minute))), lo = Math.min(480, now - 30, ...timed.map((t) => toMin(t.time!))), hi = Math.max(1200, now + 30, ...timed.map((t) => Math.min(1440, toMin(t.time!) + t.duration)))
  const x = (m: number) => `${((m - lo) / (hi - lo)) * 100}%`
  return <div className="daybar" aria-hidden>{Array.from({ length: 24 }, (_, h) => h * 60).filter((m) => m > lo && m < hi && m % 120 === 0).map((m) => <small key={m} style={{ left: x(m) }}>{fmtTime(`${m / 60}:00`.padStart(5, '0')).replace(':00', '')}</small>)}
    {timed.map((t) => <button key={t.id} tabIndex={-1} title={`${fmtTime(t.time!)} ${t.title}`} className={`p${t.priority}`} style={{ left: x(toMin(t.time!)), width: `${(Math.min(t.duration, 1440 - toMin(t.time!)) / (hi - lo)) * 100}%` }} onClick={() => useStore.setState({ selected: t.id })}>{t.title}</button>)}<i style={{ left: x(now) }} /></div>
}

export function ListView({ view }: { view: View }) {
  const data = useStore((s) => s.data), today = useStore((s) => s.today)
  const list = view.t === 'list' ? data.list[view.id] : null
  const key = view.t === 'list' ? view.id : view.t === 'tag' ? `tag:${view.id}` : view.t
  const sort: SortKey = settingsOf(data).sort[key] ?? (view.t === 'list' || view.t === 'inbox' ? 'manual' : 'date')
  const sections = list ? Object.values(data.section).filter((s) => s.listId === list.id).sort((a, b) => a.order - b.order) : []
  const tasks = tasksOf(data).filter((t) => inView(view, t, today))
  const archive = view.t === 'done' || view.t === 'trash'
  const preset: Partial<Task> = view.t === 'today' || view.t === 'week' ? { due: today } : list ? { listId: list.id } : view.t === 'tag' ? { tags: [view.id] } : {}
  const board = list?.view === 'board'
  const addSection = () => mutate('Add section', [{ kind: 'section', put: [{ id: newId(), listId: list!.id, name: 'New section', order: (sections.at(-1)?.order ?? 0) + 1 }] }])
  async function emptyTrash() { if (await ask('Empty Trash?', `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} will be deleted.`, 'Empty Trash')) mutate('Emptied Trash', [{ kind: 'task', del: tasks.map((t) => t.id) }], { toast: true }) }
  const doneToday = view.t === 'today' ? tasksOf(data).filter((t) => t.status === 'done' && !t.deletedAt && t.completedAt && ymd(new Date(t.completedAt)) === today) : []
  return (
    <div className="page">
      <header className="head">
        {list ? <><i className="blob" style={{ background: list.color }} /><h1><Draft key={list.id} aria-label="List name" value={list.name} onSave={(v) => { if (v.trim()) mutate('Rename list', [{ kind: 'list', put: [{ ...list, name: v.trim() }] }]) }} /></h1></>
          : view.t === 'today' ? <div className="dateline"><h1>{fmt(today, { weekday: 'long' })}</h1><span>{fmt(today, { month: 'long', day: 'numeric' })}</span></div> : <h1>{view.t === 'tag' ? `#${view.id}` : NAMES[view.t]}</h1>}
        <span className="grow" />
        {list && <><div className="seg">{(['list', 'board'] as const).map((x) => <button key={x} className={list.view === x ? 'on' : ''} onClick={() => mutate('Change view', [{ kind: 'list', put: [{ ...list, view: x }] }])}>{x === 'list' ? 'List' : 'Board'}</button>)}</div></>}
        {!archive && !board && <MenuButton label="Sort" items={(['date', 'priority', ...(view.t === 'today' || view.t === 'week' ? [] : ['manual']), 'title'] as SortKey[]).map((s) => ({ label: { date: 'By date', priority: 'By priority', manual: 'By hand', title: 'By title' }[s], on: s === sort, run: () => setSort(key, s) }))}><span>{{ date: 'By date', priority: 'By priority', manual: 'By hand', title: 'By title' }[sort]}</span></MenuButton>}
        {list && <MenuButton label="List options" items={[{ label: 'Add section', run: addSection }, '-', { label: 'Delete list', danger: true, run: () => deleteList(list) }]}><Icon n="more" /></MenuButton>}
        {view.t === 'trash' && tasks.length > 0 && <button onClick={emptyTrash}>Empty Trash</button>}
      </header>
      {view.t === 'today' && <DayBar tasks={tasks.filter((t) => t.due === today)} />}
      {!archive && <AddBar key={key} hotkey preset={preset} />}
      {board ? <Board listId={list!.id} tasks={tasks} sections={sections} addSection={addSection} /> : (
        <div className="scroll">
          {groupsFor(view, tasks, sort, today, sections).map((g) => <GroupBlock key={g.key} g={g} manual={sort === 'manual'} showList={view.t !== 'list' && view.t !== 'inbox'} hideDue={!archive && !g.late && (sort === 'date' && g.key !== 'later' && g.key !== 'pin')} />)}
          {!tasks.length && <p className="nothing">{view.t === 'today' ? (doneToday.length ? 'All done for today.' : 'Nothing due today.') : view.t === 'trash' ? 'Trash is empty.' : view.t === 'done' ? 'Finished tasks will collect here.' : 'No tasks here yet.'}</p>}
          {doneToday.length > 0 && <GroupBlock g={{ key: 'dt', label: 'Done today', tasks: doneToday.sort((a, b) => b.completedAt! - a.completedAt!) }} showList hideDue manual={false} />}
        </div>)}
    </div>
  )
}
function place(id: string, before: Task | null, siblings: Task[], sectionId: string | null | undefined, listId?: string) {
  const t = useStore.getState().data.task[id]
  if (!t || t.id === before?.id) return
  const rest = siblings.filter((x) => x.id !== id), i = before ? rest.findIndex((x) => x.id === before.id) : rest.length
  const order = between(rest[i - 1]?.order, rest[i]?.order)
  // Repeated halving runs out of precision; renumber the group when it does.
  if (rest[i - 1] && rest[i] && (order <= rest[i - 1].order || order >= rest[i].order)) { const all = [...rest.slice(0, i), t, ...rest.slice(i)]; mutate('Reorder', [{ kind: 'task', put: all.map((x, k) => ({ ...x, order: k * 1000, ...(x.id === id ? { sectionId: sectionId === undefined ? x.sectionId : sectionId } : {}) })) }]); return }
  patch(t, { order, ...(sectionId === undefined ? {} : { sectionId }), ...(listId ? { listId } : {}) }, 'Reorder')
}
function GroupBlock({ g, manual, showList, hideDue }: { g: Group; manual: boolean; showList: boolean; hideDue: boolean }) {
  const [shut, setShut] = useState(false), sec = useStore((s) => (g.section ? s.data.section[g.section] : null))
  const end = useDrop((id) => place(id, null, g.tasks, g.section)), can = manual && g.key !== 'pin' && g.key !== 'dt'
  return (
    <section className={`group ${end.over && can ? 'over' : ''}`} {...(can ? end.props : {})}>
      {g.label && <header className={g.late ? 'late' : ''}><button className="fold" aria-expanded={!shut} onClick={() => setShut(!shut)} aria-label={`${shut ? 'Show' : 'Hide'} ${g.label}`}><Icon n="right" s={11} /></button>
        {sec ? <Draft aria-label="Section name" value={sec.name} onSave={(v) => { if (v.trim()) mutate('Rename section', [{ kind: 'section', put: [{ ...sec, name: v.trim() }] }]) }} /> : <h3>{g.label}</h3>}<small>{g.tasks.length}</small>
        {g.late && <button className="link" onClick={() => { const today = useStore.getState().today; mutate('Moved to today', [{ kind: 'task', put: g.tasks.map((t) => ({ ...t, due: today, snoozeUntil: null })) }], { toast: true }) }}>Move to today</button>}
        {sec && <button className="ghost small" aria-label={`Remove section ${sec.name}`} onClick={() => mutate('Removed section', [{ kind: 'section', del: [sec.id] }, { kind: 'task', put: g.tasks.map((t) => ({ ...t, sectionId: null })) }], { toast: true })}><Icon n="x" s={11} /></button>}</header>}
      {!shut && g.tasks.map((t) => can ? <DropRow key={t.id} t={t} g={g} showList={showList} hideDue={hideDue} /> : <Row key={t.id} t={t} showList={showList} hideDue={hideDue} />)}
    </section>
  )
}
function DropRow({ t, g, showList, hideDue }: { t: Task; g: Group; showList: boolean; hideDue: boolean }) {
  const d = useDrop((id) => place(id, t, g.tasks, g.section))
  return <Row t={t} showList={showList} hideDue={hideDue} drop={{ ...d.props, over: d.over }} />
}

function Board({ listId, tasks, sections, addSection }: { listId: string; tasks: Task[]; sections: { id: string; name: string; listId: string; order: number }[]; addSection(): void }) {
  const cols = [...(tasks.some((t) => !sections.some((s) => s.id === t.sectionId)) || !sections.length ? [null] : []), ...sections]
  return <div className="board">{cols.map((s) => <Column key={s?.id ?? 'none'} s={s} listId={listId} tasks={tasks.filter((t) => (s ? t.sectionId === s.id : !sections.some((x) => x.id === t.sectionId))).sort(byManual)} />)}<button className="ghost addcol" onClick={addSection}><Icon n="plus" s={13} /> Section</button></div>
}
function Column({ s, listId, tasks }: { s: { id: string; name: string; listId: string; order: number } | null; listId: string; tasks: Task[] }) {
  const d = useDrop((id) => place(id, null, tasks, s?.id ?? null, listId))
  return <div className={`col ${d.over ? 'over' : ''}`} data-col={s?.name ?? 'none'} {...d.props}><header>{s ? <Draft aria-label="Section name" value={s.name} onSave={(v) => { if (v.trim()) mutate('Rename section', [{ kind: 'section', put: [{ ...s, name: v.trim() }] }]) }} /> : <h3>No section</h3>}<small>{tasks.length}</small></header>
    <div className="cards">{tasks.map((t) => <Card key={t.id} t={t} onDrop={(id) => place(id, t, tasks, s?.id ?? null, listId)} />)}</div><AddBar preset={{ listId, sectionId: s?.id ?? null }} placeholder="Add a task" /></div>
}
export function Card({ t, onDrop }: { t: Task; onDrop?(id: string): void }) {
  const d = useDrop((id) => onDrop?.(id)), [at, setAt] = useState<{ x: number; y: number } | null>(null), today = useStore((s) => s.today), sel = useStore((s) => s.selected === t.id)
  return <div className={`card ${d.over && onDrop ? 'over' : ''} ${sel ? 'sel' : ''}`} data-task={t.id} {...dragProps(t.id)} {...(onDrop ? d.props : {})} onClick={() => useStore.setState({ selected: t.id })} onContextMenu={(e) => { e.preventDefault(); setAt({ x: e.clientX, y: e.clientY }) }}><Check t={t} /><div><span className="title">{t.title}</span><Meta t={t} /></div>{at && <span onClick={(e) => e.stopPropagation()}><Menu at={at} items={taskMenu(t, today)} onClose={() => setAt(null)} /></span>}</div>
}

const QUAD = [{ p: 3, name: 'Do first', sub: 'Urgent and important' }, { p: 2, name: 'Schedule', sub: 'Important, not urgent' }, { p: 1, name: 'Hand off', sub: 'Urgent, not important' }, { p: 0, name: 'Let go', sub: 'Neither' }] as const
export function Matrix() {
  const data = useStore((s) => s.data), tasks = tasksOf(data).filter((t) => t.status === 'open' && !t.deletedAt)
  return <div className="page"><header className="head"><h1>Matrix</h1><span className="muted">Priority decides the square. Drag to change it.</span></header><div className="matrix">{QUAD.map((q) => <Quad key={q.p} q={q} tasks={tasks.filter((t) => t.priority === q.p).sort(byDate)} />)}</div></div>
}
function Quad({ q, tasks }: { q: (typeof QUAD)[number]; tasks: Task[] }) {
  const d = useDrop((id) => { const t = useStore.getState().data.task[id]; if (t) patch(t, { priority: q.p }, 'Set priority') })
  return <div className={`quad q${q.p} ${d.over ? 'over' : ''}`} data-quad={q.p} {...d.props}><header><h3>{q.name}</h3><small>{q.sub}</small></header><div className="scroll">{tasks.map((t) => <Row key={t.id} t={t} />)}</div><AddBar preset={{ priority: q.p }} placeholder="Add a task" /></div>
}

export function Search() {
  const data = useStore((s) => s.data), [q, setQ] = useState(''), [i, setI] = useState(0), close = () => useStore.setState({ search: false })
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = words.length ? tasksOf(data).filter((t) => !t.deletedAt).filter((t) => { const h = [t.title, t.notes, ...t.tags.map((x) => '#' + x), ...t.subtasks.map((s) => s.title), data.list[t.listId]?.name ?? 'inbox'].join('\n').toLowerCase(); return words.every((w) => h.includes(w)) }).sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || byDate(a, b)).slice(0, 40) : []
  const pick = (t?: Task) => { if (t) { useStore.setState({ search: false, view: t.status === 'done' ? { t: 'done' } : t.listId === 'inbox' ? { t: 'inbox' } : { t: 'list', id: t.listId }, selected: t.id }) } }
  return <div className="scrim upper" onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}><div className="searchbox" role="dialog" aria-label="Search"><input autoFocus aria-label="Search tasks" placeholder="Search titles, notes, tags and lists" value={q} onChange={(e) => { setQ(e.target.value); setI(0) }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, hits.length - 1)) } if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)) } if (e.key === 'Enter') pick(hits[i]) }} />
    {hits.length > 0 && <div className="hits">{hits.map((t, k) => <button key={t.id} className={`${k === i ? 'on' : ''} ${t.status}`} onMouseEnter={() => setI(k)} onClick={() => pick(t)}><span className="title">{t.title}</span><Meta t={t} showList /></button>)}</div>}{words.length > 0 && !hits.length && <p className="muted">Nothing matches.</p>}</div></div>
}
export { listsOf, toast }
