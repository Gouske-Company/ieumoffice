/**
 * Opening a skill archive (a zip file the person chose, or a GitHub commit
 * archive) into a temporary folder. In order: the zip bomb gate, a check of
 * every entry's path, a check that no taken entry is a link, then writing.
 * Any failure throws before or while writing into a folder the caller owns
 * and removes; nothing outside that folder is written.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { assertZipInflatesWithinLimits, type ZipLimits } from '@genoffice/zip-gate'
import JSZip from 'jszip'
import { MAX_USER_SKILL_BYTES } from './constants'
import { SkillImportError } from './errors'
import { isInsideDir } from './folder'
import { MAX_SKILL_ARCHIVE_BYTES } from './github'

/**
 * Limits for the inflated archive. A GitHub archive holds the whole
 * repository, so these are above one skill folder's limits; each skill taken
 * from it is held to those separately.
 */
export const SKILL_ARCHIVE_ZIP_LIMITS: ZipLimits = {
  maxParts: 20_000,
  maxPartBytes: MAX_USER_SKILL_BYTES,
  maxTotalBytes: 4 * MAX_USER_SKILL_BYTES,
}

/** Folders macOS adds to zip files; never taken */
const IGNORED_ARCHIVE_FOLDERS: ReadonlySet<string> = new Set(['__MACOSX'])

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/
const WINDOWS_UNSAFE_CHARS = /[<>:"|?*]/
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

/**
 * What is wrong with an entry name of a zip:
 * - `unsafe`: it could write outside the folder (absolute, drive letter,
 *   `..`, `.`, empty parts, backslashes, control characters)
 * - `unportable`: a name Windows cannot hold as written (`<>:"|?*`, a device
 *   name, a trailing dot or space)
 * - `undefined`: fine. One trailing `/` (a folder entry) is allowed.
 */
export function zipEntryPathProblem(name: string): 'unsafe' | 'unportable' | undefined {
  const path = name.endsWith('/') ? name.slice(0, -1) : name
  if (!path || CONTROL.test(path) || path.includes('\\')) return 'unsafe'
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'unsafe'
  const parts = path.split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return 'unsafe'
  for (const part of parts) {
    if (WINDOWS_UNSAFE_CHARS.test(part) || WINDOWS_DEVICE.test(part)) return 'unportable'
    if (part.endsWith('.') || part.endsWith(' ')) return 'unportable'
  }
  return undefined
}

/** A zip entry stored as a symbolic link (by its Unix mode) */
function isLinkEntry(entry: JSZip.JSZipObject): boolean {
  const mode = entry.unixPermissions
  return typeof mode === 'number' && (mode & 0o170000) === 0o120000
}

export interface ExtractSkillArchiveOptions {
  /** leave out the one folder every entry sits in (a GitHub archive's `<repo>-<commit>/`) */
  stripTopFolder?: boolean | undefined
  /** take only this folder (after stripping), `/` between parts; `''` takes everything */
  subPath?: string | undefined
  /** also take these files outside `subPath` (paths after stripping) */
  alsoTake?: ((parts: readonly string[]) => boolean) | undefined
  limits?: ZipLimits | undefined
}

export interface ExtractedSkillArchive {
  files: number
  bytes: number
  /** the folder that was stripped, if any */
  topFolder: string | undefined
}

function zipFailure(error: unknown): SkillImportError {
  const message = error instanceof Error ? error.message : String(error)
  if (/^zip rejected:.*(?:limit|exceeds)/.test(message)) {
    return new SkillImportError('too-large', message)
  }
  return new SkillImportError('unsafe', message)
}

/**
 * Write a zip's entries into `destDir` (made if missing). Every entry name is
 * checked, also those not taken; entries taken must not be links and must
 * have names Windows can hold. Throws a `SkillImportError` (`unsafe` or
 * `too-large`); the caller removes `destDir` then.
 */
export async function extractSkillArchive(
  bytes: Uint8Array,
  destDir: string,
  options: ExtractSkillArchiveOptions = {},
): Promise<ExtractedSkillArchive> {
  const limits = options.limits ?? SKILL_ARCHIVE_ZIP_LIMITS
  try {
    await assertZipInflatesWithinLimits(bytes, limits)
  } catch (error) {
    throw zipFailure(error)
  }
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch (error) {
    throw zipFailure(error)
  }

  const entries: Array<{ entry: JSZip.JSZipObject; parts: string[]; problem: string | undefined }> =
    []
  for (const entry of Object.values(zip.files)) {
    // JSZip rewrites names holding `..`; the name as stored is what is judged
    const raw = entry.unsafeOriginalName ?? entry.name
    const problem = zipEntryPathProblem(raw)
    if (problem === 'unsafe') {
      throw new SkillImportError('unsafe', `The archive holds an unsafe path: ${raw}`)
    }
    if (raw !== entry.name) {
      throw new SkillImportError('unsafe', `The archive holds an unsafe path: ${raw}`)
    }
    const path = raw.endsWith('/') ? raw.slice(0, -1) : raw
    entries.push({ entry, parts: path.split('/'), problem })
  }

  let topFolder: string | undefined
  if (options.stripTopFolder && entries.length > 0) {
    const first = entries[0]!.parts[0]!
    const shared = entries.every(
      ({ entry, parts }) => parts[0] === first && (parts.length > 1 || entry.dir),
    )
    if (shared) topFolder = first
  }

  const subParts = options.subPath ? options.subPath.split('/') : []
  let files = 0
  let total = 0
  const taken: Array<{ entry: JSZip.JSZipObject; parts: string[] }> = []
  for (const { entry, parts: allParts, problem } of entries) {
    const parts = topFolder === undefined ? allParts : allParts.slice(1)
    if (parts.length === 0) continue
    if (IGNORED_ARCHIVE_FOLDERS.has(parts[0]!)) continue
    const inSubPath =
      !subParts.some((part, index) => parts[index] !== part) &&
      (parts.length > subParts.length || entry.dir)
    if (!inSubPath && (entry.dir || !options.alsoTake?.(parts))) continue
    if (problem) {
      throw new SkillImportError(
        'unsafe',
        `The archive holds a name Windows cannot use: ${entry.name}`,
      )
    }
    if (isLinkEntry(entry)) {
      throw new SkillImportError('unsafe', `The archive holds a link: ${entry.name}`)
    }
    taken.push({ entry, parts })
  }

  for (const { entry, parts } of taken) {
    const target = join(destDir, ...parts)
    if (!isInsideDir(target, destDir)) {
      throw new SkillImportError('unsafe', `The archive holds an unsafe path: ${entry.name}`)
    }
    try {
      if (entry.dir) {
        await mkdir(target, { recursive: true })
        continue
      }
      const content = await entry.async('uint8array')
      total += content.byteLength
      if (total > limits.maxTotalBytes) {
        throw new SkillImportError('too-large', 'The archive is too large')
      }
      await mkdir(dirname(target), { recursive: true })
      // `wx`: two entries landing on one file (names differing only in case on Windows) fail
      await writeFile(target, content, { flag: 'wx' })
      files++
    } catch (error) {
      if (error instanceof SkillImportError) throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EEXIST' || code === 'ENOTDIR' || code === 'EISDIR') {
        throw new SkillImportError('unsafe', `Two archive entries land on one path: ${entry.name}`)
      }
      throw new SkillImportError('failed', `Could not write ${entry.name}`)
    }
  }
  return { files, bytes: total, topFolder }
}

/**
 * How a zip holds skills, judged from its entry names alone:
 * - `single`: a `SKILL.md` at its top (one skill, the zip is its folder)
 * - `bundle`: one or more top folders, each with a `SKILL.md` (the app's
 *   export, of one skill or several)
 * Loose files beside the folders (a license, a readme) are allowed. Folders
 * macOS adds and hidden ones do not count. Anything else is not a skill zip.
 */
export type SkillArchiveLayout = 'single' | 'bundle'

export function skillArchiveLayout(names: readonly string[]): SkillArchiveLayout | undefined {
  const folders = new Set<string>()
  const withSkillMd = new Set<string>()
  for (const name of names) {
    const parts = (name.endsWith('/') ? name.slice(0, -1) : name).split('/')
    const top = parts[0]!
    if (!top || IGNORED_ARCHIVE_FOLDERS.has(top) || top.startsWith('.')) continue
    if (parts.length === 1) {
      if (!name.endsWith('/') && top.toLowerCase() === 'skill.md') return 'single'
      if (name.endsWith('/')) folders.add(top)
      continue
    }
    folders.add(top)
    if (parts.length === 2 && parts[1]!.toLowerCase() === 'skill.md') withSkillMd.add(top)
  }
  if (folders.size === 0) return undefined
  return [...folders].every((folder) => withSkillMd.has(folder)) ? 'bundle' : undefined
}

/**
 * The layout of a zip file on disk, reading only its entry list (nothing is
 * inflated or written). `undefined` when it is not a skill zip, is over the
 * archive size limit, or cannot be read as a zip.
 */
export async function readSkillArchiveLayout(
  file: string,
  maxBytes = MAX_SKILL_ARCHIVE_BYTES,
): Promise<SkillArchiveLayout | undefined> {
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile() || info.size > maxBytes) return undefined
  try {
    const zip = await JSZip.loadAsync(await readFile(file))
    return skillArchiveLayout(
      Object.values(zip.files).map((entry) => entry.unsafeOriginalName ?? entry.name),
    )
  } catch {
    return undefined
  }
}
