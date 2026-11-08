import { execFile } from 'node:child_process'
import type { Dirent } from 'node:fs'
import { lstat, mkdtemp, readdir, readFile, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { windowsSystemDir, windowsSystemTool } from '@genoffice/ai-provider/subscription'

/**
 * The session folders of agent mode (decision 0032) in the system's temporary
 * folder. Each carries a mark naming the process that made it, so that the
 * folders an app left when it did not quit normally (ended from Task Manager,
 * power lost) can be removed at the next start without touching the folders of
 * another IeumOffice that runs now: the installed app and a development run
 * share the temporary folder.
 */

const PREFIX = 'ieum-agent-'
/** `mkdtemp` adds six letters or digits to the prefix */
const SESSION_FOLDER_NAME = /^ieum-agent-[A-Za-z0-9]{6}$/
const OWNER_FILE = 'owner.json'

/** An unmarked folder (from a version before the mark) goes once nothing in it changed for this long */
const UNMARKED_MAX_AGE_MS = 24 * 60 * 60 * 1000
/**
 * How much later than its folder a process may seem to have started and still be taken for its
 * owner: the two times come from the clock at different moments, and the clock can be set back
 * between them. A process that started later than this is another one that got the same number
 */
const START_SLACK_MS = 5 * 60 * 1000
const MAX_FOLDERS_PER_SWEEP = 100
/** a session folder holds a few files; one holding more is not one this app left, and is kept */
const MAX_ENTRIES_PER_FOLDER = 256
const PROCESS_QUERY_TIMEOUT_MS = 10_000

interface FolderOwner {
  pid: number
  /** when the folder was made, in milliseconds since 1970 */
  createdAt: number
}

/** Make a session folder in `parent`, marked with this process as its owner */
export async function makeAgentSessionFolder(parent: string = tmpdir()): Promise<string> {
  const dir = await mkdtemp(join(parent, PREFIX))
  const owner: FolderOwner = { pid: process.pid, createdAt: Date.now() }
  try {
    await writeFile(join(dir, OWNER_FILE), JSON.stringify(owner), { flag: 'wx' })
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
  return dir
}

export interface AgentFolderSweepOptions {
  /** where the session folders are made; the system's temporary folder by default */
  parent?: string | undefined
  now?: number | undefined
  /** whether a process with this number runs */
  alive?: ((pid: number) => boolean) | undefined
  /** when running processes started, in milliseconds since 1970; a process left out is unknown */
  startTimes?: ((pids: readonly number[]) => Promise<ReadonlyMap<number, number>>) | undefined
}

/** What a session folder holds, as listed without following a link */
interface FolderListing {
  /** every entry inside, deepest first */
  entries: Array<{ path: string; folder: boolean }>
  /** the latest change to the folder or anything in it */
  changedAt: number
}

/**
 * Remove the session folders whose owner process is gone, and the unmarked ones nothing changed
 * in for a day. A folder that is, or holds, a link is left, and so is one that cannot be listed
 * or judged. Never fails.
 */
export async function sweepAgentSessionFolders(
  options: AgentFolderSweepOptions = {},
): Promise<void> {
  const parent = options.parent ?? tmpdir()
  const now = options.now ?? Date.now()
  const alive = options.alive ?? processAlive
  const startTimes = options.startTimes ?? processStartTimes
  try {
    const names = (await readdir(parent))
      .filter((name) => SESSION_FOLDER_NAME.test(name))
      .slice(0, MAX_FOLDERS_PER_SWEEP)
    const running: Array<{ listing: FolderListing; dir: string; owner: FolderOwner }> = []
    for (const name of names) {
      const dir = join(parent, name)
      const listing = await listFolder(dir)
      if (!listing) continue
      const owner = await readOwner(dir)
      if (!owner) {
        if (now - listing.changedAt > UNMARKED_MAX_AGE_MS) await removeListed(dir, listing)
      } else if (!alive(owner.pid)) {
        await removeListed(dir, listing)
      } else {
        running.push({ listing, dir, owner })
      }
    }
    if (running.length === 0) return
    const started = await startTimes([...new Set(running.map((folder) => folder.owner.pid))])
    for (const { listing, dir, owner } of running) {
      const startedAt = started.get(owner.pid)
      // a process can make a folder only after it started: one started later has the number of
      // an owner that is gone
      if (startedAt !== undefined && startedAt > owner.createdAt + START_SLACK_MS) {
        await removeListed(dir, listing)
      }
    }
  } catch {
    // the system's temporary-file cleanup takes what is left
  }
}

async function listFolder(dir: string): Promise<FolderListing | undefined> {
  const entries: FolderListing['entries'] = []
  let changedAt = 0
  const visit = async (path: string): Promise<boolean> => {
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isDirectory()) return false
    changedAt = Math.max(changedAt, info.mtimeMs)
    const children: Dirent[] = await readdir(path, { withFileTypes: true })
    for (const child of children) {
      const full = join(path, child.name)
      if (entries.length >= MAX_ENTRIES_PER_FOLDER) return false
      if (child.isDirectory()) {
        if (!(await visit(full))) return false
        entries.push({ path: full, folder: true })
        continue
      }
      // a link, or anything other than a plain file (a Windows junction lists as a link)
      if (!child.isFile()) return false
      const file = await lstat(full)
      if (!file.isFile()) return false
      changedAt = Math.max(changedAt, file.mtimeMs)
      entries.push({ path: full, folder: false })
    }
    return true
  }
  try {
    return (await visit(dir)) ? { entries, changedAt } : undefined
  } catch {
    return undefined
  }
}

async function readOwner(dir: string): Promise<FolderOwner | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(dir, OWNER_FILE), 'utf8')) as Partial<FolderOwner>
    if (!Number.isSafeInteger(raw.pid) || (raw.pid as number) <= 0) return undefined
    if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return undefined
    return { pid: raw.pid as number, createdAt: raw.createdAt }
  } catch {
    return undefined
  }
}

/**
 * Remove what the listing found, entry by entry: a file is unlinked and a folder removed only
 * when empty, so a link put in place meanwhile is removed itself and never followed, and anything
 * added meanwhile keeps its folder
 */
async function removeListed(dir: string, listing: FolderListing): Promise<void> {
  try {
    for (const entry of listing.entries) {
      if (entry.folder) await rmdir(entry.path)
      else await unlink(entry.path)
    }
    await rmdir(dir)
  } catch {
    // in use, or changed since it was listed: left for a later start
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it runs, under another account
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** This process from its own clock; the others from the system, in one program run */
async function processStartTimes(pids: readonly number[]): Promise<ReadonlyMap<number, number>> {
  const out = new Map<number, number>()
  const others: number[] = []
  for (const pid of pids) {
    if (pid === process.pid) out.set(pid, Date.now() - process.uptime() * 1000)
    else others.push(pid)
  }
  if (others.length === 0) return out
  const listed =
    process.platform === 'win32' ? await windowsStartTimes(others) : await posixStartTimes(others)
  for (const [pid, startedAt] of listed) out.set(pid, startedAt)
  return out
}

function run(file: string, args: string[], options: { cwd?: string } = {}): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { ...options, timeout: PROCESS_QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 },
      (error, stdout) => resolve(error ? '' : String(stdout)),
    )
  })
}

/** Windows PowerShell started by full path, without a shell; the numbers are the only input */
async function windowsStartTimes(pids: readonly number[]): Promise<Map<number, number>> {
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `foreach ($id in @(${pids.join(',')})) {`,
    '  $p = Get-Process -Id $id',
    '  if ($p -and $p.StartTime) { "$id " + ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds() }',
    '}',
    // a number not found fails its own line only
    'exit 0',
  ].join('\n')
  const stdout = await run(
    windowsSystemTool(process.env, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { cwd: windowsSystemDir(process.env) },
  )
  const out = new Map<number, number>()
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(\d+) (\d+)$/.exec(line.trim())
    if (match) out.set(Number(match[1]), Number(match[2]))
  }
  return out
}

/** `ps` gives how long each has run (`[[dd-]hh:]mm:ss`), in the same words on every locale */
async function posixStartTimes(pids: readonly number[]): Promise<Map<number, number>> {
  const stdout = await run('/bin/ps', ['-o', 'pid=', '-o', 'etime=', '-p', pids.join(',')])
  const now = Date.now()
  const out = new Map<number, number>()
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(line)
    if (!match) continue
    const [, pid, days, hours, minutes, seconds] = match
    const elapsed =
      ((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 + Number(minutes)) * 60 + Number(seconds)
    out.set(Number(pid), now - elapsed * 1000)
  }
  return out
}
