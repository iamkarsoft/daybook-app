// Runs the backup flow against a fake GitHub. Nothing leaves this Mac: E2E_DIR=/some/empty/dir node test/github.mjs
import { _electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
const dir = process.env.E2E_DIR, bin = process.env.DAYBOOK_BIN
const sha = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex')
const R = new Map(), log = []; let goodToken = 'tok-good', raceOnce = false
const repo = (n, o = {}) => R.set(n, { full_name: n, private: true, archived: false, default_branch: 'main', html_url: '', permissions: { push: true }, head: null, commits: new Map(), trees: new Map(), ...o })
const commit = (r, files, message, parents = r.head ? [r.head] : []) => { const t = sha(files); r.trees.set(t, files); const c = sha([t, message, parents, Math.random()]); r.commits.set(c, { tree: t, message, parents, date: new Date().toISOString() }); return c }
const filesAt = (r, c) => r.trees.get(r.commits.get(c)?.tree) ?? null
repo('me/notes'); { const r = R.get('me/notes'); r.head = commit(r, { 'README.md': 'mine' }, 'init') }
repo('me/empty'); repo('me/open', { private: false }); repo('me/daybook-old', { archived: true })
const strip = ({ head, commits, trees, ...x }) => x
const srv = createServer(async (q, s) => {
  let b = ''; for await (const c of q) b += c
  const body = b ? JSON.parse(b) : null, u = new URL(q.url, 'http://x'), p = u.pathname
  log.push(`${q.method} ${p}`)
  const out = (c, j) => { s.writeHead(c, { 'content-type': 'application/json' }); s.end(typeof j === 'string' ? j : JSON.stringify(j)) }
  if (q.headers.authorization !== `Bearer ${goodToken}`) return out(401, { message: 'Bad credentials' })
  if (p === '/user') return out(200, { login: 'me' })
  if (p === '/user/repos' && q.method === 'GET') return out(200, [...R.values()].map(strip))
  if (p === '/user/repos') { if (R.has('me/' + body.name)) return out(422, { message: 'name already exists on this account' }); assert.equal(body.private, true); repo('me/' + body.name); const r = R.get('me/' + body.name); r.head = commit(r, { 'README.md': '#' }, 'Initial commit'); return out(201, strip(r)) }
  const m = /^\/repos\/([^/]+\/[^/]+)(.*)$/.exec(p), r = m && R.get(m[1]), rest = m?.[2]
  if (!r) return out(404, { message: 'Not Found' })
  if (rest === '') return out(200, strip(r))
  if (rest === '/git/ref/heads/main') return r.head ? out(200, { object: { sha: r.head } }) : out(409, { message: 'Git Repository is empty.' })
  let x
  if ((x = /^\/git\/commits\/(\w+)$/.exec(rest))) return out(200, { tree: { sha: r.commits.get(x[1]).tree } })
  if (rest === '/git/trees') { const f = { ...r.trees.get(body.base_tree) }; for (const t of body.tree) { if (t.sha === null) { if (!(t.path in f)) return out(422, { message: 'GitRPC::BadObjectState' }); delete f[t.path] } else f[t.path] = t.content } const id = sha(f); r.trees.set(id, f); return out(201, { sha: id }) }
  if (rest === '/git/commits') { const c = sha([body, Math.random()]); r.commits.set(c, { tree: body.tree, message: body.message, parents: body.parents, date: new Date().toISOString() }); return out(201, { sha: c }) }
  if (rest === '/git/refs/heads/main') { assert.equal(body.force, false); if (raceOnce) { raceOnce = false; r.head = commit(r, { ...filesAt(r, r.head), 'other.txt': 'raced' }, 'someone else') } if (!r.commits.get(body.sha).parents.includes(r.head)) return out(422, { message: 'Update is not a fast forward' }); r.head = body.sha; return out(200, {}) }
  if ((x = /^\/contents\/(.+)$/.exec(rest))) {
    if (q.method === 'PUT') { r.head = commit(r, { ...(filesAt(r, r.head) ?? {}), [x[1]]: Buffer.from(body.content, 'base64').toString() }, body.message); return out(201, {}) }
    const f = filesAt(r, u.searchParams.get('ref') ?? r.head)?.[x[1]]
    return f === undefined ? out(404, { message: 'Not Found' }) : /raw/.test(q.headers.accept) ? out(200, f) : out(200, { content: Buffer.from(f).toString('base64') })
  }
  if (rest === '/commits') { const path = u.searchParams.get('path'), o = []; for (let c = r.head; c; c = r.commits.get(c).parents[0]) { const a = filesAt(r, c)[path], pa = r.commits.get(c).parents[0], b2 = pa ? filesAt(r, pa)[path] : undefined; if (a !== b2) o.push({ sha: c, commit: { message: r.commits.get(c).message, committer: { date: r.commits.get(c).date } } }) } return out(200, o) }
  out(404, { message: 'Not Found' })
})
await new Promise((r) => srv.listen(0, '127.0.0.1', r))
const API = `http://127.0.0.1:${srv.address().port}`
const gh = dir + '/fake-gh'; writeFileSync(gh, '#!/bin/sh\necho tok-good\n'); chmodSync(gh, 0o755)
const errs = [], step = (s) => console.log('•', s)
async function launch(data) {
  const app = await _electron.launch({ ...(bin ? { executablePath: bin, args: ['--use-mock-keychain'] } : { args: ['.', '--use-mock-keychain'] }), env: { ...process.env, DAYBOOK_DATA: data, DAYBOOK_GITHUB_API: API, DAYBOOK_GH: gh } })
  let w; for (let i = 0; i < 60 && !w; i++) { w = app.windows().find((y) => y.url().endsWith('index.html')); await new Promise((r) => setTimeout(r, 100)) }
  w.setDefaultTimeout(6000); w.on('pageerror', (e) => errs.push(String(e))); w.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
  await app.evaluate(({ Notification }) => { Notification.isSupported = () => false })
  await w.emulateMedia({ colorScheme: 'light' }); await w.locator('main').getByLabel('New task').waitFor()
  return { app, w, rpc: (m, ...a) => w.evaluate(([m, a]) => window.daybook.call(m, a), [m, a]), add: async (t) => { await w.locator('main').getByLabel('New task').first().fill(t); await w.keyboard.press('Enter'); await w.locator('.row', { hasText: t }).waitFor() }, settings: async () => { await w.locator('.side').getByRole('button', { name: /^Settings/ }).click() }, quit: async () => { await app.evaluate(({ app }) => app.quit()).catch(() => {}); await new Promise((r) => setTimeout(r, 1200)) } }
}
let A, B, cur
const shot = (n) => cur.w.screenshot({ path: `${dir}/${n}.png` })
const now = (n) => filesAt(R.get(n), R.get(n).head)
try {
  A = cur = await launch(dir + '/a'); await A.add('Secret plan')
  step('connect with gh, public repo refused'); await A.settings(); await A.w.getByRole('button', { name: 'Set Up' }).click(); await shot('g1-connect'); await A.w.getByRole('button', { name: 'Connect with the GitHub CLI' }).click(); await A.w.getByText('Signed in as').waitFor(); await A.w.waitForTimeout(200); await shot('g2-choose')
  assert.deepEqual(await A.w.locator('datalist option').evaluateAll((o) => o.map((x) => x.value)), ['me/notes', 'me/empty'])
  await A.w.getByLabel('Or use one you have').fill('me/open'); await A.w.getByRole('button', { name: 'Use', exact: true }).click(); await A.w.getByText('is public').waitFor()
  step('create, back up, nothing new means no commit'); await A.w.getByRole('button', { name: 'Create' }).click(); await A.w.getByText('Not backed up yet').waitFor(); await A.w.getByRole('button', { name: 'Back Up Now' }).click(); await A.w.getByText('Backed up just now').waitFor(); await shot('g3-options')
  const N = 'me/daybook-backup'; assert.deepEqual(Object.keys(now(N)).sort(), ['README.md', 'daybook/daybook.json', 'daybook/device.json', 'daybook/tasks.md']); assert.ok(now(N)['daybook/tasks.md'].includes('Secret plan')); assert.ok(!JSON.stringify(now(N)).includes('tok-good'))
  const c1 = R.get(N).commits.size; await A.w.getByRole('button', { name: 'Back Up Now' }).click(); await A.w.getByText('Already up to date').waitFor(); assert.equal(R.get(N).commits.size, c1)
  step('turning the readable list off removes it'); await A.w.getByLabel('Include a readable list').uncheck(); await A.w.getByRole('button', { name: 'Back Up Now' }).click(); await A.w.getByText('Backed up to GitHub').waitFor(); assert.ok(!('daybook/tasks.md' in now(N))); await A.w.getByLabel('Include a readable list').check()
  step('a racing push is kept'); await A.rpc('gh.backup', false); raceOnce = true; await A.w.keyboard.press('Escape'); await A.w.getByRole('button', { name: 'Options' }).waitFor(); await A.w.keyboard.press('Escape'); await A.w.locator('.scrim').waitFor({ state: 'detached' }); await A.add('Second task'); const rb = await A.rpc('gh.backup', false); assert.equal(rb.ok, true); assert.equal(now(N)['other.txt'], 'raced'); assert.ok(now(N)['daybook/daybook.json'].includes('Second task'))
  step('going public stops uploads'); await A.add('Third task'); R.get(N).private = false; const before = R.get(N).head, rp = await A.rpc('gh.backup', false); assert.match(rp.error, /is public/); assert.equal(R.get(N).head, before); await A.w.getByText('Check backup').waitFor(); await shot('g4-warning'); R.get(N).private = true
  step('expired sign-in recovers'); goodToken = 'changed'; assert.match((await A.rpc('gh.backup', false)).error, /did not accept/); goodToken = 'tok-good'; assert.equal((await A.rpc('gh.backup', false)).ok, true); await A.w.getByText('Check backup').waitFor({ state: 'detached' })
  step('restore an older version, undo it'); await A.settings(); await A.w.getByRole('button', { name: 'Options' }).click(); await A.w.getByRole('button', { name: 'Restore' }).click(); await A.w.locator('.versions > div').first().waitFor(); assert.ok(await A.w.locator('.versions > div').count() >= 3); await shot('g5-history'); await A.w.locator('.versions > div').last().getByRole('button', { name: 'Restore' }).click(); await A.w.getByText('which has 1 open task').waitFor(); await A.w.locator('.modal').last().getByRole('button', { name: 'Restore', exact: true }).click(); await A.w.locator('.row', { hasText: 'Third task' }).waitFor({ state: 'detached' }); assert.equal(await A.w.locator('.row').count(), 1); assert.ok(readdirSync(dir + '/a/backups').some((f) => f.startsWith('before-restore'))); await A.w.locator('.toast').getByText('Undo').click(); await A.w.locator('.row', { hasText: 'Third task' }).waitFor()
  step('automatic backup after changes'); const h0 = R.get(N).head; await A.add('Automatic one'); await A.app.evaluate(() => { const real = Date.now; Date.now = () => real() + 4 * 60000 }); const t0 = Date.now(), sec0 = new Date().getSeconds(); while (R.get(N).head === h0 && Date.now() - t0 < 90000) await A.w.waitForTimeout(100); console.log(`  started at :${sec0}, fired after ${((Date.now() - t0) / 1000).toFixed(1)}s`); assert.notEqual(R.get(N).head, h0, 'no automatic backup in 90s'); assert.ok(now(N)['daybook/daybook.json'].includes('Automatic one')); await A.quit()
  step('settings survive restart'); A = cur = await launch(dir + '/a'); assert.equal((await A.rpc('gh.status')).value.repo, N); await A.quit()
  step('token on a second Mac, its data cannot overwrite'); B = cur = await launch(dir + '/b'); await B.add('From B'); await B.settings(); await B.w.getByRole('button', { name: 'Set Up' }).click(); await B.w.getByRole('button', { name: 'Use an access token' }).click(); await B.w.getByLabel('Access token').fill('nope'); await B.w.getByRole('button', { name: 'Connect', exact: true }).click(); await B.w.getByText('did not accept').waitFor(); await B.w.getByLabel('Access token').fill('tok-good'); await B.w.getByRole('button', { name: 'Connect', exact: true }).click(); await B.w.getByLabel('Or use one you have').fill(N); await B.w.getByRole('button', { name: 'Use', exact: true }).click(); const hb = R.get(N).head; await B.w.getByRole('button', { name: 'Back Up Now' }).click(); await B.w.getByText('from another Mac').first().waitFor(); assert.equal(R.get(N).head, hb); await shot('g6-other-mac')
  for (const f of readdirSync(dir + '/b').filter((x) => /sqlite/.test(x))) assert.ok(!readFileSync(dir + '/b/' + f).includes('tok-good'), 'token stored in plain text')
  await B.w.getByRole('button', { name: 'Look at that backup' }).click(); await B.w.locator('.versions > div').first().getByRole('button', { name: 'Restore' }).click(); await B.w.locator('.modal').last().getByRole('button', { name: 'Restore', exact: true }).click(); await B.w.locator('.row', { hasText: 'Automatic one' }).waitFor()
  await B.settings(); await B.w.getByRole('button', { name: 'Options' }).click(); await B.w.getByRole('button', { name: 'Replace with this Mac' }).click(); await B.w.locator('.modal').last().getByRole('button', { name: 'Replace', exact: true }).click(); await B.w.getByText('Backed up just now').waitFor(); assert.notEqual(R.get(N).head, hb)
  step('existing files left alone, empty repo works'); for (const n of ['me/notes', 'me/empty']) { assert.equal((await B.rpc('gh.choose', n)).ok, true); const x = await B.rpc('gh.backup', false); assert.equal(x.ok, true, x.error); assert.ok(now(n)['daybook/daybook.json']) } assert.equal(now('me/notes')['README.md'], 'mine')
  step('offline'); await new Promise((r) => { srv.close(r); srv.closeAllConnections() }); await B.w.keyboard.press('Escape'); await B.add('While offline'); assert.match((await B.rpc('gh.backup', false)).error, /could not be reached/)
  step('disconnect forgets the token'); assert.equal((await B.rpc('gh.disconnect')).ok, true); const s = (await B.rpc('gh.status')).value; assert.deepEqual([s.login, s.repo], ['', '']); assert.match((await B.rpc('gh.connect', 'token', '')).error, /Paste/)
  assert.ok(!log.some((l) => l.startsWith('DELETE'))); assert.deepEqual(errs, []); console.log('GITHUB OK')
} catch (e) { await shot('gfail').catch(() => {}); console.log('FAILED', e.message.slice(0, 900), '\n', e.stack?.split('\n').find((l) => l.includes('github.mjs')), errs.slice(0, 4)) }
finally { for (const x of [A, B]) await x?.app.evaluate(({ app }) => app.exit(0)).catch(() => {}); srv.close(); setTimeout(() => process.exit(), 300) }
