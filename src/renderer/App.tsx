import { useEffect, useState } from 'react'
import { addDays } from '../shared/dates.ts'
import { parseBackup } from '../shared/backup.ts'
import { importCsv } from '../shared/import.ts'
import { KINDS, type List, type Op } from '../shared/types.ts'
import { Compose } from './Add.tsx'
import { ago, BackupDialog } from './Backup.tsx'
import { Calendar } from './Calendar.tsx'
import { Detail } from './Detail.tsx'
import { Distractions } from './Distractions.tsx'
import { clock, Focus, useLeft } from './Focus.tsx'
import { Habits } from './Habits.tsx'
import { ListView, Matrix, Search } from './Lists.tsx'
import { ask, boot, call, COLORS, fail, go, listsOf, menuHandlers, move, mutate, newId, open, patch, reschedule, saveSettings, settingsOf, tasksOf, toast, toggle, trash, undo, useStore, type View } from './store.ts'
import { Ask, Icon, Modal, Toast, useDrop } from './ui.tsx'

const SMART: [View['t'], string, string][] = [['today', 'Today', 'sun'], ['week', 'Next 7 Days', 'week'], ['inbox', 'Inbox', 'inbox'], ['all', 'All Tasks', 'all']]
const TOOLS: [View['t'], string, string][] = [['calendar', 'Calendar', 'cal'], ['matrix', 'Matrix', 'matrix'], ['habits', 'Habits', 'habit'], ['focus', 'Focus', 'focus'], ['distractions', 'Distractions', 'bolt']]

export function App() {
  const { ready, view, selected, search, settings } = useStore()
  const data = useStore((s) => s.data)
  useEffect(() => {
    const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')
    Object.assign(menuHandlers, {
      undo: () => (typing() ? call('app.nativeUndo') : undo()), search: () => useStore.setState({ search: true }), settings: () => useStore.setState({ settings: true }), 'new-list': () => addList(),
    })
    boot()
    const key = (e: KeyboardEvent) => {
      if (typing() || document.querySelector('.scrim, .menu') || e.metaKey || e.ctrlKey || e.altKey) return
      const s = useStore.getState(), t = s.selected ? s.data.task[s.selected] : undefined
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const rows = [...document.querySelectorAll<HTMLElement>('.row[data-task]')], i = rows.findIndex((r) => r.dataset.task === s.selected), n = rows[i < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
        if (n) { e.preventDefault(); useStore.setState({ selected: n.dataset.task! }); n.focus(); n.scrollIntoView({ block: 'nearest' }) }
        return
      }
      if (e.key === 'Escape') { useStore.setState({ selected: null }); return }
      if (!t || (document.activeElement?.tagName === 'BUTTON' && e.key === ' ')) return
      if (e.key === ' ') { e.preventDefault(); toggle(t) }
      else if (t.deletedAt) return
      else if (e.key === 'Backspace' || e.key === 'Delete') trash(t)
      else if (e.key === 't') reschedule(t, s.today)
      else if (e.key === 'm') reschedule(t, addDays(s.today, 1))
      else if (/^[0-3]$/.test(e.key)) patch(t, { priority: Number(e.key) as 0 }, 'Set priority')
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  // Views without an add bar still answer New Task.
  useEffect(() => { const has = !['calendar', 'matrix', 'habits', 'focus', 'distractions', 'done', 'trash'].includes(view.t) && !(view.t === 'list' && !data.list[view.id]); if (!has) menuHandlers.new = () => useStore.setState({ compose: {} }) }, [view])
  if (!ready) return null
  const v: View = view.t === 'list' && !data.list[view.id] ? { t: 'inbox' } : view
  return <div className="app"><Sidebar v={v} /><main>{v.t === 'calendar' ? <Calendar /> : v.t === 'matrix' ? <Matrix /> : v.t === 'habits' ? <Habits /> : v.t === 'focus' ? <Focus /> : v.t === 'distractions' ? <Distractions /> : <ListView key={JSON.stringify(v)} view={v} />}</main>{selected && data.task[selected] && <Detail />}{search && <Search />}{settings && <SettingsDialog />}<Compose /><Ask /><Toast /></div>
}
function addList() {
  const n = listsOf(useStore.getState().data), l: List = { id: newId(), name: 'New list', color: COLORS[n.length % COLORS.length], order: Date.now(), view: 'list' }
  mutate('Add list', [{ kind: 'list', put: [l] }]); go({ t: 'list', id: l.id })
  setTimeout(() => document.querySelector<HTMLTextAreaElement>('.head h1 textarea')?.select(), 50)
}
function Nav({ on, icon, dot, label, count, onClick, onDropTask }: { on: boolean; icon?: string; dot?: string; label: string; count?: number; onClick(): void; onDropTask?(id: string): void }) {
  const d = useDrop((id) => onDropTask?.(id))
  return <button className={`nav ${on ? 'on' : ''} ${d.over && onDropTask ? 'over' : ''}`} {...(onDropTask ? d.props : {})} onClick={onClick} aria-current={on ? 'page' : undefined}>{icon ? <Icon n={icon} /> : <i className="dot" style={{ background: dot }} />}<span>{label}</span>{!!count && <small>{count}</small>}</button>
}
function Sidebar({ v }: { v: View }) {
  const data = useStore((s) => s.data), today = useStore((s) => s.today), timer = useStore((s) => s.timer), left = useLeft()
  const gh = useStore((s) => s.gh)
  const tasks = tasksOf(data).filter(open), get = (id: string) => useStore.getState().data.task[id], tags = [...new Set(tasks.flatMap((t) => t.tags))].sort()
  const count = (k: string) => (k === 'today' ? tasks.filter((t) => t.due && t.due <= today).length : k === 'inbox' ? tasks.filter((t) => t.listId === 'inbox').length : k === 'week' ? tasks.filter((t) => t.due && t.due <= addDays(today, 6)).length : 0)
  return <nav className="side"><div className="drag" /><button className="searchbtn" onClick={() => useStore.setState({ search: true })}><Icon n="search" s={14} /><span>Search</span><kbd>⌘K</kbd></button>
    <div className="scroll">
      {SMART.map(([t, l, i]) => <Nav key={t} on={v.t === t} icon={i} label={l} count={count(t)} onClick={() => go({ t } as View)} onDropTask={t === 'today' ? (id) => reschedule(get(id), today) : t === 'inbox' ? (id) => move(get(id), 'inbox') : undefined} />)}
      <hr />{TOOLS.map(([t, l, i]) => <Nav key={t} on={v.t === t} icon={i} label={l} onClick={() => go({ t } as View)} />)}
      <h4>Lists<button className="ghost small" aria-label="New list" onClick={addList}><Icon n="plus" s={13} /></button></h4>
      {listsOf(data).map((l) => <Nav key={l.id} on={v.t === 'list' && v.id === l.id} dot={l.color} label={l.name} count={tasks.filter((t) => t.listId === l.id).length} onClick={() => go({ t: 'list', id: l.id })} onDropTask={(id) => { const t = get(id); if (t.listId !== l.id) move(t, l.id) }} />)}
      {tags.length > 0 && <><h4>Tags</h4>{tags.map((t) => <Nav key={t} on={v.t === 'tag' && v.id === t} dot="var(--ink3)" label={t} count={tasks.filter((x) => x.tags.includes(t)).length} onClick={() => go({ t: 'tag', id: t })} />)}</>}
      <hr /><Nav on={v.t === 'done'} icon="done" label="Completed" onClick={() => go({ t: 'done' })} /><Nav on={v.t === 'trash'} icon="trash" label="Trash" onClick={() => go({ t: 'trash' })} onDropTask={(id) => trash(get(id))} />
    </div>
    {timer.phase !== 'idle' && <button className={`mini ph-${timer.phase}`} onClick={() => go({ t: 'focus' })}><b>{clock(left)}</b><span>{timer.phase === 'break' ? 'Break' : timer.title || 'Focusing'}</span></button>}
    <button className="nav" onClick={() => useStore.setState({ settings: true })}><Icon n="gear" /><span>Settings</span>{gh?.error && <small className="warn" title={gh.error}>Check backup</small>}</button></nav>
}
function SettingsDialog() {
  const data = useStore((s) => s.data), s = settingsOf(data), close = () => useStore.setState({ settings: false }), [login, setLogin] = useState(false), [info, setInfo] = useState<{ hotkey: string; hotkeyOk: boolean; dir: string } | null>(null)
  useEffect(() => { call('login.get').then(setLogin, () => {}); call('app.info').then(setInfo, () => {}) }, [])
  const gh = useStore((x) => x.gh), [ghOpen, setGhOpen] = useState(false)
  const num = (k: 'focusMin' | 'shortMin' | 'longMin', l: string) => <label>{l}<input type="number" min={1} max={180} value={s[k]} onChange={(e) => saveSettings({ [k]: Math.max(1, Math.min(180, Math.trunc(Number(e.target.value)) || 1)) })} /></label>
  async function doImport() {
    try {
      const f = await call('import.read')
      if (!f) return
      let ops: Op[], msg: string
      if (/\.json$/i.test(f.name)) {
        const j = parseBackup(f.text)
        ops = KINDS.map((k) => ({ kind: k, put: j[k] }) as Op); msg = `${j.task.length} tasks from the backup. Items with the same id are replaced; nothing is removed.`
      } else {
        const r = importCsv(f.text, listsOf(data)); ops = r.ops
        msg = `${r.tasks} tasks and ${r.lists} new lists.${r.skippedRepeats ? ` ${r.skippedRepeats} repeating ${r.skippedRepeats === 1 ? 'task uses a pattern' : 'tasks use patterns'} Daybook does not support and will come in without a repeat.` : ''}`
      }
      if (await ask(`Import ${f.name}?`, `${msg} You can undo this.`, 'Import')) { mutate('Imported', ops, { toast: true }); close() }
    } catch (e) { fail(e) }
  }
  if (ghOpen) return <BackupDialog onClose={() => setGhOpen(false)} />
  return <Modal title="Settings" onClose={close} wide><div className="form">
    <div className="two"><label>Week starts on<select value={s.weekStart} onChange={(e) => saveSettings({ weekStart: Number(e.target.value) as 0 | 1 })}><option value={1}>Monday</option><option value={0}>Sunday</option></select></label><label>All-day reminders at<input type="time" value={s.allDayTime} onChange={(e) => { if (e.target.value) saveSettings({ allDayTime: e.target.value }) }} /></label></div>
    <div className="three">{num('focusMin', 'Focus minutes')}{num('shortMin', 'Short break')}{num('longMin', 'Long break')}</div>
    <label>Distraction penalty to suggest, in minutes<input type="number" min={0} max={120} value={s.penaltyMin} onChange={(e) => saveSettings({ penaltyMin: Math.max(0, Math.min(120, Math.trunc(Number(e.target.value)) || 0)) })} /></label>
    <label>Menu bar shows<select value={s.menuBar} onChange={(e) => saveSettings({ menuBar: e.target.value as 'count' })}><option value="count">How many tasks are due</option><option value="next">Next task with a time</option><option value="icon">Icon only</option></select></label>
    <div className="ghrepo"><span><b>GitHub backup</b><small className={gh?.error ? 'warn' : 'muted'}>{!gh?.repo ? 'Off' : gh.error || `${gh.repo}. ${gh.lastOk ? `Backed up ${ago(gh.lastOk)}` : 'Not backed up yet'}`}</small></span><button onClick={() => setGhOpen(true)}>{gh?.repo ? 'Options…' : 'Set Up…'}</button></div>
    <label className="inline"><input type="checkbox" checked={login} onChange={(e) => { const on = e.target.checked; call('login.set', on).then(() => setLogin(on), fail) }} /> Open at login, so reminders always fire</label>
    <p className="muted">{info && (info.hotkeyOk ? `Quick add from anywhere: ${info.hotkey}.` : `${info.hotkey} is taken by another app, so quick add from anywhere is off.`)} Closing the window keeps Daybook in the menu bar. {info && `Data and 14 daily backups are in ${info.dir}.`}</p>
    <div className="actions"><button onClick={doImport}>Import…</button><button onClick={() => call('backup.export').then((p) => { if (p) toast(`Saved ${p.split('/').pop()}`) }, fail)}>Export Backup…</button><span className="grow" /><button className="primary" onClick={close}>Done</button></div></div></Modal>
}
