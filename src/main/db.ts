import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULTS, KINDS, type Kind, type Op, type Settings, type Snapshot, type Task } from '../shared/types.ts'

export class Db {
  private db: DatabaseSync
  private dir: string
  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'daybook.sqlite'))
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS docs (kind TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (kind, id)) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS fired (key TEXT PRIMARY KEY, at INTEGER NOT NULL) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;`)
  }
  load(): Snapshot {
    const out = Object.fromEntries(KINDS.map((k) => [k, []])) as unknown as Record<Kind, unknown[]>
    for (const r of this.db.prepare('SELECT kind, json FROM docs').all() as { kind: Kind; json: string }[]) out[r.kind]?.push(JSON.parse(r.json))
    return out as unknown as Snapshot
  }
  apply(ops: Op[]) {
    const put = this.db.prepare('INSERT INTO docs VALUES (?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET json = excluded.json, updated = excluded.updated')
    const del = this.db.prepare('DELETE FROM docs WHERE kind = ? AND id = ?')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const op of ops) {
        if (!KINDS.includes(op.kind)) throw new Error(`Unknown kind ${op.kind}`)
        for (const d of op.put ?? []) { if (typeof d.id !== 'string' || !d.id) throw new Error('Missing id'); put.run(op.kind, d.id, JSON.stringify(d), Date.now()) }
        for (const id of op.del ?? []) del.run(op.kind, id)
      }
      this.db.exec('COMMIT')
    } catch (e) { this.db.exec('ROLLBACK'); throw e }
  }
  tasks(): Task[] { return (this.db.prepare("SELECT json FROM docs WHERE kind = 'task'").all() as { json: string }[]).map((r) => JSON.parse(r.json)) }
  task(id: string): Task | null { const r = this.db.prepare("SELECT json FROM docs WHERE kind = 'task' AND id = ?").get(id) as { json: string } | undefined; return r ? JSON.parse(r.json) : null }
  settings(): Settings { const r = this.db.prepare("SELECT json FROM docs WHERE kind = 'settings' AND id = 'main'").get() as { json: string } | undefined; return { ...DEFAULTS, ...(r ? JSON.parse(r.json) : {}) } }
  /** True once per key, across restarts, so a reminder never fires twice. */
  claim(key: string) { return this.db.prepare('INSERT OR IGNORE INTO fired VALUES (?, ?)').run(key, Date.now()).changes === 1 }
  /** Start of the window to look for due reminders in; moves forward to `now` on each call. */
  since(now: number) {
    const r = this.db.prepare("SELECT at FROM fired WHERE key = '_last'").get() as { at: number } | undefined
    this.db.prepare("INSERT INTO fired VALUES ('_last', ?) ON CONFLICT (key) DO UPDATE SET at = excluded.at").run(now)
    return r?.at ?? now
  }
  /** Settings for this Mac only. Kept apart from docs so backups never contain them. */
  kv(key: string): string | null { return (this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null }
  kvSet(key: string, value: string | null) { if (value === null) this.db.prepare('DELETE FROM kv WHERE key = ?').run(key); else this.db.prepare('INSERT INTO kv VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value) }
  snapshot(name: string) {
    const dir = join(this.dir, 'backups')
    mkdirSync(dir, { recursive: true })
    this.db.prepare('VACUUM INTO ?').run(join(dir, name))
    return name
  }
  backup(today: string) {
    this.db.prepare('DELETE FROM fired WHERE at < ?').run(Date.now() - 30 * 86400000)
    const dir = join(this.dir, 'backups'), f = join(dir, `${today}.sqlite`)
    mkdirSync(dir, { recursive: true })
    if (existsSync(f)) return
    this.db.prepare('VACUUM INTO ?').run(f)
    for (const x of readdirSync(dir).filter((n) => /^\d{4}-\d\d-\d\d\.sqlite$/.test(n)).sort().slice(0, -14)) rmSync(join(dir, x))
  }
  close() { this.db.close() }
}
