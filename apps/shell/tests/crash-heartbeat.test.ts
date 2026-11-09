import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  goneEntryFrom,
  heartbeatPath,
  parseHeartbeat,
  startHeartbeat,
  type Heartbeat,
} from '../src/main/crash-heartbeat'

/**
 * The main process's heartbeat (src/main/crash-heartbeat.ts). A main process
 * that dies runs none of its own code, so the only trace is the heartbeat it
 * left: the next launch turns an unmarked one into a `main-gone` line.
 */

const MIN = 60_000
let dir: string
let logPath: string

const logLines = () =>
  existsSync(logPath)
    ? readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : []
const beatOnDisk = () => JSON.parse(readFileSync(heartbeatPath(dir), 'utf8')) as Heartbeat
const writeBeat = (value: unknown) => writeFileSync(heartbeatPath(dir), JSON.stringify(value))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crash-heartbeat-'))
  logPath = join(dir, 'crash-log.jsonl')
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

describe('goneEntryFrom', () => {
  const beat: Heartbeat = {
    version: 1,
    startedAt: 0,
    at: 42 * MIN + 5_000,
    memory: { appMB: 4200, mainMB: 3900, heapMB: 3600, heapLimitMB: 4096, freeMB: 900 },
  }

  it('reports a run that never marked its end, with its last figures and minutes', () => {
    expect(goneEntryFrom(beat, 45 * MIN)).toEqual({
      kind: 'main-gone',
      appMB: 4200,
      mainMB: 3900,
      heapMB: 3600,
      heapLimitMB: 4096,
      freeMB: 900,
      upMin: 42,
      beatAgeMin: 2,
    })
  })

  it('stays quiet for a run that ended on purpose, or left no heartbeat', () => {
    expect(goneEntryFrom({ ...beat, ended: 'quit' }, 45 * MIN)).toBeNull()
    expect(goneEntryFrom({ ...beat, ended: 'os' }, 45 * MIN)).toBeNull()
    expect(goneEntryFrom(null, 45 * MIN)).toBeNull()
  })
})

describe('parseHeartbeat', () => {
  it('keeps whole non-negative figures only and rejects other shapes', () => {
    expect(
      parseHeartbeat({
        version: 1,
        startedAt: 1,
        at: 2,
        ended: 'nope',
        memory: { appMB: 10, freeMB: -1, totalMB: 1.5, note: 'C:\\secret' },
      }),
    ).toEqual({ version: 1, startedAt: 1, at: 2, memory: { appMB: 10 } })
    expect(parseHeartbeat({ version: 2, startedAt: 1, at: 2 })).toBeNull()
    expect(parseHeartbeat('x')).toBeNull()
  })
})

describe('startHeartbeat', () => {
  it("writes a main-gone line for the previous run's unmarked heartbeat, then beats anew", () => {
    writeBeat({ version: 1, startedAt: 0, at: 10 * MIN, memory: { heapMB: 3600 } })
    const handle = startHeartbeat({
      userDataDir: dir,
      logPath,
      memory: () => ({ appMB: 500 }),
      now: () => 11 * MIN,
    })
    expect(logLines()).toEqual([
      expect.objectContaining({ kind: 'main-gone', heapMB: 3600, upMin: 10, beatAgeMin: 1 }),
    ])
    expect(beatOnDisk()).toEqual({
      version: 1,
      startedAt: 11 * MIN,
      at: 11 * MIN,
      memory: { appMB: 500 },
    })
    handle.stop()
  })

  it('writes nothing to the log after a run that ended on purpose, or a first run', () => {
    writeBeat({ version: 1, startedAt: 0, at: 1, ended: 'quit', memory: {} })
    startHeartbeat({ userDataDir: dir, logPath, memory: () => ({}) }).stop()
    rmSync(heartbeatPath(dir))
    startHeartbeat({ userDataDir: dir, logPath, memory: () => ({}) }).stop()
    writeFileSync(heartbeatPath(dir), '{not json')
    startHeartbeat({ userDataDir: dir, logPath, memory: () => ({}) }).stop()
    expect(logLines()).toEqual([])
  })

  it('beats on its interval and stops once the end is marked', () => {
    vi.useFakeTimers()
    let clock = 0
    let appMB = 100
    const handle = startHeartbeat({
      userDataDir: dir,
      logPath,
      memory: () => ({ appMB }),
      intervalMs: 1000,
      now: () => clock,
    })
    clock = 1000
    appMB = 200
    vi.advanceTimersByTime(1000)
    expect(beatOnDisk()).toMatchObject({ at: 1000, memory: { appMB: 200 } })
    handle.markEnded('os')
    // a later will-quit does not overwrite the first mark
    handle.markEnded('quit')
    expect(beatOnDisk()).toMatchObject({ ended: 'os' })
    clock = 5000
    vi.advanceTimersByTime(5000)
    expect(beatOnDisk()).toMatchObject({ at: 1000, ended: 'os' })
  })

  it('never throws when the beat cannot be written or the figures fail', () => {
    const handle = startHeartbeat({
      userDataDir: dir,
      logPath,
      memory: () => {
        throw new Error('no metrics')
      },
      writeJson: () => {
        throw new Error('disk full')
      },
    })
    expect(() => handle.markEnded('quit')).not.toThrow()
  })
})
