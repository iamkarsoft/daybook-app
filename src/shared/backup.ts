import { fmtTime } from './dates.ts'
import { repeatText } from './repeat.ts'
import { byDate } from './tasks.ts'
import { KINDS, type Op, type Snapshot } from './types.ts'

const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v

/** Same data always gives the same text, so an unchanged backup makes no commit. */
export function backupJson(d: Snapshot): string {
  const body = Object.fromEntries(KINDS.map((k) => [k, [...d[k]].sort((a, b) => (a.id < b.id ? -1 : 1)).map(sorted)]))
  return JSON.stringify({ app: 'daybook', version: 1, ...body }, null, 1) + '\n'
}
export function backupMarkdown(d: Snapshot): string {
  const open = d.task.filter((t) => t.status === 'open' && !t.deletedAt), line = (s: string) => s.replace(/\s+/g, ' ').replace(/([\\`*_[\]<>#])/g, '\\$1')
  const lists = [{ id: 'inbox', name: 'Inbox' }, ...[...d.list].sort((a, b) => a.order - b.order)]
  return `# Open tasks\n\n` + lists.map((l) => {
    const ts = open.filter((t) => t.listId === l.id).sort(byDate)
    return ts.length ? `## ${line(l.name)}\n\n` + ts.map((t) => `- [ ] ${line(t.title)}${t.due ? ` (${t.due}${t.time ? ' ' + fmtTime(t.time) : ''}${t.repeat ? ', ' + repeatText(t.repeat).toLowerCase() : ''})` : ''}${t.tags.map((x) => ` \`${x}\``).join('')}\n` + t.subtasks.map((s) => `  - [${s.done ? 'x' : ' '}] ${line(s.title)}\n`).join('')).join('') + '\n' : ''
  }).join('')
}
/** Throws unless the text is a complete backup this version can read. */
export function parseBackup(text: string): Snapshot {
  let j: any
  try { j = JSON.parse(text) } catch { throw new Error('That backup is not readable') }
  if (j?.app !== 'daybook') throw new Error('That is not a Daybook backup')
  if (j.version !== 1) throw new Error('That backup came from a newer version of Daybook')
  // Backups from before distractions existed have none.
  j.distraction ??= []
  for (const k of KINDS) if (!Array.isArray(j[k]) || j[k].some((x: any) => !x || typeof x.id !== 'string' || !x.id)) throw new Error(`That backup is damaged (${k})`)
  if (j.task.some((t: any) => typeof t.title !== 'string' || !Array.isArray(t.tags) || !Array.isArray(t.subtasks) || !Array.isArray(t.reminders))) throw new Error('That backup is damaged (task)')
  return Object.fromEntries(KINDS.map((k) => [k, j[k]])) as unknown as Snapshot
}
/** Ops that make `now` equal `then`, removing anything the backup does not have. */
export function restoreOps(now: Snapshot, then: Snapshot): Op[] {
  return KINDS.map((k) => { const keep = new Set(then[k].map((x) => x.id)); return { kind: k, put: then[k], del: now[k].map((x) => x.id).filter((id) => !keep.has(id)) } as Op })
}
