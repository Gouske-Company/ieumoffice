import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AI_MEDIA_PROVIDERS,
  AI_PROVIDERS,
  HEADLESS_SUBSCRIPTION_CONSENT_VERSION,
  defaultAiSettings,
} from '@genoffice/ai-provider'
import type { AiSettings, AiSubscriptionStatus } from '@genoffice/ai-provider'
import {
  advancedPaneUseChoice,
  advancedProviderIds,
  aiSelectionChoices,
  aiSelectionValue,
  changeAiSettings,
  initialAdvancedProvider,
  mediaKeyProviders,
  mediaSelection,
  mediaSpecialChoices,
  readUrlGithubToken,
  withAiSelection,
  withHeadlessSubscription,
  withLiveSelectionFields,
  withReadUrlGithubToken,
  writeAiSettings,
} from '../src/renderer/src/settings-ai'
import {
  checkingSubscriptionStatuses,
  subscriptionLaunchResultOf,
  subscriptionStatusMapOf,
} from '../src/shared/subscription-api'

/**
 * The rules behind the AI part of Settings (src/renderer/src/settings-ai.ts):
 * which connections "AI to use" lists, what picking one writes, and which
 * choices the media blocks offer.
 */

function status(
  provider: AiSubscriptionStatus['provider'],
  state: AiSubscriptionStatus['state'],
  meteredAccepted = false,
): AiSubscriptionStatus {
  return { provider, state, meteredAccepted }
}

function settingsWith(patch: Partial<AiSettings> = {}): AiSettings {
  return { ...defaultAiSettings(), ...patch }
}

function withOpenAiKey(settings: AiSettings): AiSettings {
  return {
    ...settings,
    providers: { ...settings.providers, openai: { apiKey: 'sk-test', model: 'gpt-test' } },
  }
}

describe('"AI to use" choices', () => {
  it('always offers auto, and names what it runs on only while a subscription is ready', () => {
    const none = aiSelectionChoices(settingsWith(), checkingSubscriptionStatuses())
    expect(none.map((choice) => choice.value)).toEqual(['auto'])
    expect(none[0]!.name).toBeUndefined()

    const ready = aiSelectionChoices(settingsWith(), {
      'claude-code': status('claude-code', 'ready'),
      codex: status('codex', 'ready'),
    })
    expect(ready.map((choice) => choice.value)).toEqual(['auto', 'claude-code', 'codex'])
    expect(ready[0]!.name).toBe('Claude')
    expect(ready.every((choice) => !choice.metered && !choice.unavailable)).toBe(true)
  })

  it('never offers a metered login the user has not accepted', () => {
    const choices = aiSelectionChoices(settingsWith(), {
      'claude-code': status('claude-code', 'ready'),
      codex: status('codex', 'metered'),
    })
    expect(choices.map((choice) => choice.value)).toEqual(['auto', 'claude-code'])
  })

  it('needs the acceptance in both the settings and the status before a metered login is listed', () => {
    const statuses = {
      'claude-code': status('claude-code', 'signed-out'),
      codex: status('codex', 'metered', true),
    }
    // the status says accepted, the settings do not: a flag that outlived its login
    expect(aiSelectionChoices(settingsWith(), statuses).map((c) => c.value)).toEqual(['auto'])

    const accepted = aiSelectionChoices(
      settingsWith({ meteredAccepted: { codex: true } }),
      statuses,
    )
    expect(accepted.map((choice) => choice.value)).toEqual(['auto', 'codex'])
    expect(accepted[1]).toMatchObject({ kind: 'subscription', metered: true })
    // auto never lands on a connection that costs money
    expect(accepted[0]!.name).toBeUndefined()
  })

  it('lists a key provider only once its settings are filled in', () => {
    const statuses = checkingSubscriptionStatuses()
    expect(aiSelectionChoices(settingsWith(), statuses).map((c) => c.value)).toEqual(['auto'])
    const configured = aiSelectionChoices(withOpenAiKey(settingsWith()), statuses)
    expect(configured.map((choice) => choice.value)).toEqual(['auto', 'openai'])
    expect(configured[1]).toMatchObject({ kind: 'key', metered: false })
  })

  it('keeps a stored selection that cannot run in the list, marked and not pickable', () => {
    const settings = settingsWith({ provider: 'codex' })
    const choices = aiSelectionChoices(settings, {
      'claude-code': status('claude-code', 'ready'),
      codex: status('codex', 'metered'),
    })
    expect(aiSelectionValue(settings)).toBe('codex')
    const stored = choices.find((choice) => choice.value === 'codex')
    expect(stored).toMatchObject({ unavailable: true, name: 'Codex' })
    // an unavailable entry writes nothing
    expect(withAiSelection(settingsWith({ provider: 'auto' }), stored!).provider).toBe('auto')
  })

  it('reads a provider id this build does not know as auto', () => {
    const settings = settingsWith({ provider: 'retired-provider' as never })
    expect(aiSelectionValue(settings)).toBe('auto')
    const choices = aiSelectionChoices(settings, checkingSubscriptionStatuses())
    expect(choices.map((choice) => choice.value)).toEqual(['auto'])
  })

  it('lists each self-hosted endpoint on its own and selects it by id', () => {
    const settings = settingsWith({
      customEndpoints: [
        { id: 'ep-a', name: 'Local', baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: 'a' },
        { id: 'ep-b', name: 'Lab', baseUrl: 'http://127.0.0.1:2/v1', apiKey: '', model: 'b' },
      ],
      customEndpoint: 'ep-a',
    })
    const choices = aiSelectionChoices(settings, checkingSubscriptionStatuses())
    expect(choices.map((choice) => choice.value)).toEqual(['auto', 'custom::ep-a', 'custom::ep-b'])
    const next = withAiSelection(settings, choices[2]!)
    expect(next.provider).toBe('custom')
    expect(next.customEndpoint).toBe('ep-b')
    expect(next.providers.custom.model).toBe('b')
    expect(aiSelectionValue(next)).toBe('custom::ep-b')
  })
})

describe('picking a choice', () => {
  const statuses = {
    'claude-code': status('claude-code', 'ready'),
    codex: status('codex', 'ready'),
  }

  it('writes auto or the explicit provider id and nothing else', () => {
    const settings = withOpenAiKey(settingsWith())
    const choices = aiSelectionChoices(settings, statuses)
    const pick = (value: string) =>
      withAiSelection(
        settings,
        choices.find((choice) => choice.value === value)!,
      )

    expect(pick('claude-code').provider).toBe('claude-code')
    expect(pick('codex').provider).toBe('codex')
    expect(pick('openai').provider).toBe('openai')
    expect(pick('auto').provider).toBe('auto')
    expect(pick('openai').providers).toEqual(settings.providers)
  })
})

describe('"use this AI" in the Advanced key pane', () => {
  it('is offered for a filled-in key provider that is not in use, and picking it selects only that', () => {
    const settings = withOpenAiKey(settingsWith({ provider: 'auto' }))
    const choice = advancedPaneUseChoice(settings, 'openai')
    expect(choice).toMatchObject({ value: 'openai', kind: 'key' })
    const next = withAiSelection(settings, choice!)
    expect(next.provider).toBe('openai')
    expect(next.providers).toEqual(settings.providers)
  })

  it('is not offered before the key and model are both there, or once the provider is in use', () => {
    expect(advancedPaneUseChoice(settingsWith(), 'openai')).toBeUndefined()
    const noModel = settingsWith({
      providers: { ...defaultAiSettings().providers, openai: { apiKey: 'sk-test', model: '' } },
    })
    expect(advancedPaneUseChoice(noModel, 'openai')).toBeUndefined()
    const inUse = withOpenAiKey(settingsWith({ provider: 'openai' }))
    expect(advancedPaneUseChoice(inUse, 'openai')).toBeUndefined()
  })

  it('never offers a subscription', () => {
    expect(advancedPaneUseChoice(settingsWith(), 'codex')).toBeUndefined()
  })

  it('matches a self-hosted endpoint by its id', () => {
    const settings = settingsWith({
      provider: 'custom',
      customEndpoints: [
        { id: 'ep-a', name: 'Local', baseUrl: 'http://127.0.0.1:1/v1', apiKey: '', model: 'a' },
        { id: 'ep-b', name: 'Lab', baseUrl: 'http://127.0.0.1:2/v1', apiKey: '', model: 'b' },
      ],
      customEndpoint: 'ep-a',
    })
    expect(advancedPaneUseChoice(settings, 'custom', 'ep-a')).toBeUndefined()
    const other = advancedPaneUseChoice(settings, 'custom', 'ep-b')
    expect(other).toMatchObject({ value: 'custom::ep-b' })
    expect(withAiSelection(settings, other!).customEndpoint).toBe('ep-b')
  })
})

describe('a key pane save', () => {
  it('takes the fields the visible part writes from the file as it is now', () => {
    const draft = settingsWith({ provider: 'auto', headlessSubscriptionEnabled: false })
    const latest = settingsWith({
      provider: 'codex',
      headlessSubscriptionEnabled: true,
      headlessSubscriptionConsentVersion: HEADLESS_SUBSCRIPTION_CONSENT_VERSION,
      subscriptionNoticeSeen: true,
      meteredAccepted: { codex: true },
      readUrl: { githubToken: 'ghp_live' },
    })
    const merged = withLiveSelectionFields({ ...draft, maxOutputTokens: 9216 }, latest)
    expect(merged).toMatchObject({
      provider: 'codex',
      headlessSubscriptionEnabled: true,
      // without the consent the switch the file has on would be saved as off
      headlessSubscriptionConsentVersion: HEADLESS_SUBSCRIPTION_CONSENT_VERSION,
      subscriptionNoticeSeen: true,
      meteredAccepted: { codex: true },
      // a key pane draft must not drop a token saved while it was open
      readUrl: { githubToken: 'ghp_live' },
      maxOutputTokens: 9216,
    })
    // nothing readable: the draft goes out as it is
    expect(withLiveSelectionFields(draft, null)).toBe(draft)
  })
})

describe('the automatic-requests switch', () => {
  it('records the version of the warning the user agreed to when turned on', () => {
    const on = withHeadlessSubscription(settingsWith(), true)
    expect(on).toMatchObject({
      headlessSubscriptionEnabled: true,
      headlessSubscriptionConsentVersion: HEADLESS_SUBSCRIPTION_CONSENT_VERSION,
    })
    const off = withHeadlessSubscription(on, false)
    expect(off.headlessSubscriptionEnabled).toBe(false)
  })

  it('stays off on save when turned on without that version, as an older file has it', async () => {
    const draft = settingsWith({
      headlessSubscriptionEnabled: true,
      headlessSubscriptionConsentVersion: undefined,
    })
    vi.stubGlobal('window', { aiOffice: { setAiSettings: vi.fn(async () => {}) } })
    try {
      expect((await writeAiSettings(draft)).headlessSubscriptionEnabled).toBe(false)
      const on = withHeadlessSubscription(draft, true)
      expect((await writeAiSettings(on)).headlessSubscriptionEnabled).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the GitHub read token', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sets the field, trims it, and removes it when cleared', () => {
    const empty = settingsWith()
    expect(readUrlGithubToken(empty)).toBe('')
    const saved = withReadUrlGithubToken(empty, '  ghp_test  ')
    expect(saved.readUrl).toEqual({ githubToken: 'ghp_test' })
    expect(readUrlGithubToken(saved)).toBe('ghp_test')
    const cleared = withReadUrlGithubToken(saved, '   ')
    expect('readUrl' in cleared).toBe(false)
    expect(readUrlGithubToken(cleared)).toBe('')
  })

  it('saves and deletes the token without touching the other settings', async () => {
    const initial = settingsWith({
      provider: 'codex',
      maxOutputTokens: 9216,
      providers: {
        ...settingsWith().providers,
        openai: { apiKey: 'sk-test', model: 'gpt-test' },
      },
    })
    // the providers as the settings file holds them: JSON keeps no undefined field
    const storedProviders = JSON.parse(JSON.stringify(initial.providers)) as AiSettings['providers']
    const file = { stored: initial, writes: 0 }
    vi.stubGlobal('window', {
      aiOffice: {
        getAiSettings: async () => file.stored,
        setAiSettings: async (next: AiSettings) => {
          file.stored = next
          file.writes += 1
        },
      },
    })

    expect(
      await changeAiSettings((current) => withReadUrlGithubToken(current, ' ghp_test ')),
    ).toMatchObject({ readUrl: { githubToken: 'ghp_test' } })
    expect(file.stored.readUrl).toEqual({ githubToken: 'ghp_test' })
    expect(file.stored).toMatchObject({
      provider: 'codex',
      maxOutputTokens: 9216,
      providers: storedProviders,
    })

    expect(await changeAiSettings((current) => withReadUrlGithubToken(current, ''))).not.toBeNull()
    expect('readUrl' in file.stored).toBe(false)
    expect(file.stored).toMatchObject({
      provider: 'codex',
      maxOutputTokens: 9216,
      providers: storedProviders,
    })
    expect(file.writes).toBe(2)
  })
})

describe('a change saved at once', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stubSettingsFile(initial: AiSettings | null) {
    const file = { stored: initial, writes: 0 }
    vi.stubGlobal('window', {
      aiOffice: {
        getAiSettings: async () => {
          // a real read crosses to the main process: let other work interleave
          await new Promise((resolve) => setTimeout(resolve, 5))
          if (!file.stored) throw new Error("No handler registered for 'ai:get-settings'")
          return file.stored
        },
        setAiSettings: async (next: AiSettings) => {
          file.stored = next
          file.writes += 1
        },
      },
    })
    return file
  }

  it('starts from the file as it is, so two quick changes both land', async () => {
    const file = stubSettingsFile(settingsWith())
    const [first, second] = await Promise.all([
      changeAiSettings((current) => withHeadlessSubscription(current, true)),
      changeAiSettings((current) => ({ ...current, provider: 'codex' })),
    ])
    expect(first).toMatchObject({ headlessSubscriptionEnabled: true, provider: 'auto' })
    expect(second).toMatchObject({ headlessSubscriptionEnabled: true, provider: 'codex' })
    expect(file.stored).toMatchObject({ headlessSubscriptionEnabled: true, provider: 'codex' })
    expect(file.writes).toBe(2)
  })

  it('writes neither an unknown selection nor a field this build does not know', async () => {
    const legacy = settingsWith({ provider: 'retired-provider' as never })
    legacy.search = { ...legacy.search!, provider: 'retired-provider' as never }
    const file = stubSettingsFile({ ...legacy, retiredSwitch: false } as AiSettings)
    await changeAiSettings((current) => ({ ...current, subscriptionNoticeSeen: true }))
    expect(file.stored).toMatchObject({ provider: 'auto', subscriptionNoticeSeen: true })
    expect(file.stored!.search?.provider).toBe('parallel')
    expect('retiredSwitch' in file.stored!).toBe(false)
  })

  it('writes nothing, and does not throw, when the file cannot be read', async () => {
    const file = stubSettingsFile(null)
    await expect(changeAiSettings((current) => current)).resolves.toBeNull()
    expect(file.writes).toBe(0)
  })
})

describe('the Advanced key pane', () => {
  it('lists no id outside the catalog and not Claude, and keeps Codex for its path', () => {
    const listed = advancedProviderIds([...AI_PROVIDERS, { id: 'retired-provider' }])
    expect(listed).not.toContain('retired-provider')
    expect(listed).not.toContain('claude-code')
    expect(listed).toContain('codex')
    expect(listed).toContain('custom')
    expect(listed).toContain('openai')
  })

  it('opens on the selected provider, or on the first one that takes a key', () => {
    expect(initialAdvancedProvider({ provider: 'openai' }, AI_PROVIDERS)).toBe('openai')
    expect(initialAdvancedProvider({ provider: 'codex' }, AI_PROVIDERS)).toBe('codex')
    const first = initialAdvancedProvider({ provider: 'auto' }, AI_PROVIDERS)
    expect(first).toBe(AI_PROVIDERS.find((m) => !['claude-code', 'codex'].includes(m.id))!.id)
    // a subscription or an unknown id selected: the pane still opens on a key provider
    expect(initialAdvancedProvider({ provider: 'claude-code' }, AI_PROVIDERS)).toBe(first)
    expect(initialAdvancedProvider({ provider: 'retired-provider' as never }, AI_PROVIDERS)).toBe(
      first,
    )
  })

  it('opens on a filled-in key provider while none is selected, so its saved key is in view', () => {
    const withKey = withOpenAiKey(settingsWith({ provider: 'auto' }))
    expect(initialAdvancedProvider(withKey, AI_PROVIDERS)).toBe('openai')
    expect(initialAdvancedProvider({ ...withKey, provider: 'claude-code' }, AI_PROVIDERS)).toBe(
      'openai',
    )
    // the stored selection still comes first
    expect(initialAdvancedProvider({ ...withKey, provider: 'codex' }, AI_PROVIDERS)).toBe('codex')
  })
})

describe('media choices', () => {
  it('offers the Codex subscription for image generation only when the build can do it', () => {
    expect(mediaSpecialChoices('image', true)).toEqual(['codex', 'none'])
    expect(mediaSpecialChoices('image', false)).toEqual(['none'])
  })

  it('offers "ask the current AI" for image analysis and "none" for video analysis', () => {
    expect(mediaSpecialChoices('analysis', true)).toEqual(['chat'])
    expect(mediaSpecialChoices('video', true)).toEqual(['none'])
  })

  it('lists only the providers able to serve each block', () => {
    for (const block of ['image', 'analysis', 'video'] as const) {
      const listed = mediaKeyProviders(block, AI_MEDIA_PROVIDERS)
      expect(listed.length).toBeGreaterThan(0)
      for (const meta of listed) {
        expect(block === 'image' ? meta.imageProtocol : meta.analysisProtocol).toBeTruthy()
        if (block === 'video') expect(meta.videoAnalysis).toBe(true)
      }
    }
  })

  it('shows a stored Codex image selection as "none" where Codex cannot generate', () => {
    const settings = settingsWith()
    settings.media = { ...settings.media!, imageProvider: 'codex' }
    expect(mediaSelection('image', settings, AI_MEDIA_PROVIDERS, true)).toBe('codex')
    expect(mediaSelection('image', settings, AI_MEDIA_PROVIDERS, false)).toBe('none')
  })

  it('shows a stored key provider as it is, and anything else as the default', () => {
    const image = mediaKeyProviders('image', AI_MEDIA_PROVIDERS)[0]!.id
    const video = mediaKeyProviders('video', AI_MEDIA_PROVIDERS)[0]!.id
    const settings = settingsWith()
    settings.media = {
      ...settings.media!,
      imageProvider: image,
      analysisProvider: 'retired-provider' as never,
      videoAnalysisProvider: video,
    }
    expect(mediaSelection('image', settings, AI_MEDIA_PROVIDERS, false)).toBe(image)
    expect(mediaSelection('analysis', settings, AI_MEDIA_PROVIDERS, false)).toBe('chat')
    expect(mediaSelection('video', settings, AI_MEDIA_PROVIDERS, false)).toBe(video)
    settings.media = { ...settings.media, videoAnalysisProvider: 'retired-provider' as never }
    expect(mediaSelection('video', settings, AI_MEDIA_PROVIDERS, false)).toBe('none')
  })
})

describe('IPC answers', () => {
  it('reads a missing or malformed status as checking', () => {
    expect(subscriptionStatusMapOf(undefined)).toEqual(checkingSubscriptionStatuses())
    expect(subscriptionStatusMapOf('nope')).toEqual(checkingSubscriptionStatuses())
    const partial = subscriptionStatusMapOf({
      'claude-code': { provider: 'claude-code', state: 'ready', planName: 'max' },
      codex: { provider: 'codex', state: 'no-such-state' },
    })
    expect(partial['claude-code']).toEqual({
      provider: 'claude-code',
      state: 'ready',
      planName: 'max',
      meteredAccepted: false,
    })
    expect(partial.codex).toEqual({ provider: 'codex', state: 'checking', meteredAccepted: false })
  })

  it('drops the spawn error text of a failed launch', () => {
    expect(subscriptionLaunchResultOf({ ok: true })).toEqual({ ok: true })
    expect(
      subscriptionLaunchResultOf({
        ok: false,
        reason: 'unsupported',
        error: 'spawn C:\\Users\\someone\\codex.exe ENOENT',
        installUrl: 'https://developers.openai.com/codex/cli',
      }),
    ).toEqual({
      ok: false,
      reason: 'unsupported',
      installUrl: 'https://developers.openai.com/codex/cli',
    })
    expect(subscriptionLaunchResultOf(null)).toEqual({ ok: false, reason: 'failed' })
    expect(subscriptionLaunchResultOf({ ok: false, reason: 'weird' })).toEqual({
      ok: false,
      reason: 'failed',
    })
  })
})
