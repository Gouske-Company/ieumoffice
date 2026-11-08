/**
 * The memo panel and its one editor modal.
 *
 * The panel sits in its own column beside the document, next to the AI dock
 * rather than in it (MemoSide.tsx). It lists the memos of the open document in
 * document order and lets the user select, add, change and remove them. The editor is an app modal, not the
 * editor's own dialog, and while it is open every HWP editor instance in the app
 * has its input taken away: the plugin locks the editor itself and a
 * BroadcastChannel asks the other tabs to lock too. The main process is told as
 * well, so it can hold back Save, tab close and quit (T7).
 *
 * Everything the panel decides (order, read-only reasons, pages, error strings,
 * locks, notices) is a plain function at the top of this file, so it can be
 * tested without a browser or an editor. The component only lays those answers out.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { PRODUCT_NAME, type Params } from '@genoffice/i18n'
import type { AgentMemo, AgentMemoAnchor } from '../../studio-plugin/agent-plugin.mjs'
import { MEMO_NOT_COPIED_EVENT, MEMO_REMOVED_EVENT } from '../../studio-plugin/agent-plugin.mjs'
import type { AgentBridge } from './ai/agent-bridge'
import { useI18n, type StringKey } from './i18n/locale'

/** The longest memo body the engine takes, in UTF-16 units (spec 3.3). */
export const MAX_MEMO_TEXT = 100_000
/** The channel every HWP editor instance listens on while a memo modal is open. */
export const MEMO_LOCK_CHANNEL = 'ieum:hwp-memo-lock'
/** How often a tab locked by another one asks main whether that modal is still open. */
export const MEMO_LOCK_RECHECK_MS = 5000
/** The editor's own Insert > Memo menu (T4) asks the app to open the memo editor. */
export const MEMO_INSERT_EVENT = 'ieum:memo-insert'
/** A document change is followed after this pause: typing does not re-read the list per key. */
export const MEMO_DOC_CHANGE_DEBOUNCE_MS = 350
/**
 * What a new memo's author is when no name is set anywhere (spec 3.6). It is written into
 * the document, where Hangul shows it: the product's own name, the same in every language.
 */
export const MEMO_FALLBACK_AUTHOR = PRODUCT_NAME
/** The longest author a memo field takes (spec 3.6). */
export const MAX_MEMO_AUTHOR = 64

export type MemoMode = 'insert' | 'edit'

/** A notice the app shows once, outside the panel. */
export interface MemoNotice {
  key: StringKey
  params?: Params
  /** a refused action is an error; news from the document is information */
  tone?: 'info' | 'error'
}

/** What the panel and the modal show about a memo's read-only state. */
export function memoReadOnlyKey(reason: AgentMemo['readOnlyReason']): StringKey | null {
  switch (reason) {
    case 'formatted':
      return 'memoReadOnlyFormatted'
    case 'object':
      return 'memoReadOnlyObject'
    case 'unsupported_place':
      return 'memoReadOnlyPlace'
    case 'protected':
      return 'memoReadOnlyProtected'
    default:
      return null
  }
}

/** A memo's body may be changed here only when the engine says so. */
export function canEditMemo(memo: AgentMemo): boolean {
  return memo.editable === true
}

/**
 * A memo may be removed even when its body cannot be rewritten (the text and the
 * whole memo field go, no formatting is rewritten): everything but a protected
 * document or a place this app cannot address (spec 3.4).
 */
export function canDeleteMemo(memo: AgentMemo): boolean {
  return memo.readOnlyReason !== 'protected' && memo.readOnlyReason !== 'unsupported_place'
}

/** The order a memo list is read and shown in: section, paragraph, start, number. */
export function sortMemos(memos: readonly AgentMemo[]): AgentMemo[] {
  // a memo with no address (a header, a note) goes after the ones in the body
  const sectionOf = (memo: AgentMemo) => memo.sectionIndex ?? Number.MAX_SAFE_INTEGER
  const paraOf = (memo: AgentMemo) => memo.paraIndex ?? Number.MAX_SAFE_INTEGER
  const startOf = (memo: AgentMemo) => memo.startCharIdx ?? Number.MAX_SAFE_INTEGER
  return [...memos].sort((a, b) => {
    const section = sectionOf(a) - sectionOf(b)
    if (section !== 0) return section
    const para = paraOf(a) - paraOf(b)
    if (para !== 0) return para
    const start = startOf(a) - startOf(b)
    if (start !== 0) return start
    const index = (a.index ?? 0) - (b.index ?? 0)
    if (index !== 0) return index
    return a.id - b.id
  })
}

/** The words a card shows: the engine's preview, or the first line of the body. */
export function memoPreviewOf(memo: AgentMemo): string {
  const preview = (memo.preview ?? '').replace(/\s+/g, ' ').trim()
  if (preview) return preview
  return (memo.text ?? '').replace(/\s+/g, ' ').trim()
}

/** A card with no text says so instead of showing an empty line. */
export function isEmptyMemoText(text: string): boolean {
  return text.replace(/\s+/g, '').length === 0
}

/** The page as the panel shows it; 0 (unknown) is not shown. */
export function memoPageParams(page: number): Params | null {
  return Number.isInteger(page) && page > 0 ? { page } : null
}

/**
 * The date the panel shows, when the file carries one. A date the browser can
 * parse is localized; an unfamiliar string is shown as the file wrote it. The
 * engine writes a memo's time as Hancom does, the local wall time followed by
 * `Z` (rhwp `memo_time::date`), so that `Z` does not mean UTC here.
 */
export function memoDateText(date: string | null, lang: string): string | null {
  const raw = (date ?? '').trim()
  if (!raw) return null
  const wall = /^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?)Z$/.exec(raw)?.[1]
  const parsed = new Date(wall ?? raw)
  if (Number.isNaN(parsed.getTime())) return raw
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
  } catch {
    return raw
  }
}

/** What the editor would put the memo on, from what the plugin answered. */
export function memoSelectionPreview(selection: {
  preview?: string | null
  startCharIdx: number
  endCharIdx: number
}): { text: string; caret: boolean } {
  return {
    text: (selection.preview ?? '').replace(/\s+/g, ' ').trim(),
    caret: selection.startCharIdx === selection.endCharIdx,
  }
}

/** Why a selection cannot carry a memo, as the message shown for it (spec 3.2). */
export function memoSelectionError(
  reason: 'none' | 'multi_paragraph' | 'unsupported_place' | 'overlap' | 'protected',
): StringKey {
  switch (reason) {
    case 'multi_paragraph':
      return 'memoErrMultiParagraph'
    case 'unsupported_place':
      return 'memoErrUnsupported'
    case 'overlap':
      return 'memoErrOverlap'
    case 'protected':
      return 'memoErrProtected'
    default:
      return 'memoErrNone'
  }
}

/** A line break in the textarea starts a paragraph; Windows-style endings are one break. */
export function normalizeMemoText(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * What keeps a body from being saved, or null. A new memo must hold something
 * besides whitespace; an existing memo may be cleared (spec 3.2, 3.3).
 */
export function memoBodyProblem(text: string, mode: MemoMode): StringKey | null {
  const body = normalizeMemoText(text)
  if (mode === 'insert' && body.trim() === '') return 'memoErrEmpty'
  if (body.length > MAX_MEMO_TEXT) return 'memoErrTooLong'
  return null
}

/** The message for a refused insert/set/remove, by the plugin's reason (spec 4.3). */
export function memoMutationErrorKey(
  kind: 'save' | 'delete',
  reason?: string | null,
  why?: string | null,
): StringKey {
  if (reason === 'memo_read_only') {
    const key = memoReadOnlyKey((why ?? null) as AgentMemo['readOnlyReason'])
    if (key) return key
  }
  if (reason === 'protected') return 'memoErrProtected'
  if (reason === 'memo_overlap') return 'memoErrOverlap'
  if (reason === 'memo_text_too_long') return 'memoErrTooLong'
  return kind === 'delete' ? 'memoErrDelete' : 'memoErrSave'
}

/** An author as the file takes it: no separators or control characters, 64 units, never empty. */
function cleanAuthor(raw: string): string {
  return (
    raw
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f/\\;]/g, '')
      .trim()
      .slice(0, MAX_MEMO_AUTHOR)
  )
}

/** The author a new memo takes: the setting, then the PC account, then the product name. */
export function authorNameOf(
  setting: { value?: string | null; fallback?: string | null } | null | undefined,
): string {
  const value = typeof setting?.value === 'string' ? cleanAuthor(setting.value) : ''
  if (value) return value
  const fallback = typeof setting?.fallback === 'string' ? cleanAuthor(setting.fallback) : ''
  if (fallback) return fallback
  return MEMO_FALLBACK_AUTHOR
}

/** Which memo is selected after one is removed: the next, else the previous, else none. */
export function memoSelectionAfterDelete(
  memos: readonly AgentMemo[],
  removedId: number,
): number | null {
  const at = memos.findIndex((memo) => memo.id === removedId)
  if (at < 0) return null
  const next = memos[at + 1] ?? memos[at - 1]
  return next ? next.id : null
}

/** The two events the plugin fires on the editor's window, as one app notice. */
export function memoNoticeOf(
  name: string,
  detail: unknown,
): { key: StringKey; params?: Params } | null {
  const value = (detail ?? {}) as { count?: unknown }
  const raw = typeof value.count === 'number' && Number.isFinite(value.count) ? value.count : 1
  const count = Math.max(1, Math.floor(raw))
  if (name === MEMO_REMOVED_EVENT) return { key: 'memoRemoved', params: { count } }
  if (name === MEMO_NOT_COPIED_EVENT) return { key: 'memoNotCopied' }
  return null
}

/** One lock message another HWP editor instance (or this tab) sent. */
export interface MemoLockMessage {
  type: 'lock' | 'unlock'
  tab: string
}

/** Who has the memo modal open now: this tab, and any other tab that said so. */
export interface MemoLockState {
  local: boolean
  foreign: string[]
}

export function emptyMemoLockState(): MemoLockState {
  return { local: false, foreign: [] }
}

/** A raw BroadcastChannel message, if it is one of ours. */
export function memoLockMessageOf(value: unknown): MemoLockMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as { type?: unknown; tab?: unknown }
  if (message.type !== 'lock' && message.type !== 'unlock') return null
  if (typeof message.tab !== 'string' || message.tab === '') return null
  return { type: message.type, tab: message.tab }
}

/** A lock or unlock from anywhere: the tab is remembered once, and dropped on unlock. */
export function reduceMemoLock(state: MemoLockState, message: MemoLockMessage): MemoLockState {
  if (message.type === 'lock') {
    if (state.foreign.includes(message.tab)) return state
    return { ...state, foreign: [...state.foreign, message.tab] }
  }
  const foreign = state.foreign.filter((tab) => tab !== message.tab)
  return foreign.length === state.foreign.length ? state : { ...state, foreign }
}

/** This tab's own modal joined or left the lock state. */
export function withLocalMemoLock(state: MemoLockState, local: boolean): MemoLockState {
  return state.local === local ? state : { ...state, local }
}

/** The editor stays locked while any tab has the memo modal open. */
export function memoIsLocked(state: MemoLockState): boolean {
  return state.local || state.foreign.length > 0
}

/** What the modal holds: the selection for a new memo, or the memo being changed. */
interface MemoEditor {
  mode: MemoMode
  /** the memo being changed; null while adding */
  memoId: number | null
  /** where a new memo goes; null while changing one */
  anchor: AgentMemoAnchor | null
  /** the author shown: the current user for a new memo, the memo's own for an old one */
  author: string
  /** the text the selection covers, empty at a caret */
  selectionText: string
  caret: boolean
  text: string
}

export interface MemoPanelProps {
  /** the memo column is out */
  open: boolean
  /** this document's plugin, the only way to the memos */
  bridge: AgentBridge
  /** bumped whenever the document may have changed: the list is read again */
  changeTick?: number
  /** bumped when the editor's Insert > Memo menu asks for the add dialog (T4) */
  insertTick?: number
  /** close the memo column */
  onCollapse: () => void
  /**
   * A memo modal is open somewhere, here or in another tab: saving and closing
   * must wait. Called with false when it closes or this panel unmounts.
   */
  onModalOpenChange(open: boolean): void
  /** one-time news for the app's notice line */
  onNotice(notice: MemoNotice): void
}

const closeIcon = '×'
const detailOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function newTabId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `memo-${Date.now()}-${Math.random()}`
  } catch {
    return `memo-${Date.now()}-${Math.random()}`
  }
}

export function MemoPanel({
  open,
  bridge,
  changeTick = 0,
  insertTick = 0,
  onCollapse,
  onModalOpenChange,
  onNotice,
}: MemoPanelProps): ReactElement {
  const { lang, t } = useI18n()
  const rtl = lang === 'ar' || lang === 'he'
  const titleId = useId()
  const [memos, setMemos] = useState<AgentMemo[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  /** this engine build has no memo API: keep the screen closed and say why once */
  const [unsupported, setUnsupported] = useState(false)
  const unsupportedNotifiedRef = useRef(false)
  const onNoticeRef = useRef(onNotice)
  const onCollapseRef = useRef(onCollapse)
  onNoticeRef.current = onNotice
  onCollapseRef.current = onCollapse
  const [editor, setEditor] = useState<MemoEditor | null>(null)
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const [modalError, setModalError] = useState<{ key: StringKey; detail?: string } | null>(null)
  const [locks, setLocks] = useState<MemoLockState>(emptyMemoLockState)
  const aliveRef = useRef(true)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const tabIdRef = useRef<string>('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  /** where focus was before the dialog opened, to go back there when it closes */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  /** the last Insert > Memo request this panel acted on */
  const handledInsertTickRef = useRef(0)
  /** a save is on its way to the plugin: a second click or Ctrl+Enter waits */
  const savingRef = useRef(false)

  if (!tabIdRef.current) tabIdRef.current = newTabId()

  const modalOpen = editor !== null
  const locked = memoIsLocked(locks)
  const foreignOnly = locks.foreign.length > 0 && !locks.local
  const contended = locks.foreign.length > 0 && locks.local

  const load = useCallback(async (): Promise<AgentMemo[]> => {
    try {
      const listed = await bridge.listMemos()
      if (!aliveRef.current) return []
      if (listed.supported === false) {
        setUnsupported(true)
        setMemos([])
        setLoadFailed(false)
        // An older engine cannot answer any memo call. Tell the user and close
        // the column instead of showing an empty, unusable memo screen.
        if (!unsupportedNotifiedRef.current) {
          unsupportedNotifiedRef.current = true
          onNoticeRef.current({ key: 'memoUnsupportedBuild', tone: 'error' })
        }
        onCollapseRef.current()
        return []
      }
      unsupportedNotifiedRef.current = false
      setUnsupported(false)
      const sorted = sortMemos(listed.memos)
      setMemos(sorted)
      setLoadFailed(false)
      return sorted
    } catch {
      if (aliveRef.current) setLoadFailed(true)
      return []
    }
  }, [bridge])

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // the panel is only live with its column out: close it and it stops reading
  useEffect(() => {
    if (open) void load()
  }, [open, load])

  // a user's own edit can add (a paste) or take away a memo: look again after the typing
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => void load(), MEMO_DOC_CHANGE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [open, changeTick, load])

  // anchors follow the panel, and the selected one stays stronger while it is out
  useEffect(() => {
    if (!open) return
    void bridge.showMemoAnchors(true).catch(() => {})
    return () => {
      void bridge.showMemoAnchors(false).catch(() => {})
    }
  }, [open, bridge])

  useEffect(() => {
    if (!open) return
    void bridge.selectMemo(selectedId).catch(() => {})
  }, [open, selectedId, bridge])

  // a memo that went away (an edit, an undo, a paste) cannot stay selected
  useEffect(() => {
    if (selectedId !== null && !memos.some((memo) => memo.id === selectedId)) setSelectedId(null)
  }, [memos, selectedId])

  // another tab's modal locks this editor too (spec 3.2)
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(MEMO_LOCK_CHANNEL)
    channelRef.current = channel
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = memoLockMessageOf(event.data)
      if (!message || message.tab === tabIdRef.current) return
      setLocks((state) => {
        const next = reduceMemoLock(state, message)
        // a tab opened while the modal was already up learned about it from main:
        // the one unlock message means that modal closed
        if (message.type === 'unlock' && next.foreign.includes('main')) {
          return { ...next, foreign: next.foreign.filter((tab) => tab !== 'main') }
        }
        return next
      })
    }
    return () => {
      channelRef.current = null
      channel.close()
    }
  }, [])

  // a tab opened while another tab's modal is up asks main, then locks itself (T7)
  useEffect(() => {
    let alive = true
    const asked = window.hwpApi.getMemoModalOpen?.()
    if (asked) {
      void asked
        .then((isOpen) => {
          if (!alive || !isOpen) return
          setLocks((state) => reduceMemoLock(state, { type: 'lock', tab: 'main' }))
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [])

  // a tab that crashed never sends its unlock: main's flag is the truth to fall back on
  const hasForeignLock = locks.foreign.length > 0
  useEffect(() => {
    if (!hasForeignLock) return
    let alive = true
    const timer = setInterval(() => {
      const asked = window.hwpApi.getMemoModalOpen?.()
      if (!asked) return
      void asked
        .then((isOpen) => {
          if (!alive || isOpen) return
          setLocks((state) => (state.foreign.length === 0 ? state : { ...state, foreign: [] }))
        })
        .catch(() => {})
    }, MEMO_LOCK_RECHECK_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [hasForeignLock])

  // this tab's modal, and the other tabs through the channel
  useEffect(() => {
    setLocks((state) => withLocalMemoLock(state, modalOpen))
  }, [modalOpen])

  useEffect(() => {
    if (!modalOpen) return
    channelRef.current?.postMessage({ type: 'lock', tab: tabIdRef.current })
    window.hwpApi.setMemoModalOpen?.(true)
    return () => {
      channelRef.current?.postMessage({ type: 'unlock', tab: tabIdRef.current })
      window.hwpApi.setMemoModalOpen?.(false)
    }
  }, [modalOpen])

  // the editor takes no keys, clicks or paste while any memo modal is open
  useEffect(() => {
    void bridge.setMemoLock(locked).catch(() => {})
    onModalOpenChange(locked)
  }, [locked, bridge, onModalOpenChange])

  useEffect(
    () => () => {
      void bridge.setMemoLock(false).catch(() => {})
      onModalOpenChange(false)
    },
    [bridge, onModalOpenChange],
  )

  useEffect(() => {
    if (!modalOpen) return
    const frame = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [modalOpen])

  const closeEditor = useCallback(() => {
    setEditor(null)
    setModalError(null)
    setBusy(false)
    const back = returnFocusRef.current
    returnFocusRef.current = null
    if (back) requestAnimationFrame(() => back.focus())
  }, [])

  /** remember where to put the caret back, then show the dialog */
  const openEditor = useCallback((next: MemoEditor) => {
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement ? active : null
    setModalError(null)
    setEditor(next)
  }, [])

  const reveal = useCallback(
    (memo: AgentMemo | undefined) => {
      if (!memo?.anchor) return
      void bridge.reveal(memo.anchor).catch(() => {})
    },
    [bridge],
  )

  const selectMemo = useCallback(
    (memo: AgentMemo) => {
      setSelectedId(memo.id)
      reveal(memo)
    },
    [reveal],
  )

  const beginInsert = useCallback(async () => {
    if (opening || busy || editor) return
    if (unsupported) {
      onNotice({ key: 'memoUnsupportedBuild', tone: 'error' })
      return
    }
    if (foreignOnly) {
      onNotice({ key: 'memoLockedElsewhere' })
      return
    }
    setOpening(true)
    try {
      const selection = await bridge.memoSelection()
      if (!selection.ok) {
        onNotice({ key: memoSelectionError(selection.reason), tone: 'error' })
        return
      }
      const preview = memoSelectionPreview(selection)
      const asked = window.hwpApi.getAuthorName?.()
      const setting = asked ? await asked.catch(() => null) : null
      openEditor({
        mode: 'insert',
        memoId: null,
        anchor: selection.anchor,
        author: authorNameOf(setting),
        selectionText: preview.text,
        caret: preview.caret,
        text: '',
      })
    } catch {
      onNotice({ key: 'memoErrSave', tone: 'error' })
    } finally {
      setOpening(false)
    }
  }, [opening, busy, editor, unsupported, foreignOnly, bridge, onNotice, openEditor])

  // the editor's Insert > Memo menu asks for the same dialog as the panel's button
  useEffect(() => {
    if (!open || insertTick === 0 || insertTick === handledInsertTickRef.current) return
    // a dialog already open keeps its text; the menu press is not replayed after it closes
    handledInsertTickRef.current = insertTick
    if (modalOpen) return
    void beginInsert()
  }, [open, insertTick, modalOpen, beginInsert])

  const beginEdit = useCallback(
    async (memo: AgentMemo) => {
      if (opening || busy || editor || foreignOnly || !canEditMemo(memo)) return
      setOpening(true)
      try {
        const listed = await bridge.listMemos()
        const fresh = listed.memos.find((one) => one.id === memo.id) ?? memo
        if (!canEditMemo(fresh)) {
          const key = memoReadOnlyKey(fresh.readOnlyReason) ?? 'memoErrSave'
          onNotice({ key })
          return
        }
        openEditor({
          mode: 'edit',
          memoId: fresh.id,
          anchor: null,
          author: fresh.author,
          selectionText: '',
          caret: false,
          text: fresh.text,
        })
      } catch {
        onNotice({ key: 'memoErrLoad', tone: 'error' })
      } finally {
        setOpening(false)
      }
    },
    [opening, busy, editor, foreignOnly, bridge, onNotice, openEditor],
  )

  const save = useCallback(async () => {
    if (!editor || busy || savingRef.current) return
    const problem = memoBodyProblem(editor.text, editor.mode)
    if (problem) {
      setModalError({ key: problem })
      return
    }
    if (contended) {
      setModalError({ key: 'memoContended' })
      return
    }
    savingRef.current = true
    setBusy(true)
    setModalError(null)
    const text = normalizeMemoText(editor.text)
    try {
      if (editor.mode === 'insert') {
        if (!editor.anchor) {
          setModalError({ key: 'memoErrNone' })
          return
        }
        const result = await bridge.insertMemo(editor.anchor, editor.author, text)
        if (!result.ok) {
          setModalError({ key: memoMutationErrorKey('save', result.reason), detail: result.reason })
          return
        }
        closeEditor()
        const list = await load()
        setSelectedId(result.id)
        reveal(list.find((memo) => memo.id === result.id))
      } else {
        if (editor.memoId === null) {
          setModalError({ key: 'memoErrSave' })
          return
        }
        const result = await bridge.setMemo(editor.memoId, text)
        if (!result.ok) {
          setModalError({
            key: memoMutationErrorKey('save', result.reason, result.why),
            detail: result.reason,
          })
          return
        }
        const id = editor.memoId
        closeEditor()
        const list = await load()
        setSelectedId(id)
        reveal(list.find((memo) => memo.id === id))
      }
    } catch (error) {
      setModalError({ key: 'memoErrSave', detail: detailOf(error) })
    } finally {
      savingRef.current = false
      if (aliveRef.current) setBusy(false)
    }
  }, [editor, busy, contended, bridge, closeEditor, load, reveal])

  // Esc cancels and Ctrl+Enter saves wherever the focus is in the modal
  const saveRef = useRef<() => Promise<void>>(async () => {})
  saveRef.current = save
  useEffect(() => {
    if (!modalOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      // an unfinished IME composition owns Esc and Enter; do not act on stale text
      if (event.isComposing) return
      if (event.key === 'Escape') {
        // a save in flight is not abandoned: the document may already be changing
        if (busy) return
        event.preventDefault()
        event.stopPropagation()
        closeEditor()
        return
      }
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [modalOpen, closeEditor, busy])

  const remove = useCallback(
    async (memo: AgentMemo) => {
      if (foreignOnly || !canDeleteMemo(memo)) return
      const nextId = memoSelectionAfterDelete(memos, memo.id)
      try {
        const result = await bridge.removeMemo(memo.id)
        if (!result.ok) {
          onNotice({
            key: memoMutationErrorKey('delete', result.reason, result.why),
            tone: 'error',
          })
          return
        }
        // the card leaves even if re-reading the list fails afterwards
        setMemos((current) => current.filter((one) => one.id !== memo.id))
        const list = await load()
        const next = list.some((one) => one.id === nextId) ? nextId : null
        setSelectedId(next)
        if (next === null) void bridge.selectMemo(null).catch(() => {})
        else reveal(list.find((one) => one.id === next))
      } catch {
        onNotice({ key: 'memoErrDelete', tone: 'error' })
      }
    },
    [foreignOnly, memos, bridge, load, onNotice, reveal],
  )

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented) return
    if (event.key !== 'Tab') return
    // keep Tab inside the dialog: the editor behind it is locked either way
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'textarea, button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const pageOf = (memo: AgentMemo): Params | null => memoPageParams(memo.page)
  const authorOf = (memo: AgentMemo): string => memo.author.trim() || t('memoUnknownAuthor')
  const dateOf = (memo: AgentMemo): string | null => memoDateText(memo.date, lang)

  const modal = editor ? (
    <div className="memo-modal-backdrop" onKeyDown={onDialogKeyDown}>
      <div
        ref={dialogRef}
        className="memo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir={rtl ? 'rtl' : undefined}
      >
        <div className="memo-modal-head">
          <span id={titleId} className="memo-modal-title">
            {editor.mode === 'insert' ? t('memoNewTitle') : t('memoEditTitle')}
          </span>
          <button
            type="button"
            className="memo-icon-button"
            aria-label={t('dismiss')}
            data-tip={t('dismiss')}
            disabled={busy}
            onClick={closeEditor}
          >
            {closeIcon}
          </button>
        </div>
        <div className="memo-modal-body">
          <div className="memo-field">
            <span className="memo-field-label">{t('memoAuthor')}</span>
            <span className="memo-author-value">
              {editor.author.trim() || t('memoUnknownAuthor')}
            </span>
          </div>
          {editor.mode === 'insert' && (
            <div className="memo-selection">
              {editor.caret
                ? t('memoCaretLabel')
                : t('memoSelectionLabel', { text: editor.selectionText })}
            </div>
          )}
          <label className="memo-field">
            <span className="memo-field-label">{t('memoBody')}</span>
            <textarea
              ref={textareaRef}
              className="memo-textarea"
              dir={rtl ? 'rtl' : undefined}
              value={editor.text}
              disabled={busy}
              placeholder={t('memoBodyPlaceholder')}
              onChange={(event) => {
                const text = event.target.value
                setEditor((current) => (current ? { ...current, text } : current))
              }}
            />
          </label>
          {modalError && (
            <div className="memo-modal-error" role="alert">
              <span>{t(modalError.key)}</span>
              {modalError.detail && <span className="memo-modal-detail">{modalError.detail}</span>}
            </div>
          )}
          {contended && (
            <div className="memo-modal-warning" role="status">
              {t('memoContended')}
            </div>
          )}
        </div>
        <div className="memo-modal-foot">
          <span className="memo-save-hint">{t('memoSaveHint')}</span>
          <div className="memo-modal-actions">
            <button type="button" className="memo-button" disabled={busy} onClick={closeEditor}>
              {t('memoCancel')}
            </button>
            <button
              type="button"
              className="memo-button memo-button-primary"
              disabled={busy || memoBodyProblem(editor.text, editor.mode) !== null || contended}
              onClick={() => void save()}
            >
              {t('fileSave')}
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <aside
      className="memo-panel"
      dir={rtl ? 'rtl' : undefined}
      aria-label={t('memoTitle')}
      aria-hidden={open ? undefined : true}
    >
      <div className="memo-panel-head">
        <span className="memo-panel-title">
          {t('memoTitle')}
          {memos.length > 0 && <span className="memo-panel-count">{memos.length}</span>}
        </span>
        <button
          type="button"
          className="memo-icon-button"
          aria-label={t('aiCollapsePanel')}
          data-tip={t('aiCollapsePanel')}
          onClick={onCollapse}
        >
          {closeIcon}
        </button>
      </div>

      {unsupported && (
        <div className="memo-panel-warning" role="status">
          {t('memoUnsupportedBuild')}
        </div>
      )}
      {foreignOnly && (
        <div className="memo-panel-warning" role="status">
          {t('memoLockedElsewhere')}
        </div>
      )}

      <div className="memo-panel-tools">
        <button
          type="button"
          className="memo-button memo-add-button"
          disabled={unsupported || opening || busy || foreignOnly}
          onClick={() => void beginInsert()}
        >
          <span aria-hidden>+</span> {t('memoAdd')}
        </button>
      </div>

      <div className="memo-list">
        {!unsupported && loadFailed && (
          <div className="memo-list-error" role="alert">
            {t('memoErrLoad')}
          </div>
        )}
        {unsupported ? null : memos.length === 0 && !loadFailed ? (
          <div className="memo-empty">
            <p>{t('memoEmpty')}</p>
          </div>
        ) : (
          memos.map((memo) => {
            const reason = memoReadOnlyKey(memo.readOnlyReason)
            const page = pageOf(memo)
            const date = dateOf(memo)
            const selected = memo.id === selectedId
            return (
              <div key={memo.id} className={`memo-card${selected ? ' selected' : ''}`}>
                <button
                  type="button"
                  className="memo-card-select"
                  aria-pressed={selected}
                  onClick={() => selectMemo(memo)}
                >
                  <span className="memo-card-head">
                    <span className="memo-card-author">{authorOf(memo)}</span>
                    {page && <span className="memo-card-page">{t('memoPage', page)}</span>}
                    {date && <span className="memo-card-date">{date}</span>}
                    {!canEditMemo(memo) && (
                      <span className="memo-readonly-badge">{t('memoReadOnly')}</span>
                    )}
                  </span>
                  <span
                    className={`memo-card-text${isEmptyMemoText(memo.text) ? ' memo-card-empty' : ''}`}
                  >
                    {isEmptyMemoText(memo.text) ? t('memoNoBody') : memoPreviewOf(memo)}
                  </span>
                  {reason && <span className="memo-card-reason">{t(reason)}</span>}
                </button>
                <div className="memo-card-actions">
                  <button
                    type="button"
                    className="memo-button memo-card-button"
                    disabled={opening || busy || foreignOnly || !canEditMemo(memo)}
                    title={reason ? t(reason) : undefined}
                    onClick={() => void beginEdit(memo)}
                  >
                    {t('memoEdit')}
                  </button>
                  <button
                    type="button"
                    className="memo-button memo-card-button memo-card-delete"
                    disabled={opening || busy || foreignOnly || !canDeleteMemo(memo)}
                    onClick={() => void remove(memo)}
                  >
                    {t('memoDelete')}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
      {modal && createPortal(modal, document.body)}
    </aside>
  )
}
