import { useEffect, useState } from 'react'
import { restoreOps } from '../shared/backup.ts'
import { KINDS, type GhEvery, type Snapshot } from '../shared/types.ts'
import { ask, call, fail, mutate, toast, useStore } from './store.ts'
import { Icon, Modal } from './ui.tsx'

export function ago(at: number) { const m = Math.floor((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }

export function BackupDialog({ onClose }: { onClose(): void }) {
  const s = useStore((x) => x.gh)
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [token, setToken] = useState(''), [useToken, setUseToken] = useState(false)
  const [repos, setRepos] = useState<string[] | null>(null), [name, setName] = useState('daybook-backup'), [pick, setPick] = useState(''), [change, setChange] = useState(false)
  const [hist, setHist] = useState<{ sha: string; at: string; message: string }[] | null>(null)
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> { setBusy(true); setErr(''); try { return await fn() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const choosing = !!s?.login && (!s.repo || change)
  useEffect(() => { if (choosing && !repos) call('gh.repos').then((r) => { setRepos(r); setPick((p) => p || r.find((x) => /daybook/i.test(x)) || '') }, (e) => { setRepos([]); setErr(e.message) }) }, [choosing])
  if (!s) return null
  async function restore(v: { sha: string; at: string }) {
    const then = await run(() => call('gh.fetch', v.sha))
    if (!then) return
    const n = then.task.filter((t) => t.status === 'open' && !t.deletedAt).length
    if (!(await ask('Restore this backup?', `Everything in Daybook now is replaced with the backup from ${new Date(v.at).toLocaleString()}, which has ${n} open ${n === 1 ? 'task' : 'tasks'}. A copy of what you have now is kept in the backups folder, and you can undo this.`, 'Restore'))) return
    await run(async () => {
      await call('backup.local')
      const d = useStore.getState().data
      mutate('Restored backup', restoreOps(Object.fromEntries(KINDS.map((k) => [k, Object.values(d[k])])) as unknown as Snapshot, then), { toast: true })
      useStore.setState({ settings: false })
    })
  }
  const backup = (takeOver: boolean) => run(async () => { const r = await call('gh.backup', takeOver); toast(r.changed ? 'Backed up to GitHub' : 'Already up to date') })
  return (
    <Modal title="GitHub backup" onClose={onClose} wide>
      {!s.login ? <div className="form">
        <p className="muted">Daybook saves a copy of your tasks, habits and settings to a private repository you choose. Every version is kept, so you can go back to any of them.</p>
        {s.gh && !useToken ? <><button className="primary" disabled={busy} onClick={() => run(() => call('gh.connect', 'gh'))}>{busy ? 'Connecting…' : 'Connect with the GitHub CLI'}</button><button className="link" onClick={() => setUseToken(true)}>Use an access token instead</button></>
          : <form className="form" onSubmit={(e) => { e.preventDefault(); run(async () => { await call('gh.connect', 'token', token); setToken('') }) }}><label>Access token<input type="password" autoFocus value={token} placeholder="github_pat_…" autoComplete="off" onChange={(e) => setToken(e.target.value)} /></label>
            <p className="muted">Create a fine-grained token on <button type="button" className="link" onClick={() => window.open('https://github.com/settings/personal-access-tokens/new')}>GitHub</button> limited to your backup repository, with <b>Contents: read and write</b>. It is encrypted with your Mac’s keychain.</p>
            <div className="actions">{s.gh && <button type="button" onClick={() => setUseToken(false)}>Back</button>}<button className="primary" disabled={busy || !token.trim()}>{busy ? 'Connecting…' : 'Connect'}</button></div></form>}
      </div> : choosing ? <div className="form">
        <p className="muted">Signed in as <b>{s.login}</b>. Only private repositories are listed.</p>
        <form className="inrow" onSubmit={(e) => { e.preventDefault(); run(async () => { await call('gh.create', name); setChange(false) }) }}><label>New private repository<input value={name} onChange={(e) => setName(e.target.value)} /></label><button className="primary" disabled={busy || !name.trim()}>Create</button></form>
        <form className="inrow" onSubmit={(e) => { e.preventDefault(); run(async () => { await call('gh.choose', pick); setChange(false) }) }}><label>Or use one you have<input list="ghrepos" value={pick} placeholder={repos ? 'owner/name' : 'Loading…'} onChange={(e) => setPick(e.target.value)} /><datalist id="ghrepos">{repos?.map((r) => <option key={r} value={r} />)}</datalist></label><button disabled={busy || !pick.includes('/')}>Use</button></form>
        <div className="actions">{change ? <button onClick={() => setChange(false)}>Cancel</button> : <button onClick={() => call('gh.disconnect').catch(fail)}>Disconnect</button>}</div>
      </div> : hist ? <div className="form">
        {hist.length ? <div className="versions">{hist.map((v) => <div key={v.sha}><span><b>{new Date(v.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</b><small className="muted">{v.message}</small></span><button disabled={busy} onClick={() => restore(v)}>Restore</button></div>)}</div> : <p className="muted">No backups in this repository yet.</p>}
        <div className="actions"><button onClick={() => setHist(null)}>Back</button></div>
      </div> : <div className="form">
        <div className="ghrepo"><span><b>{s.repo}</b><small className="muted">Private. Signed in as {s.login}</small></span><button className="link" onClick={() => window.open(`https://github.com/${s.repo}`)}>View</button><button className="link" onClick={() => { setRepos(null); setChange(true) }}>Change</button></div>
        <div className={`ghstate ${s.error ? 'bad' : ''}`} role="status">{s.busy ? 'Backing up…' : s.error ? s.error : s.lastOk ? `Backed up ${ago(s.lastOk)}` : 'Not backed up yet'}</div>
        {s.block && /another Mac/.test(s.error) && <div className="inrow"><button disabled={busy} onClick={() => run(async () => setHist(await call('gh.history')))}>Look at that backup…</button><button className="danger" disabled={busy} onClick={async () => { if (await ask('Replace that backup?', 'New backups will come from this Mac. The older ones stay in the repository’s history and can still be restored.', 'Replace')) backup(true) }}>Replace with this Mac’s data…</button></div>}
        <label>Back up<select value={s.every} onChange={(e) => call('gh.set', { every: e.target.value as GhEvery }).catch(fail)}><option value="changes">A few minutes after changes</option><option value="hour">Every hour</option><option value="day">Every day</option><option value="manual">Only when I ask</option></select></label>
        <label className="inline"><input type="checkbox" checked={s.markdown} onChange={(e) => call('gh.set', { markdown: e.target.checked }).catch(fail)} /> Include a readable list of open tasks (tasks.md)</label>
        <p className="muted">Files go in a <b>daybook</b> folder; nothing else in the repository is touched. They are not encrypted, so anyone you give access to the repository can read them.</p>
        <div className="actions"><button onClick={async () => { if (await ask('Disconnect GitHub?', 'Automatic backups stop. Backups already on GitHub stay there.', 'Disconnect')) call('gh.disconnect').catch(fail) }}>Disconnect</button><span className="grow" /><button disabled={busy} onClick={() => run(async () => setHist(await call('gh.history')))}>Restore…</button><button className="primary" disabled={busy || s.busy} onClick={() => backup(false)}><Icon n="repeat" s={13} /> Back Up Now</button></div>
      </div>}
      {err && err !== s.error && <div className="ghstate bad" role="alert">{err}</div>}
    </Modal>
  )
}
