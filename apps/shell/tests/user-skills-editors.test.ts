import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readAppSettings } from '../src/main/app-settings'
import {
  createUserSkillsService,
  type UserSkillsService,
} from '../src/main/user-skills/user-skills-service'

/**
 * Where a skill is used (decision 0122) in the shell's skills service: an own
 * skill's choice goes into its SKILL.md, another source's into the settings
 * file, and the list carries the result.
 */

let root: string
let home: string
let settingsPath: string
let service: UserSkillsService

const appDir = () => join(home, '.ieumoffice', 'skills')
const claudeDir = () => join(home, '.claude', 'skills')

function skill(dir: string, text: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), text)
}

const MINE =
  '---\nname: deck\ndescription: >\n  Makes decks\n  look good.\nlicense: MIT\nmetadata:\n  author: me\n  ieum-title: Deck\n---\nBody\n'

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skills-editors-'))
  home = join(root, 'home')
  settingsPath = join(root, 'app-settings.json')
  skill(join(appDir(), 'deck'), MINE)
  skill(
    join(claudeDir(), 'sheet-tidy'),
    '---\nname: sheet-tidy\ndescription: Tidies sheets\nmetadata:\n  ieum-editors: sheets\n---\nTidy.\n',
  )
  service = createUserSkillsService({
    homeDir: () => home,
    builtinDir: () => undefined,
    settingsPath: () => settingsPath,
    tempDir: () => join(root, 'temp'),
    trash: vi.fn(async (path: string) => rmSync(path, { recursive: true, force: true })),
    fetch: () => Promise.reject(new Error('no network in tests')),
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function editorsOf(id: string) {
  return (await service.list()).find((view) => view.id === id)?.editors
}

const mineText = () => readFileSync(join(appDir(), 'deck', 'SKILL.md'), 'utf8')

describe('an own skill', () => {
  const save = (editors?: 'all' | string[]) =>
    service.save({
      id: 'app:deck',
      title: '',
      description: 'Makes decks look good.',
      body: 'Body\n',
      editors,
    })

  it('writes ieum-editors into its file and the list follows it', async () => {
    expect(await save(['slides'])).toEqual({ ok: true, id: 'app:deck' })
    expect(mineText()).toContain('\n  ieum-editors: slides\n')
    expect(mineText()).toContain('license: MIT\nmetadata:\n  author: me\n  ieum-title: Deck\n')
    expect(await editorsOf('app:deck')).toEqual(['slides'])
  })

  it('takes ieum-editors out for every editor and leaves the other metadata', async () => {
    await save(['slides', 'docs'])
    await save('all')
    expect(mineText()).not.toContain('ieum-editors')
    expect(mineText()).toContain('metadata:\n  author: me\n  ieum-title: Deck\n')
    expect(await editorsOf('app:deck')).toBeUndefined()
  })

  it('keeps ids this app does not know when the choice did not change', async () => {
    writeFileSync(
      join(appDir(), 'deck', 'SKILL.md'),
      MINE.replace(
        '  ieum-title: Deck\n',
        '  ieum-title: Deck\n  ieum-editors: slides future-editor\n',
      ),
    )
    await save(['slides'])
    expect(mineText()).toContain('ieum-editors: slides future-editor')
  })

  it('is not given a choice in the settings file', async () => {
    expect(await service.setState('app:deck', { editors: ['slides'] })).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(readAppSettings(settingsPath).skills).toBeUndefined()
  })

  it('takes the editors a skill card saves', async () => {
    const saved = await service.saveFromCard({
      title: '',
      name: 'chart-style',
      description: 'Styles charts',
      body: 'Do it.\n',
      invoke: 'auto',
      editors: ['sheets'],
    })
    expect(saved).toEqual({ ok: true, id: 'app:chart-style' })
    expect(await editorsOf('app:chart-style')).toEqual(['sheets'])
  })
})

describe('a skill the person cannot edit', () => {
  it('keeps the choice in the settings file and its own file as it was', async () => {
    const file = join(claudeDir(), 'sheet-tidy', 'SKILL.md')
    const before = readFileSync(file)
    expect(await editorsOf('user:sheet-tidy')).toEqual(['sheets'])

    expect(await service.setState('user:sheet-tidy', { editors: ['sheets', 'docs'] })).toEqual({
      ok: true,
    })
    expect(readAppSettings(settingsPath).skills).toEqual({
      states: { 'user:sheet-tidy': { editors: ['docs', 'sheets'] } },
    })
    expect(await editorsOf('user:sheet-tidy')).toEqual(['docs', 'sheets'])

    await service.setState('user:sheet-tidy', { editors: 'all' })
    expect(readAppSettings(settingsPath).skills).toEqual({
      states: { 'user:sheet-tidy': { editors: 'all' } },
    })
    expect(await editorsOf('user:sheet-tidy')).toBeUndefined()
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('forgets a choice that says what the file says', async () => {
    await service.setState('user:sheet-tidy', { editors: ['docs'] })
    await service.setState('user:sheet-tidy', { editors: ['sheets'] })
    expect(readAppSettings(settingsPath).skills).toEqual({})
  })

  it('keeps the choice beside on/off', async () => {
    await service.setState('user:sheet-tidy', { editors: ['hwp'] })
    await service.setState('user:sheet-tidy', { enabled: true })
    expect(readAppSettings(settingsPath).skills).toEqual({
      states: { 'user:sheet-tidy': { enabled: true, editors: ['hwp'] } },
    })
  })

  it('carries the choice into the file of a copy made mine', async () => {
    await service.setState('user:sheet-tidy', { editors: ['hwp'] })
    expect(await service.copyToMine('user:sheet-tidy', false)).toEqual({
      ok: true,
      id: 'app:sheet-tidy',
    })
    expect(readFileSync(join(appDir(), 'sheet-tidy', 'SKILL.md'), 'utf8')).toContain(
      'ieum-editors: hwp',
    )
    expect(await editorsOf('app:sheet-tidy')).toEqual(['hwp'])
  })
})
