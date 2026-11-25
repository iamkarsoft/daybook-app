import { hm, ymd } from './dates.ts'
import { parseRRule } from './repeat.ts'
import { newTask, uid } from './tasks.ts'
import type { List, Op, Priority, Section, Task } from './types.ts'

export function parseCsv(s: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], f = '', q = false
  s = s.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
    else f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  return rows
}

const COLORS = ['#7a3b69', '#2f6f8f', '#3d7a4e', '#b0632a', '#5b56a6', '#a63d4a']
const MIN: [RegExp, number][] = [[/(\d+)W/, 10080], [/(\d+)D/, 1440], [/(\d+)H/, 60], [/(\d+)M/, 1]]

/** Reads a TickTick CSV backup, or any CSV with at least a Title column. Columns are found by name. */
export function importCsv(text: string, existing: List[]): { ops: Op[]; tasks: number; lists: number; skippedRepeats: number } {
  const rows = parseCsv(text)
  const h = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === 'title'))
  if (h < 0) throw new Error('No "Title" column found in this file')
  const col = new Map(rows[h].map((c, i) => [c.trim().toLowerCase(), i]))
  const lists = new Map(existing.map((l) => [l.name.toLowerCase(), l])), sections = new Map<string, Section>()
  const newLists: List[] = [], tasks: Task[] = [], byOld = new Map<string, Task>(), parents: [Task, string][] = []
  let skippedRepeats = 0
  for (const r of rows.slice(h + 1)) {
    const g = (n: string) => (r[col.get(n) ?? -1] ?? '').trim()
    if (!g('title') && !g('content')) continue
    let listId = 'inbox'
    const ln = g('list name')
    if (ln && ln.toLowerCase() !== 'inbox') {
      let l = lists.get(ln.toLowerCase())
      if (!l) { l = { id: uid(), name: ln, color: COLORS[newLists.length % COLORS.length], order: Date.now() + newLists.length, view: 'list' }; lists.set(ln.toLowerCase(), l); newLists.push(l) }
      listId = l.id
    }
    let sectionId: string | null = null
    const cn = g('column name')
    if (cn && listId !== 'inbox') {
      const k = `${listId}\u0000${cn}`
      if (!sections.has(k)) sections.set(k, { id: uid(), listId, name: cn, order: sections.size })
      sectionId = sections.get(k)!.id
    }
    const raw = g('due date') || g('start date'), allDay = /^true$/i.test(g('is all day')) || /^\d{4}-\d\d-\d\d$/.test(raw)
    let due: string | null = null, time: string | null = null
    if (raw) {
      const d = new Date(raw.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'))
      if (/^\d{4}-\d\d-\d\d$/.test(raw)) due = raw
      else if (!isNaN(+d)) {
        // All-day dates are midnight in the task's own zone, so read the calendar day there.
        if (allDay) { try { due = new Intl.DateTimeFormat('en-CA', { timeZone: g('timezone') || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) } catch { due = ymd(d) } }
        else { due = ymd(d); time = hm(d) }
      }
    }
    const rr = g('repeat'), repeat = rr && due ? parseRRule(rr, due) : null
    if (rr && !repeat) skippedRepeats++
    const p = Number(g('priority')) || 0, status = Number(g('status')) || 0
    const created = +new Date(g('created time').replace(/([+-]\d\d)(\d\d)$/, '$1:$2')), completed = +new Date(g('completed time').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'))
    const reminders = due ? g('reminder').split(/[\n,]/).filter((x) => /P/i.test(x)).map((x) => MIN.reduce((n, [re, k]) => n + Number(re.exec(x.toUpperCase().replace(/^.*?P/, ''))?.[1] ?? 0) * k, 0)) : []
    // Checklists keep their items in Content, marked with ▫ (open) and ▪ (done).
    const lines = g('content').split(/\r?\n/), check = /^(y|true|1)$/i.test(g('is check list'))
    const t = newTask({
      title: g('title') || 'Untitled', listId, sectionId, due, time, reminders, repeat,
      priority: (p >= 5 ? 3 : p >= 3 ? 2 : p >= 1 ? 1 : 0) as Priority,
      tags: g('tags').split(/[,\s]+/).map((x) => x.replace(/^#/, '').toLowerCase()).filter(Boolean),
      subtasks: check ? lines.filter((l) => /^[▫▪]/.test(l)).map((l) => ({ id: uid(), title: l.slice(1).trim(), done: l[0] === '▪' })) : [],
      notes: (check ? lines.filter((l) => !/^[▫▪]/.test(l)) : lines).join('\n').trim(),
      status: status > 0 ? 'done' : 'open', order: tasks.length,
      ...(isNaN(created) ? {} : { createdAt: created }), completedAt: status > 0 ? (isNaN(completed) ? Date.now() : completed) : null,
    })
    if (t.status === 'done') t.repeat = null
    tasks.push(t)
    if (g('taskid')) byOld.set(g('taskid'), t)
    if (g('parentid')) parents.push([t, g('parentid')])
  }
  // Subtasks with nothing of their own fold into the parent's checklist; the rest stay as tasks.
  const folded = new Set<Task>()
  for (const [t, pid] of parents) {
    const parent = byOld.get(pid)
    if (parent && parent !== t && !folded.has(parent) && !t.due && !t.notes && !t.subtasks.length && !parents.some(([, x]) => byOld.get(x) === t)) { parent.subtasks.push({ id: uid(), title: t.title, done: t.status === 'done' }); folded.add(t) }
  }
  const kept = tasks.filter((t) => !folded.has(t))
  return { ops: [{ kind: 'list', put: newLists }, { kind: 'section', put: [...sections.values()] }, { kind: 'task', put: kept }], tasks: kept.length, lists: newLists.length, skippedRepeats }
}
