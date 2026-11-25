import { addDays, dayLabel, fmtTime } from '../shared/dates.ts'
import type { Task } from '../shared/types.ts'
import { useState } from 'react'
import { call, listsOf, move, mutate, patch, PRIO, reschedule, toggle, trash, useStore } from './store.ts'
import { dragProps, Icon, Menu, type Item } from './ui.tsx'

export function Check({ t }: { t: Task }) {
  return <button className={`check p${t.priority} ${t.status}`} role="checkbox" aria-checked={t.status === 'done'} aria-label={`Complete ${t.title}`} onClick={(e) => { e.stopPropagation(); toggle(t) }}>{t.status === 'done' && <Icon n="done" s={11} />}</button>
}
export function taskMenu(t: Task, today: string): Item[] {
  const lists = listsOf(useStore.getState().data)
  if (t.deletedAt) return [{ label: 'Restore', run: () => patch(t, { deletedAt: null }, 'Restore') }, { label: 'Delete forever', danger: true, run: () => mutate('Deleted forever', [{ kind: 'task', del: [t.id] }], { toast: true }) }]
  return [
    { label: 'Today', run: () => reschedule(t, today) }, { label: 'Tomorrow', run: () => reschedule(t, addDays(today, 1)) }, { label: 'Next week', run: () => reschedule(t, addDays(today, 7)) }, { label: 'No date', run: () => reschedule(t, null) }, '-',
    ...([3, 2, 1, 0] as const).map((p) => ({ label: `${PRIO[p]} priority`, on: t.priority === p, run: () => patch(t, { priority: p }, 'Set priority') })), '-',
    ...[{ id: 'inbox', name: 'Inbox' }, ...lists].filter((l) => l.id !== t.listId).slice(0, 8).map((l) => ({ label: `Move to ${l.name}`, run: () => move(t, l.id) })), '-',
    { label: t.pinned ? 'Unpin' : 'Pin to top', run: () => patch(t, { pinned: !t.pinned }) }, { label: 'Focus on this', run: () => call('timer.start', t.id, t.title) }, { label: 'Move to Trash', danger: true, run: () => trash(t) },
  ]
}
export function Meta({ t, showList, hideDue }: { t: Task; showList?: boolean; hideDue?: boolean }) {
  const today = useStore((s) => s.today), list = useStore((s) => s.data.list[t.listId])
  const sub = t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : ''
  return <span className="meta">
    {t.tags.map((x) => <em key={x}>#{x}</em>)}{sub && <span>{sub}</span>}{t.repeat && <Icon n="repeat" s={12} />}{t.reminders.length > 0 && <Icon n="bell" s={12} />}
    {t.due && (!hideDue || t.time) && <span className={`due ${t.status === 'open' && t.due < today ? 'late' : ''}`}>{hideDue ? '' : dayLabel(t.due, today)}{t.time ? `${hideDue ? '' : ', '}${fmtTime(t.time)}` : ''}</span>}
    {showList && list && <span className="inlist"><i style={{ background: list.color }} />{list.name}</span>}
  </span>
}
export function Row({ t, showList, hideDue, drop }: { t: Task; showList?: boolean; hideDue?: boolean; drop?: React.HTMLAttributes<HTMLDivElement> & { over?: boolean } }) {
  const sel = useStore((s) => s.selected === t.id), today = useStore((s) => s.today), [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const { over, ...dp } = drop ?? {}
  return (
    <div className={`row ${sel ? 'sel' : ''} ${t.status} ${over ? 'over' : ''}`} data-task={t.id} tabIndex={0} {...dragProps(t.id)} {...dp} onClick={() => useStore.setState({ selected: t.id })} onFocus={(e) => { if (e.target === e.currentTarget) useStore.setState((s) => (s.selected && s.selected !== t.id ? { selected: t.id } : s)) }} onContextMenu={(e) => { e.preventDefault(); setAt({ x: e.clientX, y: e.clientY }) }}>
      <Check t={t} /><span className="title">{t.pinned && <Icon n="pin" s={12} />}{t.title}</span><Meta t={t} showList={showList} hideDue={hideDue} />
      {at && <span onClick={(e) => e.stopPropagation()}><Menu at={at} items={taskMenu(t, today)} onClose={() => setAt(null)} /></span>}
    </div>
  )
}
