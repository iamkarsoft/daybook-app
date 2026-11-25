import { net } from 'electron'

export class GhError extends Error { status: number; code?: string; constructor(m: string, status = 0, code?: string) { super(m); this.status = status; this.code = code } }
export interface Repo { full_name: string; private: boolean; archived: boolean; default_branch: string; html_url: string; permissions?: { push?: boolean } }
type File = { path: string; content: string }

// The override exists for tests, and only applies to a test data folder.
const API = (process.env.DAYBOOK_DATA && process.env.DAYBOOK_GITHUB_API) || 'https://api.github.com'

export class GitHub {
  private token: string
  constructor(token: string) { this.token = token }

  private async send(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json') {
    let r: Response
    try {
      r = await net.fetch(API + path, {
        method, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Daybook', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch { throw new GhError('GitHub could not be reached', 0, 'offline') }
    if (r.ok) return r
    const msg = await r.json().then((j: any) => String(j?.message ?? ''), () => '')
    if (r.status === 401) throw new GhError('GitHub did not accept the sign-in. Connect again.', 401, 'auth')
    if (r.status === 429 || (r.status === 403 && (r.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(msg)))) throw new GhError('GitHub asked us to slow down. It will try again later.', r.status)
    if (r.status === 403) throw new GhError('That sign-in is not allowed to do this. The token needs Contents: read and write.', 403)
    throw new GhError(msg ? `GitHub: ${msg}` : `GitHub returned an error (${r.status})`, r.status)
  }
  private async json<T = any>(method: string, path: string, body?: unknown): Promise<T> { return (await this.send(method, path, body)).json() as Promise<T> }
  private async maybe<T = any>(path: string): Promise<T | null> { try { return await this.json<T>('GET', path) } catch (e) { if (e instanceof GhError && e.status === 404) return null; throw e } }

  async login(): Promise<string> { return (await this.json('GET', '/user')).login }
  async repos(): Promise<string[]> {
    const out: string[] = []
    for (let page = 1; page <= 5; page++) {
      const r = await this.json<Repo[]>('GET', `/user/repos?visibility=private&sort=pushed&per_page=100&page=${page}`)
      out.push(...r.filter((x) => x.private && !x.archived && x.permissions?.push).map((x) => x.full_name))
      if (r.length < 100) break
    }
    return out
  }
  async create(name: string): Promise<string> {
    if (!/^[\w.-]{1,100}$/.test(name)) throw new GhError('Use letters, numbers, dots, dashes and underscores for the name')
    const r = await this.json<Repo>('POST', '/user/repos', { name, private: true, auto_init: true, description: 'Daybook backup' })
    if (!r.private) throw new GhError('GitHub did not make that repository private, so it will not be used')
    return r.full_name
  }
  /** Called before every upload: personal data never goes to a repository others can read. */
  async check(repo: string): Promise<Repo> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new GhError('That is not a repository name')
    const r = await this.maybe<Repo>(`/repos/${repo}`)
    if (!r) throw new GhError(`${repo} was not found, or this sign-in cannot see it`, 404)
    if (r.private !== true) throw new GhError(`${repo} is public. Daybook only backs up to private repositories.`, 0, 'public')
    if (r.archived) throw new GhError(`${repo} is archived, so nothing can be saved to it`)
    if (!r.permissions?.push) throw new GhError(`This sign-in cannot write to ${repo}`)
    return r
  }
  async push(repo: string, folder: string, files: File[], remove: string[], message: string, device: string, takeOver: boolean): Promise<{ sha: string; changed: boolean; repo: string }> {
    for (let attempt = 0; ; attempt++) {
      const r = await this.check(repo), base = `/repos/${r.full_name}`, ref = `${base}/git/ref/heads/${encodeURIComponent(r.default_branch)}`
      let head: string | null = null
      try { head = (await this.json('GET', ref)).object.sha }
      catch (e) { if (!(e instanceof GhError) || (e.status !== 404 && e.status !== 409)) throw e }
      if (!head) {
        // The Git data API needs one commit to build on; an empty repository has none.
        await this.json('PUT', `${base}/contents/${folder}/README.md`, { message: 'Start Daybook backup', content: Buffer.from('Daybook keeps its backup in this folder.\n').toString('base64') })
        if (attempt < 3) continue
        throw new GhError('That repository could not be set up')
      }
      const owner = await this.maybe(`${base}/contents/${folder}/device.json?ref=${head}`)
      if (owner?.content && !takeOver) {
        let id = ''
        try { id = JSON.parse(Buffer.from(owner.content, 'base64').toString()).device } catch { /* unreadable counts as someone else's */ }
        if (id !== device) throw new GhError('This repository already holds a backup from another Mac, or from before Daybook was reinstalled.', 0, 'other-device')
      }
      const tree: any[] = files.map((f) => ({ path: `${folder}/${f.path}`, mode: '100644', type: 'blob', content: f.content }))
      tree.push({ path: `${folder}/device.json`, mode: '100644', type: 'blob', content: JSON.stringify({ app: 'daybook', device }) + '\n' })
      for (const p of remove) if (await this.maybe(`${base}/contents/${folder}/${p}?ref=${head}`)) tree.push({ path: `${folder}/${p}`, mode: '100644', type: 'blob', sha: null })
      const was = (await this.json('GET', `${base}/git/commits/${head}`)).tree.sha
      const now = (await this.json('POST', `${base}/git/trees`, { base_tree: was, tree })).sha
      if (now === was) return { sha: head, changed: false, repo: r.full_name }
      const commit = (await this.json('POST', `${base}/git/commits`, { message, tree: now, parents: [head] })).sha
      try { await this.json('PATCH', `${base}/git/refs/heads/${encodeURIComponent(r.default_branch)}`, { sha: commit, force: false }); return { sha: commit, changed: true, repo: r.full_name } }
      catch (e) {
        // Someone else pushed in between: rebuild on top of theirs rather than overwrite it.
        if (!(e instanceof GhError) || e.status !== 422 || attempt >= 3) throw e
      }
    }
  }
  async history(repo: string, folder: string): Promise<{ sha: string; at: string; message: string }[]> {
    const r = await this.check(repo)
    try { return (await this.json<any[]>('GET', `/repos/${r.full_name}/commits?path=${folder}/daybook.json&per_page=50`)).map((c) => ({ sha: c.sha, at: c.commit.committer.date, message: String(c.commit.message).split('\n')[0] })) }
    catch (e) { if (e instanceof GhError && e.status === 409) return []; throw e }
  }
  async file(repo: string, path: string, sha: string): Promise<string> {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new GhError('That is not a backup version')
    return (await this.send('GET', `/repos/${repo}/contents/${path}?ref=${sha}`, undefined, 'application/vnd.github.raw+json')).text()
  }
}
