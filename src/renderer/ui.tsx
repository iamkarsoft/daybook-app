import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { undo, useStore } from './store.ts'
const P: Record<string, string> = {
  sun: 'M8 10.8a2.8 2.8 0 100-5.6 2.8 2.8 0 000 5.6zM8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1', week: 'M2.5 4h11v9.5h-11zM2.5 7h11M5 2.5V4M11 2.5V4M5 10h6', inbox: 'M2.5 9.5l2-6h7l2 6v3.5h-11zM2.5 9.5h3l1 1.7h3l1-1.7h3', all: 'M5.5 4.5h8M5.5 8h8M5.5 11.5h8M2.7 4.5h.01M2.7 8h.01M2.7 11.5h.01', cal: 'M2.5 4h11v9.5h-11zM2.5 7h11M5 2.5V4M11 2.5V4M5.5 9.7h.01M8 9.7h.01M10.5 9.7h.01', matrix: 'M2.8 2.8h4.4v4.4H2.8zM8.8 2.8h4.4v4.4H8.8zM2.8 8.8h4.4v4.4H2.8zM8.8 8.8h4.4v4.4H8.8z', habit: 'M13.2 6.2A5.5 5.5 0 108 13.5M5.6 7.8l2 2 5.6-6M10.5 12.5l1.2 1.2 2.3-2.6', focus: 'M8 14A5.5 5.5 0 108 3a5.5 5.5 0 000 11zM8 6v2.7l1.8 1M6.3 1.4h3.4', done: 'M2.8 8.3l3.4 3.4 7-7.4', trash: 'M3 4.5h10M6.3 4.5V2.8h3.4v1.7M4.3 4.5l.6 8.7h6.2l.6-8.7', plus: 'M8 3v10M3 8h10', x: 'M4 4l8 8M12 4l-8 8', search: 'M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10.4 10.4l3.1 3.1', bell: 'M4 11V7.2a4 4 0 018 0V11l1 1H3zM6.8 14h2.4', repeat: 'M3 7V6a2 2 0 012-2h7.5M10.5 2l2 2-2 2M13 9v1a2 2 0 01-2 2H3.5M5.5 14l-2-2 2-2', flag: 'M4 14V2.8h8l-1.8 3L12 8.8H4', more: 'M4 8h.01M8 8h.01M12 8h.01', left: 'M10 3.5L5.5 8l4.5 4.5', right: 'M6 3.5L10.5 8 6 12.5', play: 'M5 3.2l7.5 4.8L5 12.8z', pause: 'M5 3.5v9M11 3.5v9', gear: 'M8 10.2a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4zM8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6L5 5M11 11l1.4 1.4M3.6 12.4L5 11M11 5l1.4-1.4', pin: 'M6 2.5h4l-.5 4 2 2.3H4.5l2-2.3zM8 8.8v4.7', board: 'M2.5 3h3.2v10H2.5zM6.9 3h3.2v6.5H6.9zM11.2 3h2.3v8h-2.3z', bolt: 'M9 1.8L3.8 9h3.8L7 14.2 12.2 7H8.4z',
}
export const Icon = ({ n, s = 16 }: { n: string; s?: number }) => <svg className="icon" width={s} height={s} viewBox="0 0 16 16" fill={n === 'play' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={n === 'more' || n === 'all' ? 1.6 : 1.35} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={P[n]} /></svg>

export function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { const p = document.activeElement as HTMLElement | null; if (!ref.current?.contains(document.activeElement)) ref.current?.focus(); return () => p?.focus?.() }, [])
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    // When the focused control has just gone away, focus falls to the body and the dialog never sees Escape.
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && document.activeElement === document.body && [...document.querySelectorAll('.modal')].at(-1) === ref.current) { e.stopPropagation(); close.current() } }
    addEventListener('keydown', k, true)
    return () => removeEventListener('keydown', k, true)
  }, [])
  return <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><div className={`modal ${wide ? 'wide' : ''}`} ref={ref} tabIndex={-1} role="dialog" aria-modal aria-label={title} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose() }}><h2>{title}</h2>{children}</div></div>
}
export function Ask() {
  const a = useStore((s) => s.ask)
  return a && <Modal title={a.title} onClose={() => a.done(false)}><p className="muted">{a.body}</p><div className="actions"><button autoFocus onClick={() => a.done(false)}>Cancel</button><button className="danger" onClick={() => a.done(true)}>{a.confirm}</button></div></Modal>
}
export function Toast() {
  const t = useStore((s) => s.toast)
  useEffect(() => { if (!t) return; const h = setTimeout(() => useStore.setState({ toast: null }), t.bad ? 8000 : 4500); return () => clearTimeout(h) }, [t])
  return t && <div className={`toast ${t.bad ? 'bad' : ''}`} role="status"><span>{t.text}</span>{t.undo && <button onClick={undo}>Undo</button>}</div>
}
export type Item = { label: string; run(): void; danger?: boolean; on?: boolean } | '-'
export function Menu({ at, items, onClose }: { at: { x: number; y: number }; items: Item[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null), [pos, setPos] = useState(at), close = useRef(onClose)
  close.current = onClose
  useLayoutEffect(() => { const r = ref.current!.getBoundingClientRect(); setPos({ x: Math.max(6, Math.min(at.x, innerWidth - r.width - 8)), y: Math.max(6, Math.min(at.y, innerHeight - r.height - 8)) }); ref.current!.querySelector('button')?.focus() }, [])
  useEffect(() => { const f = (e: Event) => { if (!ref.current?.contains(e.target as Node)) close.current() }; addEventListener('mousedown', f, true); return () => removeEventListener('mousedown', f, true) }, [])
  return <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }} onKeyDown={(e) => {
    e.stopPropagation()
    const b = [...ref.current!.querySelectorAll('button')], i = b.indexOf(document.activeElement as HTMLButtonElement)
    if (e.key === 'Escape') onClose(); if (e.key === 'ArrowDown') { e.preventDefault(); b[(i + 1) % b.length].focus() } if (e.key === 'ArrowUp') { e.preventDefault(); b[(i - 1 + b.length) % b.length].focus() }
  }}>{items.map((x, i) => x === '-' ? <hr key={i} /> : <button role="menuitem" key={i} className={`${x.danger ? 'bad' : ''} ${x.on ? 'on' : ''}`} onClick={() => { onClose(); x.run() }}>{x.label}</button>)}</div>
}
export function MenuButton({ items, children, label, className = 'ghost' }: { items: Item[]; children: ReactNode; label: string; className?: string }) {
  const [at, set] = useState<{ x: number; y: number } | null>(null)
  return <><button className={className} aria-label={label} title={label} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); set({ x: r.left, y: r.bottom + 4 }) }}>{children}</button>{at && <Menu at={at} items={items} onClose={() => set(null)} />}</>
}
/** Text that saves shortly after typing stops, on blur, and when it goes away. */
export function Draft({ value, onSave, area, ...rest }: { value: string; onSave(v: string): void; area?: boolean } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const [v, setV] = useState(value), st = useRef({ v: value, saved: value, onSave })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined), ref = useRef<HTMLTextAreaElement>(null)
  st.current.onSave = onSave
  const flush = () => { clearTimeout(timer.current); const s = st.current; if (s.v !== s.saved) { s.saved = s.v; s.onSave(s.v) } }
  useEffect(() => { const s = st.current; if (value !== s.saved) { const clean = s.v === s.saved; s.saved = value; if (clean) { s.v = value; setV(value) } } }, [value])
  useEffect(() => flush, [])
  useLayoutEffect(() => { const el = ref.current!; el.style.height = '0'; el.style.height = `${el.scrollHeight}px` }, [v])
  return <textarea {...rest} ref={ref} rows={1} value={v} onBlur={flush}
    onChange={(e) => { const x = area ? e.target.value : e.target.value.replace(/\n/g, ' '); setV(x); st.current.v = x; clearTimeout(timer.current); timer.current = setTimeout(flush, 500) }}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (!area && e.key === 'Enter')) e.currentTarget.blur() }} />
}
export const drag: { id: string | null } = { id: null }
/** Spread onto any element that accepts a dropped task. */
export function useDrop(onDrop: (id: string, e: React.DragEvent) => void) {
  const [over, set] = useState(false)
  return { over, props: {
    onDragOver: (e: React.DragEvent) => { if (drag.id) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move' as const; set(true) } },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) set(false) },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); set(false); const id = drag.id; drag.id = null; if (id) onDrop(id, e) },
  } }
}
export const dragProps = (id: string) => ({ draggable: true, onDragStart: (e: React.DragEvent) => { drag.id = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }, onDragEnd: () => { drag.id = null } })
