import { useEffect, useMemo, useRef, useState } from 'react'
import { dayLabel, fmtTime } from '../shared/dates.ts'
import { parseTask } from '../shared/parse.ts'
import { repeatText } from '../shared/repeat.ts'
import type { Task } from '../shared/types.ts'
import { addFromText, call, listsOf, menuHandlers, PRIO, useStore } from './store.ts'
import { Icon, Modal } from './ui.tsx'

/** One-line entry. Recognised phrases show as chips; clicking one turns it back into plain text. */
export function AddBar({ preset, placeholder, auto, hotkey, onAdded, onEscape }: { preset: Partial<Task>; placeholder?: string; auto?: boolean; hotkey?: boolean; onAdded?(t: Task): void; onEscape?(): void }) {
  const data = useStore((s) => s.data), today = useStore((s) => s.today)
  const [v, setV] = useState(''), [ignore, setIgnore] = useState<string[]>([]), ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (hotkey) menuHandlers.new = () => ref.current?.focus(); return () => { if (hotkey) delete menuHandlers.new } }, [hotkey])
  const p = useMemo(() => parseTask(v, new Date(), listsOf(data).map((l) => l.name), ignore), [v, ignore, data.list])
  const due = p.due ?? preset.due
  const label = (c: (typeof p.chips)[number]) => c.type === 'date' ? dayLabel(p.due!, today) : c.type === 'time' ? `${p.time ? fmtTime(p.time) : c.text}` : c.type === 'repeat' ? repeatText(p.repeat!) : c.type === 'priority' ? `${PRIO[p.priority!]} priority` : c.type === 'list' ? p.list! : c.text
  function submit() { const t = addFromText(v, preset, ignore); if (t) { setV(''); setIgnore([]); onAdded?.(t) } }
  return (
    <div className="add">
      <div className="addrow"><Icon n="plus" s={15} /><input ref={ref} autoFocus={auto} aria-label="New task" value={v} placeholder={placeholder ?? 'Add a task. Try “Call Ama friday 3pm #work !high”'} onChange={(e) => { setV(e.target.value); if (!e.target.value) setIgnore([]) }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit(); if (e.key === 'Escape') { if (v && !onEscape) setV(''); else { e.currentTarget.blur(); onEscape?.() } } }} />
        {v && due && !p.chips.some((c) => c.type === 'date') && <small className="muted">{dayLabel(due, today)}</small>}</div>
      {p.chips.length > 0 && <div className="chips">{p.chips.map((c) => <button key={c.type + c.text} className={`chip ${c.type}`} title="Keep as plain text" onClick={() => { setIgnore([...ignore, c.text]); ref.current?.focus() }}>{label(c)}<Icon n="x" s={10} /></button>)}</div>}
    </div>
  )
}
export function Compose() {
  const c = useStore((s) => s.compose), close = () => useStore.setState({ compose: null })
  return c && <Modal title="New task" onClose={close}><AddBar auto preset={c} placeholder="What needs doing?" onAdded={close} onEscape={close} /></Modal>
}
export function QuickWindow() {
  const [n, setN] = useState(0), [added, setAdded] = useState('')
  useEffect(() => { document.body.classList.add('quickwin'); menuHandlers.undo = () => { call('app.nativeUndo') }; menuHandlers.quick = () => { setAdded(''); setN((x) => x + 1) } }, [])
  return <div className="quickwin"><AddBar key={n} auto preset={{}} placeholder="Add to Inbox" onAdded={(t) => { setAdded(t.title); setTimeout(() => call('quick.close'), 550) }} onEscape={() => call('quick.close')} /><small className="muted">{added ? `Added “${added}”` : 'Return adds it. Escape closes.'}</small></div>
}
