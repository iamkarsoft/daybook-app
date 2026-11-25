import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, addMonths, diffDays, dow } from '../src/shared/dates.ts'
import { nextDue, occurrences, parseRRule, repeatText, type Repeat } from '../src/shared/repeat.ts'
import { parseTask } from '../src/shared/parse.ts'
import { completeOps, newTask, reminderTimes } from '../src/shared/tasks.ts'
import { importCsv } from '../src/shared/import.ts'
import { logId, streak } from '../src/shared/habits.ts'

const now = new Date(2026, 10, 25, 10, 30) // Wednesday 25 Nov 2026
const p = (s: string, lists: string[] = [], ig: string[] = []) => parseTask(s, now, lists, ig)
const r = (x: Partial<Repeat>): Repeat => ({ freq: 'day', every: 1, from: 'due', ...x })
test('date arithmetic', () => {
  assert.equal(addDays('2026-03-07', 2), '2026-03-09'); assert.equal(addDays('2028-02-28', 1), '2028-02-29'); assert.equal(diffDays('2027-01-01', '2026-12-31'), 1); assert.equal(dow('2026-11-25'), 3)
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2026-12-15', 1), '2027-01-15'); assert.equal(addMonths('2026-01-15', -1), '2025-12-15')
})
test('monthly keeps its anchor through short months', () => {
  const m = r({ freq: 'month', anchor: 31 })
  assert.equal(nextDue(m, '2026-01-31', '2026-01-31'), '2026-02-28'); assert.equal(nextDue(m, '2026-02-28', '2026-02-28'), '2026-03-31')
  assert.equal(nextDue(r({ freq: 'year', anchor: 29 }), '2028-02-29', '2028-02-29'), '2029-02-28')
})
test('late completion skips missed dates but not today', () => {
  assert.equal(nextDue(r({}), '2026-11-20', '2026-11-25'), '2026-11-25'); assert.equal(nextDue(r({}), '2026-11-25', '2026-11-25'), '2026-11-26')
  assert.equal(nextDue(r({ every: 3 }), '2026-11-20', '2026-11-25'), '2026-11-26'); assert.equal(nextDue(r({ from: 'done', every: 10 }), '2026-11-01', '2026-11-25'), '2026-12-05')
  assert.equal(nextDue(r({}), '2026-11-30', '2026-11-25'), '2026-12-01')
})
test('weekly days and intervals', () => {
  const w = r({ freq: 'week', days: [1, 4] })
  assert.equal(nextDue(w, '2026-11-23', '2026-11-23'), '2026-11-26'); assert.equal(nextDue(w, '2026-11-26', '2026-11-26'), '2026-11-30')
  assert.equal(nextDue({ ...w, every: 2 }, '2026-11-26', '2026-11-26'), '2026-12-07'); assert.equal(nextDue(r({ freq: 'week', days: [0] }), '2026-11-29', '2026-11-29'), '2026-12-06')
  assert.equal(nextDue(r({ until: '2026-11-25' }), '2026-11-25', '2026-11-25'), null)
  assert.deepEqual(occurrences(w, '2026-11-23', '2026-11-24', '2026-12-03'), ['2026-11-26', '2026-11-30', '2026-12-03'])
  assert.equal(repeatText(r({ freq: 'week', days: [1, 2, 3, 4, 5] })), 'Every weekday')
})
test('parses a full line', () => {
  const t = p('Pay rent tomorrow 5pm every month #Home !high ~Personal', ['Personal', 'Work'])
  assert.deepEqual([t.title, t.due, t.time, t.repeat?.freq, t.repeat?.anchor, t.priority, t.tags, t.list, t.reminders], ['Pay rent', '2026-11-26', '17:00', 'month', 26, 3, ['home'], 'Personal', [0]])
})
test('dates', () => {
  for (const [s, d] of Object.entries({ 'x today': '2026-11-25', 'x friday': '2026-11-27', 'x on fri': '2026-11-27', 'x next monday': '2026-11-30', 'x wednesday': '2026-12-02', 'x in 3 days': '2026-11-28', 'x in two weeks': '2026-12-09', 'x jan 5': '2027-01-05', 'x 5th of january': '2027-01-05', 'x dec 1 2027': '2027-12-01', 'x 2026-12-24': '2026-12-24', 'x next month': '2026-12-25', 'x this weekend': '2026-11-28', 'x by Nov 25': '2026-11-25', 'x feb 29': '2028-02-29' })) { assert.equal(p(s).due, d, s); assert.equal(p(s).title, 'x', s) }
})
test('times', () => {
  for (const [s, d, t] of [['x at 9am', '2026-11-26', '09:00'], ['x 14:45', '2026-11-25', '14:45'], ['x at 5', '2026-11-25', '17:00'], ['x noon', '2026-11-25', '12:00'], ['x 12am friday', '2026-11-27', '00:00'], ['x in 45 minutes', '2026-11-25', '11:15'], ['x tonight', '2026-11-25', '20:00']] as const) assert.deepEqual([p(s).due, p(s).time, p(s).title], [d, t, 'x'], s)
})
test('leaves ordinary words alone', () => {
  for (const s of ['May need to call Sun', 'Look at 99 problems', 'We sat down', 'Read chapter 5', 'Fix bug #123', 'x 2026-13-45', 'Email bob@5pm.com', 'feb 31 notes']) { const t = p(s); assert.deepEqual([t.title, t.due], [s, null], s) }
})
test('an ignored phrase stays in the title', () => assert.deepEqual([p('Call tomorrow inc', [], ['tomorrow']).title, p('Call tomorrow inc', [], ['tomorrow']).due], ['Call tomorrow inc', null]))
test('repeats', () => {
  assert.deepEqual(p('gym every mon, wed and fri').repeat?.days, [1, 3, 5]); assert.equal(p('gym every mon, wed and fri').due, '2026-11-25')
  assert.equal(p('x every other week').repeat?.every, 2); assert.equal(p('x daily').due, '2026-11-25'); assert.equal(p('standup every weekday 9:30').time, '09:30'); assert.equal(p('x remind me 30 min before at 3pm').reminders[0], 30)
})
test('completing', () => {
  const [op] = completeOps(newTask({ title: 'a', due: '2026-11-25', repeat: r({}), subtasks: [{ id: '1', title: 's', done: true }] }), now) as any
  assert.equal(op.put.length, 2); assert.equal(op.put[0].status, 'done'); assert.equal(op.put[0].repeat, null); assert.equal(op.put[1].due, '2026-11-26'); assert.equal(op.put[1].status, 'open'); assert.equal(op.put[1].subtasks[0].done, false); assert.notEqual(op.put[0].id, op.put[1].id)
  assert.equal((completeOps(newTask({ due: '2026-11-25', repeat: r({ until: '2026-11-25' }) }), now) as any)[0].put.length, 1)
})
test('reminders', () => {
  const t = newTask({ due: '2026-11-25', time: '15:00', reminders: [0, 30] })
  assert.deepEqual(reminderTimes(t, '09:00'), [new Date(2026, 10, 25, 15).getTime(), new Date(2026, 10, 25, 14, 30).getTime()])
  assert.deepEqual(reminderTimes({ ...t, time: null, reminders: [0] }, '09:00'), [new Date(2026, 10, 25, 9).getTime()]); assert.deepEqual(reminderTimes({ ...t, status: 'done' }, '09:00'), [])
})
test('streaks', () => {
  const h = { id: 'h', name: '', color: '', goal: 2, unit: '', days: [1, 2, 3, 4, 5], order: 0, createdOn: '', archived: false }
  const logs = new Map(['2026-11-24', '2026-11-23', '2026-11-20'].map((date) => [logId('h', date), { id: logId('h', date), habitId: 'h', date, count: 2 }]))
  assert.equal(streak(h, logs, '2026-11-25'), 3)
  logs.set(logId('h', '2026-11-25'), { id: '', habitId: 'h', date: '2026-11-25', count: 1 }); assert.equal(streak(h, logs, '2026-11-25'), 3)
  assert.equal(streak({ ...h, days: [] }, logs, '2026-11-25'), 0)
})
test('rrule subset', () => {
  assert.deepEqual(parseRRule('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH', '2026-11-23'), { freq: 'week', every: 2, from: 'due', days: [1, 4] })
  assert.equal(parseRRule('RRULE:FREQ=MONTHLY;BYDAY=2MO', null), null); assert.equal(parseRRule('RRULE:FREQ=DAILY;COUNT=3', null), null)
})
test('csv import', () => {
  const csv = '"Date: 2026-11-25"\n"Version: 7.1"\n"Status: \n0 Normal\n1 Completed"\n"List Name","Title","Tags","Content","Is Check list","Due Date","Reminder","Repeat","Priority","Status","Timezone","Is All Day","Column Name","taskId","parentId"\n"Work","Ship, it","a, b","line1\nline2","N","2026-12-01T05:00:00+0000","PT30M","RRULE:FREQ=MONTHLY;BYDAY=2MO","5","0","America/New_York","true","Doing","1",""\n"Work","child","","","N","","","","0","0","","","","2","1"\n"Inbox","Pack","","▫socks\n▪shoes","Y","","","","0","0","","","","3",""\n"Work","Old","","","N","","","","0","2","","","","4",""\n'
  const x = importCsv(csv, []), tasks = (x.ops[2] as any).put
  assert.deepEqual([x.tasks, x.lists, x.skippedRepeats], [3, 1, 1])
  assert.deepEqual([tasks[0].title, tasks[0].due, tasks[0].time, tasks[0].priority, tasks[0].tags, tasks[0].notes, tasks[0].reminders, tasks[0].subtasks[0].title], ['Ship, it', '2026-12-01', null, 3, ['a', 'b'], 'line1\nline2', [30], 'child'])
  assert.deepEqual(tasks[1].subtasks.map((s: any) => [s.title, s.done]), [['socks', false], ['shoes', true]]); assert.equal(tasks[2].status, 'done'); assert.throws(() => importCsv('a,b\n1,2', []))
})
import { backupJson, backupMarkdown, parseBackup, restoreOps } from '../src/shared/backup.ts'
import { DEFAULTS, type Snapshot } from '../src/shared/types.ts'
const snap = (x: Partial<Snapshot>): Snapshot => ({ list: [], section: [], task: [], habit: [], log: [], focus: [], settings: [DEFAULTS], ...x })
test('backup text is stable and reads back', () => {
  const a = newTask({ id: 'a', title: 'A', order: 1, createdAt: 1 }), b = newTask({ id: 'b', title: 'B', order: 2, createdAt: 2 })
  const flip = Object.fromEntries(Object.entries(a).reverse()) as any
  assert.equal(backupJson(snap({ task: [a, b] })), backupJson(snap({ task: [b, flip] })))
  assert.deepEqual(parseBackup(backupJson(snap({ task: [a, b] }))).task, [a, b].map((x) => ({ ...x })))
  for (const bad of ['{', '{}', '{"app":"daybook","version":2}', '{"app":"daybook","version":1}', backupJson(snap({ task: [{ id: 'x' } as any] }))]) assert.throws(() => parseBackup(bad))
})
test('restore replaces everything', () => {
  const a = newTask({ id: 'a' }), b = newTask({ id: 'b' }), op = restoreOps(snap({ task: [a, b] }), snap({ task: [a] })).find((o) => o.kind === 'task')!
  assert.deepEqual([op.del, op.put!.length], [['b'], 1])
})
test('markdown escapes titles and hides finished work', () => {
  const m = backupMarkdown(snap({ task: [newTask({ title: '*x* <b>\n# y', due: '2026-12-01', tags: ['t'] }), newTask({ title: 'gone', status: 'done' }), newTask({ title: 'binned', deletedAt: 1 })] }))
  assert.match(m, /- \[ \] \\\*x\\\* \\<b\\> \\# y \(2026-12-01\) `t`/); assert.doesNotMatch(m, /gone|binned/)
})
