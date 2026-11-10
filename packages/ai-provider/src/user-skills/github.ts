/**
 * GitHub addresses and the only connections skills make: reading which commit
 * a branch points at, and downloading that commit's zip archive. Requests go
 * to three hosts only (`github.com`, `api.github.com`, `codeload.github.com`),
 * over https, without a token, cookies or an Authorization header. Redirects
 * are followed by hand so every hop is checked against the same hosts. Nothing
 * here connects unless a caller asks; `fetch` is passed in.
 */
import { USER_SKILL_NAME } from './constants'
import { SkillImportError, isAbortError } from './errors'

/** The hosts skills may be fetched from; any other host, also as a redirect target, is refused */
export const GITHUB_SKILL_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'api.github.com',
  'codeload.github.com',
])

/** The largest archive downloaded or opened, in bytes */
export const MAX_SKILL_ARCHIVE_BYTES = 50 * 1024 * 1024

/** The largest API answer read, in bytes */
const MAX_API_ANSWER_BYTES = 1024 * 1024

/** Redirects followed for one request */
const MAX_REDIRECTS = 5

/**
 * How many leading segments after `tree/` or `blob/` are tried as a branch
 * name (branch names may hold `/`). Each try is one API request, and GitHub
 * allows few requests without a token.
 */
export const MAX_GITHUB_REF_SEGMENTS = 4

/** The `fetch` the caller passes in (the global one, or a test fake) */
export type SkillFetch = (url: string, init: RequestInit) => Promise<Response>

/** A GitHub address the person typed, read without connecting */
export interface GitHubSkillAddress {
  owner: string
  repo: string
  /** the branch as written; `undefined` means the default branch */
  ref: string | undefined
  /** the folder inside the repository, `/` between parts, `''` for the top */
  path: string
  /** `owner/repo@name`: only the skill with this name */
  skill: string | undefined
  /**
   * For `tree/...` and `blob/...` addresses: the decoded segments after
   * `tree` or `blob` (without the final `SKILL.md`). `ref` and `path` above
   * are the guess with a one-segment branch; `resolveGitHubSkillAddress`
   * settles the split with GitHub.
   */
  refPath: string[] | undefined
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/
const REPO = /^[A-Za-z0-9._-]{1,100}$/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const REF_UNSAFE = /[\s~^:?*[\\]|@\{|\.\.|\.lock$|^\.|\.$/

function repoName(value: string): string | undefined {
  const name = value.endsWith('.git') ? value.slice(0, -4) : value
  if (!REPO.test(name) || name === '.' || name === '..') return undefined
  return name
}

/** One path or branch segment of a URL, decoded; `undefined` when not allowed */
function decodeSegment(raw: string): string | undefined {
  let value: string
  try {
    value = decodeURIComponent(raw)
  } catch {
    return undefined
  }
  if (!value || value === '.' || value === '..') return undefined
  if (value.includes('/') || value.includes('\\') || CONTROL.test(value)) return undefined
  return value
}

function refSegmentAllowed(segment: string): boolean {
  return !REF_UNSAFE.test(segment)
}

/**
 * The public skills directory's page of one skill. The page is the skill of
 * that name in the GitHub repository `<owner>/<repo>` (its own install line is
 * `npx skills add https://github.com/<owner>/<repo> --skill <skill>`), so the
 * address is read as `<owner>/<repo>@<skill>` here and the directory itself
 * is never contacted.
 */
const SKILLS_DIRECTORY_PAGE = /^https:\/\/skills\.sh\/([^/?#]+)\/([^/?#]+)\/([^/?#]+)\/?(?:#.*)?$/i

/**
 * Read a GitHub address in one of the six forms:
 * - `https://github.com/<owner>/<repo>`
 * - `https://github.com/<owner>/<repo>/tree/<branch>/<path>`
 * - `https://github.com/<owner>/<repo>/blob/<branch>/<path>/SKILL.md`
 * - `https://skills.sh/<owner>/<repo>/<skill name>` (the skills directory)
 * - `<owner>/<repo>`
 * - `<owner>/<repo>@<skill name>`
 *
 * Anything else gives `undefined`: other hosts and schemes, a port, a user
 * name, a query string, other pages of a repository, `.` or `..` segments.
 * A `#fragment` is dropped (it never reaches a server).
 */
export function parseGitHubSkillAddress(input: string): GitHubSkillAddress | undefined {
  const text = input.trim()
  if (!text || /\s/.test(text) || CONTROL.test(text) || text.includes('\\')) return undefined

  const url = /^https:\/\/github\.com(\/.*)?$/i.exec(text)
  if (url) {
    let rest = url[1] ?? ''
    const hash = rest.indexOf('#')
    if (hash >= 0) rest = rest.slice(0, hash)
    if (rest.includes('?')) return undefined
    let parts = rest.split('/').slice(1)
    if (parts.length > 0 && parts[parts.length - 1] === '') parts = parts.slice(0, -1)
    if (parts.length < 2) return undefined
    const [ownerRaw, repoRaw, kind, ...tail] = parts
    const owner = OWNER.test(ownerRaw!) ? ownerRaw! : undefined
    const repo = repoName(repoRaw!)
    if (!owner || !repo) return undefined
    if (kind === undefined) {
      return { owner, repo, ref: undefined, path: '', skill: undefined, refPath: undefined }
    }
    if (kind !== 'tree' && kind !== 'blob') return undefined
    if (kind === 'blob') {
      if (tail.length < 2 || tail[tail.length - 1] !== 'SKILL.md') return undefined
      tail.pop()
    }
    if (tail.length === 0) return undefined
    const segments: string[] = []
    for (const raw of tail) {
      const segment = decodeSegment(raw)
      if (segment === undefined) return undefined
      segments.push(segment)
    }
    if (!refSegmentAllowed(segments[0]!)) return undefined
    return {
      owner,
      repo,
      ref: segments[0],
      path: segments.slice(1).join('/'),
      skill: undefined,
      refPath: segments,
    }
  }

  const page = SKILLS_DIRECTORY_PAGE.exec(text)
  if (page) {
    const [, ownerRaw, repoRaw, skillRaw] = page
    const owner = OWNER.test(ownerRaw!) ? ownerRaw! : undefined
    const repo = repoName(repoRaw!)
    const skill = decodeSegment(skillRaw!)
    if (!owner || !repo || !skill || !USER_SKILL_NAME.test(skill)) return undefined
    return { owner, repo, ref: undefined, path: '', skill, refPath: undefined }
  }

  const short = /^([^/@]+)\/([^/@]+)(?:@([^/@]+))?$/.exec(text)
  if (!short) return undefined
  const [, ownerRaw, repoRaw, skillRaw] = short
  const owner = OWNER.test(ownerRaw!) ? ownerRaw! : undefined
  const repo = repoName(repoRaw!)
  if (!owner || !repo) return undefined
  if (skillRaw !== undefined && !USER_SKILL_NAME.test(skillRaw)) return undefined
  return { owner, repo, ref: undefined, path: '', skill: skillRaw, refPath: undefined }
}

export interface GitHubRequestOptions {
  fetch: SkillFetch
  signal?: AbortSignal | undefined
}

/** Throws `unsafe` unless the address is https on one of the three hosts, with no user or port */
export function assertGitHubSkillUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new SkillImportError('unsafe', `Not a web address: ${value}`)
  }
  if (
    url.protocol !== 'https:' ||
    !GITHUB_SKILL_HOSTS.has(url.hostname.toLowerCase()) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw new SkillImportError('unsafe', `Refused to connect to ${url.protocol}//${url.host}`)
  }
  return url
}

function failureOf(response: Response): SkillImportError {
  const status = response.status
  const remaining = response.headers.get('x-ratelimit-remaining')
  const retryAfter = response.headers.get('retry-after')
  if (status === 429 || (status === 403 && (remaining === '0' || retryAfter !== null))) {
    return new SkillImportError('rate-limited', `GitHub is limiting requests (HTTP ${status})`)
  }
  if ([401, 403, 404, 410, 422, 451].includes(status)) {
    return new SkillImportError('not-found', `GitHub answered HTTP ${status}`)
  }
  return new SkillImportError('network', `GitHub answered HTTP ${status}`)
}

/**
 * One GET to an allowed host, following redirects by hand (each target is
 * checked before it is requested). Returns the final successful answer;
 * throws a `SkillImportError` for anything else.
 */
export async function githubSkillGet(
  url: string,
  accept: string,
  options: GitHubRequestOptions,
): Promise<Response> {
  let current = assertGitHubSkillUrl(url)
  for (let hop = 0; ; hop++) {
    let response: Response
    try {
      response = await options.fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { Accept: accept, 'User-Agent': 'IeumOffice' },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (error) {
      if (isAbortError(error, options.signal)) {
        throw new SkillImportError('cancelled', 'Cancelled')
      }
      throw new SkillImportError('network', `Could not reach ${current.host}`)
    }
    if (response.type === 'opaqueredirect' || response.status === 0) {
      throw new SkillImportError('unsafe', 'A redirect could not be checked')
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined)
      const location = response.headers.get('location')
      if (!location) throw new SkillImportError('network', 'A redirect without a target')
      if (hop >= MAX_REDIRECTS) throw new SkillImportError('network', 'Too many redirects')
      let next: string
      try {
        next = new URL(location, current).href
      } catch {
        throw new SkillImportError('unsafe', 'A redirect to a malformed address')
      }
      current = assertGitHubSkillUrl(next)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw failureOf(response)
    }
    return response
  }
}

/**
 * The whole body of an answer, refusing (with `too-large`) once it passes
 * `maxBytes`: first by the declared length, then while reading.
 */
export async function readCappedBody(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new SkillImportError('too-large', `The download is ${declared} bytes (limit ${maxBytes})`)
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw new SkillImportError('too-large', `The download is over ${maxBytes} bytes`)
    }
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      if (signal?.aborted) throw new SkillImportError('cancelled', 'Cancelled')
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        throw new SkillImportError('too-large', `The download is over ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    if (error instanceof SkillImportError) throw error
    if (isAbortError(error, signal)) throw new SkillImportError('cancelled', 'Cancelled')
    throw new SkillImportError('network', 'The download broke off')
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

function apiRepoUrl(owner: string, repo: string): string {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
}

function encodeRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/')
}

/** A repository's default branch */
export async function githubDefaultBranch(
  owner: string,
  repo: string,
  options: GitHubRequestOptions,
): Promise<string> {
  const response = await githubSkillGet(
    apiRepoUrl(owner, repo),
    'application/vnd.github+json',
    options,
  )
  const text = new TextDecoder().decode(
    await readCappedBody(response, MAX_API_ANSWER_BYTES, options.signal),
  )
  let branch: unknown
  try {
    branch = (JSON.parse(text) as { default_branch?: unknown }).default_branch
  } catch {
    branch = undefined
  }
  if (typeof branch !== 'string' || !branch || CONTROL.test(branch)) {
    throw new SkillImportError('network', 'GitHub did not name a default branch')
  }
  return branch
}

/** The commit a branch (or other ref) points at now, as a hex hash */
export async function githubRefCommit(
  owner: string,
  repo: string,
  ref: string,
  options: GitHubRequestOptions,
): Promise<string> {
  const response = await githubSkillGet(
    `${apiRepoUrl(owner, repo)}/commits/${encodeRef(ref)}`,
    'application/vnd.github.sha',
    options,
  )
  const sha = new TextDecoder()
    .decode(await readCappedBody(response, MAX_API_ANSWER_BYTES, options.signal))
    .trim()
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) {
    throw new SkillImportError('network', 'GitHub did not answer with a commit')
  }
  return sha
}

export interface ResolvedGitHubSkillAddress {
  owner: string
  repo: string
  ref: string
  path: string
  commit: string
  skill: string | undefined
}

/**
 * Settle an address with GitHub: the branch (the default one when none was
 * given), the commit it points at now, and the folder inside the repository.
 * For `tree/` and `blob/` addresses, branch names of one, two, ... segments
 * are tried in turn, as GitHub's own pages do.
 */
export async function resolveGitHubSkillAddress(
  address: GitHubSkillAddress,
  options: GitHubRequestOptions,
): Promise<ResolvedGitHubSkillAddress> {
  const { owner, repo, skill } = address
  if (!address.refPath) {
    const ref = address.ref ?? (await githubDefaultBranch(owner, repo, options))
    const commit = await githubRefCommit(owner, repo, ref, options)
    return { owner, repo, ref, path: address.path, commit, skill }
  }
  const segments = address.refPath
  const tries = Math.min(segments.length, MAX_GITHUB_REF_SEGMENTS)
  for (let count = 1; count <= tries; count++) {
    const refSegments = segments.slice(0, count)
    if (!refSegments.every(refSegmentAllowed)) break
    const ref = refSegments.join('/')
    try {
      const commit = await githubRefCommit(owner, repo, ref, options)
      return { owner, repo, ref, path: segments.slice(count).join('/'), commit, skill }
    } catch (error) {
      if (error instanceof SkillImportError && error.kind === 'not-found' && count < tries) {
        continue
      }
      throw error
    }
  }
  throw new SkillImportError('not-found', 'No such branch')
}

/** Download a commit's zip archive, at most `maxBytes` */
export async function downloadGitHubArchive(
  owner: string,
  repo: string,
  commit: string,
  options: GitHubRequestOptions & { maxBytes?: number | undefined },
): Promise<Uint8Array> {
  const response = await githubSkillGet(
    `https://codeload.github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zip/${encodeURIComponent(commit)}`,
    'application/zip',
    options,
  )
  return readCappedBody(response, options.maxBytes ?? MAX_SKILL_ARCHIVE_BYTES, options.signal)
}
