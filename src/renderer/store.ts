import { create } from 'zustand'
import { addDays, ymd } from '../shared/dates.ts'
import { logId } from '../shared/habits.ts'
import { parseTask } from '../shared/parse.ts'
import { completeOps, newTask, uid } from '../shared/tasks.ts'
import { DEFAULTS, IDLE, KINDS, type GhStatus, type Habit, type Kind, type Kinds, type List, type Op, type PushEvent, type Rpc, type Settings, type SortKey, type Task, type Timer } from '../shared/types.ts'

declare global { interface Window { daybook: { call(m: string, a: unknown[]): Promise<{ ok: true; value: any } | { ok: false; error: string }>; onPush(fn: (e: PushEvent) => void): () => void } } }
export async function call<K extends keyof Rpc>(m: K, ...a: Parameters<Rpc[K]>): Promise<Awaited<ReturnType<Rpc[K]>>> {
  const r = await window.daybook.call(m, a)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

export type View = { t: 'today' | 'week' | 'inbox' | 'all' | 'done' | 'trash' | 'calendar' | 'matrix' | 'habits' | 'focus' } | { t: 'list' | 'tag'; id: string }
type Data = { [K in Kind]: Record<string, Kinds[K]> }
interface State {
  gh: GhStatus | null
  ready: boolean; data: Data; timer: Timer; today: string; minute: number
  view: View; selected: string | null; search: boolean
  compose: Partial<Task> | null; settings: boolean
  toast: { text: string; n: number; bad?: boolean; undo?: boolean } | null
  ask: { title: string; body: string; confirm: string; done(ok: boolean): void } | null
}
const empty = () => Object.fromEntries(KINDS.map((k) => [k, {}])) as unknown as Data
export const useStore = create<State>(() => ({ gh: null, ready: false, data: empty(), timer: IDLE, today: ymd(new Date()), minute: Date.now(), view: { t: 'today' }, selected: null, search: false, compose: null, settings: false, toast: null, ask: null }))
const { setState: set, getState: get } = useStore
export const settingsOf = (d: Data): Settings => ({ ...DEFAULTS, ...d.settings.main })
export const tasksOf = (d: Data) => Object.values(d.task)
export const listsOf = (d: Data) => Object.values(d.list).sort((a, b) => a.order - b.order)

let tn = 0
export const toast = (text: string, o: { bad?: boolean; undo?: boolean } = {}) => set({ toast: { text, n: ++tn, ...o } })
export const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { bad: true })
export const ask = (title: string, body: string, confirm: string) => new Promise<boolean>((res) => set({ ask: { title, body, confirm, done: (ok) => { set({ ask: null }); res(ok) } } }))

function local(ops: Op[]) {
  set((s) => {
    const data = { ...s.data } as any
    for (const op of ops) {
      const m = { ...data[op.kind] }
      for (const d of op.put ?? []) m[d.id] = d
      for (const id of op.del ?? []) delete m[id]
      data[op.kind] = m
    }
    return { data }
  })
}
/** The ops that put everything these ops touch back as it is now. */
function inverse(ops: Op[]): Op[] {
  const d = get().data as any, seen = new Set<string>()
  return ops.map((op) => {
    const put: any[] = [], del: string[] = []
    for (const id of [...(op.put ?? []).map((x) => x.id), ...(op.del ?? [])]) {
      if (seen.has(op.kind + id)) continue
      seen.add(op.kind + id)
      const was = d[op.kind][id]
      if (was) put.push(was); else del.push(id)
    }
    return { kind: op.kind, put, del } as Op
  })
}
const undoStack: { label: string; ops: Op[] }[] = []
async function send(ops: Op[]) { try { await call('apply', ops) } catch (e) { fail(e); await reload() } }
export function mutate(label: string, ops: Op[], o: { toast?: boolean } = {}) {
  undoStack.push({ label, ops: inverse(ops) })
  if (undoStack.length > 100) undoStack.shift()
  local(ops)
  if (o.toast) toast(label, { undo: true })
  return send(ops)
}
export function undo() {
  const u = undoStack.pop()
  if (!u) return
  local(u.ops); send(u.ops); toast(`Undid: ${u.label}`)
}
export async function reload() {
  const { data, timer } = await call('load')
  const d = empty() as any
  for (const k of KINDS) for (const x of data[k]) d[k][x.id] = x
  set({ data: d, timer, ready: true })
}
export const menuHandlers: Record<string, () => void> = {}
export function boot() {
  window.daybook.onPush((e) => {
    if (e.t === 'ops') local(e.ops)
    else if (e.t === 'timer') set({ timer: e.timer })
    else if (e.t === 'gh') set({ gh: e.status })
    else if (e.t === 'tick') set({ today: ymd(new Date()), minute: Date.now() })
    else if (e.t === 'open') { const t = get().data.task[e.id]; if (t) set({ view: t.listId === 'inbox' ? { t: 'inbox' } : { t: 'list', id: t.listId }, selected: e.id }) }
    else if (e.t === 'menu') menuHandlers[e.a.startsWith('go:') ? 'go' : e.a] ? (e.a.startsWith('go:') ? go({ t: e.a.slice(3) } as View) : menuHandlers[e.a]()) : undefined
    else if (e.t === 'quick' || e.t === 'panel') menuHandlers[e.t]?.()
  })
  menuHandlers.go = () => {}
  call('gh.status').then((gh) => set({ gh }), () => {})
  return reload().catch(fail)
}
export const go = (view: View) => set({ view, selected: null })

export const patch = (t: Task, x: Partial<Task>, label = 'Edit task') => mutate(label, [{ kind: 'task', put: [{ ...(get().data.task[t.id] ?? t), ...x }] }])
export function toggle(t: Task) {
  if (t.status === 'open') mutate(t.repeat ? 'Completed, next date set' : 'Completed', completeOps(t), { toast: true })
  else patch(t, { status: 'open', completedAt: null }, 'Reopen task')
}
export function trash(t: Task) {
  mutate('Moved to Trash', [{ kind: 'task', put: [{ ...t, deletedAt: Date.now() }] }], { toast: true })
  if (get().selected === t.id) set({ selected: null })
}
export function reschedule(t: Task, due: string | null, time: string | null | undefined = undefined) {
  patch(t, { due, time: due ? (time === undefined ? t.time : time) : null, snoozeUntil: null, ...(due ? {} : { repeat: null, reminders: [] }), ...(due && time && !t.time && !t.reminders.length ? { reminders: [0] } : {}) }, 'Reschedule')
}
/** Moving into another list drops the section, which belongs to the old one. */
export const move = (t: Task, listId: string, sectionId: string | null = null) => patch(t, { listId, sectionId }, 'Move task')
export function addFromText(text: string, preset: Partial<Task>, ignore: string[] = []): Task | null {
  const d = get().data, p = parseTask(text, new Date(), listsOf(d).map((l) => l.name), ignore)
  if (!p.title) return null
  const named = p.list ? listsOf(d).find((l) => l.name === p.list) : null
  const t = newTask({
    ...preset, title: p.title, priority: p.priority ?? preset.priority ?? 0, tags: [...new Set([...(preset.tags ?? []), ...p.tags])], repeat: p.repeat, reminders: p.reminders,
    due: p.due ?? preset.due ?? null, time: p.due ? p.time : p.time ?? preset.time ?? null, ...(named ? { listId: named.id, sectionId: null } : {}),
  })
  if (t.time && !t.reminders.length) t.reminders = [0]
  mutate('Add task', [{ kind: 'task', put: [t] }])
  return t
}
/** One more each time; past the goal it starts again from zero. */
export function bumpHabit(h: Habit, date: string) {
  const id = logId(h.id, date), c = get().data.log[id]?.count ?? 0, n = c >= h.goal ? 0 : c + 1
  mutate('Log habit', [n ? { kind: 'log', put: [{ id, habitId: h.id, date, count: n }] } : { kind: 'log', del: [id] }])
}
export const saveSettings = (x: Partial<Settings>) => mutate('Change settings', [{ kind: 'settings', put: [{ ...settingsOf(get().data), ...x }] }])
export const setSort = (key: string, v: SortKey) => saveSettings({ sort: { ...settingsOf(get().data).sort, [key]: v } })
export async function deleteList(l: List) {
  const d = get().data, inside = tasksOf(d).filter((t) => t.listId === l.id), n = inside.filter((t) => !t.deletedAt).length
  if (n && !(await ask(`Delete ${l.name}?`, `Its ${n} ${n === 1 ? 'task' : 'tasks'} will move to Trash. You can undo this.`, 'Delete List'))) return
  go({ t: 'today' })
  mutate('Deleted list', [
    { kind: 'list', del: [l.id] }, { kind: 'section', del: Object.values(d.section).filter((s) => s.listId === l.id).map((s) => s.id) },
    { kind: 'task', put: inside.map((t) => ({ ...t, listId: 'inbox', sectionId: null, deletedAt: t.deletedAt ?? Date.now() })) },
  ], { toast: true })
}

export const open = (t: Task) => t.status === 'open' && !t.deletedAt
export function inView(v: View, t: Task, today: string): boolean {
  if (v.t === 'trash') return !!t.deletedAt
  if (t.deletedAt) return false
  if (v.t === 'done') return t.status === 'done'
  if (t.status !== 'open') return false
  switch (v.t) {
    case 'today': return !!t.due && t.due <= today
    case 'week': return !!t.due && t.due <= addDays(today, 6)
    case 'inbox': return t.listId === 'inbox'
    case 'list': return t.listId === v.id
    case 'tag': return t.tags.includes(v.id)
    default: return true
  }
}
export const PRIO = ['None', 'Low', 'Medium', 'High'] as const
export const COLORS = ['#7a3b69', '#2f6f8f', '#3d7a4e', '#b0632a', '#5b56a6', '#a63d4a', '#5d6670']
export const newId = uid
