import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makeAgentSessionFolder,
  sweepAgentSessionFolders,
} from '../../src/main/agent/agent-session-folders'

const HOUR = 60 * 60 * 1000
const NOW = Date.UTC(2026, 10, 8, 12, 0, 0)
const OWNER = 4242

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** the temporary folder the sweep looks in */
function parentFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-folders-test-'))
  roots.push(dir)
  return dir
}

/** a folder as a session leaves it: its settings, and the owner's mark unless `owner` is null */
function sessionFolder(
  parent: string,
  name: string,
  owner: { pid: number; createdAt: number } | null | string,
): string {
  const dir = join(parent, name)
  mkdirSync(join(dir, 'sandbox-probe', 'denied'), { recursive: true })
  writeFileSync(join(dir, 'claude-settings.json'), '{}')
  writeFileSync(join(dir, 'sandbox-probe', 'readable.txt'), 'x')
  if (owner !== null) {
    writeFileSync(
      join(dir, 'owner.json'),
      typeof owner === 'string' ? owner : JSON.stringify(owner),
    )
  }
  return dir
}

/** every entry of `dir` and the folder itself last changed `at` */
function age(dir: string, at: number): void {
  const when = new Date(at)
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) walk(full)
      utimesSync(full, when, when)
    }
  }
  walk(dir)
  utimesSync(dir, when, when)
}

const linkType = process.platform === 'win32' ? 'junction' : 'dir'

describe('sweeping the session folders left by an app that did not quit normally', () => {
  it('removes a folder whose owner process is gone', async () => {
    const parent = parentFolder()
    const dir = sessionFolder(parent, 'ieum-agent-Dead01', { pid: OWNER, createdAt: NOW - HOUR })
    await sweepAgentSessionFolders({
      parent,
      now: NOW,
      alive: () => false,
      startTimes: async () => new Map(),
    })
    expect(existsSync(dir)).toBe(false)
  })

  it('keeps a folder whose owner still runs', async () => {
    const parent = parentFolder()
    const dir = sessionFolder(parent, 'ieum-agent-Live01', { pid: OWNER, createdAt: NOW - HOUR })
    await sweepAgentSessionFolders({
      parent,
      now: NOW,
      alive: (pid) => pid === OWNER,
      startTimes: async () => new Map([[OWNER, NOW - 2 * HOUR]]),
    })
    expect(readFileSync(join(dir, 'claude-settings.json'), 'utf8')).toBe('{}')
  })

  it('removes a folder whose owner’s number now belongs to a process started after the folder', async () => {
    const parent = parentFolder()
    const dir = sessionFolder(parent, 'ieum-agent-Reuse1', {
      pid: OWNER,
      createdAt: NOW - 3 * HOUR,
    })
    await sweepAgentSessionFolders({
      parent,
      now: NOW,
      alive: (pid) => pid === OWNER,
      startTimes: async () => new Map([[OWNER, NOW - HOUR]]),
    })
    expect(existsSync(dir)).toBe(false)
  })

  it('keeps a folder whose owner number runs when that process’s start cannot be told', async () => {
    const parent = parentFolder()
    const dir = sessionFolder(parent, 'ieum-agent-Unkn01', { pid: OWNER, createdAt: NOW - HOUR })
    await sweepAgentSessionFolders({
      parent,
      now: NOW,
      alive: () => true,
      startTimes: async () => new Map(),
    })
    expect(existsSync(dir)).toBe(true)
  })

  it('removes an unmarked folder only when nothing in it changed for a day', async () => {
    const parent = parentFolder()
    const old = sessionFolder(parent, 'ieum-agent-Old001', null)
    age(old, NOW - 25 * HOUR)
    const broken = sessionFolder(parent, 'ieum-agent-Old002', '{"pid":')
    age(broken, NOW - 25 * HOUR)
    const young = sessionFolder(parent, 'ieum-agent-Young1', null)
    age(young, NOW - 23 * HOUR)
    const touched = sessionFolder(parent, 'ieum-agent-Young2', null)
    age(touched, NOW - 25 * HOUR)
    const recent = new Date(NOW - HOUR)
    utimesSync(join(touched, 'sandbox-probe', 'readable.txt'), recent, recent)

    await sweepAgentSessionFolders({
      parent,
      now: NOW,
      alive: () => false,
      startTimes: async () => new Map(),
    })
    expect(existsSync(old), 'old and unmarked').toBe(false)
    expect(existsSync(broken), 'old, with a mark that cannot be read').toBe(false)
    expect(existsSync(young), 'younger than a day').toBe(true)
    expect(existsSync(touched), 'a file in it changed within the day').toBe(true)
  })

  it('does not follow a link: as the folder, or anywhere inside it', async () => {
    const parent = parentFolder()
    const outside = parentFolder()
    const target = sessionFolder(outside, 'precious', { pid: OWNER, createdAt: NOW - HOUR })
    symlinkSync(target, join(parent, 'ieum-agent-Link01'), linkType)
    const holding = sessionFolder(parent, 'ieum-agent-Link02', {
      pid: OWNER,
      createdAt: NOW - HOUR,
    })
    symlinkSync(target, join(holding, 'sandbox-probe', 'away'), linkType)

    await sweepAgentSessionFolders({
      parent,
      now: NOW,
      alive: () => false,
      startTimes: async () => new Map(),
    })
    expect(readdirSync(target).sort()).toEqual([
      'claude-settings.json',
      'owner.json',
      'sandbox-probe',
    ])
    expect(existsSync(join(target, 'sandbox-probe', 'readable.txt'))).toBe(true)
    expect(existsSync(join(parent, 'ieum-agent-Link01')), 'the link is left').toBe(true)
    expect(
      existsSync(join(holding, 'claude-settings.json')),
      'a folder holding a link is left',
    ).toBe(true)
  })

  it('touches nothing but folders named as session folders', async () => {
    const parent = parentFolder()
    const dead = { pid: OWNER, createdAt: NOW - HOUR }
    const others = [
      'ieum-agent-skills-AbC123',
      'ieum-agent-abc',
      'other-AbC123',
      'ieum-agent-AbC123x',
    ]
    for (const name of others) sessionFolder(parent, name, dead)
    writeFileSync(join(parent, 'ieum-agent-File01'), JSON.stringify(dead))
    const ours = sessionFolder(parent, 'ieum-agent-AbC123', dead)

    await sweepAgentSessionFolders({
      parent,
      now: NOW,
      alive: () => false,
      startTimes: async () => new Map(),
    })
    expect(existsSync(ours)).toBe(false)
    expect(readdirSync(parent).sort()).toEqual([...others, 'ieum-agent-File01'].sort())
  })

  it('keeps the folder of a session this app runs now, with the real process checks', async () => {
    const parent = parentFolder()
    const dir = await makeAgentSessionFolder(parent)
    writeFileSync(join(dir, 'claude-settings.json'), '{}')
    await sweepAgentSessionFolders({ parent })
    expect(existsSync(join(dir, 'claude-settings.json'))).toBe(true)

    // the same folder once its owner is gone
    await sweepAgentSessionFolders({ parent, alive: () => false })
    expect(existsSync(dir)).toBe(false)
  })

  it('never fails, whatever the temporary folder holds', async () => {
    await expect(
      sweepAgentSessionFolders({ parent: join(parentFolder(), 'missing') }),
    ).resolves.toBeUndefined()
  })
})
