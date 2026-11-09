/**
 * The template flow's channels (spec 5.6, 5.7): what crosses between the AI
 * panels and the shell when a template copy or a template preview opens, and
 * the checks the shell runs on it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  USER_SKILLS_CHANNELS,
  handoffTargetOf,
  previewEndedOf,
  previewInputOf,
  templateOpenInputOf,
} from '../src/user-skills-channels'
import { userSkillsBridge } from '../src/user-skills-bridge'

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}))

beforeEach(() => {
  electronMocks.invoke.mockReset()
  electronMocks.on.mockReset()
  electronMocks.removeListener.mockReset()
})

describe('checks on what the panels send', () => {
  it('reads a template open: a skill, the request and the chips', () => {
    expect(
      templateOpenInputOf({
        skillId: 'app:letter',
        text: 'for Friday',
        chips: [{ id: 'app:letter', source: 'app', title: 'Letter', extra: 1 }],
      }),
    ).toEqual({
      skillId: 'app:letter',
      text: 'for Friday',
      chips: [{ id: 'app:letter', source: 'app', title: 'Letter' }],
    })
    expect(templateOpenInputOf({ skillId: 'letter', text: '', chips: [] })).toBeUndefined()
    expect(
      templateOpenInputOf({ skillId: 'app:a', text: 'x', chips: [{ id: 'no' }] }),
    ).toBeUndefined()
    expect(templateOpenInputOf({ skillId: 'app:a', text: 1, chips: [] })).toBeUndefined()
  })

  it('brings the asking document along only when asked with true', () => {
    expect(
      templateOpenInputOf({ skillId: 'app:a', text: 'x', chips: [], withCurrent: true }),
    ).toEqual({ skillId: 'app:a', text: 'x', chips: [], withCurrent: true })
    expect(
      templateOpenInputOf({ skillId: 'app:a', text: 'x', chips: [], withCurrent: 'yes' }),
    ).toEqual({ skillId: 'app:a', text: 'x', chips: [] })
  })

  it('reads a preview: bytes, names, the request, the redaction answer and the card', () => {
    const input = {
      bytes: new Uint8Array([1, 2]),
      fileName: 'report.docx',
      title: 'Report',
      tabTitle: 'Template preview - Report',
      text: 'clear',
      originalRedacted: true,
      proposal: { key: 'k', title: 'Report' },
      draft: { title: 'R' },
    }
    expect(previewInputOf(input)).toEqual(input)
    expect(previewInputOf({ ...input, bytes: [1, 2] })).toBeUndefined()
    expect(previewInputOf({ ...input, originalRedacted: 'no' })).toBeUndefined()
    expect(previewInputOf({ ...input, proposal: 'x' })).toBeUndefined()
    expect(previewInputOf({ ...input, tabTitle: '' })).toBeUndefined()
  })

  it('takes only an editor name for a hand-off, and a well-formed end of a preview', () => {
    expect(handoffTargetOf('hwp')).toBe('hwp')
    expect(handoffTargetOf('home')).toBeUndefined()
    expect(previewEndedOf({ previewId: 'p', outcome: 'unsaved' })).toEqual({
      previewId: 'p',
      outcome: 'unsaved',
    })
    expect(previewEndedOf({ previewId: 'p', outcome: 'saved', skillId: 'bad' })).toEqual({
      previewId: 'p',
      outcome: 'saved',
    })
    expect(previewEndedOf({ outcome: 'saved' })).toBeUndefined()
  })

  it('keeps every channel under skills:', () => {
    for (const key of [
      'openTemplate',
      'openPreview',
      'previewOriginal',
      'finishPreview',
      'takeHandoff',
      'focusTab',
      'previewEnded',
    ] as const) {
      expect(USER_SKILLS_CHANNELS[key].startsWith('skills:')).toBe(true)
    }
  })
})

describe('the bridge calls of the template flow', () => {
  it('passes the template calls through their channels', async () => {
    electronMocks.invoke.mockResolvedValue({ ok: true, tabId: 't1' })
    const bridge = userSkillsBridge()
    const input = { skillId: 'app:a', text: 'x', chips: [] }
    await expect(bridge.openTemplate(input)).resolves.toEqual({ ok: true, tabId: 't1' })
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(USER_SKILLS_CHANNELS.openTemplate, input)
    await bridge.finishPreview('p1', 'saved', { skillId: 'app:a', title: 'A' })
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(USER_SKILLS_CHANNELS.finishPreview, {
      previewId: 'p1',
      outcome: 'saved',
      skillId: 'app:a',
      title: 'A',
    })
    await bridge.focusTab('t3')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(USER_SKILLS_CHANNELS.focusTab, 't3')
  })

  it('takes a hand-off for its editor, and nothing without a shell', async () => {
    electronMocks.invoke.mockResolvedValueOnce({ id: 'h', mode: 'skill' })
    await expect(userSkillsBridge().takeHandoff('docs')).resolves.toEqual({
      id: 'h',
      mode: 'skill',
    })
    expect(electronMocks.invoke).toHaveBeenCalledWith(USER_SKILLS_CHANNELS.takeHandoff, 'docs')
    electronMocks.invoke.mockRejectedValueOnce(new Error('no handler'))
    await expect(userSkillsBridge().takeHandoff('docs')).resolves.toBeNull()
  })

  it('hears only well-formed ends of its previews', () => {
    const listener = vi.fn()
    const off = userSkillsBridge().onPreviewEnded(listener)
    const [channel, handler] = electronMocks.on.mock.calls[0]!
    expect(channel).toBe(USER_SKILLS_CHANNELS.previewEnded)
    handler({}, { previewId: 'p', outcome: 'saved' })
    handler({}, { nonsense: true })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ previewId: 'p', outcome: 'saved' })
    off()
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      USER_SKILLS_CHANNELS.previewEnded,
      handler,
    )
  })
})
