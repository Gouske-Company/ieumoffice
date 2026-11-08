/**
 * A vendor CLI the person turned off in this app (decision 0114): the app
 * neither checks nor runs it, the program keeps its login for the rest of the
 * PC, and it can be turned back on. No test here starts a real CLI: the
 * detector, the model lister and every launcher are stand-ins that record
 * what the app asked of them.
 */
import { describe, expect, it } from 'vitest'
import { defaultAiSettings } from '../src/providers'
import {
  SUBSCRIPTION_IPC_CHANNELS,
  createSubscriptionStatusService,
  registerSubscriptionIpc,
  type SubscriptionDetection,
  type SubscriptionLaunchResult,
  type SubscriptionStatusServiceDeps,
} from '../src/subscription'
import type { AiSettings, AiSubscriptionProviderId } from '../src/types'

type Handler = (event: unknown, payload?: unknown) => unknown

const READY: Record<AiSubscriptionProviderId, SubscriptionDetection> = {
  'claude-code': {
    provider: 'claude-code',
    state: 'ready',
    loginMethod: 'subscription',
    loginKind: 'claude.ai/firstParty',
  },
  codex: { provider: 'codex', state: 'ready', loginMethod: 'subscription', loginKind: 'chatgpt' },
  chatgpt: { provider: 'chatgpt', state: 'signed-out' },
}

function harness(
  options: {
    off?: AiSettings['subscriptionOff']
    detect?: SubscriptionStatusServiceDeps['detect']
    acceptanceStore?: SubscriptionStatusServiceDeps['acceptanceStore']
    writable?: boolean
  } = {},
) {
  const settings: AiSettings = {
    ...defaultAiSettings(),
    ...(options.off ? { subscriptionOff: options.off } : {}),
  }
  const asked: AiSubscriptionProviderId[] = []
  const listed: AiSubscriptionProviderId[] = []
  const service = createSubscriptionStatusService({
    getSettings: () => settings,
    setMeteredAccepted: () => undefined,
    ...(options.writable === false
      ? {}
      : {
          setSubscriptionOff: (provider, off) => {
            const next = { ...settings.subscriptionOff }
            if (off) next[provider] = true
            else delete next[provider]
            settings.subscriptionOff = next
          },
        }),
    acceptanceStore: options.acceptanceStore ?? {
      read: async () => ({}),
      write: async () => undefined,
    },
    detect:
      options.detect ??
      (async (provider) => {
        asked.push(provider)
        return READY[provider]
      }),
    listModels: async (provider) => {
      listed.push(provider)
      return [{ id: 'opus', label: 'Opus' }]
    },
  })
  return { service, settings, asked, listed }
}

/** let the model readings that follow a check settle */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the status service and a CLI turned off', () => {
  it('never asks the program while it is off, and reports it as off', async () => {
    const h = harness({ off: { 'claude-code': true } })
    const statuses = await h.service.check()
    await settle()
    expect(statuses['claude-code']).toEqual({
      provider: 'claude-code',
      state: 'off',
      meteredAccepted: false,
    })
    expect(statuses.codex.state).toBe('ready')
    expect(h.asked).not.toContain('claude-code')
    expect(h.asked).toContain('codex')
    expect(h.listed).not.toContain('claude-code')
    expect(h.listed).toContain('codex')
  })

  it('turns off at once, stores it, and asks nothing on the checks after', async () => {
    const h = harness()
    await h.service.check()
    await settle()
    expect(h.asked.filter((id) => id === 'claude-code')).toHaveLength(1)

    const result = await h.service.setOff('claude-code', true)
    expect(result.ok).toBe(true)
    expect(result.statuses['claude-code'].state).toBe('off')
    // the models it listed belong to a login this app no longer looks at
    expect(result.statuses['claude-code'].models).toBeUndefined()
    expect(h.settings.subscriptionOff).toEqual({ 'claude-code': true })

    await h.service.check()
    await h.service.check(['claude-code'], { fresh: true })
    await settle()
    expect(h.asked.filter((id) => id === 'claude-code')).toHaveLength(1)
    expect(h.service.getStatuses()['claude-code'].state).toBe('off')
  })

  it('back on, reads checking and asks the program again', async () => {
    const h = harness({ off: { 'claude-code': true } })
    await h.service.check()
    const result = await h.service.setOff('claude-code', false)
    expect(result.ok).toBe(true)
    expect(result.statuses['claude-code'].state).toBe('checking')
    expect(h.settings.subscriptionOff).toEqual({})
    await settle()
    expect(h.asked).toContain('claude-code')
    expect(h.service.getStatuses()['claude-code'].state).toBe('ready')
  })

  it('does not take the answer of a check that was under way when it was turned off', async () => {
    let answer: (detection: SubscriptionDetection) => void = () => undefined
    const h = harness({
      detect: (provider) =>
        provider === 'claude-code'
          ? new Promise((resolve) => {
              answer = resolve
            })
          : Promise.resolve(READY[provider]),
    })
    const checking = h.service.check(['claude-code'])
    await settle()
    await h.service.setOff('claude-code', true)
    answer(READY['claude-code'])
    const statuses = await checking
    expect(statuses['claude-code'].state).toBe('off')
    expect(h.service.getStatuses()['claude-code'].state).toBe('off')
  })

  it('back on while the service is busy, and a check that read it as off arrives: ends checked, not off', async () => {
    // the acceptance record read of another provider's check holds the shared queue
    let releaseRead: () => void = () => undefined
    let slow = false
    const h = harness({
      off: { codex: true },
      acceptanceStore: {
        read: () =>
          slow
            ? new Promise((resolve) => {
                releaseRead = () => resolve({})
              })
            : Promise.resolve({}),
        write: async () => undefined,
      },
    })
    await h.service.check()
    await settle()
    expect(h.service.getStatuses().codex.state).toBe('off')

    slow = true
    void h.service.check(['claude-code'], { fresh: true })
    await settle()
    // "use again" waits behind the Claude check; a window's check of Codex reads the
    // setting before the switch is saved
    const turnedOn = h.service.setOff('codex', false)
    void h.service.check(['codex'])
    await settle()
    slow = false
    releaseRead()
    expect((await turnedOn).ok).toBe(true)
    await settle()
    await settle()

    expect(h.settings.subscriptionOff).toEqual({})
    expect(h.asked).toContain('codex')
    expect(h.service.getStatuses().codex.state).toBe('ready')
  })

  it('changes nothing where no writer was given (the headless callers)', async () => {
    const h = harness({ writable: false })
    await h.service.check(['claude-code'])
    const result = await h.service.setOff('claude-code', true)
    expect(result.ok).toBe(false)
    expect(result.statuses['claude-code'].state).toBe('ready')
  })
})

describe('the subscription channels and a CLI turned off', () => {
  function wired(off?: AiSettings['subscriptionOff']) {
    const h = harness({ off })
    const handlers = new Map<string, Handler>()
    const launched: string[] = []
    const ran =
      (name: string) =>
      async (provider: AiSubscriptionProviderId): Promise<SubscriptionLaunchResult> => {
        launched.push(`${name}:${provider}`)
        return { ok: true }
      }
    let meteredCalls = 0
    const service = {
      ...h.service,
      setMeteredAccepted: async (provider: AiSubscriptionProviderId, accepted: boolean) => {
        meteredCalls++
        return h.service.setMeteredAccepted(provider, accepted)
      },
    }
    registerSubscriptionIpc(
      { handle: (channel, handler) => void handlers.set(channel, handler) },
      {
        service,
        launchLogin: ran('login'),
        launchLogout: ran('logout'),
        launchInstall: ran('install'),
        launchUpdate: ran('update'),
        cancelLogin: ran('cancel'),
      },
    )
    const call = (channel: string, payload?: unknown) => handlers.get(channel)!(null, payload)
    return { ...h, call, launched, meteredCalls: () => meteredCalls }
  }

  it('turns a CLI off, ends a sign-in the app started for it, and answers with the statuses', async () => {
    const w = wired()
    await w.service.check()
    const result = (await w.call(SUBSCRIPTION_IPC_CHANNELS.off, {
      provider: 'claude-code',
      off: true,
    })) as { ok: boolean; statuses: Record<string, { state: string }> }
    expect(result.ok).toBe(true)
    expect(result.statuses['claude-code'].state).toBe('off')
    expect(w.launched).toEqual(['cancel:claude-code'])
    expect(w.settings.subscriptionOff).toEqual({ 'claude-code': true })
  })

  it.each([
    ['after its first check', true],
    ['before any check, while its status still reads checking', false],
  ])(
    'starts nothing for a CLI that is off: no login, logout, install, update or "use anyway" (%s)',
    async (_when, checked) => {
      const w = wired({ codex: true })
      if (checked) await w.service.check()
      else expect(w.service.getStatuses().codex.state).toBe('checking')
      for (const channel of [
        SUBSCRIPTION_IPC_CHANNELS.login,
        SUBSCRIPTION_IPC_CHANNELS.logout,
        SUBSCRIPTION_IPC_CHANNELS.install,
        SUBSCRIPTION_IPC_CHANNELS.update,
      ]) {
        expect(await w.call(channel, { provider: 'codex' }), channel).toEqual({
          ok: false,
          reason: 'invalid',
        })
      }
      expect(
        await w.call(SUBSCRIPTION_IPC_CHANNELS.metered, { provider: 'codex', accepted: true }),
      ).toMatchObject({ ok: false })
      expect(w.launched).toEqual([])
      expect(w.meteredCalls()).toBe(0)
      expect(w.asked).not.toContain('codex')
      // the other CLI is untouched
      expect(await w.call(SUBSCRIPTION_IPC_CHANNELS.login, { provider: 'claude-code' })).toEqual({
        ok: true,
      })
      expect(w.launched).toEqual(['login:claude-code'])
    },
  )

  it('takes a CLI id and a real boolean only; ChatGPT has no switch', async () => {
    const w = wired()
    await w.service.check()
    for (const payload of [
      { provider: 'chatgpt', off: true },
      { provider: 'claude-code', off: 'yes' },
      { provider: 'anthropic', off: true },
      { off: true },
      null,
    ]) {
      expect(
        await w.call(SUBSCRIPTION_IPC_CHANNELS.off, payload),
        JSON.stringify(payload),
      ).toMatchObject({ ok: false })
    }
    expect(w.settings.subscriptionOff).toBeUndefined()
    expect(w.launched).toEqual([])
  })
})
