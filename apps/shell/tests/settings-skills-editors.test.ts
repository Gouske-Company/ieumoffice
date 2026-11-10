/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserSkillView } from '@genoffice/electron-utils/user-skills-channels'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SkillsPane } from '../src/renderer/src/skills/SkillsPane'
import { skillsText } from '../src/renderer/src/i18n/strings-skills'

/**
 * Settings → Skills and where a skill is used (decision 0122): the row says
 * where a skill is used when it is not every editor, an own skill's editor
 * saves the choice with the skill, and another source's view changes the
 * settings file's choice at once.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

function view(partial: Partial<UserSkillView> & Pick<UserSkillView, 'source' | 'name'>) {
  const owned = partial.source === 'app'
  return {
    id: `${partial.source}:${partial.name}`,
    plugin: undefined,
    title: partial.name,
    description: `${partial.name} description`,
    enabled: true,
    invoke: 'auto',
    hidden: false,
    hasScripts: false,
    mcpServers: [],
    template: undefined,
    templateExists: false,
    agentOnly: false,
    unreadable: undefined,
    files: 1,
    bytes: 10,
    github: undefined,
    owned,
    can: {
      edit: owned,
      copyToMine: !owned,
      export: owned,
      checkUpdate: false,
      openFolder: true,
      remove: owned,
      hide: false,
    },
    shadowedBy: undefined,
    ...partial,
  } as UserSkillView
}

const deck = view({ source: 'app', name: 'deck', editors: ['slides'] })
const tidy = view({ source: 'user', name: 'sheet-tidy', editors: ['sheets'] })
const notes = view({ source: 'app', name: 'notes' })

function bridge(views: UserSkillView[], fileEditors?: string[]) {
  return {
    list: vi.fn(async () => views),
    read: vi.fn(async (id: string) => ({
      ok: true,
      skill: {
        id,
        name: id.split(':').at(-1),
        title: id,
        description: 'd',
        body: 'b',
        template: undefined,
        ...(fileEditors ? { editors: fileEditors } : {}),
        files: [],
      },
    })),
    setState: vi.fn(async () => ({ ok: true })),
    checkName: vi.fn(async () => ({ ok: true })),
    save: vi.fn(async () => ({ ok: true, id: 'app:deck' })),
    openFolder: vi.fn(async () => ({ ok: true })),
    onChanged: vi.fn(() => () => undefined),
    onDropped: vi.fn(() => () => undefined),
    takeDropped: vi.fn(async () => ({ ok: true, preview: null })),
  }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
    getAiPanelPrefs: async () => ({ fontSize: 'default', spellcheck: true }),
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    openHelp: vi.fn(async () => {}),
  } as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { aiOfficeUserSkills?: unknown }).aiOfficeUserSkills
})

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
    await Promise.resolve()
  })
  await flush()
}

async function renderPane(api: ReturnType<typeof bridge>): Promise<void> {
  ;(window as unknown as { aiOfficeUserSkills?: unknown }).aiOfficeUserSkills = api
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'ko' }, createElement(SkillsPane)))
    await Promise.resolve()
  })
  await flush()
}

const row = (id: string) => host.querySelector<HTMLElement>(`[data-skill-id="${id}"]`)!

async function openFromMenu(id: string, action: 'actView' | 'actEdit'): Promise<void> {
  await click(row(id).querySelector('button[aria-haspopup="menu"]'))
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (b) => b.textContent?.trim() === skillsText('ko', action),
  )
  await click(item)
}

const checkbox = (editor: string) =>
  document.querySelector<HTMLInputElement>(`input[type="checkbox"][value="${editor}"]`)
const radio = (label: string) =>
  [...document.querySelectorAll('label')]
    .find((l) => l.textContent === label)!
    .querySelector<HTMLInputElement>('input')!
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)

describe('the skills list', () => {
  it('says where a skill is used when it is not every editor', async () => {
    await renderPane(bridge([deck, notes]))
    expect(row('app:deck').textContent).toContain('쓰는 곳: 프레젠테이션')
    expect(row('app:notes').textContent).not.toContain('쓰는 곳')
  })
})

describe('an own skill’s editor', () => {
  it('starts at the file’s editors and saves the change with the skill', async () => {
    const api = bridge([deck], ['slides'])
    await renderPane(api)
    await openFromMenu('app:deck', 'actEdit')
    expect(checkbox('slides')!.checked).toBe(true)
    await click(checkbox('docs'))
    await click(button(skillsText('ko', 'save')))
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'app:deck', editors: ['docs', 'slides'] }),
    )
    expect(api.setState).not.toHaveBeenCalled()
  })

  it('saves every editor as such', async () => {
    const api = bridge([deck], ['slides'])
    await renderPane(api)
    await openFromMenu('app:deck', 'actEdit')
    await click(radio('모든 편집기'))
    await click(button(skillsText('ko', 'save')))
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ editors: 'all' }))
  })
})

describe('a skill the person cannot edit', () => {
  it('changes the settings file’s choice from its view, without a copy', async () => {
    const api = bridge([tidy])
    await renderPane(api)
    await openFromMenu('user:sheet-tidy', 'actView')
    expect(checkbox('sheets')!.checked).toBe(true)
    await click(checkbox('hwp'))
    expect(api.setState).toHaveBeenLastCalledWith('user:sheet-tidy', {
      editors: ['sheets', 'hwp'],
    })
    await click(radio('모든 편집기'))
    expect(api.setState).toHaveBeenLastCalledWith('user:sheet-tidy', { editors: 'all' })
    expect(api.save).not.toHaveBeenCalled()
  })

  it('waits while no editor is checked', async () => {
    const api = bridge([tidy])
    await renderPane(api)
    await openFromMenu('user:sheet-tidy', 'actView')
    await click(checkbox('sheets'))
    expect(api.setState).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('편집기를 하나 이상 고르세요')
  })
})
