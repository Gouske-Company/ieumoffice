import { describe, expect, it, vi } from 'vitest'

import {
  AiRunError,
  AiTimeoutError,
  HEADLESS_SUBSCRIPTION_CONSENT_VERSION,
  defaultAiSettings,
  type AiCustomEndpoint,
  type AiLocalModelProfile,
  type AiMediaProviderConfig,
  type AiMediaSettings,
  type AiModelEffort,
  type AiProviderConfig,
  type AiSettings,
  type AiStreamChunk,
  type AiSubscriptionStatus,
  type AiSubscriptionStatuses,
} from '@genoffice/ai-provider'
import {
  aiRunBlockChunk,
  aiSettingsFromStored,
  aiStreamErrorChunk,
  resolveAiRunTarget,
  subscriptionStreamCallbacks,
  withMeteredAccepted,
} from '../src/main/ai-run'
import {
  aiChatRequestSchema,
  aiSettingsInputSchema,
  aiStreamRequestSchema,
  type AiSettingsInput,
} from '../src/shared/desktop-api'

function status(
  provider: AiSubscriptionStatus['provider'],
  state: AiSubscriptionStatus['state'],
  meteredAccepted = false,
): AiSubscriptionStatus {
  return { provider, state, meteredAccepted }
}

const BOTH_READY: AiSubscriptionStatuses = {
  'claude-code': status('claude-code', 'ready'),
  codex: status('codex', 'ready'),
}

/**
 * A settings file as the app writes it. A file without the provider table is
 * a pre-provider one and reads as defaults, so every stored fixture has it.
 */
function file(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { providers: {}, ...fields }
}

function withKeyProvider(): AiSettings {
  const settings = defaultAiSettings()
  return {
    ...settings,
    provider: 'anthropic',
    providers: {
      ...settings.providers,
      anthropic: { apiKey: 'sk-test', model: 'claude-sonnet-4-5' },
    },
  }
}

describe('aiSettingsFromStored (ai:get-settings)', () => {
  it('reads a file from before the subscription providers as automatic, without the switch that was removed', () => {
    const settings = aiSettingsFromStored(
      file({ provider: 'retired-provider', retiredSwitch: false }),
    )
    expect(settings.provider).toBe('auto')
    expect('retiredSwitch' in settings).toBe(false)
    expect(settings.media?.imageProvider).toBe('codex')
    expect(settings.search?.provider).toBe('parallel')
  })

  it('keeps an explicit subscription selection instead of replacing it', () => {
    expect(aiSettingsFromStored(file({ provider: 'claude-code' })).provider).toBe('claude-code')
    expect(aiSettingsFromStored(file({ provider: 'codex' })).provider).toBe('codex')
  })

  it('keeps a half-filled key provider selected: nothing else is picked for the user', () => {
    const stored = { provider: 'openai', providers: { openai: { apiKey: '', model: '' } } }
    expect(aiSettingsFromStored(stored).provider).toBe('openai')
  })

  it('never throws on a broken file', () => {
    expect(aiSettingsFromStored('not an object').provider).toBe('auto')
    expect(aiSettingsFromStored(null).provider).toBe('auto')
    expect(aiSettingsFromStored(file({ provider: 'no-such-provider' })).provider).toBe('auto')
  })

  it('returns settings the strict ai:set-settings schema accepts', () => {
    const settings = aiSettingsFromStored(
      file({ provider: 'codex', meteredAccepted: { codex: true }, subscriptionNoticeSeen: true }),
    )
    const parsed = aiSettingsInputSchema.parse(JSON.parse(JSON.stringify(settings)))
    expect(parsed.meteredAccepted).toEqual({ 'claude-code': false, codex: true })
    expect(parsed.subscriptionNoticeSeen).toBe(true)
    expect(parsed.headlessSubscriptionEnabled).toBe(false)
    expect(parsed.headlessSubscriptionConsentVersion).toBe(0)
    // a switch turned on with the current consent goes through the schema as it is
    const on = aiSettingsFromStored(
      file({
        headlessSubscriptionEnabled: true,
        headlessSubscriptionConsentVersion: HEADLESS_SUBSCRIPTION_CONSENT_VERSION,
      }),
    )
    expect(aiSettingsInputSchema.parse(JSON.parse(JSON.stringify(on)))).toMatchObject({
      headlessSubscriptionEnabled: true,
      headlessSubscriptionConsentVersion: HEADLESS_SUBSCRIPTION_CONSENT_VERSION,
    })
  })
})

/** A field of the settings type the strict schema leaves out; a file that carries it is refused */
type Unnamed<Type, Input> = [Exclude<keyof Type, keyof NonNullable<Input>>] extends [never]
  ? true
  : Exclude<keyof Type, keyof NonNullable<Input>>
type InputEndpoint = NonNullable<AiSettingsInput['customEndpoints']>[number]
// fails to compile, naming the field, when the settings type grows one the schema does not take
const everyFieldNamed: [
  Unnamed<AiSettings, AiSettingsInput>,
  Unnamed<AiProviderConfig, AiSettingsInput['providers'][string]>,
  Unnamed<AiModelEffort, NonNullable<AiSettingsInput['providers'][string]['modelEfforts']>[string]>,
  Unnamed<AiCustomEndpoint, InputEndpoint>,
  Unnamed<AiLocalModelProfile, NonNullable<InputEndpoint['modelProfiles']>[string]>,
  Unnamed<AiMediaSettings, AiSettingsInput['media']>,
  Unnamed<AiMediaProviderConfig, NonNullable<AiSettingsInput['media']>['providers'][string]>,
] = [true, true, true, true, true, true, true]

describe('the strict settings schema of the standalone sheets editor', () => {
  it('names every field of the settings type', () => {
    expect(everyFieldNamed.every((named) => named === true)).toBe(true)
  })

  // every field the app writes, as another editor or the Settings window leaves the file
  const written = file({
    provider: 'claude-code',
    providers: {
      'claude-code': { apiKey: '', model: 'opus', effort: 'high' },
      openai: {
        apiKey: 'sk-test',
        model: 'gpt-5.5',
        models: ['gpt-5.5'],
        modelEfforts: { 'gpt-5.5': { efforts: ['low', 'high'], defaultEffort: 'low' } },
      },
    },
    customEndpoints: [
      {
        id: 'local-1',
        name: 'Ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: '',
        model: 'qwen3',
        kind: 'local',
        effort: 'low',
        modelProfiles: { qwen3: { contextLength: 8192, efforts: ['low', 'high'] } },
      },
    ],
    customEndpoint: 'local-1',
    subscriptionOff: { 'claude-code': true },
    readUrl: { githubToken: 'ghp_test' },
    internetTools: false,
  })

  it('accepts settings read from a file that carries every field the app writes', () => {
    const settings = aiSettingsFromStored(written)
    const parsed = aiSettingsInputSchema.parse(JSON.parse(JSON.stringify(settings)))
    expect(parsed.subscriptionOff).toEqual({ 'claude-code': true })
    expect(parsed.readUrl).toEqual({ githubToken: 'ghp_test' })
    expect(parsed.internetTools).toBe(false)
    expect(parsed.providers['claude-code']?.effort).toBe('high')
    expect(parsed.providers.openai?.modelEfforts).toEqual({
      'gpt-5.5': { efforts: ['low', 'high'], defaultEffort: 'low' },
    })
  })

  it('takes the same settings on ai:chat and ai:stream requests', () => {
    const settings = JSON.parse(JSON.stringify(aiSettingsFromStored(written))) as unknown
    expect(() => aiChatRequestSchema.parse({ settings, system: 's', user: 'u' })).not.toThrow()
    expect(() =>
      aiStreamRequestSchema.parse({ requestId: 'r1', settings, system: 's', messages: [] }),
    ).not.toThrow()
  })

  it('turns off only a vendor CLI, and only with a literal true', () => {
    const base = JSON.parse(JSON.stringify(aiSettingsFromStored(file()))) as Record<string, unknown>
    expect(
      aiSettingsInputSchema.parse({ ...base, subscriptionOff: { codex: true } }).subscriptionOff,
    ).toEqual({ codex: true })
    for (const subscriptionOff of [{ chatgpt: true }, { codex: false }, { codex: 'yes' }]) {
      expect(() => aiSettingsInputSchema.parse({ ...base, subscriptionOff })).toThrow()
    }
  })
})

describe('resolveAiRunTarget', () => {
  it('runs automatic on Claude when both subscriptions are ready', () => {
    const target = resolveAiRunTarget({}, BOTH_READY)
    expect(target.ok && target.provider).toBe('claude-code')
  })

  it('runs automatic on Codex when Claude is only a metered login', () => {
    const target = resolveAiRunTarget(file({ meteredAccepted: { 'claude-code': true } }), {
      'claude-code': status('claude-code', 'metered', true),
      codex: status('codex', 'ready'),
    })
    expect(target.ok && target.provider).toBe('codex')
  })

  it('reports not-connected for automatic when no subscription is ready, even with a key filled in', () => {
    const stored = { ...withKeyProvider(), provider: 'auto' }
    const target = resolveAiRunTarget(stored, {
      'claude-code': status('claude-code', 'signed-out'),
      codex: status('codex', 'not-installed'),
    })
    expect(target.ok).toBe(false)
    if (target.ok) return
    expect(target.block.errorCode).toBe('not-connected')
    expect(target.block.errorProvider).toBeUndefined()
  })

  it('reports not-connected before any status was read', () => {
    const target = resolveAiRunTarget({}, {})
    expect(target.ok).toBe(false)
    if (!target.ok) expect(target.block.errorCode).toBe('not-connected')
  })

  it('reads a provider id this build does not know as automatic', () => {
    const target = resolveAiRunTarget(file({ provider: 'retired-provider' }), {
      'claude-code': status('claude-code', 'signed-out'),
      codex: status('codex', 'ready'),
    })
    expect(target.ok && target.provider).toBe('codex')
  })

  it('reports the selected subscription that cannot run and never falls back to the other one', () => {
    const target = resolveAiRunTarget(file({ provider: 'claude-code' }), {
      'claude-code': status('claude-code', 'signed-out'),
      codex: status('codex', 'ready'),
    })
    expect(target.ok).toBe(false)
    if (target.ok) return
    expect(target.block).toMatchObject({ errorCode: 'signed-out', errorProvider: 'claude-code' })
  })

  it.each([
    ['not-installed', 'not-installed'],
    ['metered', 'metered-not-accepted'],
    ['checking', 'not-connected'],
    ['error', 'not-connected'],
  ] as const)('maps a selected Codex in state %s to %s', (state, errorCode) => {
    const target = resolveAiRunTarget(file({ provider: 'codex' }), {
      codex: status('codex', state),
    })
    expect(target.ok).toBe(false)
    if (target.ok) return
    expect(target.block).toMatchObject({ errorCode, errorProvider: 'codex' })
  })

  it('runs a metered login only when both the setting and the status carry the acceptance', () => {
    const stored = file({ provider: 'codex', meteredAccepted: { codex: true } })
    const accepted = resolveAiRunTarget(stored, { codex: status('codex', 'metered', true) })
    expect(accepted.ok && accepted.provider).toBe('codex')
    // a renderer cannot grant itself the acceptance: the status of this process decides too
    const forged = resolveAiRunTarget(stored, { codex: status('codex', 'metered', false) })
    expect(forged.ok).toBe(false)
    if (!forged.ok) expect(forged.block.errorCode).toBe('metered-not-accepted')
  })

  it('runs a selected key provider on its own config, whatever the subscriptions are', () => {
    const target = resolveAiRunTarget(withKeyProvider(), BOTH_READY)
    expect(target.ok).toBe(true)
    if (!target.ok) return
    expect(target.provider).toBe('anthropic')
    expect(target.config).toMatchObject({ apiKey: 'sk-test', model: 'claude-sonnet-4-5' })
  })

  it('reports a selected key provider that is not filled in, without naming a subscription', () => {
    const target = resolveAiRunTarget(file({ provider: 'openai' }), BOTH_READY)
    expect(target.ok).toBe(false)
    if (target.ok) return
    expect(target.block.errorCode).toBe('not-connected')
    expect(target.block.errorProvider).toBeUndefined()
  })

  it('hands back the subscription config with an empty model (the program default)', () => {
    const target = resolveAiRunTarget(file({ provider: 'claude-code' }), BOTH_READY)
    expect(target.ok).toBe(true)
    if (target.ok) expect(target.config.model).toBe('')
  })
})

describe('stream chunks', () => {
  it('answers a request no provider can run with an error chunk carrying the cause', () => {
    const target = resolveAiRunTarget(file({ provider: 'codex' }), {
      codex: status('codex', 'signed-out'),
    })
    expect(target.ok).toBe(false)
    if (target.ok) return
    expect(aiRunBlockChunk('r1', target.block)).toEqual({
      requestId: 'r1',
      type: 'error',
      error: 'AI is not connected (signed-out)',
      errorCode: 'signed-out',
      errorProvider: 'codex',
    })
  })

  it('forwards the kind, provider and reset time of a run error', () => {
    const err = new AiRunError('rate-limit', 'limit reached', {
      provider: 'claude-code',
      resetsAt: 1_800_000_000_000,
    })
    expect(aiStreamErrorChunk('r2', err)).toEqual({
      requestId: 'r2',
      type: 'error',
      error: 'limit reached',
      errorCode: 'rate-limit',
      errorProvider: 'claude-code',
      errorResetsAt: 1_800_000_000_000,
    })
  })

  it('keeps the code of the existing error classes and adds none to a plain error', () => {
    expect(aiStreamErrorChunk('r3', new AiTimeoutError(180_000)).errorCode).toBe('timeout')
    expect(aiStreamErrorChunk('r4', new Error('boom'))).toEqual({
      requestId: 'r4',
      type: 'error',
      error: 'boom',
    })
    expect(aiStreamErrorChunk('r5', 'text only').error).toBe('text only')
  })

  it('forwards subscription usage and a cut input as their own chunk types', () => {
    const sent: AiStreamChunk[] = []
    const send = vi.fn((chunk: AiStreamChunk) => void sent.push(chunk))
    const callbacks = subscriptionStreamCallbacks('r6', send)
    const usage = [
      {
        provider: 'claude-code' as const,
        window: 'five_hour' as const,
        utilization: 0.83,
        resetsAt: 1_800_000_000_000,
      },
    ]
    callbacks.onSubscriptionUsage(usage)
    callbacks.onInputTruncated()
    expect(sent).toEqual([
      { requestId: 'r6', type: 'subscription-usage', subscriptionUsage: usage },
      { requestId: 'r6', type: 'input-truncated' },
    ])
  })
})

describe('withMeteredAccepted', () => {
  it('sets the flag of one provider and keeps the selection and the other flag', () => {
    const stored = file({
      provider: 'codex',
      providers: { codex: { apiKey: '', model: 'gpt-5' } },
      meteredAccepted: { 'claude-code': true },
    })
    const next = withMeteredAccepted(stored, 'codex', true)
    expect(next.meteredAccepted).toEqual({ 'claude-code': true, codex: true })
    expect(next.provider).toBe('codex')
    expect(next.providers.codex.model).toBe('gpt-5')
    expect(stored.meteredAccepted).toEqual({ 'claude-code': true })
  })

  it('takes the acceptance back', () => {
    const next = withMeteredAccepted(file({ meteredAccepted: { codex: true } }), 'codex', false)
    expect(next.meteredAccepted).toEqual({ 'claude-code': false, codex: false })
  })

  it('writes settings that still carry the flag when read back, even from no file at all', () => {
    for (const stored of [undefined, {}, file({ meteredAccepted: 'yes' })]) {
      const written = JSON.parse(JSON.stringify(withMeteredAccepted(stored, 'claude-code', true)))
      expect(aiSettingsFromStored(written).meteredAccepted).toEqual({
        'claude-code': true,
        codex: false,
      })
      // and the strict save schema of the settings channel takes them
      expect(() => aiSettingsInputSchema.parse(written)).not.toThrow()
    }
  })
})
