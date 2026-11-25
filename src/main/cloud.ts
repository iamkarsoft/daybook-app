import { safeStorage } from 'electron'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { backupJson, backupMarkdown, parseBackup } from '../shared/backup.ts'
import type { GhEvery, GhStatus, Snapshot } from '../shared/types.ts'
import type { Db } from './db.ts'
import { GhError, GitHub } from './github.ts'

interface Cfg { auth: 'gh' | 'token'; login: string; repo: string; every: GhEvery; markdown: boolean; hash: string; lastOk: number; lastTry: number; error: string; block: boolean }
const BLANK: Cfg = { auth: 'gh', login: '', repo: '', every: 'changes', markdown: true, hash: '', lastOk: 0, lastTry: 0, error: '', block: false }
const FOLDER = 'daybook', MIN = 60000

/** An app opened from the Finder does not get the shell's PATH, so look in the usual places. */
function ghPath() { return (process.env.DAYBOOK_DATA && process.env.DAYBOOK_GH ? [process.env.DAYBOOK_GH] : ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/opt/local/bin/gh']).find((p) => existsSync(p)) ?? null }

export class Cloud {
  private db: Db
  private onStatus: (s: GhStatus) => void
  private running: Promise<{ changed: boolean }> | null = null
  private first = 0
  private last = 0
  constructor(db: Db, onStatus: (s: GhStatus) => void) { this.db = db; this.onStatus = onStatus; this.first = this.last = Date.now() - 4 * MIN }

  private cfg(): Cfg { const v = this.db.kv('github'); return { ...BLANK, ...(v ? JSON.parse(v) : {}) } }
  private save(x: Partial<Cfg>) { this.db.kvSet('github', JSON.stringify({ ...this.cfg(), ...x })); this.onStatus(this.status()) }
  private device() { let d = this.db.kv('device'); if (!d) { d = randomUUID(); this.db.kvSet('device', d) } return d }
  status(): GhStatus {
    const c = this.cfg()
    return { gh: !!ghPath(), auth: c.auth, login: c.login, repo: c.repo, every: c.every, markdown: c.markdown, lastOk: c.lastOk, error: c.error, block: c.block, busy: !!this.running }
  }
  private async client(): Promise<GitHub> {
    if (this.cfg().auth === 'token') {
      const t = this.db.kv('github.token')
      if (!t) throw new GhError('Connect to GitHub first', 0, 'auth')
      try { return new GitHub((await safeStorage.decryptStringAsync(Buffer.from(t, 'base64'))).result) } catch { throw new GhError('The saved token could not be read from the keychain. Connect again.', 0, 'auth') }
    }
    return new GitHub(await this.ghToken())
  }
  private ghToken() {
    const p = ghPath()
    if (!p) throw new GhError('The GitHub CLI is not installed')
    return new Promise<string>((res, rej) => execFile(p, ['auth', 'token', '--hostname', 'github.com'], { timeout: 10000 }, (e, out) => (e || !out.trim() ? rej(new GhError('The GitHub CLI is not signed in. Run “gh auth login” in Terminal.', 0, 'auth')) : res(out.trim()))))
  }
  async connect(auth: 'gh' | 'token', token?: string) {
    const t = auth === 'gh' ? await this.ghToken() : (token ?? '').trim()
    if (!t || /\s/.test(t)) throw new GhError('Paste a token first')
    const login = await new GitHub(t).login()
    if (auth === 'token') {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new GhError('The system keychain is unavailable, so the token cannot be stored safely')
      this.db.kvSet('github.token', (await safeStorage.encryptStringAsync(t)).toString('base64'))
    } else this.db.kvSet('github.token', null)
    // A different account must pick its own repository.
    this.save({ auth, login, error: '', ...(this.cfg().login !== login ? { repo: '', hash: '', lastOk: 0, block: false } : {}) })
  }
  disconnect() { this.db.kvSet('github.token', null); this.db.kvSet('github', null); this.onStatus(this.status()) }
  async repos() { return (await this.client()).repos() }
  async create(name: string) { const r = await (await this.client()).create(name.trim()); this.save({ repo: r, hash: '', lastOk: 0, error: '', block: false }); return r }
  async choose(repo: string) { const r = await (await this.client()).check(repo.trim()); this.save({ repo: r.full_name, hash: '', lastOk: 0, error: '', block: false }) }
  set(x: { every?: GhEvery; markdown?: boolean }) { this.save({ ...(x.every ? { every: x.every } : {}), ...(x.markdown === undefined ? {} : { markdown: x.markdown }) }); if (x.markdown !== undefined) this.touched() }
  touched() { this.last = Date.now(); if (!this.first) this.first = this.last }

  backup(takeOver = false) { return (this.running ??= this.run(takeOver).finally(() => { this.running = null; this.onStatus(this.status()) })) }
  private async run(takeOver: boolean): Promise<{ changed: boolean }> {
    const c = this.cfg(), started = Date.now(), from = this.first
    if (!c.repo) throw new GhError('Choose a repository first')
    this.first = 0
    const data = this.db.load(), json = backupJson(data), files = [{ path: 'daybook.json', content: json }, ...(c.markdown ? [{ path: 'tasks.md', content: backupMarkdown(data) }] : [])]
    const hash = createHash('sha256').update(JSON.stringify([c.repo, files])).digest('hex')
    if (hash === c.hash && !takeOver) { this.save({ lastOk: started, lastTry: started, error: '', block: false }); return { changed: false } }
    this.onStatus({ ...this.status(), busy: true })
    try {
      const open = data.task.filter((t) => t.status === 'open' && !t.deletedAt).length
      const r = await (await this.client()).push(c.repo, FOLDER, files, c.markdown ? [] : ['tasks.md'], `Daybook backup: ${open} open ${open === 1 ? 'task' : 'tasks'}`, this.device(), takeOver)
      // Disconnected or pointed elsewhere while uploading: that choice wins.
      if (this.cfg().repo === c.repo) this.save({ repo: r.repo, hash: createHash('sha256').update(JSON.stringify([r.repo, files])).digest('hex'), lastOk: started, lastTry: started, error: '', block: false })
      return { changed: r.changed }
    } catch (e: any) {
      this.first ||= from || started
      if (this.cfg().repo === c.repo) this.save({ lastTry: started, error: String(e?.message ?? e), block: ['other-device', 'public', 'auth'].includes(e?.code) })
      throw e
    }
  }
  /** Runs a scheduled backup if one is due. Problems only you can fix wait for you; the rest retry every 15 minutes. */
  tick(now = Date.now()) {
    const c = this.cfg()
    if (!c.repo || c.every === 'manual' || c.block || this.running) return
    if (c.error && now - c.lastTry < 15 * MIN) return
    const due = c.error ? true : c.every === 'hour' ? now - c.lastOk >= 60 * MIN : c.every === 'day' ? now - c.lastOk >= 1440 * MIN : !!this.first && (now - this.last >= 3 * MIN || now - this.first >= 15 * MIN)
    if (due) this.backup().catch(() => {})
  }
  async history() { const c = this.cfg(); return (await this.client()).history(c.repo, FOLDER) }
  async fetch(sha: string): Promise<Snapshot> { const c = this.cfg(); return parseBackup(await (await this.client()).file(c.repo, `${FOLDER}/daybook.json`, sha)) }
}
