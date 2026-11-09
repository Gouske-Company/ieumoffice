/**
 * The provider row of the document jobs' confirmations: what it lists, how it
 * marks a subscription that is not connected or is turned off in this app, and
 * that a key provider is listed only once its key is filled in.
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeAiSettings,
  type AiSettings,
  type AiSubscriptionState,
  type SubscriptionStatusMap,
} from '@genoffice/ai-provider/browser'
import { jobProviderOptions, withJobProvider } from '../src/renderer/doc-jobs/JobProviderSelect'

const status = (provider: 'claude-code' | 'chatgpt' | 'codex', state: AiSubscriptionState) => ({
  provider,
  state,
  meteredAccepted: false,
  ...(state === 'ready' ? { loginMethod: 'subscription' as const } : {}),
})

const statusesOf = (
  claude: AiSubscriptionState,
  codex: AiSubscriptionState,
  chatgpt?: AiSubscriptionState,
) =>
  ({
    'claude-code': status('claude-code', claude),
    codex: status('codex', codex),
    ...(chatgpt ? { chatgpt: status('chatgpt', chatgpt) } : {}),
  }) as SubscriptionStatusMap

const settingsOf = (over: Partial<AiSettings> = {}): AiSettings => ({
  ...normalizeAiSettings({}),
  provider: 'auto',
  ...over,
})

const notConnected = (name: string) => `${name} (not connected)`
const list = (settings: AiSettings, statuses: SubscriptionStatusMap) =>
  jobProviderOptions(settings, statuses, 'en', notConnected)

describe('job provider row: options', () => {
  it('lists automatic and every subscription, marking those not connected', () => {
    const { options, value } = list(settingsOf(), statusesOf('ready', 'signed-out', 'signed-out'))
    expect(value).toBe('auto')
    expect(options.map((o) => o.value)).toEqual(['auto', 'claude-code', 'chatgpt', 'codex'])
    expect(options[0]!.label).toContain('Claude')
    const byValue = (v: string) => options.find((o) => o.value === v)!
    expect(byValue('claude-code')).toMatchObject({ label: 'Claude', notConnected: false })
    expect(byValue('chatgpt')).toMatchObject({
      label: 'ChatGPT (not connected)',
      notConnected: true,
    })
    expect(byValue('codex')).toMatchObject({ label: 'Codex (not connected)', notConnected: true })
  })

  it('does not call a program not connected while it is still being checked', () => {
    const { options } = list(settingsOf(), statusesOf('checking', 'checking', 'checking'))
    for (const o of options.filter((o) => o.value !== 'auto')) {
      expect(o.notConnected).toBe(false)
      expect(o.label).not.toContain('not connected')
    }
  })

  it('shows a program turned off in this app as off, and does not offer it', () => {
    const settings = settingsOf({ subscriptionOff: { codex: true } })
    // a status read before the switch was turned can still say ready
    const { options } = list(settings, statusesOf('ready', 'ready', 'signed-out'))
    const codex = options.find((o) => o.value === 'codex')!
    expect(codex.off).toBe(true)
    expect(codex.notConnected).toBe(false)
    expect(codex.label).toBe('Codex · Off in this app')
    expect(options.filter((o) => o.off).map((o) => o.value)).toEqual(['codex'])
  })

  it('keeps an off program readable when it is the stored choice', () => {
    const settings = settingsOf({ provider: 'codex', subscriptionOff: { codex: true } })
    const { options, value } = list(settings, statusesOf('ready', 'off', 'signed-out'))
    expect(value).toBe('codex')
    expect(options.filter((o) => o.value === 'codex')).toHaveLength(1)
    expect(options.find((o) => o.value === 'codex')!.off).toBe(true)
  })

  it('lists a key provider only once its key is filled in', () => {
    const empty = list(settingsOf(), statusesOf('ready', 'ready'))
    expect(empty.options.some((o) => o.value === 'openai')).toBe(false)
    const base = settingsOf()
    const filled = settingsOf({
      providers: { ...base.providers, openai: { apiKey: 'sk-test', model: 'gpt-test' } },
    })
    const { options, value } = list(filled, statusesOf('ready', 'ready'))
    // having a key never makes "automatic" run on it
    expect(value).toBe('auto')
    expect(options.find((o) => o.value === 'auto')!.label).toContain('Claude')
    expect(options.find((o) => o.value === 'openai')).toMatchObject({
      label: 'OpenAI',
      notConnected: false,
      off: false,
    })
  })

  it('marks an accepted metered login as paid', () => {
    const settings = settingsOf({ meteredAccepted: { 'claude-code': true, codex: false } })
    const statuses = {
      ...statusesOf('metered', 'signed-out'),
      'claude-code': { ...status('claude-code', 'metered'), meteredAccepted: true },
    } as SubscriptionStatusMap
    const claude = list(settings, statuses).options.find((o) => o.value === 'claude-code')!
    expect(claude.label).toBe('Claude · Paid')
    expect(claude.notConnected).toBe(false)
  })

  it('lists a stored key provider whose key was removed, as not connected', () => {
    const { options, value } = list(
      settingsOf({ provider: 'openai' }),
      statusesOf('ready', 'ready'),
    )
    expect(value).toBe('openai')
    expect(options.find((o) => o.value === 'openai')).toMatchObject({
      label: 'OpenAI (not connected)',
      notConnected: true,
    })
  })
})

describe('job provider row: choosing', () => {
  it('keeps the model each provider was set to', () => {
    const base = settingsOf()
    const settings = settingsOf({
      providers: { ...base.providers, codex: { apiKey: '', model: 'gpt-x' } },
    })
    const codex = withJobProvider(settings, { provider: 'codex' })
    expect(codex.provider).toBe('codex')
    expect(codex.providers.codex?.model).toBe('gpt-x')
    expect(withJobProvider(codex, { provider: 'auto' }).provider).toBe('auto')
  })
})
