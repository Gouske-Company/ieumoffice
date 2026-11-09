import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeJsonAtomic } from '@genoffice/electron-utils/atomic-write'
import { appendCrashLog } from './crash-log'
import type { CrashEntry, CrashMemory } from './crash-log'

/**
 * The main process's heartbeat. When the main process itself dies (its
 * JavaScript heap runs out, native code crashes, Windows ends it), nothing in
 * it runs any more: no exception, no quit path, no crash-log line. Testers
 * could only say "the app just closed". So the running app writes its memory
 * figures to `<userData>/crash-heartbeat.json` every HEARTBEAT_MS, and marks
 * the file when it ends on purpose. The next launch finds an unmarked file and
 * writes a `main-gone` line to the crash log with those last figures.
 *
 * The file holds the same kind of figures as a crash-log line (whole MB and
 * counts) and two times. Nothing else, and it never leaves the PC.
 */

export const HEARTBEAT_FILE = 'crash-heartbeat.json'
export const HEARTBEAT_MS = 30_000

/** how the run ended on purpose: the quit path, or the OS ending the session */
export type HeartbeatEnd = 'quit' | 'os'

export interface Heartbeat {
  version: 1
  /** epoch ms when the run started */
  startedAt: number
  /** epoch ms of this beat */
  at: number
  ended?: HeartbeatEnd
  memory: CrashMemory
}

export function heartbeatPath(userDataDir: string): string {
  return join(userDataDir, HEARTBEAT_FILE)
}

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

export function parseHeartbeat(raw: unknown): Heartbeat | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.version !== 1 || !isTime(value.startedAt) || !isTime(value.at)) return null
  const memory: CrashMemory = {}
  if (value.memory && typeof value.memory === 'object') {
    for (const [key, figure] of Object.entries(value.memory as Record<string, unknown>)) {
      if (typeof figure === 'number' && Number.isInteger(figure) && figure >= 0) {
        ;(memory as Record<string, number>)[key] = figure
      }
    }
  }
  const beat: Heartbeat = { version: 1, startedAt: value.startedAt, at: value.at, memory }
  if (value.ended === 'quit' || value.ended === 'os') beat.ended = value.ended
  return beat
}

function readHeartbeat(filePath: string): Heartbeat | null {
  try {
    return parseHeartbeat(JSON.parse(readFileSync(filePath, 'utf8')))
  } catch {
    return null
  }
}

const MINUTE = 60_000

/**
 * The `main-gone` line for the previous run's heartbeat, or null when that run
 * ended on purpose (or left no readable heartbeat). A power cut also leaves an
 * unmarked heartbeat: the figures (and `beatAgeMin`) tell it apart.
 */
export function goneEntryFrom(previous: Heartbeat | null, now: number): CrashEntry | null {
  if (!previous || previous.ended) return null
  return {
    ...previous.memory,
    kind: 'main-gone',
    upMin: Math.max(0, Math.floor((previous.at - previous.startedAt) / MINUTE)),
    beatAgeMin: Math.max(0, Math.floor((now - previous.at) / MINUTE)),
  }
}

export interface HeartbeatOptions {
  userDataDir: string
  /** the crash log the `main-gone` line goes to */
  logPath: string
  memory: () => CrashMemory
  intervalMs?: number
  now?: () => number
  /** injectable for tests; defaults to the atomic userData JSON writer */
  writeJson?: (filePath: string, value: unknown) => void
}

export interface HeartbeatHandle {
  /** the run is ending on purpose: write the mark now and stop beating */
  markEnded: (how: HeartbeatEnd) => void
  stop: () => void
}

/**
 * Report the previous run if it died, then beat for this one. Never throws:
 * a diagnostic must not make anything worse.
 */
export function startHeartbeat(options: HeartbeatOptions): HeartbeatHandle {
  const filePath = heartbeatPath(options.userDataDir)
  const now = options.now ?? Date.now
  const writeJson = options.writeJson ?? writeJsonAtomic
  const startedAt = now()
  try {
    const gone = goneEntryFrom(readHeartbeat(filePath), startedAt)
    if (gone) appendCrashLog(options.logPath, gone)
  } catch {
    /* best effort */
  }
  let ended = false
  const beat = (end?: HeartbeatEnd): void => {
    let memory: CrashMemory = {}
    try {
      memory = options.memory()
    } catch {
      /* the beat goes out without figures */
    }
    const value: Heartbeat = { version: 1, startedAt, at: now(), memory }
    if (end) value.ended = end
    try {
      writeJson(filePath, value)
    } catch {
      /* best effort */
    }
  }
  beat()
  const timer = setInterval(() => {
    if (!ended) beat()
  }, options.intervalMs ?? HEARTBEAT_MS)
  timer.unref?.()
  return {
    markEnded: (how) => {
      if (ended) return
      ended = true
      clearInterval(timer)
      beat(how)
    },
    stop: () => {
      ended = true
      clearInterval(timer)
    },
  }
}
