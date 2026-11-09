/**
 * Taking skills in: from a folder, a zip file or a GitHub address. Every path
 * goes preview first (`prepare*Import` finds the skills and describes them,
 * writing only into its own temporary folder), then `installImportedSkills`
 * copies the chosen ones into the app's skills folder. Installing writes each
 * skill completely into a staging folder inside the app's skills folder and
 * renames it into place, so no half-written skill is ever left; any problem
 * installs nothing.
 */
import { randomBytes } from 'node:crypto'
import type { Dirent } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { extractSkillArchive, readSkillArchiveLayout } from './archive'
import {
  IEUM_SOURCE_FILE,
  MAX_USER_SKILL_BYTES,
  MAX_USER_SKILL_FILES,
  USER_SKILL_NAME,
} from './constants'
import { SkillImportError } from './errors'
import {
  findSkillUrls,
  isInsideDir,
  listSkillFolderFiles,
  readUserSkillFolder,
  skillContentHash,
  type SkillFolderLimits,
} from './folder'
import { parseSkillMd } from './frontmatter'
import {
  MAX_SKILL_ARCHIVE_BYTES,
  downloadGitHubArchive,
  parseGitHubSkillAddress,
  resolveGitHubSkillAddress,
  type SkillFetch,
} from './github'
import { isReservedUserSkillName } from './names'
import { isoSeconds, renderIeumSourceRecord, type IeumSourceRecord } from './source-record'
import { isInsideCodexHome } from './sources'
import type { UserSkillUnreadableReason } from './types'
import { SKILL_PREVIEW_WARNING_COUNT, findSkillWarnings, type SkillWarning } from './warnings'

/**
 * Folders made while installing, inside the app's skills folder (so the final
 * rename stays on one disk). They live only while an install runs.
 */
export const SKILL_STAGING_PREFIX = '.ieum-staging-'

/** How deep the skill search goes below the chosen folder */
export const SKILL_SEARCH_MAX_DEPTH = 8

/** How many web addresses a preview lists (the total is given too) */
export const SKILL_PREVIEW_URL_COUNT = 5

const SKIPPED_SEARCH_FOLDERS: ReadonlySet<string> = new Set(['.git', 'node_modules', '__MACOSX'])

const LICENSE_FILE = /^(?:licen[cs]e|copying|unlicense)(?:[.-][^/]*)?$/i

const DEFAULT_SKILL_LIMITS: SkillFolderLimits = {
  files: MAX_USER_SKILL_FILES,
  bytes: MAX_USER_SKILL_BYTES,
}

/**
 * What the person handed over to take skills from. Every way in (the add
 * menu, a file dropped on a window, pasted text) is one of these and goes
 * through `prepareSkillImport` to the same preview.
 */
export type SkillImportSource =
  | { kind: 'folder'; folder: string }
  | { kind: 'zip'; file: string }
  /** a single `SKILL.md` file: a skill of that one file */
  | { kind: 'skill-file'; file: string }
  /** pasted `SKILL.md` text: a skill of that one file */
  | { kind: 'text'; text: string }
  /** what the person typed: a GitHub address or a skills directory address */
  | { kind: 'github'; address: string }

/** Where an import came from */
export type SkillImportOrigin =
  | { kind: 'folder'; folder: string }
  | { kind: 'zip'; file: string }
  | { kind: 'skill-file'; file: string }
  | { kind: 'text' }
  | {
      kind: 'github'
      /** `owner/repo` */
      repo: string
      /** the branch settled with GitHub */
      ref: string
      commit: string
      /** the folder the search was limited to, `''` for the whole repository */
      path: string
    }

/** Why a found skill cannot be installed; `duplicate`: an earlier one in the same import has its name */
export type SkillImportProblem = UserSkillUnreadableReason | 'duplicate'

/** One skill found by an import, as the preview shows it */
export interface SkillImportCandidate {
  /** stable within the import: the path inside the import's root, `.` for the root itself */
  key: string
  /** the path inside the import's root, `/` between parts, `''` for the root */
  rel: string
  /** where its files are now (inside the import's temporary folder, or the chosen folder) */
  dir: string
  /** the name it is installed under (its front matter `name`) */
  name: string
  title: string
  description: string
  files: number
  bytes: number
  hasScripts: boolean
  /** a template file the skill names exists */
  hasTemplate: boolean
  /** the first few web addresses in its text files */
  urls: string[]
  /** how many web addresses there are in all */
  urlCount: number
  /** a license file at the top of the skill folder */
  license: string | undefined
  /** the first few lines the preview points at (`warnings.ts`) */
  warnings: SkillWarning[]
  /** how many such lines there are in all */
  warningCount: number
  /** a skill of the same name (or a folder of that name) is already in the app's skills folder */
  collision: boolean
  problem: SkillImportProblem | undefined
}

/** A prepared import: what was found, waiting for the person's choice */
export interface SkillImport {
  origin: SkillImportOrigin
  /** the folder the candidates' `rel` paths start from */
  root: string
  candidates: SkillImportCandidate[]
  /** a license file at the top of `root` (a repository's license) */
  rootLicense: string | undefined
  /** this import's temporary folder; `disposeSkillImport` removes it */
  tempDir: string | undefined
}

function sameFileName(name: string, wanted: string): boolean {
  return process.platform === 'win32'
    ? name.toLowerCase() === wanted.toLowerCase()
    : name === wanted
}

async function readDirents(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function licenseFileIn(dir: string): Promise<string | undefined> {
  const names = (await readDirents(dir))
    .filter((entry) => entry.isFile() && LICENSE_FILE.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  return names[0]
}

export interface FindSkillFoldersOptions {
  /** folders never searched (the app's own skills folder) */
  skipDirs?: readonly string[] | undefined
  /** with it, nothing inside the Codex home (`~/.codex`) is opened */
  homeDir?: string | undefined
  maxDepth?: number | undefined
}

/**
 * The skill folders under `root/start`: a folder holding a `SKILL.md` is a
 * skill and is not searched further. Returned as paths inside `root` (`''`
 * for `root` itself), sorted. Links to folders are not followed; `.git`,
 * `node_modules` and `__MACOSX` are skipped.
 */
export async function findSkillFolders(
  root: string,
  start = '',
  options: FindSkillFoldersOptions = {},
): Promise<string[]> {
  const found: string[] = []
  const maxDepth = options.maxDepth ?? SKILL_SEARCH_MAX_DEPTH
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (options.skipDirs?.some((skip) => isInsideDir(dir, skip))) return
    if (options.homeDir && (await isInsideCodexHome(dir, options.homeDir))) return
    const entries = await readDirents(dir)
    const hasSkillMd = entries.some(
      (entry) => sameFileName(entry.name, 'SKILL.md') && (entry.isFile() || entry.isSymbolicLink()),
    )
    if (hasSkillMd) {
      found.push(rel)
      return
    }
    if (depth >= maxDepth) return
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED_SEARCH_FOLDERS.has(entry.name)) continue
      await walk(join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1)
    }
  }
  const startDir = start ? join(root, ...start.split('/')) : root
  await walk(startDir, start, 0)
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The app's own skills by lowercase name: each folder under its folder name
 * and under the `name` its `SKILL.md` gives. Staging folders are left out.
 */
export async function appSkillFoldersByName(appSkillsDir: string): Promise<Map<string, string[]>> {
  const byName = new Map<string, string[]>()
  const add = (name: string, dir: string) => {
    const key = name.toLowerCase()
    const dirs = byName.get(key) ?? []
    if (!dirs.includes(dir)) dirs.push(dir)
    byName.set(key, dirs)
  }
  for (const entry of await readDirents(appSkillsDir)) {
    if (entry.name.startsWith(SKILL_STAGING_PREFIX)) continue
    const dir = join(appSkillsDir, entry.name)
    const info = await stat(dir).catch(() => undefined)
    if (!info?.isDirectory()) continue
    add(entry.name, dir)
    const text = await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => undefined)
    const name = text === undefined ? undefined : parseSkillMd(text)?.name?.trim()
    if (name) add(name, dir)
  }
  return byName
}

/**
 * Describe one found skill folder for the preview. `undefined` for a reserved
 * name (never shown). `existing` is `appSkillFoldersByName` of the app's
 * skills folder; folders in `ignoreDirs` do not count as a collision.
 */
export async function describeSkillCandidate(
  dir: string,
  rel: string,
  existing: ReadonlyMap<string, readonly string[]>,
  ignoreDirs: readonly string[] = [],
): Promise<SkillImportCandidate | undefined> {
  const skill = await readUserSkillFolder(dir, { source: 'app' })
  if (!skill) return undefined
  const readable = skill.unreadable !== 'too-large'
  const urls = readable ? await findSkillUrls(dir) : []
  const warnings = readable ? await findSkillWarnings(dir) : []
  const taken = (existing.get(skill.name.toLowerCase()) ?? []).filter(
    (other) => !ignoreDirs.some((ignored) => isInsideDir(other, ignored)),
  )
  return {
    key: rel || '.',
    rel,
    dir,
    name: skill.name,
    title: skill.title,
    description: skill.description,
    files: skill.files,
    bytes: skill.bytes,
    hasScripts: skill.hasScripts,
    hasTemplate: skill.templateExists,
    urls: urls.slice(0, SKILL_PREVIEW_URL_COUNT),
    urlCount: urls.length,
    license: await licenseFileIn(dir),
    warnings: warnings.slice(0, SKILL_PREVIEW_WARNING_COUNT),
    warningCount: warnings.length,
    collision: taken.length > 0,
    problem: skill.unreadable,
  }
}

async function describeCandidates(
  root: string,
  rels: string[],
  appSkillsDir: string,
  onlySkill: string | undefined,
): Promise<SkillImportCandidate[]> {
  const existing = await appSkillFoldersByName(appSkillsDir)
  const candidates: SkillImportCandidate[] = []
  const seen = new Set<string>()
  for (const rel of rels) {
    const dir = rel ? join(root, ...rel.split('/')) : root
    const candidate = await describeSkillCandidate(dir, rel, existing)
    if (!candidate) continue
    if (onlySkill !== undefined) {
      const wanted = onlySkill.toLowerCase()
      const folderName = rel ? basename(dir).toLowerCase() : ''
      if (candidate.name.toLowerCase() !== wanted && folderName !== wanted) continue
    }
    const key = candidate.name.toLowerCase()
    if (!candidate.problem && seen.has(key)) candidate.problem = 'duplicate'
    if (!candidate.problem) seen.add(key)
    candidates.push(candidate)
  }
  return candidates
}

async function makeWorkDir(tempDir: string): Promise<string> {
  await mkdir(tempDir, { recursive: true })
  return mkdtemp(join(tempDir, 'ieum-skill-import-'))
}

async function removeQuietly(dir: string | undefined): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
}

function noSkills(): SkillImportError {
  return new SkillImportError('no-skills', 'No skill was found')
}

export interface PrepareFolderImportOptions {
  folder: string
  appSkillsDir: string
  homeDir: string
}

/**
 * Find the skills in a folder the person chose: the folder itself when it
 * holds a `SKILL.md`, else the skills below it. Writes nothing.
 */
export async function prepareFolderImport(
  options: PrepareFolderImportOptions,
): Promise<SkillImport> {
  const { folder, appSkillsDir, homeDir } = options
  if (isInsideDir(folder, appSkillsDir)) {
    throw new SkillImportError('invalid-source', 'The folder is inside the app skills folder')
  }
  if (await isInsideCodexHome(folder, homeDir)) {
    throw new SkillImportError('invalid-source', 'The folder is inside the Codex home')
  }
  const info = await stat(folder).catch(() => undefined)
  if (!info?.isDirectory()) throw noSkills()
  const rels = await findSkillFolders(folder, '', { skipDirs: [appSkillsDir], homeDir })
  const candidates = await describeCandidates(folder, rels, appSkillsDir, undefined)
  if (candidates.length === 0) throw noSkills()
  return {
    origin: { kind: 'folder', folder },
    root: folder,
    candidates,
    rootLicense: await licenseFileIn(folder),
    tempDir: undefined,
  }
}

export interface PrepareZipImportOptions {
  file: string
  appSkillsDir: string
  /** where this import's temporary folder is made */
  tempDir: string
  maxArchiveBytes?: number | undefined
}

/**
 * Open a zip file into a temporary folder and find the skills in it. A
 * `SKILL.md` at the top of the zip is one skill named by its front matter.
 */
export async function prepareZipImport(options: PrepareZipImportOptions): Promise<SkillImport> {
  const maxBytes = options.maxArchiveBytes ?? MAX_SKILL_ARCHIVE_BYTES
  const info = await stat(options.file).catch(() => undefined)
  if (!info?.isFile()) throw new SkillImportError('not-found', 'The zip file cannot be read')
  if (info.size > maxBytes) {
    throw new SkillImportError(
      'too-large',
      `The zip file is ${info.size} bytes (limit ${maxBytes})`,
    )
  }
  const bytes = await readFile(options.file).catch(() => undefined)
  if (!bytes) throw new SkillImportError('not-found', 'The zip file cannot be read')
  const work = await makeWorkDir(options.tempDir)
  try {
    const root = join(work, 'zip')
    await mkdir(root)
    await extractSkillArchive(new Uint8Array(bytes), root)
    const rels = await findSkillFolders(root)
    const candidates = await describeCandidates(root, rels, options.appSkillsDir, undefined)
    if (candidates.length === 0) throw noSkills()
    return {
      origin: { kind: 'zip', file: options.file },
      root,
      candidates,
      rootLicense: await licenseFileIn(root),
      tempDir: work,
    }
  } catch (error) {
    await removeQuietly(work)
    throw error
  }
}

/** The largest `SKILL.md` text taken as a skill of its own (pasted, or a dropped file) */
export const MAX_SKILL_TEXT_IMPORT_BYTES = 2 * 1024 * 1024

/**
 * The `name` of a text that reads as a `SKILL.md`: it starts with a `---`
 * front matter block (after blank space; `\s` also takes a byte order mark)
 * that has a `name`. `undefined` for any other text.
 */
export function skillTextName(text: string): string | undefined {
  const start = text.replace(/^\s+/, '')
  if (!start.startsWith('---')) return undefined
  return parseSkillMd(start)?.name?.trim() || undefined
}

export interface PrepareTextImportOptions {
  text: string
  appSkillsDir: string
  /** where this import's temporary folder is made */
  tempDir: string
}

async function prepareSingleFileImport(
  text: string,
  origin: Extract<SkillImportOrigin, { kind: 'text' | 'skill-file' }>,
  options: { appSkillsDir: string; tempDir: string },
): Promise<SkillImport> {
  if (Buffer.byteLength(text, 'utf8') > MAX_SKILL_TEXT_IMPORT_BYTES) {
    throw new SkillImportError('too-large', 'The SKILL.md text is too large')
  }
  const name = skillTextName(text)
  if (name === undefined) throw noSkills()
  const work = await makeWorkDir(options.tempDir)
  try {
    const root = join(work, 'text')
    // the folder gets the skill's name, so a name the rule refuses still shows as that problem
    const folder = USER_SKILL_NAME.test(name) ? name : 'skill'
    await mkdir(join(root, folder), { recursive: true })
    await writeFile(join(root, folder, 'SKILL.md'), text.replace(/^\s+(?=---)/, ''))
    const candidates = await describeCandidates(root, [folder], options.appSkillsDir, undefined)
    if (candidates.length === 0) throw noSkills()
    return { origin, root, candidates, rootLicense: undefined, tempDir: work }
  } catch (error) {
    await removeQuietly(work)
    throw error
  }
}

/** Take pasted `SKILL.md` text as a skill of that one file */
export function prepareTextImport(options: PrepareTextImportOptions): Promise<SkillImport> {
  return prepareSingleFileImport(options.text, { kind: 'text' }, options)
}

export interface PrepareSkillFileImportOptions {
  file: string
  appSkillsDir: string
  /** where this import's temporary folder is made */
  tempDir: string
}

/**
 * Take one `SKILL.md` file as a skill of that one file. The folder around it
 * is not taken: a file dropped from a downloads folder must not bring the
 * rest of that folder along. A skill with more files comes as a zip.
 */
export async function prepareSkillFileImport(
  options: PrepareSkillFileImportOptions,
): Promise<SkillImport> {
  const info = await stat(options.file).catch(() => undefined)
  if (!info?.isFile()) throw new SkillImportError('not-found', 'The file cannot be read')
  if (info.size > MAX_SKILL_TEXT_IMPORT_BYTES) {
    throw new SkillImportError('too-large', 'The SKILL.md file is too large')
  }
  const text = await readFile(options.file, 'utf8').catch(() => undefined)
  if (text === undefined) throw new SkillImportError('not-found', 'The file cannot be read')
  return prepareSingleFileImport(text, { kind: 'skill-file', file: options.file }, options)
}

/** A dropped file's name that makes it a skill file (`SKILL.md`, any case) */
const SKILL_FILE_NAME = /(?:^|[\\/])skill\.md$/i

/**
 * What a file dropped on a window gives to take skills from: a `SKILL.md`
 * file, or a zip whose layout is a skill's (`readSkillArchiveLayout`).
 * `undefined` for anything else, which keeps the drop's usual handling.
 */
export async function droppedSkillSourceOf(
  path: string,
): Promise<Extract<SkillImportSource, { kind: 'zip' | 'skill-file' }> | undefined> {
  if (SKILL_FILE_NAME.test(path)) return { kind: 'skill-file', file: path }
  if (!/\.zip$/i.test(path)) return undefined
  return (await readSkillArchiveLayout(path)) ? { kind: 'zip', file: path } : undefined
}

export interface PrepareGitHubImportOptions {
  /** what the person typed */
  address: string
  fetch: SkillFetch
  appSkillsDir: string
  /** where this import's temporary folder is made */
  tempDir: string
  signal?: AbortSignal | undefined
  maxArchiveBytes?: number | undefined
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new SkillImportError('cancelled', 'Cancelled')
}

/**
 * Read a GitHub address, settle the branch's commit, download that commit's
 * archive, open it into a temporary folder and find the skills (only under
 * the address's folder, only the named one for `owner/repo@name`). Connects
 * only to the three GitHub hosts. On failure or cancel the temporary folder
 * is gone and nothing else was written.
 */
export async function prepareGitHubImport(
  options: PrepareGitHubImportOptions,
): Promise<SkillImport> {
  const address = parseGitHubSkillAddress(options.address)
  if (!address) throw new SkillImportError('bad-address', 'Not a GitHub address the app accepts')
  const request = { fetch: options.fetch, signal: options.signal }
  const resolved = await resolveGitHubSkillAddress(address, request)
  const archive = await downloadGitHubArchive(resolved.owner, resolved.repo, resolved.commit, {
    ...request,
    maxBytes: options.maxArchiveBytes,
  })
  throwIfCancelled(options.signal)
  const work = await makeWorkDir(options.tempDir)
  try {
    const root = join(work, 'repo')
    await mkdir(root)
    await extractSkillArchive(archive, root, {
      stripTopFolder: true,
      subPath: resolved.path,
      // the repository's license, for the preview
      alsoTake: (parts) => parts.length === 1 && LICENSE_FILE.test(parts[0]!),
    })
    throwIfCancelled(options.signal)
    const start = resolved.path ? join(root, ...resolved.path.split('/')) : root
    const startInfo = await stat(start).catch(() => undefined)
    if (!startInfo?.isDirectory()) throw noSkills()
    const rels = await findSkillFolders(root, resolved.path)
    const candidates = await describeCandidates(root, rels, options.appSkillsDir, resolved.skill)
    throwIfCancelled(options.signal)
    if (candidates.length === 0) throw noSkills()
    return {
      origin: {
        kind: 'github',
        repo: `${resolved.owner}/${resolved.repo}`,
        ref: resolved.ref,
        commit: resolved.commit,
        path: resolved.path,
      },
      root,
      candidates,
      rootLicense: await licenseFileIn(root),
      tempDir: work,
    }
  } catch (error) {
    await removeQuietly(work)
    throw error
  }
}

export interface PrepareSkillImportEnv {
  appSkillsDir: string
  homeDir: string
  /** where an import's temporary folder is made */
  tempDir: string
  fetch: SkillFetch
  signal?: AbortSignal | undefined
}

/** Find the skills of any source for the one preview (writes only its temporary folder) */
export function prepareSkillImport(
  source: SkillImportSource,
  env: PrepareSkillImportEnv,
): Promise<SkillImport> {
  const { appSkillsDir, tempDir } = env
  switch (source.kind) {
    case 'folder':
      return prepareFolderImport({ folder: source.folder, appSkillsDir, homeDir: env.homeDir })
    case 'zip':
      return prepareZipImport({ file: source.file, appSkillsDir, tempDir })
    case 'skill-file':
      return prepareSkillFileImport({ file: source.file, appSkillsDir, tempDir })
    case 'text':
      return prepareTextImport({ text: source.text, appSkillsDir, tempDir })
    case 'github':
      return prepareGitHubImport({
        address: source.address,
        fetch: env.fetch,
        appSkillsDir,
        tempDir,
        signal: env.signal,
      })
  }
}

/** Remove an import's temporary folder (after installing, or when the person cancels) */
export async function disposeSkillImport(imported: SkillImport): Promise<void> {
  await removeQuietly(imported.tempDir)
}

/**
 * Copy a skill folder's files (links inside it as the files they lead to),
 * leaving out a source record at its top. Throws `too-large` over the limits.
 */
async function copySkillFolder(from: string, to: string, limits: SkillFolderLimits): Promise<void> {
  const listed = await listSkillFolderFiles(from, limits)
  if (!listed) throw new SkillImportError('failed', `Cannot read ${from}`)
  if (listed.tooLarge) throw new SkillImportError('too-large', 'A skill folder is too large')
  await mkdir(to, { recursive: true })
  for (const file of listed.files) {
    if (file.rel === IEUM_SOURCE_FILE) continue
    const target = join(to, ...file.rel.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await copyFile(file.path, target)
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined
}

/** One skill to put into the app's skills folder */
export interface SkillInstallPlan {
  candidate: SkillImportCandidate
  /** the folder name under the app's skills folder */
  folderName: string
  /** existing folders it replaces */
  replaceDirs: string[]
  /** for a GitHub skill: the record to write, without the time and hash */
  source?: Omit<IeumSourceRecord, 'kind' | 'installedAt' | 'contentHash'> | undefined
}

export interface CommitSkillInstallOptions {
  now?: (() => Date) | undefined
  /** how a replaced folder goes away (the shell passes the OS trash); removed for good when not given */
  discardReplaced?: ((dir: string) => Promise<void>) | undefined
  limits?: SkillFolderLimits | undefined
  random?: (() => string) | undefined
}

/**
 * Put skills into the app's skills folder: each is written completely into a
 * staging folder first, then folders it replaces are moved aside and it is
 * renamed into place. If anything fails, what was moved is moved back and
 * nothing is installed.
 */
export async function commitSkillInstall(
  appSkillsDir: string,
  plans: readonly SkillInstallPlan[],
  options: CommitSkillInstallOptions = {},
): Promise<string[]> {
  const limits = options.limits ?? DEFAULT_SKILL_LIMITS
  const now = options.now ?? (() => new Date())
  for (const plan of plans) {
    for (const dir of plan.replaceDirs) {
      // a direct child of the app's skills folder, never that folder itself
      const child = isInsideDir(appSkillsDir, dirname(dir)) && !isInsideDir(appSkillsDir, dir)
      if (!child || !isInsideDir(dir, appSkillsDir)) {
        throw new SkillImportError('invalid-source', 'Only skills of the app folder are replaced')
      }
    }
  }
  await mkdir(appSkillsDir, { recursive: true })
  const suffix = options.random?.() ?? randomBytes(6).toString('hex')
  const stage = join(appSkillsDir, `${SKILL_STAGING_PREFIX}${suffix}`)
  await mkdir(stage)
  const moved: Array<{ from: string; to: string }> = []
  /** per plan, the folders it replaced as moved aside into the staging folder */
  const replaced: Array<Array<{ from: string; aside: string }>> = plans.map(() => [])
  const installed: string[] = []
  try {
    const staged: string[] = []
    for (const [index, plan] of plans.entries()) {
      const dir = join(stage, `new-${index}`)
      await copySkillFolder(plan.candidate.dir, dir, limits)
      if (plan.source) {
        const record: IeumSourceRecord = {
          kind: 'github',
          ...plan.source,
          installedAt: isoSeconds(now()),
          contentHash: await skillContentHash(dir),
        }
        await writeFile(join(dir, IEUM_SOURCE_FILE), renderIeumSourceRecord(record))
      }
      staged.push(dir)
    }
    for (const [index, plan] of plans.entries()) {
      for (const [n, dir] of plan.replaceDirs.entries()) {
        if (!(await exists(dir))) continue
        const aside = join(stage, `old-${index}-${n}`, basename(dir))
        await mkdir(dirname(aside), { recursive: true })
        await rename(dir, aside)
        moved.push({ from: dir, to: aside })
        replaced[index]!.push({ from: dir, aside })
      }
      const target = join(appSkillsDir, plan.folderName)
      if (await exists(target)) {
        throw new SkillImportError('needs-choice', `${plan.folderName} is already there`)
      }
      await rename(staged[index]!, target)
      moved.push({ from: staged[index]!, to: target })
      installed.push(target)
    }
  } catch (error) {
    let restored = true
    for (const { from, to } of moved.reverse()) {
      try {
        await rename(to, from)
      } catch {
        restored = false
      }
    }
    // a folder that could not be moved back stays in the staging folder rather than being lost
    if (restored) await removeQuietly(stage)
    if (error instanceof SkillImportError) throw error
    throw new SkillImportError('failed', 'Installing the skill failed')
  }
  if (options.discardReplaced && !(await discardOrRestore(options.discardReplaced))) {
    throw new SkillImportError(
      'trash-failed',
      'A replaced skill could not be moved to the trash; it was put back',
    )
  }
  await removeQuietly(stage)
  return installed

  /**
   * Hand the replaced folders to `discard` (the OS trash). If one cannot go,
   * nothing is deleted for good: every plan none of whose folders has gone yet
   * is undone (its new folder out, its old ones back), and the staging folder
   * is kept when anything could not be put back. False when one could not go.
   */
  async function discardOrRestore(discard: (dir: string) => Promise<void>): Promise<boolean> {
    const gone = new Set<string>()
    let failed = false
    for (const folders of replaced) {
      for (const { aside } of folders) {
        try {
          await discard(aside)
          gone.add(aside)
        } catch {
          failed = true
          break
        }
      }
      if (failed) break
    }
    if (!failed) return true
    let restored = true
    for (const [index, folders] of [...replaced.entries()].reverse()) {
      // a plan whose old folder is already in the trash stays installed: undoing it would lose both
      if (folders.some(({ aside }) => gone.has(aside))) {
        if (folders.some(({ aside }) => !gone.has(aside))) restored = false
        continue
      }
      try {
        await rename(installed[index]!, join(stage, `undone-${index}`))
        for (const { from, aside } of folders) await rename(aside, from)
      } catch {
        restored = false
      }
    }
    if (restored) await removeQuietly(stage)
    return false
  }
}

/** What to do with a chosen skill whose name the app's skills folder already has */
export type SkillCollisionChoice = 'replace' | 'skip'

export interface InstallImportedSkillsOptions extends CommitSkillInstallOptions {
  appSkillsDir: string
  /** the keys of the candidates the person checked */
  selected: readonly string[]
  /** for every checked candidate whose name is taken, by key */
  onCollision?: Readonly<Record<string, SkillCollisionChoice>> | undefined
}

export interface InstalledSkill {
  key: string
  name: string
  dir: string
  replaced: boolean
}

export interface InstallImportedSkillsResult {
  installed: InstalledSkill[]
  /** keys skipped because of a name already taken */
  skipped: string[]
}

/**
 * Install the checked skills of a prepared import. Name collisions are judged
 * again now; each needs a `replace` or `skip` choice, else `needs-choice` is
 * thrown and nothing is written. A GitHub skill gets its source record. The
 * import's temporary folder is left for `disposeSkillImport`.
 */
export async function installImportedSkills(
  imported: SkillImport,
  options: InstallImportedSkillsOptions,
): Promise<InstallImportedSkillsResult> {
  const byKey = new Map(imported.candidates.map((candidate) => [candidate.key, candidate]))
  const existing = await appSkillFoldersByName(options.appSkillsDir)
  const plans: SkillInstallPlan[] = []
  const skipped: string[] = []
  const names = new Set<string>()
  for (const key of new Set(options.selected)) {
    const candidate = byKey.get(key)
    if (!candidate) throw new SkillImportError('not-installable', `No skill ${key} in this import`)
    if (candidate.problem === 'too-large') {
      throw new SkillImportError('too-large', `${candidate.name} is too large`)
    }
    if (candidate.problem || isReservedUserSkillName(candidate.name)) {
      throw new SkillImportError('not-installable', `${candidate.name} cannot be installed`)
    }
    const lower = candidate.name.toLowerCase()
    if (names.has(lower)) {
      throw new SkillImportError('not-installable', `${candidate.name} is chosen twice`)
    }
    names.add(lower)
    const taken = existing.get(lower) ?? []
    if (taken.length > 0) {
      const choice = options.onCollision?.[key]
      if (!choice) throw new SkillImportError('needs-choice', `${candidate.name} is already there`)
      if (choice === 'skip') {
        skipped.push(key)
        continue
      }
    }
    const origin = imported.origin
    plans.push({
      candidate,
      folderName: candidate.name,
      replaceDirs: taken,
      source:
        origin.kind === 'github'
          ? { repo: origin.repo, ref: origin.ref, path: candidate.rel, commit: origin.commit }
          : undefined,
    })
  }
  const dirs =
    plans.length > 0 ? await commitSkillInstall(options.appSkillsDir, plans, options) : []
  return {
    installed: plans.map((plan, index) => ({
      key: plan.candidate.key,
      name: plan.candidate.name,
      dir: dirs[index]!,
      replaced: plan.replaceDirs.length > 0,
    })),
    skipped,
  }
}
