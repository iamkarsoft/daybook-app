import { useEffect, useRef, useState } from 'react'
import { dayLabel, fmt } from '../shared/dates.ts'
import { inSession, stats } from '../shared/distractions.ts'
import type { Distraction } from '../shared/types.ts'
import { call, fail, logDistraction, mutate, noteDistraction, settingsOf, useStore } from './store.ts'
import { Draft, Icon, MenuButton } from './ui.tsx'

const PENALTIES = [0, 1, 2, 5, 10]
/**
 * The "Distracted" button for a focus session. One click counts it and pauses the timer;
 * then you say what happened and how many minutes to add as a penalty, and it resumes.
 */
export function Capture({ className = '' }: { className?: string }) {
  const timer = useStore((s) => s.timer), all = useStore((s) => s.data.distraction), def = useStore((s) => settingsOf(s.data).penaltyMin)
  const [noting, setNoting] = useState<{ d: Distraction; resume: boolean } | null>(null), [text, setText] = useState(''), [pen, setPen] = useState(def), box = useRef<HTMLInputElement>(null)
  const n = timer.phase === 'focus' ? inSession(Object.values(all), timer.startedAt) : 0
  useEffect(() => { if (noting) box.current?.focus() }, [noting])
  if (timer.phase !== 'focus' && !noting) return null
  const hit = () => {
    const resume = !!timer.endsAt, d = logDistraction()
    if (resume) call('timer.pause').catch(fail)
    setText(''); setPen(def); setNoting({ d, resume })
  }
  /** Escape keeps the count but skips the note and the penalty. */
  async function done(save: boolean) {
    if (!noting) return
    const { d, resume } = noting, minutes = save ? pen : 0
    setNoting(null)
    if (save && (text.trim() || minutes)) noteDistraction(d, { note: text, penalty: minutes })
    try { if (minutes) await call('timer.extend', minutes); if (resume) await call('timer.resume') } catch (e) { fail(e) }
  }
  return <div className={`capture ${className}`}>
    <div className="caprow">
      <button className="distract" onClick={hit} disabled={!!noting} title="Count a distraction and pause the timer"><Icon n="bolt" s={13} /> Distracted</button>
      <span className="muted" aria-live="polite">{noting ? 'Timer paused' : n ? `${n} this session` : 'None yet this session'}</span>
    </div>
    {noting && <form className="capnote" onSubmit={(e) => { e.preventDefault(); done(true) }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); done(false) } }}>
      <input ref={box} aria-label="What distracted you" placeholder="What pulled you away? (optional)" value={text} onChange={(e) => setText(e.target.value)} />
      <div className="penalty" role="group" aria-label="Penalty minutes"><span className="muted">Add to focus</span>
        {PENALTIES.map((m) => <button type="button" key={m} aria-pressed={pen === m} className={pen === m ? 'on' : ''} onClick={() => setPen(m)}>{m ? `+${m}` : 'None'}</button>)}
        <input type="number" min={0} max={120} aria-label="Custom penalty minutes" value={pen} onChange={(e) => setPen(Math.max(0, Math.min(120, Math.trunc(Number(e.target.value)) || 0)))} />
      </div>
      <div className="capact"><button type="button" onClick={() => done(false)}>Skip</button><button className="primary" type="submit">{noting.resume ? `Resume${pen ? ` +${pen} min` : ''}` : `Save${pen ? ` +${pen} min` : ''}`}</button></div>
    </form>}
  </div>
}

const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']] as const
const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })

/** The distraction log, with what it says about your focus. */
export function Distractions() {
  const data = useStore((s) => s.data), today = useStore((s) => s.today), [range, setRange] = useState<number>(7)
  const all = Object.values(data.distraction).sort((a, b) => b.at - a.at), st = stats(all, Object.values(data.focus), today, range)
  const maxDay = Math.max(1, ...st.perDay), maxHour = Math.max(1, ...st.perHour), every = range > 30 ? 14 : range > 7 ? 5 : 1
  const delta = st.total - st.prevTotal, shown = all.filter((d) => d.date >= st.days[0])
  const groups = [...new Set(shown.map((d) => d.date))].map((day) => [day, shown.filter((d) => d.date === day)] as const)
  const peak = st.perHour.indexOf(Math.max(...st.perHour))
  return <div className="page"><header className="head"><h1>Distractions</h1><span className="grow" />
    <div className="seg" role="tablist" aria-label="Period">{RANGES.map(([k, l]) => <button key={k} role="tab" aria-selected={range === k} className={range === k ? 'on' : ''} onClick={() => setRange(k)}>{l}</button>)}</div></header>
    <div className="scroll dstats">
      {!all.length && <p className="nothing">During a focus session, press Distracted whenever your attention slips. They are counted and charted here.</p>}
      {all.length > 0 && <>
        <div className="tiles">
          <div className="tile"><small>Distractions</small><b>{st.total}</b><span className="muted">{st.prevTotal || st.total ? `${delta === 0 ? 'Same as' : `${Math.abs(delta)} ${delta < 0 ? 'fewer' : 'more'} than`} the ${range} days before` : ''}</span></div>
          <div className="tile"><small>Per focus hour</small><b>{st.perHourFocused === null ? '–' : st.perHourFocused.toFixed(1)}</b><span className="muted">{st.focusMin ? `over ${st.focusMin >= 120 ? `${Math.round(st.focusMin / 60)} h` : `${st.focusMin} min`} of focus` : 'No focus logged'}</span></div>
          <div className="tile"><small>Distraction-free sessions</small><b>{st.sessions ? `${Math.round((st.clean / st.sessions) * 100)}%` : '–'}</b><span className="muted">{st.sessions ? `${st.clean} of ${st.sessions}` : 'No sessions yet'}</span></div>
          <div className="tile"><small>Penalty added</small><b>{st.penaltyMin ? `${st.penaltyMin} min` : '–'}</b><span className="muted">{st.penaltyMin ? 'extra focus to make up for it' : 'No penalties'}</span></div>
          <div className="tile"><small>Worst hour</small><b>{st.total ? hourLabel(peak) : '–'}</b><span className="muted">{st.total ? `${st.perHour[peak]} ${st.perHour[peak] === 1 ? 'distraction' : 'distractions'}` : ''}</span></div>
        </div>
        <section><h3>By day</h3><div className="dbars" style={{ '--n': range } as React.CSSProperties}>{st.days.map((d, i) => <div key={d} className="dbar" title={`${fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}: ${st.perDay[i]}`}>
          {range === 7 && <span>{st.perDay[i] || ''}</span>}<i style={{ height: `${(st.perDay[i] / maxDay) * 100}%` }} /><small>{(st.days.length - 1 - i) % every === 0 ? fmt(d, range === 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' }) : ''}</small></div>)}</div></section>
        <section><h3>Time of day</h3><div className="dbars hours" style={{ '--n': 24 } as React.CSSProperties}>{st.perHour.map((c, h) => <div key={h} className="dbar" title={`${hourLabel(h)}: ${c}`}><i style={{ height: `${(c / maxHour) * 100}%` }} /><small>{h % 6 === 0 ? hourLabel(h) : ''}</small></div>)}</div></section>
        <div className="two">
          <section><h3>What comes up</h3>{st.themes.length ? <div className="chips">{st.themes.map(([w, c]) => <span className="chip" key={w}>{w}<small className="muted">{c}</small></span>)}</div> : <p className="muted">{st.noted ? 'No word repeats yet.' : 'Add a note when you log one to see patterns here.'}</p>}</section>
          <section><h3>While working on</h3>{st.byTask.map(([t, c]) => <div className="flog" key={t}><span>{t}</span><small className="muted">{c}</small></div>)}{!st.byTask.length && <p className="muted">Nothing in this period.</p>}</section>
        </div>
        <section><h3>Log</h3>{!groups.length && <p className="muted">Nothing in this period.</p>}
          {groups.map(([day, ds]) => <div key={day} className="dday"><h4>{dayLabel(day, today)}<small className="muted">{ds.length}</small></h4>{ds.map((d) => <LogRow key={d.id} d={d} />)}</div>)}</section>
      </>}
    </div></div>
}
function LogRow({ d }: { d: Distraction }) {
  return <div className="drow">
    <small className="muted">{new Date(d.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</small>
    <div><Draft value={d.note} aria-label="Distraction note" placeholder="Add what happened" onSave={(v) => noteDistraction(d, { note: v })} />{(d.title || d.penalty > 0) && <small className="muted">{[d.title && `During ${d.title}`, d.penalty > 0 && `+${d.penalty} min penalty`].filter(Boolean).join(' · ')}</small>}</div>
    <MenuButton label="Distraction options" items={[{ label: 'Delete', danger: true, run: () => mutate('Deleted distraction', [{ kind: 'distraction', del: [d.id] }], { toast: true }) }]}><Icon n="more" /></MenuButton>
  </div>
}
