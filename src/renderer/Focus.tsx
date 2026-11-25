import { useEffect, useState } from 'react'
import { addDays, fmt } from '../shared/dates.ts'
import { byDate } from '../shared/tasks.ts'
import { call, fail, open, settingsOf, tasksOf, useStore } from './store.ts'
import { Icon } from './ui.tsx'

export function useLeft() {
  const t = useStore((s) => s.timer), [, n] = useState(0)
  useEffect(() => { if (!t.endsAt) return; const h = setInterval(() => n((x) => x + 1), 500); return () => clearInterval(h) }, [t.endsAt])
  return t.endsAt ? Math.max(0, t.endsAt - Date.now()) : t.left ?? 0
}
export const clock = (ms: number) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
export function Focus() {
  const t = useStore((s) => s.timer), data = useStore((s) => s.data), today = useStore((s) => s.today), left = useLeft(), st = settingsOf(data)
  const [pick, setPick] = useState(t.taskId ?? ''), idle = t.phase === 'idle', total = idle ? st.focusMin * 60000 : t.total, f = idle ? 1 : left / total, R = 118, C = 2 * Math.PI * R
  const tasks = tasksOf(data).filter(open).sort(byDate), logs = Object.values(data.focus).sort((a, b) => b.startedAt - a.startedAt), week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const per = (d: string) => logs.filter((l) => l.date === d).reduce((a, l) => a + l.minutes, 0), max = Math.max(60, ...week.map(per))
  const run = (p: Promise<unknown>) => p.catch(fail)
  return <div className="page"><header className="head"><h1>Focus</h1></header><div className="focus scroll">
    <div className="dial"><svg viewBox="0 0 260 260" aria-hidden><circle cx="130" cy="130" r={R} className="track" /><circle cx="130" cy="130" r={R} className={`arc ${t.phase}`} strokeDasharray={C} strokeDashoffset={C * (1 - f)} transform="rotate(-90 130 130)" /></svg><div><b>{clock(idle ? total : left)}</b><span>{idle ? `${t.done} ${t.done === 1 ? 'session' : 'sessions'} so far` : t.phase === 'break' ? 'Break' : t.title || 'Focusing'}</span></div></div>
    <div className="controls">{idle ? <><select aria-label="Task to focus on" value={data.task[pick] ? pick : ''} onChange={(e) => setPick(e.target.value)}><option value="">No task</option>{tasks.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select><button className="primary" onClick={() => run(call('timer.start', data.task[pick] ? pick : null, data.task[pick]?.title ?? ''))}><Icon n="play" s={12} /> Start</button>{t.done > 0 && <button onClick={() => run(call('timer.break'))}>Break</button>}</>
      : <>{t.endsAt ? <button onClick={() => run(call('timer.pause'))}><Icon n="pause" s={13} /> Pause</button> : <button className="primary" onClick={() => run(call('timer.resume'))}><Icon n="play" s={12} /> Resume</button>}<button onClick={() => run(call('timer.stop'))}>{t.phase === 'break' ? 'Skip break' : 'End early'}</button></>}</div>
    <div className="fstats"><h3>This week</h3><div className="bars">{week.map((d) => <div key={d} title={`${per(d)} min`}><span>{per(d) || ''}</span><i style={{ height: `${(per(d) / max) * 100}px` }} /><small>{fmt(d, { weekday: 'short' })}</small></div>)}</div>{logs.slice(0, 8).map((l) => <div className="flog" key={l.id}><span>{l.title || 'Unlinked session'}</span><small className="muted">{new Date(l.startedAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}, {l.minutes} min</small></div>)}</div>
  </div></div>
}
