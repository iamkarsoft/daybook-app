import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, shell, Tray, type MenuItemConstructorOptions } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { hm, ymd } from '../shared/dates.ts'
import { byDate, completeOps, reminderTimes, uid } from '../shared/tasks.ts'
import { IDLE, type Op, type PushEvent, type Rpc, type Task, type Timer } from '../shared/types.ts'
import { Cloud } from './cloud.ts'
import { Db } from './db.ts'

if (process.env.DAYBOOK_DATA) app.setPath('userData', process.env.DAYBOOK_DATA)
const HOTKEY = 'Control+Alt+Space'
let db: Db, cloud: Cloud, win: BrowserWindow | null = null, quick: BrowserWindow | null = null, panel: BrowserWindow | null = null, tray: Tray | null = null
let quitting = false, hotkeyOk = false
let timer: Timer = IDLE
const live = new Set<Notification>()

const push = (e: PushEvent, except?: Electron.WebContents) => { for (const w of [win, quick, panel]) if (w && !w.isDestroyed() && w.webContents !== except) w.webContents.send('push', e) }
function commit(ops: Op[], from?: Electron.WebContents) { db.apply(ops); push({ t: 'ops', ops }, from); refreshTray(); cloud.touched() }

function notify(title: string, body: string, onClick: () => void, actions: [string, () => void][] = []) {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, actions: actions.map(([text]) => ({ type: 'button' as const, text })) })
  // Held until dismissed: a collected notification stops delivering clicks.
  live.add(n)
  n.on('click', () => { live.delete(n); onClick() })
  n.on('action', (e: any, i?: number) => { live.delete(n); actions[e?.actionIndex ?? i ?? 0]?.[1]() })
  n.on('close', () => live.delete(n))
  n.show()
}

/** Reminders missed while the app was shut still fire, if they are under 12 hours old. */
function checkReminders() {
  // Only what came due since the last look, so a task entered with a past time stays quiet.
  const now = Date.now(), from = Math.max(db.since(now), now - 12 * 3600000), { allDayTime } = db.settings()
  for (const t of db.tasks()) for (const at of reminderTimes(t, allDayTime)) {
    if (at > now || at <= from || !db.claim(`${t.id}|${at}`)) continue
    const fresh = (fn: (t: Task) => Op[]) => { const x = db.task(t.id); if (x && x.status === 'open' && !x.deletedAt) commit(fn(x)) }
    notify(t.title || 'Task', t.time ? `${t.due} at ${t.time}` : 'Due ' + t.due, () => openTask(t.id), [
      ['Done', () => fresh((x) => completeOps(x))],
      ['Snooze 15 min', () => fresh((x) => [{ kind: 'task', put: [{ ...x, snoozeUntil: Date.now() + 15 * 60000 }] }])],
    ])
  }
}

function setTimer(t: Timer) { timer = t; push({ t: 'timer', timer }); refreshTray() }
function logFocus() {
  if (timer.phase !== 'focus') return
  const left = timer.endsAt ? Math.max(0, timer.endsAt - Date.now()) : timer.left ?? 0
  const minutes = Math.round((timer.total - left) / 60000)
  if (minutes >= 1) commit([{ kind: 'focus', put: [{ id: uid(), taskId: timer.taskId, title: timer.title, date: ymd(new Date(timer.startedAt)), startedAt: timer.startedAt, minutes }] }])
}
function checkTimer() {
  if (!timer.endsAt || Date.now() < timer.endsAt) return
  if (timer.phase === 'focus') {
    logFocus()
    const done = timer.done + 1
    setTimer({ ...IDLE, done, taskId: timer.taskId, title: timer.title })
    notify('Focus session done', timer.title || 'Time for a break.', show, [['Start break', startBreak]])
  } else { setTimer({ ...IDLE, done: timer.done, taskId: timer.taskId, title: timer.title }); notify('Break over', 'Ready for another round?', show) }
}
function begin(phase: 'focus' | 'break', minutes: number, x: Partial<Timer>) {
  const total = minutes * 60000
  setTimer({ ...timer, ...x, phase, total, left: null, startedAt: Date.now(), endsAt: Date.now() + total })
}
function startBreak() { const s = db.settings(); begin('break', timer.done > 0 && timer.done % 4 === 0 ? s.longMin : s.shortMin, {}) }

let trayText = '', tip = ''
function refreshTray() {
  if (!tray) return
  let text = ''
  if (timer.phase !== 'idle') {
    const sec = Math.ceil((timer.endsAt ? Math.max(0, timer.endsAt - Date.now()) : timer.left ?? 0) / 1000)
    text = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}${timer.endsAt ? '' : ' paused'}`
  } else {
    const now = new Date(), today = ymd(now), mode = db.settings().menuBar
    const due = db.tasks().filter((t) => t.status === 'open' && !t.deletedAt && t.due && t.due <= today)
    const next = due.filter((t) => t.due === today && t.time && t.time >= hm(now)).sort(byDate)[0]
    if (mode === 'next' && next) text = `${next.time} ${next.title.length > 22 ? next.title.slice(0, 21).trimEnd() + '…' : next.title}`
    else if (mode !== 'icon' && due.length) text = String(due.length)
    const t = `Daybook: ${due.length} due today`
    if (t !== tip) { tip = t; tray.setToolTip(t) }
  }
  if (text !== trayText) { trayText = text; tray.setTitle(text, { fontType: 'monospacedDigit' }) }
}

const prefs = { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false }
function harden(w: BrowserWindow) {
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' } })
}
function show() {
  if (win) { win.show(); win.focus(); return }
  win = new BrowserWindow({ width: 1240, height: 820, minWidth: 760, minHeight: 520, show: false, titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 }, webPreferences: prefs })
  harden(win)
  win.once('ready-to-show', () => win?.show())
  // Closing hides, so reminders keep working; Quit ends the app.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win?.hide() } })
  win.on('closed', () => { win = null })
  win.loadFile(join(__dirname, 'index.html'))
}
function showQuick() {
  if (!quick) {
    quick = new BrowserWindow({ width: 620, height: 132, show: false, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, webPreferences: prefs })
    harden(quick)
    quick.on('blur', () => quick?.hide())
    quick.on('close', (e) => { if (!quitting) { e.preventDefault(); quick?.hide() } })
    quick.loadFile(join(__dirname, 'index.html'), { hash: 'quick' })
    quick.once('ready-to-show', placeQuick)
  } else placeQuick()
}
function placeQuick() {
  if (!quick) return
  const { workArea: a } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  quick.setPosition(Math.round(a.x + (a.width - 620) / 2), Math.round(a.y + a.height * 0.22))
  quick.show(); quick.focus()
  quick.webContents.send('push', { t: 'quick' } satisfies PushEvent)
}

const PW = 348, PH = 520
let panelHidden = 0
function createPanel() {
  // A panel-type window takes the keyboard without pulling the main window forward.
  panel = new BrowserWindow({ width: PW, height: PH, show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, type: 'panel', webPreferences: prefs })
  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  harden(panel)
  // Timed here, not on 'hide', which macOS reports about 300 ms late.
  panel.on('blur', () => { if (panel?.isVisible()) { panelHidden = Date.now(); panel.hide() } })
  panel.on('close', (e) => { if (!quitting) { e.preventDefault(); panel?.hide() } })
  panel.loadFile(join(__dirname, 'index.html'), { hash: 'panel' })
}
function togglePanel() {
  if (!panel || !tray) return
  // Clicking the icon blurs the panel first; without this it would close and reopen.
  if (panel.isVisible()) { panel.hide(); return }
  if (Date.now() - panelHidden < 250) return
  const b = tray.getBounds(), area = (b.width ? screen.getDisplayMatching(b) : screen.getPrimaryDisplay()).workArea
  const x = b.width ? b.x + b.width / 2 - PW / 2 : area.x + area.width - PW - 8
  panel.setBounds({ x: Math.round(Math.max(area.x + 6, Math.min(x, area.x + area.width - PW - 6))), y: Math.round(area.y + 5), width: PW, height: Math.min(PH, area.height - 20) })
  panel.show()
  panel.webContents.send('push', { t: 'panel' } satisfies PushEvent)
}
function openTask(id: string | null) { show(); if (id) win?.webContents.send('push', { t: 'open', id } satisfies PushEvent) }
/** Undo belongs to whichever window has focus; everything else is for the main window. */
function runMenu(a: string) {
  const f = BrowserWindow.getFocusedWindow()
  if (a === 'undo') { f?.webContents.send('push', { t: 'menu', a } satisfies PushEvent); return }
  show()
  win?.webContents.send('push', { t: 'menu', a } satisfies PushEvent)
}

type Handlers = { [K in keyof Rpc]: (e: Electron.IpcMainInvokeEvent, ...a: Parameters<Rpc[K]>) => ReturnType<Rpc[K]> | Promise<ReturnType<Rpc[K]>> }
const handlers: Handlers = {
  load: () => ({ data: db.load(), timer }),
  apply: (e, ops) => commit(ops, e.sender),
  'timer.start': (_, taskId, title) => { logFocus(); begin('focus', db.settings().focusMin, { taskId, title }) },
  'timer.break': () => startBreak(),
  'timer.pause': () => { if (timer.endsAt) setTimer({ ...timer, left: Math.max(0, timer.endsAt - Date.now()), endsAt: null }) },
  'timer.resume': () => { if (timer.left !== null) setTimer({ ...timer, endsAt: Date.now() + timer.left, left: null }) },
  'timer.stop': () => { logFocus(); setTimer({ ...IDLE, done: timer.done }) },
  'timer.extend': (_, minutes) => {
    const ms = Math.max(0, Math.min(120, Math.trunc(Number(minutes)) || 0)) * 60000
    if (timer.phase !== 'focus' || !ms) return
    setTimer({ ...timer, total: timer.total + ms, ...(timer.endsAt ? { endsAt: timer.endsAt + ms } : { left: (timer.left ?? 0) + ms }) })
  },
  'backup.export': async () => {
    const name = `daybook-${ymd(new Date())}.json`
    const path = process.env.DAYBOOK_EXPORT_DIR ? join(process.env.DAYBOOK_EXPORT_DIR, name) : (await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('downloads'), name) })).filePath
    if (!path) return null
    await writeFile(path, JSON.stringify({ app: 'daybook', version: 1, exportedAt: new Date().toISOString(), ...db.load() }, null, 1))
    return path
  },
  'backup.local': () => db.snapshot(`before-restore-${Date.now()}.sqlite`),
  'gh.status': () => cloud.status(),
  'gh.connect': (_, auth, token) => cloud.connect(auth, token),
  'gh.disconnect': () => cloud.disconnect(),
  'gh.repos': () => cloud.repos(),
  'gh.create': (_, name) => cloud.create(name),
  'gh.choose': (_, repo) => cloud.choose(repo),
  'gh.set': (_, x) => cloud.set(x),
  'gh.backup': (_, takeOver) => cloud.backup(takeOver),
  'gh.history': () => cloud.history(),
  'gh.fetch': (_, sha) => cloud.fetch(sha),
  'import.read': async () => {
    const path = process.env.DAYBOOK_IMPORT_FILE ?? (await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Daybook backup or CSV', extensions: ['csv', 'json'] }] })).filePaths[0]
    return path ? { name: basename(path), text: await readFile(path, 'utf8') } : null
  },
  'login.get': () => app.getLoginItemSettings().openAtLogin,
  'login.set': (_, on) => app.setLoginItemSettings({ openAtLogin: on }),
  'app.nativeUndo': (e) => e.sender.undo(),
  'quick.close': () => quick?.hide(),
  'panel.close': () => panel?.hide(),
  'app.show': (_, id) => { panel?.hide(); openTask(id) },
  'app.quick': () => { panel?.hide(); showQuick() },
  'app.info': () => ({ hotkey: '⌃⌥Space', hotkeyOk, dir: app.getPath('userData') }),
}
ipcMain.handle('rpc', async (e, m: keyof Rpc, args: unknown[]) => {
  const ours = [win, quick, panel].some((w) => w && e.senderFrame === w.webContents.mainFrame)
  if (!ours || !Object.hasOwn(handlers, m)) return { ok: false, error: 'Not allowed' }
  try { return { ok: true, value: await (handlers[m] as any)(e, ...args) } } catch (err: any) { return { ok: false, error: String(err?.message ?? err) } }
})

function buildMenu() {
  const go = (label: string, accelerator: string, a: string): MenuItemConstructorOptions => ({ label, accelerator, click: () => runMenu(a) })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Daybook', submenu: [{ role: 'about' }, { type: 'separator' }, go('Settings…', 'CmdOrCtrl+,', 'settings'), { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'File', submenu: [go('New Task', 'CmdOrCtrl+N', 'new'), go('New List', 'CmdOrCtrl+Shift+N', 'new-list'), { type: 'separator' }, { role: 'close' }] },
    { label: 'Edit', submenu: [go('Undo', 'CmdOrCtrl+Z', 'undo'), { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' }, go('Search', 'CmdOrCtrl+K', 'search')] },
    { label: 'Go', submenu: ['Today', 'Next 7 Days', 'Inbox', 'Calendar', 'Matrix', 'Habits', 'Focus', 'Distractions'].map((l, i) => go(l, `CmdOrCtrl+${i + 1}`, 'go:' + ['today', 'week', 'inbox', 'calendar', 'matrix', 'habits', 'focus', 'distractions'][i])) },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions])] },
    { role: 'windowMenu' },
  ]))
}
// A small tick-in-a-page template image, drawn here so there is no asset to load.
function trayIcon() {
  const S = 36, b = Buffer.alloc(S * S * 4)
  const dist = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => { const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2))); return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const qx = Math.abs(x - 17.5) - 7, qy = Math.abs(y - 17.5) - 8, box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 5
    const a = Math.max(0, Math.min(1, 1.9 - Math.abs(box))), tick = Math.max(0, Math.min(1, 2.4 - Math.min(dist(x, y, 12, 18, 16, 22), dist(x, y, 16, 22, 24, 13))))
    b[(y * S + x) * 4 + 3] = Math.round(255 * Math.max(a, tick))
  }
  const i = nativeImage.createFromBitmap(b, { width: S, height: S, scaleFactor: 2 })
  i.setTemplateImage(true)
  return i
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', show)
  app.on('activate', show)
  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => {})
  app.on('will-quit', () => { globalShortcut.unregisterAll(); if (db) { logFocus(); db.close() } })
  app.whenReady().then(() => {
    try { db = new Db(app.getPath('userData')); db.load() }
    catch (e: any) { dialog.showErrorBox('Daybook could not open its data', `${e.message}\n\nNothing was changed. Daily copies are in:\n${join(app.getPath('userData'), 'backups')}`); app.exit(1); return }
    cloud = new Cloud(db, (status) => push({ t: 'gh', status }))
    buildMenu(); show()
    hotkeyOk = globalShortcut.register(HOTKEY, showQuick)
    tray = new Tray(trayIcon())
    if (process.env.DAYBOOK_DATA) (globalThis as any).daybookTray = tray // lets the tests click it
    refreshTray()
const trayMenu = Menu.buildFromTemplate([{ label: 'Open Daybook', click: show }, { label: 'Quick Add', accelerator: HOTKEY, click: showQuick }, { type: 'separator' }, { label: 'Quit', click: () => app.quit() }])
    createPanel()
    tray.setIgnoreDoubleClickEvents(true)
    tray.on('click', (e) => (e.ctrlKey ? tray!.popUpContextMenu(trayMenu) : togglePanel()))
    tray.on('right-click', () => tray!.popUpContextMenu(trayMenu))
    let last = '', day = ''
    const tick = () => {
      checkTimer()
      const min = new Date().toTimeString().slice(0, 5)
      if (min !== last) { last = min; checkReminders(); refreshTray(); cloud.tick(); push({ t: 'tick' }) }
      const d = ymd(new Date())
      if (d !== day) { day = d; try { db.backup(d) } catch (e) { console.error('Backup failed', e) } }
    }
    tick(); setInterval(tick, 1000)
    // The countdown reads only memory, and setTitle runs only when the text changes.
    setInterval(() => { if (timer.endsAt) refreshTray() }, 250)
  })
}
