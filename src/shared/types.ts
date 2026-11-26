import type { Repeat } from './repeat.ts'
export type Priority = 0 | 1 | 2 | 3
export interface Subtask { id: string; title: string; done: boolean }
export interface Task {
  id: string; title: string; notes: string
  listId: string; sectionId: string | null
  status: 'open' | 'done'
  priority: Priority
  tags: string[]
  /** Local calendar date and wall-clock time. Never a UTC instant, so travel and DST do not move tasks. */
  due: string | null
  time: string | null
  duration: number
  /** Minutes before the due time; all-day tasks count from the all-day reminder time. */
  reminders: number[]
  snoozeUntil: number | null
  repeat: Repeat | null
  subtasks: Subtask[]
  pinned: boolean
  order: number
  createdAt: number
  completedAt: number | null
  deletedAt: number | null
}
export interface List { id: string; name: string; color: string; order: number; view: 'list' | 'board' }
export interface Section { id: string; listId: string; name: string; order: number }
export interface Habit { id: string; name: string; color: string; goal: number; unit: string; days: number[]; order: number; createdOn: string; archived: boolean }
export interface HabitLog { id: string; habitId: string; date: string; count: number }
export interface FocusLog { id: string; taskId: string | null; title: string; date: string; startedAt: number; minutes: number }
/** One moment attention slipped during focus. `session` is the focus session's startedAt, linking it to its FocusLog. */
export interface Distraction { id: string; at: number; date: string; note: string; taskId: string | null; title: string; session: number | null; /** Minutes added to the session for it. */ penalty: number }
export interface Settings { id: 'main'; weekStart: 0 | 1; allDayTime: string; focusMin: number; shortMin: number; longMin: number; menuBar: 'count' | 'next' | 'icon'; penaltyMin: number; sort: Record<string, SortKey> }
export type SortKey = 'date' | 'priority' | 'manual' | 'title'

export interface Kinds { list: List; section: Section; task: Task; habit: Habit; log: HabitLog; focus: FocusLog; distraction: Distraction; settings: Settings }
export type Kind = keyof Kinds
export const KINDS: Kind[] = ['list', 'section', 'task', 'habit', 'log', 'focus', 'distraction', 'settings']
export type Op = { [K in Kind]: { kind: K; put?: Kinds[K][]; del?: string[] } }[Kind]
export type Snapshot = { [K in Kind]: Kinds[K][] }

export interface Timer { phase: 'idle' | 'focus' | 'break'; endsAt: number | null; left: number | null; total: number; startedAt: number; taskId: string | null; title: string; done: number }
export const IDLE: Timer = { phase: 'idle', endsAt: null, left: null, total: 0, startedAt: 0, taskId: null, title: '', done: 0 }
export const DEFAULTS: Settings = { id: 'main', weekStart: 1, allDayTime: '09:00', focusMin: 25, shortMin: 5, longMin: 15, menuBar: 'count', penaltyMin: 2, sort: {} }

export type GhEvery = 'changes' | 'hour' | 'day' | 'manual'
export interface GhStatus { gh: boolean; auth: 'gh' | 'token'; login: string; repo: string; every: GhEvery; markdown: boolean; lastOk: number; error: string; block: boolean; busy: boolean }

export interface Rpc {
  load: () => { data: Snapshot; timer: Timer }
  apply: (ops: Op[]) => void
  'timer.start': (taskId: string | null, title: string) => void
  'timer.break': () => void
  'timer.pause': () => void
  'timer.resume': () => void
  'timer.stop': () => void
  /** Adds minutes to the running or paused focus session. */
  'timer.extend': (minutes: number) => void
  'backup.export': () => string | null
  'backup.local': () => string
  'gh.status': () => GhStatus
  'gh.connect': (auth: 'gh' | 'token', token?: string) => void
  'gh.disconnect': () => void
  'gh.repos': () => string[]
  'gh.create': (name: string) => string
  'gh.choose': (repo: string) => void
  'gh.set': (x: { every?: GhEvery; markdown?: boolean }) => void
  'gh.backup': (takeOver: boolean) => { changed: boolean }
  'gh.history': () => { sha: string; at: string; message: string }[]
  'gh.fetch': (sha: string) => Snapshot
  'import.read': () => { name: string; text: string } | null
  'login.get': () => boolean
  'login.set': (on: boolean) => void
  'app.nativeUndo': () => void
  'quick.close': () => void
  'panel.close': () => void
  'app.show': (taskId: string | null) => void
  'app.quick': () => void
  'app.info': () => { hotkey: string; hotkeyOk: boolean; dir: string }
}
export type PushEvent = { t: 'ops'; ops: Op[] } | { t: 'timer'; timer: Timer } | { t: 'menu'; a: string } | { t: 'open'; id: string } | { t: 'quick' } | { t: 'panel' } | { t: 'gh'; status: GhStatus } | { t: 'tick' }
