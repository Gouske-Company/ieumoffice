// @vitest-environment node
/**
 * The in-app switch that turns a subscription CLI off (decision 0114) lives in
 * ai-settings.json beside the key providers' sealed keys (decision 0063). Every
 * write the docs main makes must keep both: a window saving a copy it read
 * before the switch moved, the switch itself, and the metered "use anyway"
 * answer. The subscription service, the CLIs and the network are mocked.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { setAiSecretCodec, type AiSettings } from '@genoffice/ai-provider'

type Handler = (event: unknown, ...args: unknown[]) => unknown
type Cli = 'claude-code' | 'codex'
type Setup = {
  setMeteredAccepted: (provider: Cli, accepted: boolean) => unknown
  setSubscriptionOff: (provider: Cli, off: boolean) => unknown
}

const state = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, Handler>(),
  setup: null as Setup | null,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? state.userData : tmpdir()),
    getName: () => 'docs-test',
    getVersion: () => '0',
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
  WebContentsView: class {},
  clipboard: {},
  dialog: {},
  nativeImage: {},
  net: {},
  session: {},
  shell: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))
vi.mock('@genoffice/ai-search', () => ({
  createCodexImageCliGenerator: () => async () => ({ bytes: new Uint8Array(), mime: 'image/png' }),
  registerCodexImageGenerator: () => {},
}))
vi.mock('@genoffice/ai-provider/subscription', () => ({
  ensureSubscriptionIpc: (_ipc: unknown, setup: Setup) => {
    state.setup = setup
    return {}
  },
  sharedSubscriptionStatuses: () => ({}),
}))
vi.mock('@genoffice/ai-provider/codex-app-server', () => ({
  shutdownCodexAppServers: () => {},
}))
vi.mock('@genoffice/ai-provider/custom-models', () => ({}))
vi.mock('../src/main/lazy-media', () => ({ readLazyMedia: async () => null }))
vi.mock('../src/main/lazy-media-inline', () => ({}))

import { registerAiIpc } from '../src/main/docs-main'

const KEY = 'sk-test-plain-key-5678'
const codec = {
  seal: (plain: string) => `sealed:v1:${Buffer.from(plain).toString('base64')}`,
  open: (sealed: string) => Buffer.from(sealed.slice('sealed:v1:'.length), 'base64').toString(),
}
const settingsFile = () => join(state.userData, 'ai-settings.json')
const seed = (extra: Record<string, unknown>) =>
  writeFileSync(
    settingsFile(),
    JSON.stringify({
      provider: 'auto',
      providers: { custom: { apiKey: codec.seal(KEY), baseUrl: 'https://example.invalid/v1' } },
      ...extra,
    }),
  )
const onDisk = () => {
  const text = readFileSync(settingsFile(), 'utf8')
  return { text, written: JSON.parse(text) as AiSettings }
}
const read = async () => (await state.handlers.get('ai:get-settings')!({})) as AiSettings

beforeAll(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'docs-subscription-off-seal-'))
  vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in this test')))
  registerAiIpc()
})
afterEach(() => setAiSecretCodec(null))
afterAll(() => {
  vi.unstubAllGlobals()
  rmSync(state.userData, { recursive: true, force: true })
})

it('keeps a CLI off and the key sealed when a window saves a copy read before the switch', async () => {
  setAiSecretCodec(codec)
  seed({})
  const stale = await read()
  expect(stale.subscriptionOff).toBeUndefined()
  seed({ subscriptionOff: { codex: true } })

  await state.handlers.get('ai:set-settings')!({}, { ...stale, provider: 'custom' })

  const { text, written } = onDisk()
  expect(text).not.toContain(KEY)
  expect(written.providers.custom?.apiKey).toBe(codec.seal(KEY))
  expect(written.provider).toBe('custom')
  expect(written.subscriptionOff).toEqual({ codex: true })
  const back = await read()
  expect(back.providers.custom?.apiKey).toBe(KEY)
  expect(back.subscriptionOff).toEqual({ codex: true })
})

it('does not let a window turn a CLI off by sending the switch itself', async () => {
  setAiSecretCodec(codec)
  seed({})
  const copy = await read()

  await state.handlers.get('ai:set-settings')!({}, { ...copy, subscriptionOff: { codex: true } })

  expect(onDisk().written.subscriptionOff).toBeUndefined()
})

it.each([true, false])('keeps the key sealed when the switch turns Claude off: %s', async (off) => {
  setAiSecretCodec(codec)
  seed({ subscriptionOff: { codex: true } })

  await state.setup!.setSubscriptionOff('claude-code', off)

  const { text, written } = onDisk()
  expect(text).not.toContain(KEY)
  expect(written.providers.custom?.apiKey).toBe(codec.seal(KEY))
  expect(written.subscriptionOff).toEqual(
    off ? { codex: true, 'claude-code': true } : { codex: true },
  )
})

it('keeps a CLI off when the metered "use anyway" answer is written', async () => {
  setAiSecretCodec(codec)
  seed({ subscriptionOff: { codex: true } })

  await state.setup!.setMeteredAccepted('claude-code', true)

  const { text, written } = onDisk()
  expect(text).not.toContain(KEY)
  expect(written.meteredAccepted?.['claude-code']).toBe(true)
  expect(written.subscriptionOff).toEqual({ codex: true })
})

it('keeps the fields a newer build wrote, and the key sealed, on every write', async () => {
  setAiSecretCodec(codec)
  const newer = {
    futureTop: { mode: 'x' },
    providers: {
      custom: {
        apiKey: codec.seal(KEY),
        baseUrl: 'https://example.invalid/v1',
        futureField: 'kept',
        effort: 3,
      },
    },
  }
  seed(newer)
  const copy = await read()
  expect(copy.providers.custom).not.toHaveProperty('futureField')
  expect(copy.providers.custom).not.toHaveProperty('effort')

  await state.handlers.get('ai:set-settings')!({}, { ...copy, internetTools: false })
  await state.setup!.setMeteredAccepted('codex', true)

  const { text, written } = onDisk()
  expect(text).not.toContain(KEY)
  expect(written.internetTools).toBe(false)
  expect(written.meteredAccepted?.codex).toBe(true)
  expect((written as unknown as Record<string, unknown>).futureTop).toEqual({ mode: 'x' })
  expect(written.providers.custom).toMatchObject({
    apiKey: codec.seal(KEY),
    futureField: 'kept',
  })
})
