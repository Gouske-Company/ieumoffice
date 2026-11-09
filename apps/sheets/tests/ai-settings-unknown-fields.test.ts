/**
 * ai-settings.json is shared with newer builds and the other editors, so it can
 * hold fields this build does not know. The standalone sheets main must still
 * hand its renderer settings the strict IPC schema accepts, save them, and run
 * AI requests with them, and a save must leave the unknown fields in the file
 * with the keys sealed. The subscription service and the spreadsheet engine are
 * mocked; no request leaves the process (no subscription is ready).
 */
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { setAiSecretCodec, type AiSettings } from '@genoffice/ai-provider'
import { aiSettingsInputSchema } from '../src/shared/desktop-api'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown

const state = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, Handler>(),
  lastContents: null as unknown,
}))

class FakeContents extends EventEmitter {
  id = 952
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

const KEY = 'sk-test-plain-key-5678'
const codec = {
  seal: (plain: string) => `sealed:v1:${Buffer.from(plain).toString('base64')}`,
  open: (sealed: string) => Buffer.from(sealed.slice('sealed:v1:'.length), 'base64').toString(),
}
const settingsFile = () => join(state.userData, 'ai-settings.json')
const event = () => ({ sender: state.lastContents })
const handler = (channel: string) => state.handlers.get(channel)!

/** a file a newer build wrote: a field it added at the top, one in a provider, and a numeric level */
const newerFile = () => ({
  provider: 'auto',
  futureTop: { mode: 'x', count: 2 },
  providers: {
    openai: {
      apiKey: codec.seal(KEY),
      model: 'gpt-5.6-terra',
      futureField: 'kept',
      effort: 3,
    },
  },
})

beforeAll(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'sheets-unknown-fields-'))
  createSheetsView({ includeAiHandlers: true })
})
afterEach(() => setAiSecretCodec(null))
afterAll(() => rmSync(state.userData, { recursive: true, force: true }))

async function rendererCopy(): Promise<AiSettings> {
  const settings = await handler(IPC_CHANNELS.aiGetSettings)(event())
  return JSON.parse(JSON.stringify(settings)) as AiSettings
}

it('hands the renderer settings the strict schema accepts', async () => {
  setAiSecretCodec(codec)
  writeFileSync(settingsFile(), JSON.stringify(newerFile()))

  const settings = await rendererCopy()
  expect(aiSettingsInputSchema.safeParse(settings).error).toBeUndefined()
  expect(settings.providers.openai).toMatchObject({ apiKey: KEY, model: 'gpt-5.6-terra' })
  expect(settings.providers.openai?.effort).toBeUndefined()
})

it('runs AI requests with those settings', async () => {
  setAiSecretCodec(codec)
  writeFileSync(settingsFile(), JSON.stringify(newerFile()))
  const settings = await rendererCopy()

  await expect(
    handler(IPC_CHANNELS.aiChat)(event(), { settings, system: 's', user: 'u' }),
  ).resolves.toMatchObject({ ok: false })
  await expect(
    handler(IPC_CHANNELS.aiStream)(event(), {
      requestId: 'r1',
      settings,
      system: 's',
      messages: [{ role: 'user', text: 'u' }],
    }),
  ).resolves.toBeUndefined()
})

it('saves them and leaves the fields it does not know in the file, keys sealed', async () => {
  setAiSecretCodec(codec)
  writeFileSync(settingsFile(), JSON.stringify(newerFile()))
  const settings = await rendererCopy()

  await handler(IPC_CHANNELS.aiSetSettings)(event(), { ...settings, internetTools: false })

  const text = readFileSync(settingsFile(), 'utf8')
  const written = JSON.parse(text) as Record<string, unknown> & AiSettings
  expect(written.internetTools).toBe(false)
  expect(written.futureTop).toEqual({ mode: 'x', count: 2 })
  expect(written.providers.openai).toMatchObject({
    apiKey: codec.seal(KEY),
    model: 'gpt-5.6-terra',
    futureField: 'kept',
  })
  expect(text).not.toContain(KEY)
})
