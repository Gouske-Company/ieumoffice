/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SUBSCRIPTION_IPC_CHANNELS } from '@genoffice/ai-provider/browser'
import {
  AGENT_CHANNELS,
  AGENT_WARNING_VERSION,
  type AgentConnection,
  type AgentInit,
  type AgentStartResponse,
  type AgentWindowApi,
} from '../../src/shared/agent-api'
import { AgentWindow } from '../../src/renderer/src/agent/AgentWindow'
import { agentText } from '../../src/renderer/src/i18n/strings-agent'

/**
 * A program turned off in this app (decision 0114) while the agent window is
 * open: the window shows it as off as soon as the statuses change, and a
 * start the main process refused for it says it is off in this app.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let connection: AgentConnection
let statusesChanged: () => void

function init(): AgentInit {
  return {
    lang: 'en',
    prefs: {
      provider: 'claude-code',
      mode: 'ask-commands',
      recentFolders: ['C:\\project'],
      warningAccepted: AGENT_WARNING_VERSION,
    },
    connections: { 'claude-code': connection, codex: 'ready' },
  }
}

function installApi(start: AgentWindowApi['start']): void {
  const known: Partial<AgentWindowApi> = {
    getInit: vi.fn(async () => init()),
    start,
    getProjectPrefs: async () => null,
    getProjectSkills: async () => null,
    onStatusesChanged: (handler) => {
      statusesChanged = handler
      return () => undefined
    },
  }
  ;(window as unknown as { aiOfficeAgentWindow: unknown }).aiOfficeAgentWindow = new Proxy(known, {
    get: (target, name: string) =>
      target[name as keyof AgentWindowApi] ??
      (name.startsWith('on') ? () => () => undefined : async () => null),
  })
}

beforeEach(() => {
  connection = 'ready'
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function render(): Promise<void> {
  act(() => root.render(createElement(AgentWindow)))
  await flush()
}

const startButton = () =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent === agentText('en', 'start'),
  ) as HTMLButtonElement

const text = () => host.textContent ?? ''

describe('the agent window and a program turned off in this app', () => {
  it('listens on the channel the status service broadcasts to every window', () => {
    expect(AGENT_CHANNELS.statusesChanged).toBe(SUBSCRIPTION_IPC_CHANNELS.changed)
  })

  it('shows the program as off as soon as the statuses change', async () => {
    installApi(async () => ({ ok: false, failure: { reason: 'not-connected' } }))
    await render()
    expect(startButton().disabled).toBe(false)
    expect(text()).not.toContain(agentText('en', 'connOff'))

    connection = 'off'
    statusesChanged()
    await flush()
    expect(text()).toContain(agentText('en', 'connOff'))
    expect(startButton().disabled).toBe(true)
  })

  it('says off in this app when the start was refused for a program turned off meanwhile', async () => {
    installApi(async (): Promise<AgentStartResponse> => {
      connection = 'off'
      return { ok: false, failure: { reason: 'not-connected' } }
    })
    await render()
    await act(async () => startButton().click())
    await flush()
    expect(host.querySelector('.agent-error')?.textContent).toBe(agentText('en', 'errOffInApp'))
    expect(text()).toContain(agentText('en', 'connOff'))
  })

  it('keeps "not connected" for a program that is signed out', async () => {
    installApi(async (): Promise<AgentStartResponse> => {
      connection = 'unavailable'
      return { ok: false, failure: { reason: 'not-connected' } }
    })
    await render()
    await act(async () => startButton().click())
    await flush()
    expect(host.querySelector('.agent-error')?.textContent).toBe(agentText('en', 'errNotConnected'))
  })
})
