// @vitest-environment jsdom
import {
  LifecycleService,
  LifecycleStages,
  LocaleType,
  LogLevel,
  Univer,
  UniverInstanceType,
} from '@univerjs/core'
import { DocSkeletonManagerService, UniverDocsPlugin } from '@univerjs/docs'
import { DocSelectionRenderService, UniverDocsUIPlugin } from '@univerjs/docs-ui'
import { IRenderManagerService, UniverRenderEnginePlugin } from '@univerjs/engine-render'
import { UniverUIPlugin } from '@univerjs/ui'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  HanjaRestartTracker,
  RESTART_WINDOW_MS,
  coverCommittedText,
  installHanjaCompositionRestart,
  isHanjaKey,
} from '../src/renderer/hanja-composition-restart'

/**
 * Issue #443: in a cell, ㅁ → Hanja key → ※ left "ㅁ※" (the letter showed twice
 * while the candidate list was open). These tests drive Univer's real doc
 * editor (the hidden contenteditable, DocSelectionRenderService,
 * DocIMEInputController, IMEInputCommand) with the events Chromium dispatches
 * for Microsoft's Korean input method, which converts by committing the letter
 * and composing again over it. The sequences are simulated; no real input
 * method is involved.
 */

// jsdom has no canvas, ResizeObserver or idle callbacks; the editor only needs them to exist.
function stubBrowser(): void {
  const metrics = {
    width: 10,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
    fontBoundingBoxAscent: 8,
    fontBoundingBoxDescent: 2,
  }
  ;(HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () =>
    new Proxy(
      {},
      {
        get: (_target, name) => {
          if (name === 'measureText') return () => metrics
          if (name === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
          return () => undefined
        },
        set: () => true,
      },
    )
  const g = globalThis as unknown as Record<string, unknown>
  g.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  g.requestIdleCallback = (callback: () => void) => setTimeout(callback, 0)
}

let univer: Univer
let editorCount = 0

beforeAll(async () => {
  stubBrowser()
  const container = document.createElement('div')
  document.body.appendChild(container)
  univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: {} },
  })
  univer.registerPlugin(UniverRenderEnginePlugin)
  univer.registerPlugin(UniverUIPlugin, { container, header: false, footer: false })
  univer.registerPlugin(UniverDocsPlugin)
  univer.registerPlugin(UniverDocsUIPlugin)
  // the doc editors' render modules (input, IME) are created from the Rendered stage on
  await newEditor()
  const lifecycle = univer.__getInjector().get(LifecycleService)
  for (let i = 0; i < 300 && lifecycle.stage < LifecycleStages.Rendered; i++) await wait(10)
  expect(lifecycle.stage).toBeGreaterThanOrEqual(LifecycleStages.Rendered)
}, 60_000)

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A new empty doc editor with the caret at its start, and a way to type into it. */
async function newEditor() {
  const id = `ime-doc-${++editorCount}`
  const doc = univer.createUnit(UniverInstanceType.UNIVER_DOC, {
    id,
    body: { dataStream: '\r\n' },
    documentStyle: {},
  }) as unknown as { getBody(): { dataStream: string } }
  const injector = univer.__getInjector()
  let render = injector.get(IRenderManagerService).getRenderById(id)
  for (let i = 0; i < 100 && !render; i++) {
    await wait(10)
    render = injector.get(IRenderManagerService).getRenderById(id)
  }
  if (!render) throw new Error('the doc editor never rendered')
  render.with(DocSkeletonManagerService).getSkeleton().calculate()
  render.with(DocSelectionRenderService).addDocRanges([{ startOffset: 0, endOffset: 0 }])
  const input = document.getElementById(`__editor_${id}`)
  if (!input) throw new Error('no hidden input for the doc editor')

  const composition = (type: string, data = '') =>
    input.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))
  const keydown = (init: KeyboardEventInit & { keyCode: number }) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, ...init })
    // jsdom ignores keyCode in the init dictionary
    Object.defineProperty(event, 'keyCode', { value: init.keyCode })
    input.dispatchEvent(event)
  }
  return {
    composition,
    keydown,
    /** the IME commands run asynchronously; let them land as between real key presses */
    settle: () => wait(20),
    text: () => doc.getBody().dataStream.slice(0, -2),
  }
}

type Editor = Awaited<ReturnType<typeof newEditor>>

/** A letter key the input method takes while composing (ㅁ is the A key, ㅋ the Z key). */
function letterKey(editor: Editor, code: string): void {
  editor.keydown({ key: 'Process', code, keyCode: 229, isComposing: true })
}

/** Types one composing letter: Chromium starts a composition and updates it. */
async function typeLetter(editor: Editor, letter: string, code: string): Promise<void> {
  letterKey(editor, code)
  editor.composition('compositionstart')
  editor.composition('compositionupdate', letter)
  await editor.settle()
}

/**
 * The Hanja key on a composing `letter`: Microsoft's Korean input method
 * commits it (Blink's commit fires compositionupdate and compositionend
 * together) and composes again over the committed letter to show the
 * candidates. Picking one replaces that composition and commits it.
 */
async function hanjaConvert(
  editor: Editor,
  letter: string,
  pick: string | null,
  hanjaCode = 'ControlRight',
): Promise<void> {
  editor.keydown({ key: 'Process', code: hanjaCode, keyCode: 229, isComposing: true })
  editor.composition('compositionupdate', letter)
  editor.composition('compositionend', letter)
  editor.composition('compositionstart')
  editor.composition('compositionupdate', letter)
  await editor.settle()
  const chosen = pick ?? letter // null: Esc closes the list and keeps the letter
  editor.composition('compositionupdate', chosen)
  editor.composition('compositionend', chosen)
  await editor.settle()
}

describe('the Hanja key on a composing letter in a Univer editor', () => {
  // runs first: installing the fix patches Univer for the rest of the file
  it('types the letter twice in stock Univer (the reported bug)', async () => {
    const editor = await newEditor()
    await typeLetter(editor, 'ㅁ', 'KeyA')
    await hanjaConvert(editor, 'ㅁ', '※')
    expect(editor.text()).toBe('ㅁ※')
  })

  it('replaces the letter with the chosen symbol', async () => {
    installHanjaCompositionRestart()
    const editor = await newEditor()
    await typeLetter(editor, 'ㅁ', 'KeyA')
    editor.keydown({ key: 'Process', code: 'ControlRight', keyCode: 229, isComposing: true })
    editor.composition('compositionupdate', 'ㅁ')
    editor.composition('compositionend', 'ㅁ')
    editor.composition('compositionstart')
    editor.composition('compositionupdate', 'ㅁ')
    await editor.settle()
    // the candidate list is open over the one letter
    expect(editor.text()).toBe('ㅁ')
    editor.composition('compositionupdate', '※')
    editor.composition('compositionend', '※')
    await editor.settle()
    expect(editor.text()).toBe('※')
  })

  it('converts a syllable after earlier text, with the dedicated Hanja key', async () => {
    const editor = await newEditor()
    await typeLetter(editor, '가', 'KeyR')
    letterKey(editor, 'KeyG')
    editor.composition('compositionend', '가')
    editor.composition('compositionstart')
    editor.composition('compositionupdate', 'ㅎ')
    await editor.settle()
    editor.composition('compositionupdate', '한')
    await editor.settle()
    await hanjaConvert(editor, '한', '韓', 'Lang2')
    expect(editor.text()).toBe('가韓')
  })

  it('keeps one letter when the candidate list is closed without a choice', async () => {
    const editor = await newEditor()
    await typeLetter(editor, 'ㅁ', 'KeyA')
    await hanjaConvert(editor, 'ㅁ', null)
    expect(editor.text()).toBe('ㅁ')
  })

  it('replaces the letter when the restarted composition only reports the choice', async () => {
    const editor = await newEditor()
    await typeLetter(editor, 'ㅁ', 'KeyA')
    editor.keydown({ key: 'Process', code: 'ControlRight', keyCode: 229, isComposing: true })
    editor.composition('compositionend', 'ㅁ')
    editor.composition('compositionstart')
    await editor.settle()
    editor.composition('compositionupdate', '※')
    editor.composition('compositionend', '※')
    await editor.settle()
    expect(editor.text()).toBe('※')
  })

  it('keeps a letter typed twice (ㅋㅋ), which also restarts with the same text', async () => {
    const editor = await newEditor()
    await typeLetter(editor, 'ㅋ', 'KeyZ')
    letterKey(editor, 'KeyZ')
    editor.composition('compositionend', 'ㅋ')
    editor.composition('compositionstart')
    editor.composition('compositionupdate', 'ㅋ')
    await editor.settle()
    editor.composition('compositionend', 'ㅋ')
    await editor.settle()
    expect(editor.text()).toBe('ㅋㅋ')
  })
})

describe('isHanjaKey', () => {
  it('knows the Hanja key while composing and on its own', () => {
    expect(isHanjaKey({ key: 'Process', code: 'ControlRight', keyCode: 229 })).toBe(true)
    expect(isHanjaKey({ key: 'Process', code: 'Lang2', keyCode: 229 })).toBe(true)
    expect(isHanjaKey({ key: 'HanjaMode', code: 'Lang2', keyCode: 25 })).toBe(true)
  })

  it('leaves letters, Space and the Korean/English key alone', () => {
    expect(isHanjaKey({ key: 'Process', code: 'KeyA', keyCode: 229 })).toBe(false)
    expect(isHanjaKey({ key: 'Process', code: 'Space', keyCode: 229 })).toBe(false)
    expect(isHanjaKey({ key: 'Process', code: 'AltRight', keyCode: 229 })).toBe(false)
    expect(isHanjaKey({ key: 'Control', code: 'ControlRight', keyCode: 17 })).toBe(false)
  })
})

describe('HanjaRestartTracker', () => {
  const hanja = { key: 'Process', code: 'ControlRight', keyCode: 229 }

  it('names the committed text for the restart that follows the key', () => {
    const tracker = new HanjaRestartTracker()
    tracker.keydown(hanja, 0)
    tracker.compositionEnd('doc', 'ㅁ', 5)
    expect(tracker.compositionStart('doc', 6)).toBe('ㅁ')
    // only once
    expect(tracker.compositionStart('doc', 7)).toBeNull()
  })

  it('ignores a restart in another editor, after another key, or too late', () => {
    const other = new HanjaRestartTracker()
    other.keydown(hanja, 0)
    other.compositionEnd('doc', 'ㅁ', 5)
    expect(other.compositionStart('formula-bar', 6)).toBeNull()

    const typed = new HanjaRestartTracker()
    typed.keydown(hanja, 0)
    typed.compositionEnd('doc', 'ㅁ', 5)
    typed.keydown({ key: 'Process', code: 'KeyA', keyCode: 229 }, 6)
    expect(typed.compositionStart('doc', 7)).toBeNull()

    const late = new HanjaRestartTracker()
    late.keydown(hanja, 0)
    late.compositionEnd('doc', 'ㅁ', 5)
    expect(late.compositionStart('doc', RESTART_WINDOW_MS + 1)).toBeNull()
  })
})

describe('coverCommittedText', () => {
  const caret = (offset: number) => ({ startOffset: offset, endOffset: offset, collapsed: true })

  it('widens the caret back over the committed text', () => {
    expect(coverCommittedText(caret(3), '한', '가나한\r\n')).toEqual({
      startOffset: 2,
      endOffset: 3,
      collapsed: false,
    })
  })

  it('leaves the caret when that text is not right before it', () => {
    expect(coverCommittedText(caret(2), '한', '가나한\r\n')).toEqual(caret(2))
    expect(coverCommittedText(caret(0), 'ㅁ', '\r\n')).toEqual(caret(0))
    const selection = { startOffset: 0, endOffset: 1, collapsed: false }
    expect(coverCommittedText(selection, 'ㅁ', 'ㅁ\r\n')).toBe(selection)
  })
})
