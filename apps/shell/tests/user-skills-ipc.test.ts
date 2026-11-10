import { beforeEach, describe, expect, it, vi } from 'vitest'
import { USER_SKILLS_CHANNELS as C } from '@genoffice/electron-utils/user-skills-channels'
import type { UserSkillsService } from '../src/main/user-skills/user-skills-service'

/**
 * The skills channels in main (src/main/user-skills/user-skills-ipc.ts): the
 * settings screen alone may change skills; any window may list them, read
 * them for the AI and save a card; malformed requests are refused before the
 * service is reached; a change is broadcast to every window.
 */

type Handler = (event: unknown, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sent: [] as Array<{ id: number; channel: string }>,
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => mocks.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn(async () => ({ canceled: true })),
  },
  shell: { openPath: vi.fn(async () => '') },
  webContents: {
    getAllWebContents: () =>
      [settings, editor].map((wc) => ({
        id: wc.id,
        isDestroyed: () => false,
        send: (channel: string) => mocks.sent.push({ id: wc.id, channel }),
      })),
  },
}))

const settings = { id: 1, once: vi.fn(), isDestroyed: () => false }
const editor = { id: 2, once: vi.fn(), isDestroyed: () => false }
const agent = { id: 3, once: vi.fn(), isDestroyed: () => false }

const service = {
  list: vi.fn(async () => []),
  setState: vi.fn(async () => ({ ok: true })),
  remove: vi.fn(async () => ({ ok: true })),
  saveFromCard: vi.fn(async () => ({ ok: true, id: 'app:x' })),
  aiRead: vi.fn(async () => ({ ok: false, reason: 'disabled' })),
  aiReadFile: vi.fn(async () => ({ ok: false, reason: 'outside' })),
  copyToMine: vi.fn(async () => ({ ok: false, reason: 'exists' })),
  prepare: vi.fn(async (source: { kind: string }) => ({
    origin: source.kind === 'text' ? { kind: 'text' } : { kind: source.kind, file: 'f' },
    root: 'r',
    candidates: [],
    rootLicense: undefined,
    tempDir: undefined,
  })),
  exportBundleTo: vi.fn(async () => ({ ok: true, path: 'p' })),
}

const { registerUserSkillsIpc } = await import('../src/main/user-skills/user-skills-ipc')
const { userSkillsManageGate } = await import('../src/main/agent/agent-skills')
const openSettings = vi.fn()
const ipc = registerUserSkillsIpc({
  service: service as unknown as UserSkillsService,
  canManage: userSkillsManageGate({
    isMainWindow: (sender) => sender === (settings as unknown),
    isAgentWindow: (sender) => sender === (agent as unknown),
  }),
  openSettings,
  agentNoticeDue: () => true,
  markAgentNoticeSeen: () => undefined,
})

const call = (channel: string, sender: object, ...args: unknown[]) =>
  mocks.handlers.get(channel)!({ sender }, ...args)

beforeEach(() => {
  mocks.sent.length = 0
  for (const fn of Object.values(service)) fn.mockClear()
})

describe('who may do what', () => {
  it('refuses changes from an editor window', async () => {
    expect(await call(C.setState, editor, 'app:a', { enabled: false })).toEqual({
      ok: false,
      reason: 'not-allowed',
    })
    expect(await call(C.remove, editor, 'app:a')).toMatchObject({ reason: 'not-allowed' })
    expect(await call(C.importGitHub, editor, 'owner/repo')).toMatchObject({
      reason: 'not-allowed',
    })
    expect(service.setState).not.toHaveBeenCalled()
    expect(service.remove).not.toHaveBeenCalled()
  })

  it('lets the agent window make only the install-preview calls', async () => {
    expect(await call(C.setState, agent, 'app:a', { enabled: false })).toMatchObject({
      reason: 'not-allowed',
    })
    expect(await call(C.remove, agent, 'app:a')).toMatchObject({ reason: 'not-allowed' })
    expect(await call(C.copyToMine, agent, 'app:a')).toMatchObject({ reason: 'not-allowed' })
    expect(await call(C.importFolder, agent)).toMatchObject({ reason: 'not-allowed' })
    expect(await call(C.checkUpdate, agent, 'app:a')).toMatchObject({ reason: 'not-allowed' })
    // past the gate: a token the agent window never previewed is not found
    expect(await call(C.install, agent, { token: 't', selected: ['k'] })).toMatchObject({
      reason: 'not-found',
    })
    expect(await call(C.cancelImport, agent, 't')).toEqual({ ok: true })
    expect(service.setState).not.toHaveBeenCalled()
    expect(service.remove).not.toHaveBeenCalled()
    expect(service.copyToMine).not.toHaveBeenCalled()
  })

  it('lets the settings screen change a state and tells every window', async () => {
    expect(await call(C.setState, settings, 'app:a', { enabled: false })).toEqual({ ok: true })
    expect(service.setState).toHaveBeenCalledWith('app:a', { enabled: false })
    expect(mocks.sent.map((entry) => entry.channel)).toEqual([C.changed, C.changed])
  })

  it('lets any window save a card and read for the AI', async () => {
    const input = { title: 'T', name: 'n', description: 'd', body: 'b', invoke: 'auto' }
    expect(await call(C.saveFromCard, editor, input)).toEqual({ ok: true, id: 'app:x' })
    expect(await call(C.aiRead, editor, 'user:a')).toEqual({ ok: false, reason: 'disabled' })
    expect(await call(C.aiReadFile, editor, 'app:a', '../x.md')).toEqual({
      ok: false,
      reason: 'outside',
    })
    await call(C.openSettings, editor)
    expect(openSettings).toHaveBeenCalledTimes(1)
    expect(await call(C.agentNotice, editor)).toBe(true)
  })

  it('refuses malformed requests before the service', async () => {
    expect(await call(C.setState, settings, 'no-colon', { enabled: true })).toMatchObject({
      reason: 'invalid',
    })
    expect(await call(C.setState, settings, 'app:a', { color: 'red' })).toMatchObject({
      reason: 'invalid',
    })
    expect(await call(C.saveFromCard, editor, { title: 'T' })).toMatchObject({ reason: 'invalid' })
    expect(await call(C.aiReadFile, editor, 'app:a', 5)).toMatchObject({ reason: 'invalid' })
    expect(service.setState).not.toHaveBeenCalled()
    expect(service.saveFromCard).not.toHaveBeenCalled()
  })

  it('does not broadcast a refused change', async () => {
    expect(await call(C.copyToMine, settings, 'user:a', false)).toEqual({
      ok: false,
      reason: 'exists',
    })
    expect(mocks.sent).toEqual([])
  })

  it('answers an install with an unknown token as not found', async () => {
    expect(
      await call(C.install, settings, { token: 'nope', selected: [], onCollision: {} }),
    ).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('skills dropped on a window and pasted text', () => {
  it('keeps a dropped file for the settings screen, which previews it once', async () => {
    ipc.queueDropped({ kind: 'zip', file: 'C:/dl/pack.zip' })
    expect(mocks.sent.map((entry) => entry.channel)).toEqual([C.dropped, C.dropped])
    expect(await call(C.takeDropped, editor)).toMatchObject({ reason: 'not-allowed' })
    expect(await call(C.takeDropped, agent)).toMatchObject({ reason: 'not-allowed' })
    const taken = (await call(C.takeDropped, settings)) as {
      ok: boolean
      preview: { origin: { kind: string } } | null
    }
    expect(taken.ok).toBe(true)
    expect(taken.preview?.origin).toEqual({ kind: 'zip' })
    expect(service.prepare).toHaveBeenCalledWith({ kind: 'zip', file: 'C:/dl/pack.zip' })
    expect(await call(C.takeDropped, settings)).toEqual({ ok: true, preview: null })
  })

  it('previews pasted text from the settings screen only, and refuses what is not text', async () => {
    expect(await call(C.importText, editor, '---\nname: a\n---')).toMatchObject({
      reason: 'not-allowed',
    })
    expect(await call(C.importText, settings, 42)).toMatchObject({ reason: 'invalid' })
    expect(await call(C.importText, settings, 'x'.repeat(2_000_001))).toMatchObject({
      reason: 'invalid',
    })
    const answer = (await call(C.importText, settings, '---\nname: a\n---')) as {
      preview: { origin: unknown }
    }
    expect(answer.preview.origin).toEqual({ kind: 'text' })
    expect(service.prepare).toHaveBeenCalledTimes(1)
    expect(service.prepare).toHaveBeenCalledWith({ kind: 'text', text: '---\nname: a\n---' })
  })

  it('refuses a bundle export without skill identifiers before asking where to save', async () => {
    expect(await call(C.exportBundle, settings, [])).toMatchObject({ reason: 'invalid' })
    expect(await call(C.exportBundle, settings, ['no-colon'])).toMatchObject({ reason: 'invalid' })
    expect(await call(C.exportBundle, editor, ['app:a'])).toMatchObject({ reason: 'not-allowed' })
    // the save dialog of this test is cancelled
    expect(await call(C.exportBundle, settings, ['app:a', 'app:b'])).toMatchObject({
      reason: 'cancelled',
    })
    expect(service.exportBundleTo).not.toHaveBeenCalled()
  })
})
