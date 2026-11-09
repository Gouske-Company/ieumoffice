// @vitest-environment node
/**
 * The slides main saves the renderer's AI settings on ai:set-settings, but
 * only the Settings card turns a vendor CLI off or on (decision 0114) and only
 * the main process lists a key provider's models (decision 0087): the file's
 * switch and lists survive a save from a renderer that read the settings
 * before they changed. The subscription service is mocked.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { setAiSecretCodec, type AiSettings } from '@genoffice/ai-provider'

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown

const state = vi.hoisted(() => ({
  userData: '',
  handlers: new Map<string, Handler>(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? state.userData : tmpdir()),
    getName: () => 'slides-test',
    getVersion: () => '0',
    once: () => {},
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => state.handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  nativeImage: {},
  net: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))

// The shaping chain loads a harfbuzz wasm that cannot resolve in the unit-test env;
// nothing here renders text.
vi.mock('../src/main/shaped-metrics', () => ({
  shapedMetricsReady: async () => {},
  refineComplexWidths: async () => {},
  complexScriptOf: () => null,
  initShapedMetrics: () => {},
  gtMeasure: (t: string) => ({ width: t.length * 8 }),
  shapedFamily: () => null,
  shapedMeasure: () => ({ width: 0 }),
}))

vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
}))

import { registerAiIpc } from '../src/main/ai-ipc'

const settingsFile = () => join(state.userData, 'ai-settings.json')
const onDisk = () => JSON.parse(readFileSync(settingsFile(), 'utf8')) as AiSettings
const event = { sender: { id: 1, isDestroyed: () => false, send: () => {} } }

beforeAll(() => {
  state.userData = mkdtempSync(join(tmpdir(), 'slides-subscription-off-'))
  registerAiIpc()
})
afterEach(() => setAiSecretCodec(null))
afterAll(() => rmSync(state.userData, { recursive: true, force: true }))

async function savedFrom(
  renderer: AiSettings,
  stored: Record<string, unknown>,
): Promise<AiSettings> {
  writeFileSync(settingsFile(), JSON.stringify({ provider: 'auto', providers: {}, ...stored }))
  await state.handlers.get('ai:set-settings')!(event, JSON.parse(JSON.stringify(renderer)))
  return onDisk()
}

async function rendererCopy(stored: Record<string, unknown>): Promise<AiSettings> {
  writeFileSync(settingsFile(), JSON.stringify({ provider: 'auto', providers: {}, ...stored }))
  return (await state.handlers.get('ai:get-settings')!(event)) as AiSettings
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

it('keeps the fields a newer build wrote, and the key sealed, when a renderer saves', async () => {
  const key = 'sk-test-plain-key-9012'
  const codec = {
    seal: (plain: string) => `sealed:v1:${Buffer.from(plain).toString('base64')}`,
    open: (sealed: string) => Buffer.from(sealed.slice('sealed:v1:'.length), 'base64').toString(),
  }
  setAiSecretCodec(codec)
  const newer = {
    futureTop: { mode: 'x' },
    providers: { openai: { apiKey: codec.seal(key), model: 'm', futureField: 'kept', effort: 3 } },
  }
  const copy = await rendererCopy(newer)
  expect(copy.providers.openai).toEqual({ apiKey: key, model: 'm' })

  const written = (await savedFrom({ ...copy, internetTools: false }, newer)) as AiSettings &
    Record<string, unknown>
  expect(written.internetTools).toBe(false)
  expect(written.futureTop).toEqual({ mode: 'x' })
  expect(written.providers.openai).toMatchObject({ apiKey: codec.seal(key), futureField: 'kept' })
  expect(readFileSync(settingsFile(), 'utf8')).not.toContain(key)
})

it("keeps each key provider's live model list when a renderer saves without it", async () => {
  const key = 'sk-test-plain-key-3456'
  const codec = {
    seal: (plain: string) => `sealed:v1:${Buffer.from(plain).toString('base64')}`,
    open: (sealed: string) => Buffer.from(sealed.slice('sealed:v1:'.length), 'base64').toString(),
  }
  setAiSecretCodec(codec)
  const models = ['gpt-live-a', 'gpt-live-b']
  const modelEfforts = { 'gpt-live-a': { efforts: ['low', 'high'] } }
  const file = {
    futureTop: { mode: 'x' },
    subscriptionOff: { codex: true },
    providers: { openai: { apiKey: codec.seal(key), model: 'gpt-live-a', models, modelEfforts } },
  }
  const copy = await rendererCopy(file)
  const { models: _models, modelEfforts: _efforts, ...openai } = copy.providers.openai!
  const renderer = { ...copy, internetTools: false, providers: { ...copy.providers, openai } }

  const written = (await savedFrom(renderer, file)) as AiSettings & Record<string, unknown>
  expect(written.internetTools).toBe(false)
  expect(written.providers.openai).toMatchObject({ apiKey: codec.seal(key), models, modelEfforts })
  expect(written.subscriptionOff).toEqual({ codex: true })
  expect(written.futureTop).toEqual({ mode: 'x' })
  expect(readFileSync(settingsFile(), 'utf8')).not.toContain(key)
})
