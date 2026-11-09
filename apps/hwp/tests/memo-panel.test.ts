/** @vitest-environment jsdom */
// The decisions of the memo panel without a browser or an editor: document
// order, read-only reasons, empty bodies, page labels, selection previews,
// refusal messages, lock coordination between HWP editor instances, and the
// plugin events that become one-time notices. A light render check at the end
// mounts the panel with fakes, so the empty state and a read-only card are seen
// as the user sees them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS } from '@genoffice/i18n'
import type { AgentMemo, AgentMemoAnchor } from '../studio-plugin/agent-plugin.mjs'
import type { AgentBridge } from '../src/renderer/ai/agent-bridge'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'
import { MemoPanel } from '../src/renderer/MemoPanel'
import type { HwpApi } from '../src/shared/ipc'
import {
  MEMO_FALLBACK_AUTHOR,
  MAX_MEMO_AUTHOR,
  MAX_MEMO_TEXT,
  authorNameOf,
  canDeleteMemo,
  canEditMemo,
  isEmptyMemoText,
  memoBodyProblem,
  memoDateText,
  memoIsLocked,
  memoLockMessageOf,
  memoMutationErrorKey,
  memoNoticeOf,
  memoPageParams,
  memoPreviewOf,
  memoReadOnlyKey,
  memoSelectionAfterDelete,
  memoSelectionError,
  memoSelectionPreview,
  normalizeMemoText,
  reduceMemoLock,
  sortMemos,
  withLocalMemoLock,
  type MemoLockState,
} from '../src/renderer/MemoPanel'
import { MEMO_NOT_COPIED_EVENT, MEMO_REMOVED_EVENT } from '../studio-plugin/agent-plugin.mjs'

const memo = (overrides: Partial<AgentMemo> = {}): AgentMemo => ({
  id: 1,
  index: 1,
  author: '',
  date: null,
  text: '',
  place: 'body',
  sectionIndex: 0,
  paraIndex: 0,
  startCharIdx: 0,
  endCharIdx: 0,
  path: null,
  page: 1,
  editable: true,
  readOnlyReason: null,
  anchor: null,
  rects: [],
  preview: '',
  ...overrides,
})

describe('memo order', () => {
  it('lists memos by section, paragraph, start and number, whatever order they came in', () => {
    const ordered = sortMemos([
      memo({ id: 5, sectionIndex: 1, paraIndex: 0 }),
      memo({ id: 4, sectionIndex: 0, paraIndex: 2, startCharIdx: 0 }),
      memo({ id: 3, sectionIndex: 0, paraIndex: 1, startCharIdx: 9 }),
      memo({ id: 2, sectionIndex: 0, paraIndex: 1, startCharIdx: 9, index: 1 }),
      memo({ id: 1, sectionIndex: 0, paraIndex: 1, startCharIdx: 2 }),
    ])
    expect(ordered.map((one) => one.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('sorts memos without an address after the addressed ones', () => {
    const ordered = sortMemos([
      memo({ id: 2, sectionIndex: null, paraIndex: null }),
      memo({ id: 1, sectionIndex: 0, paraIndex: 0 }),
    ])
    expect(ordered.map((one) => one.id)).toEqual([1, 2])
  })
})

describe('read-only memos', () => {
  it('names every reason the engine reports', () => {
    expect(memoReadOnlyKey('formatted')).toBe('memoReadOnlyFormatted')
    expect(memoReadOnlyKey('object')).toBe('memoReadOnlyObject')
    expect(memoReadOnlyKey('unsupported_place')).toBe('memoReadOnlyPlace')
    expect(memoReadOnlyKey('protected')).toBe('memoReadOnlyProtected')
    expect(memoReadOnlyKey(null)).toBeNull()
  })

  it('lets a read-only memo be deleted unless the document or the place forbids it', () => {
    expect(canDeleteMemo(memo({ readOnlyReason: null }))).toBe(true)
    expect(canDeleteMemo(memo({ readOnlyReason: 'formatted' }))).toBe(true)
    expect(canDeleteMemo(memo({ readOnlyReason: 'object' }))).toBe(true)
    expect(canDeleteMemo(memo({ readOnlyReason: 'protected' }))).toBe(false)
    expect(canDeleteMemo(memo({ readOnlyReason: 'unsupported_place' }))).toBe(false)
  })

  it('edits only what the engine marks editable', () => {
    expect(canEditMemo(memo({ editable: true }))).toBe(true)
    expect(canEditMemo(memo({ editable: false }))).toBe(false)
  })
})

describe('card text', () => {
  it('shows no body as empty, including whitespace only', () => {
    expect(isEmptyMemoText('')).toBe(true)
    expect(isEmptyMemoText('  \n\t ')).toBe(true)
    expect(isEmptyMemoText('note')).toBe(false)
  })

  it('prefers the engine preview, then the first line of the body', () => {
    expect(memoPreviewOf(memo({ preview: '  a   preview ', text: 'other' }))).toBe('a preview')
    expect(memoPreviewOf(memo({ preview: '', text: ' first\nsecond ' }))).toBe('first second')
    expect(memoPreviewOf(memo({ preview: '', text: '   ' }))).toBe('')
  })

  it('shows a page only when it is known', () => {
    expect(memoPageParams(3)).toEqual({ page: 3 })
    expect(memoPageParams(0)).toBeNull()
    expect(memoPageParams(-1)).toBeNull()
    expect(memoPageParams(1.5)).toBeNull()
  })

  it('shows a date only when the file carries one', () => {
    expect(memoDateText(null, 'ko')).toBeNull()
    expect(memoDateText('   ', 'ko')).toBeNull()
    expect(memoDateText('not a date', 'ko')).toBe('not a date')
    const shown = memoDateText('2024-01-02T03:04:00Z', 'en')
    expect(shown).toBeTruthy()
    expect(shown).not.toBe('2024-01-02T03:04:00Z')
  })

  it('shows a memo time as the wall time the file wrote, its Z notwithstanding', () => {
    // the engine (as Hancom) writes the local time followed by Z
    const format = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' })
    expect(memoDateText('2024-01-02T03:04:00Z', 'en')).toBe(
      format.format(new Date(2024, 0, 2, 3, 4)),
    )
    expect(memoDateText('2024-01-02T03:04Z', 'en')).toBe(format.format(new Date(2024, 0, 2, 3, 4)))
  })
})

describe('where a new memo would go', () => {
  it('reads a range as selected text and a caret as a caret', () => {
    expect(
      memoSelectionPreview({ preview: '  some  words ', startCharIdx: 1, endCharIdx: 4 }),
    ).toEqual({ text: 'some words', caret: false })
    expect(
      memoSelectionPreview({ preview: 'nearby words', startCharIdx: 7, endCharIdx: 7 }),
    ).toEqual({ text: 'nearby words', caret: true })
  })

  it('turns every refusal into its own message', () => {
    expect(memoSelectionError('none')).toBe('memoErrNone')
    expect(memoSelectionError('multi_paragraph')).toBe('memoErrMultiParagraph')
    expect(memoSelectionError('unsupported_place')).toBe('memoErrUnsupported')
    expect(memoSelectionError('overlap')).toBe('memoErrOverlap')
    expect(memoSelectionError('protected')).toBe('memoErrProtected')
  })
})

describe('memo body validity', () => {
  it('will not add an empty or whitespace-only memo', () => {
    expect(memoBodyProblem('', 'insert')).toBe('memoErrEmpty')
    expect(memoBodyProblem('   \n\t', 'insert')).toBe('memoErrEmpty')
    expect(memoBodyProblem('a', 'insert')).toBeNull()
  })

  it('allows clearing an existing memo', () => {
    expect(memoBodyProblem('', 'edit')).toBeNull()
    expect(memoBodyProblem('   ', 'edit')).toBeNull()
  })

  it('refuses a body past the engine limit, counting UTF-16 units', () => {
    expect(memoBodyProblem('a'.repeat(MAX_MEMO_TEXT), 'insert')).toBeNull()
    expect(memoBodyProblem('a'.repeat(MAX_MEMO_TEXT + 1), 'insert')).toBe('memoErrTooLong')
    expect(memoBodyProblem('😀'.repeat(MAX_MEMO_TEXT / 2 + 1), 'edit')).toBe('memoErrTooLong')
  })

  it('keeps a Windows line ending as one paragraph break', () => {
    expect(normalizeMemoText('one\r\ntwo\rthree')).toBe('one\ntwo\nthree')
  })
})

describe('refusals from the plugin', () => {
  it('maps read-only reasons to the card wording', () => {
    expect(memoMutationErrorKey('save', 'memo_read_only', 'formatted')).toBe(
      'memoReadOnlyFormatted',
    )
    expect(memoMutationErrorKey('save', 'memo_read_only', 'object')).toBe('memoReadOnlyObject')
    expect(memoMutationErrorKey('save', 'memo_read_only', 'unsupported_place')).toBe(
      'memoReadOnlyPlace',
    )
    expect(memoMutationErrorKey('save', 'memo_read_only', 'protected')).toBe(
      'memoReadOnlyProtected',
    )
  })

  it('maps the other engine reasons, and keeps save and delete apart', () => {
    expect(memoMutationErrorKey('save', 'memo_overlap')).toBe('memoErrOverlap')
    expect(memoMutationErrorKey('save', 'memo_text_too_long')).toBe('memoErrTooLong')
    expect(memoMutationErrorKey('save', 'protected')).toBe('memoErrProtected')
    expect(memoMutationErrorKey('save', 'memo_invalid_range')).toBe('memoErrSave')
    expect(memoMutationErrorKey('save', null)).toBe('memoErrSave')
    expect(memoMutationErrorKey('delete', 'memo_insert_failed')).toBe('memoErrDelete')
    expect(memoMutationErrorKey('delete', 'memo_read_only', 'formatted')).toBe(
      'memoReadOnlyFormatted',
    )
  })
})

describe('the author of a new memo', () => {
  it('uses the setting, then the PC account, then the product name', () => {
    expect(authorNameOf({ value: '  Mina ', fallback: 'pc' })).toBe('Mina')
    expect(authorNameOf({ value: '   ', fallback: ' pc ' })).toBe('pc')
    expect(authorNameOf({ value: '', fallback: '' })).toBe(MEMO_FALLBACK_AUTHOR)
    expect(authorNameOf(null)).toBe(MEMO_FALLBACK_AUTHOR)
    expect(MEMO_FALLBACK_AUTHOR).toBe('IeumOffice')
  })

  it('takes out separators and control characters and cuts at 64 units', () => {
    expect(authorNameOf({ value: ' a/b\\c;d\n\te ', fallback: '' })).toBe('abcde')
    expect(authorNameOf({ value: 'x'.repeat(80), fallback: '' })).toHaveLength(MAX_MEMO_AUTHOR)
    // the setting becomes empty after cleaning: the PC account is next
    expect(authorNameOf({ value: ' /;; ', fallback: ' pc ' })).toBe('pc')
  })
})

describe('selecting the next memo after a delete', () => {
  const list = [memo({ id: 1 }), memo({ id: 2 }), memo({ id: 3 })]

  it('takes the next one, else the previous one, else none', () => {
    expect(memoSelectionAfterDelete(list, 1)).toBe(2)
    expect(memoSelectionAfterDelete(list, 2)).toBe(3)
    expect(memoSelectionAfterDelete(list, 3)).toBe(2)
    expect(memoSelectionAfterDelete([memo({ id: 9 })], 9)).toBeNull()
    expect(memoSelectionAfterDelete(list, 99)).toBeNull()
  })
})

describe('lock coordination between editor instances', () => {
  const empty: MemoLockState = { local: false, foreign: [] }

  it('locks while this tab has its modal, and releases only its own lock', () => {
    const local = withLocalMemoLock(empty, true)
    expect(memoIsLocked(local)).toBe(true)
    expect(memoIsLocked(withLocalMemoLock(local, false))).toBe(false)

    const withForeign = reduceMemoLock(withLocalMemoLock(local, false), {
      type: 'lock',
      tab: 'a',
    })
    expect(memoIsLocked(withForeign)).toBe(true)
    // this tab closing its own modal must not unlock a foreign one
    expect(memoIsLocked(withLocalMemoLock(withForeign, false))).toBe(true)
  })

  it('remembers a tab once and forgets it on unlock', () => {
    const first = reduceMemoLock(empty, { type: 'lock', tab: 'a' })
    const again = reduceMemoLock(first, { type: 'lock', tab: 'a' })
    expect(again).toBe(first)
    expect(reduceMemoLock(again, { type: 'lock', tab: 'b' }).foreign).toEqual(['a', 'b'])
    expect(reduceMemoLock(again, { type: 'unlock', tab: 'a' }).foreign).toEqual([])
    expect(reduceMemoLock(again, { type: 'unlock', tab: 'other' })).toBe(again)
  })

  it('accepts only our lock messages off the channel', () => {
    expect(memoLockMessageOf({ type: 'lock', tab: 'a' })).toEqual({ type: 'lock', tab: 'a' })
    expect(memoLockMessageOf({ type: 'unlock', tab: 'b' })).toEqual({
      type: 'unlock',
      tab: 'b',
    })
    expect(memoLockMessageOf({ type: 'lock', tab: '' })).toBeNull()
    expect(memoLockMessageOf({ type: 'open', tab: 'a' })).toBeNull()
    expect(memoLockMessageOf(null)).toBeNull()
    expect(memoLockMessageOf('lock')).toBeNull()
  })
})

describe('memo events become one-time notices', () => {
  it('reports how many memos went with the text, and how to bring them back', () => {
    expect(memoNoticeOf(MEMO_REMOVED_EVENT, { kind: 'memo-removed', count: 2 })).toEqual({
      key: 'memoRemoved',
      params: { count: 2 },
    })
    // a missing or impossible count still says something sensible
    expect(memoNoticeOf(MEMO_REMOVED_EVENT, null)).toEqual({
      key: 'memoRemoved',
      params: { count: 1 },
    })
    expect(memoNoticeOf(MEMO_REMOVED_EVENT, { count: 0 })).toEqual({
      key: 'memoRemoved',
      params: { count: 1 },
    })
  })

  it('reports a paste that left the memo behind', () => {
    expect(memoNoticeOf(MEMO_NOT_COPIED_EVENT, { kind: 'memo-not-copied', count: 1 })).toEqual({
      key: 'memoNotCopied',
    })
  })

  it('ignores anything else', () => {
    expect(memoNoticeOf('ieum:something-else', { count: 1 })).toBeNull()
  })
})

describe('memo strings in the 21 app languages', () => {
  const keys = [
    'memoTitle',
    'memoOpen',
    'memoAdd',
    'memoEmpty',
    'memoNoBody',
    'memoPage',
    'memoUnknownAuthor',
    'memoReadOnly',
    'memoReadOnlyFormatted',
    'memoReadOnlyObject',
    'memoReadOnlyPlace',
    'memoReadOnlyProtected',
    'memoEdit',
    'memoDelete',
    'memoNewTitle',
    'memoEditTitle',
    'memoAuthor',
    'memoBody',
    'memoBodyPlaceholder',
    'memoSelectionLabel',
    'memoCaretLabel',
    'memoSaveHint',
    'memoCancel',
    'memoErrNone',
    'memoErrMultiParagraph',
    'memoErrUnsupported',
    'memoErrOverlap',
    'memoErrProtected',
    'memoErrEmpty',
    'memoErrSave',
    'memoErrDelete',
    'memoErrTooLong',
    'memoErrLoad',
    'memoSaveBlocked',
    'memoRemoved',
    'memoNotCopied',
    'memoLockedElsewhere',
    'memoContended',
    'memoUnsupportedBuild',
    'memoHwpxLost',
    'aiToolMemos',
    'aiMemoContext',
    'aiMemoApprovalTitle',
    'aiMemoApprovalKeep',
    'aiMemoApprovalRemove',
  ] as const

  it('has every memo string in every language', () => {
    expect([...LANGS].sort()).toEqual(Object.keys(strings).sort())
    for (const lang of LANGS) {
      for (const key of keys) {
        expect(strings[lang][key], `${lang}.${key}`).toBeTruthy()
      }
    }
  })

  it('keeps the placeholders every memo label needs', () => {
    const placeholders: Partial<Record<(typeof keys)[number], string[]>> = {
      memoPage: ['{page}'],
      memoSelectionLabel: ['{text}'],
      memoRemoved: ['{count}'],
      memoHwpxLost: ['{count}'],
      aiToolMemos: ['{count}'],
      aiMemoContext: ['{count}'],
      aiMemoApprovalTitle: ['{count}'],
    }
    for (const lang of LANGS) {
      for (const [key, tokens] of Object.entries(placeholders)) {
        for (const token of tokens!) {
          expect(strings[lang][key as (typeof keys)[number]], `${lang}.${key}`).toContain(token)
        }
      }
    }
  })
})

// ---- a light render check: the empty panel and a read-only card ----

let container: HTMLElement
let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container.remove()
  delete (window as { hwpApi?: unknown }).hwpApi
  vi.unstubAllGlobals()
})

async function settle(turns = 6): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

function panelApi(): { api: HwpApi; setMemoModalOpen: ReturnType<typeof vi.fn> } {
  const setMemoModalOpen = vi.fn()
  return {
    setMemoModalOpen,
    api: {
      getMemoModalOpen: async () => false,
      setMemoModalOpen,
      getAuthorName: async () => ({ value: 'Mina', fallback: 'pc-account' }),
      onLanguageChanged: () => () => undefined,
    } as unknown as HwpApi,
  }
}

function panelBridge(memos: AgentMemo[], overrides: Record<string, unknown> = {}): AgentBridge {
  const calls = {
    listMemos: vi.fn(async () => ({ count: memos.length, memos })),
    showMemoAnchors: vi.fn(async (shown: boolean) => ({ ok: true as const, shown })),
    selectMemo: vi.fn(async (id: number | null) => ({ ok: true as const, id })),
    setMemoLock: vi.fn(async (locked: boolean) => ({ ok: true as const, locked })),
    memoSelection: vi.fn(async () => ({ ok: false as const, reason: 'none' as const })),
    reveal: vi.fn(async () => ({ ok: true })),
    insertMemo: vi.fn(async () => ({ ok: false as const, reason: 'memo_insert_failed' })),
    setMemo: vi.fn(async () => ({ ok: false as const, reason: 'memo_read_only' })),
    removeMemo: vi.fn(async () => ({ ok: false as const, reason: 'memo_remove_failed' })),
    ...overrides,
  }
  return calls as unknown as AgentBridge
}

async function mountPanel(
  bridge: AgentBridge,
  open = true,
  insertTick = 0,
): Promise<{
  onModalOpenChange: ReturnType<typeof vi.fn>
  onNotice: ReturnType<typeof vi.fn>
  onCollapse: ReturnType<typeof vi.fn>
  setMemoModalOpen: ReturnType<typeof vi.fn>
}> {
  const onModalOpenChange = vi.fn()
  const onNotice = vi.fn()
  const onCollapse = vi.fn()
  const { api, setMemoModalOpen } = panelApi()
  Object.assign(window, { hwpApi: api })
  root = createRoot(container)
  await act(async () => {
    root!.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(MemoPanel, {
          open,
          bridge,
          insertTick,
          onCollapse,
          onModalOpenChange,
          onNotice,
        }),
      }),
    )
  })
  await settle()
  return { onModalOpenChange, onNotice, onCollapse, setMemoModalOpen }
}

describe('the memo panel screen', () => {
  it('shows the empty state and turns the anchors on while it is out', async () => {
    const bridge = panelBridge([])
    await mountPanel(bridge)
    expect(container.querySelector('.memo-empty')?.textContent).toContain('No memos.')
    expect(bridge.showMemoAnchors).toHaveBeenCalledWith(true)
  })

  it('keeps the screen closed when this engine build has no memo API', async () => {
    const bridge = panelBridge([], {
      listMemos: vi.fn(async () => ({ count: 0, memos: [], supported: false })),
    })
    const { onCollapse, onNotice } = await mountPanel(bridge)
    expect(onNotice).toHaveBeenCalledWith({
      key: 'memoUnsupportedBuild',
      tone: 'error',
    })
    expect(onCollapse).toHaveBeenCalled()
    expect(container.querySelector<HTMLButtonElement>('.memo-add-button')?.disabled).toBe(true)
    expect(container.querySelector('.memo-panel-warning')?.textContent).toContain(
      'This build has no memo support.',
    )
  })

  it('draws a read-only card with its reason and only the delete action enabled', async () => {
    const readOnly = memo({
      id: 7,
      author: 'Kim',
      page: 3,
      text: 'Check this number',
      preview: 'Check this number',
      editable: false,
      readOnlyReason: 'formatted',
    })
    await mountPanel(panelBridge([readOnly]))

    const card = container.querySelector('.memo-card')
    expect(card).not.toBeNull()
    expect(card?.querySelector('.memo-card-author')?.textContent).toBe('Kim')
    expect(card?.querySelector('.memo-card-page')?.textContent).toBe('p.3')
    expect(card?.querySelector('.memo-card-text')?.textContent).toBe('Check this number')
    expect(card?.querySelector('.memo-readonly-badge')?.textContent).toBe('Read-only')
    expect(card?.querySelector('.memo-card-reason')?.textContent).toContain('mixes formatting')

    const actions = container.querySelectorAll<HTMLButtonElement>('.memo-card-actions button')
    expect(actions).toHaveLength(2)
    expect(actions[0].disabled).toBe(true)
    expect(actions[1].disabled).toBe(false)
  })

  it('leaves the editor free while no memo modal is open', async () => {
    const bridge = panelBridge([])
    const { onModalOpenChange } = await mountPanel(bridge, true)
    expect(onModalOpenChange).toHaveBeenLastCalledWith(false)
    expect(bridge.setMemoLock).toHaveBeenLastCalledWith(false)
  })

  it('opens the modal on the selection, locks the editor, and saves with Ctrl+Enter', async () => {
    const at: AgentMemoAnchor = {
      place: 'body',
      sectionIndex: 0,
      paraIndex: 2,
      startCharIdx: 4,
      endCharIdx: 4,
      path: null,
    }
    const insertMemo = vi.fn(async () => ({ ok: true as const, id: 12, index: 1 }))
    const bridge = panelBridge([], {
      memoSelection: vi.fn(async () => ({
        ok: true as const,
        place: 'body' as const,
        sectionIndex: 0,
        paraIndex: 2,
        startCharIdx: 4,
        endCharIdx: 4,
        path: null,
        preview: '',
        anchor: at,
      })),
      insertMemo,
    })
    const { onModalOpenChange, setMemoModalOpen } = await mountPanel(bridge)

    act(() => container.querySelector<HTMLButtonElement>('.memo-add-button')!.click())
    await settle()

    const dialog = document.querySelector<HTMLElement>('.memo-modal')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('Add memo')
    // the author is the setting/PC name, read-only in the dialog
    expect(dialog?.querySelector('.memo-author-value')?.textContent).toBe('Mina')
    expect(setMemoModalOpen).toHaveBeenCalledWith(true)
    expect(bridge.setMemoLock).toHaveBeenLastCalledWith(true)
    expect(onModalOpenChange).toHaveBeenLastCalledWith(true)

    const textarea = dialog!.querySelector<HTMLTextAreaElement>('.memo-textarea')!
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    act(() => {
      setValue.call(textarea, 'a new memo')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    })
    await settle()

    expect(insertMemo).toHaveBeenCalledWith(at, 'Mina', 'a new memo')
    expect(document.querySelector('.memo-modal')).toBeNull()
    expect(setMemoModalOpen).toHaveBeenLastCalledWith(false)
    expect(bridge.setMemoLock).toHaveBeenLastCalledWith(false)
    expect(onModalOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('opens the add dialog when the editor menu asks for it', async () => {
    const at: AgentMemoAnchor = {
      place: 'body',
      sectionIndex: 0,
      paraIndex: 1,
      startCharIdx: 0,
      endCharIdx: 3,
      path: null,
    }
    const bridge = panelBridge([], {
      memoSelection: vi.fn(async () => ({
        ok: true as const,
        place: 'body' as const,
        sectionIndex: 0,
        paraIndex: 1,
        startCharIdx: 0,
        endCharIdx: 3,
        path: null,
        preview: 'abc',
        anchor: at,
      })),
    })
    await mountPanel(bridge, true, 1)
    expect(document.querySelector('.memo-modal')).not.toBeNull()
    expect(document.querySelector('.memo-selection')?.textContent).toContain('abc')
  })
})
