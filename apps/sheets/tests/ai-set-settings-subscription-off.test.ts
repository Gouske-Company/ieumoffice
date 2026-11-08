/**
 * The standalone sheets main saves the renderer's AI settings on
 * ai:set-settings, but only the Settings card turns a vendor CLI off or on
 * (decision 0114): the file's switch survives a save from a renderer that read
 * the settings before the switch changed. The subscription service and the
 * spreadsheet engine are mocked.
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import type { AiSettings } from '@genoffice/ai-provider'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown

const state = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, Handler>(),
  lastContents: null as unknown,
}))

class FakeContents extends EventEmitter {
  id = 951
  isDestroyed = () => false
  setWindowOpenHandler = vi.fn()
  loadURL = vi.fn()
  send = vi.fn()
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? state.userData : tmpdir()),
    getName: () => 'sheets-test',
    getVersion: () => '0',
    getAppPath: () => tmpdir(),
    isPackaged: false,
    on: () => {},
    once: () => {},
    whenReady: () => new Promise(() => {}),
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => state.handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  WebContentsView: class {
    webContents = (state.lastContents = new FakeContents())
  },
  desktopCapturer: {},
  dialog: {},
  net: {},
  screen: {},
  session: {},
  shell: {},
  systemPreferences: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))
vi.mock('../src/main/xlsx-sidecar-client', () => ({
  XlsxSidecarClient: class {
    start(): void {}
    onProcessExit(): void {}
  },
}))
vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
}))

import { createSheetsView } from '../src/main/sheets-main'

const settingsFile = () => join(state.userData, 'ai-settings.json')
const onDisk = () => JSON.parse(readFileSync(settingsFile(), 'utf8')) as AiSettings
const event = () => ({ sender: state.lastContents })

beforeAll(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'sheets-subscription-off-'))
  createSheetsView({ includeAiHandlers: true })
})
afterAll(() => rmSync(state.userData, { recursive: true, force: true }))

async function savedFrom(
  renderer: AiSettings,
  stored: Record<string, unknown>,
): Promise<AiSettings> {
  writeFileSync(settingsFile(), JSON.stringify({ provider: 'auto', providers: {}, ...stored }))
  await state.handlers.get(IPC_CHANNELS.aiSetSettings)!(
    event(),
    JSON.parse(JSON.stringify(renderer)),
  )
  return onDisk()
}

async function rendererCopy(stored: Record<string, unknown>): Promise<AiSettings> {
  writeFileSync(settingsFile(), JSON.stringify({ provider: 'auto', providers: {}, ...stored }))
  return (await state.handlers.get(IPC_CHANNELS.aiGetSettings)!(event())) as AiSettings
}

it('keeps a CLI the file turned off when a renderer that read the settings before saves', async () => {
  const stale = await rendererCopy({})
  expect(stale.subscriptionOff).toBeUndefined()

  const written = await savedFrom(
    { ...stale, internetTools: false },
    { subscriptionOff: { 'claude-code': true } },
  )
  expect(written.internetTools).toBe(false)
  expect(written.subscriptionOff).toEqual({ 'claude-code': true })
})

it('does not turn a CLI off because a renderer says so', async () => {
  const stale = await rendererCopy({ subscriptionOff: { codex: true } })
  expect(stale.subscriptionOff).toEqual({ codex: true })

  const written = await savedFrom({ ...stale, internetTools: false }, {})
  expect(written.internetTools).toBe(false)
  expect(written.subscriptionOff).toBeUndefined()
})
