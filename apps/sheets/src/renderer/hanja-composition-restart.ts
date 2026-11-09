/**
 * The Hanja key on a letter that is still composing (ㅁ, Hanja key, then ※ from the list).
 *
 * Microsoft's Korean input method does not convert inside the running
 * composition. It commits the letter, then opens a new composition over the
 * letter it just committed so the chosen candidate can replace it. In a plain
 * text box the browser replaces that text itself. Univer's editors keep their
 * text in the document model and empty their hidden input after every event,
 * and Univer starts every composition at the caret as a fresh insertion. So
 * the restarted composition put the letter in a second time ("ㅁㅁ" while the
 * candidate list was open), and the candidate then replaced only that second
 * copy ("ㅁ※"). Issue #443.
 *
 * Univer already replaces a selection when a composition starts on one
 * (IMEInputCommand deletes a non-collapsed start range). This module hands
 * the restarted composition that range: when a composition starts right
 * after the Hanja key committed one, with the committed text just before the
 * caret, the range recorded for it (DocIMEInputManagerService.setActiveRange)
 * covers that text instead of the bare caret.
 *
 * Only the Hanja key arms this. Typing the same letter twice (ㅋㅋ) also
 * commits one composition and starts the next with the same text, and must
 * stay two letters; there the key that did it is a letter key.
 */
import { DocIMEInputManagerService } from '@univerjs/docs-ui'

/** Univer's hidden input for each doc editor is `<div data-u-comp="editor" id="__editor_<unitId>">`. */
const EDITOR_ID_PREFIX = '__editor_'

/** How long after the key the restarted composition may begin. */
export const RESTART_WINDOW_MS = 1000

export interface KeyLike {
  readonly key: string
  readonly code: string
  readonly keyCode: number
}

/**
 * The Hanja key. While a letter composes, Windows reports it as the input
 * method's key (`Process`, 229) with the physical key's code: the dedicated
 * key (`Lang2`) or right Ctrl, which Korean layouts map to Hanja. Where the
 * system sends the key itself it is `HanjaMode` (25).
 */
export function isHanjaKey(event: KeyLike): boolean {
  if (event.key === 'HanjaMode' || event.keyCode === 25) return true
  return event.keyCode === 229 && (event.code === 'Lang2' || event.code === 'ControlRight')
}

interface Commit {
  readonly unitId: string
  readonly text: string
}

/**
 * Follows one editor's key and composition events and says when a
 * composition is the Hanja key's restart, and over which committed text.
 */
export class HanjaRestartTracker {
  private hanjaAt: number | null = null
  private commit: Commit | null = null

  keydown(event: KeyLike, now: number): void {
    // any other key in between means the next composition is the user's own
    this.hanjaAt = isHanjaKey(event) ? now : null
    this.commit = null
  }

  compositionEnd(unitId: string, data: string, now: number): void {
    this.commit = data && this.armed(now) ? { unitId, text: data } : null
  }

  /** The committed text the starting composition replaces, if it is the Hanja key's restart. */
  compositionStart(unitId: string, now: number): string | null {
    const commit = this.commit
    this.commit = null
    if (!commit || commit.unitId !== unitId || !this.armed(now)) return null
    this.hanjaAt = null
    return commit.text
  }

  private armed(now: number): boolean {
    return this.hanjaAt !== null && now - this.hanjaAt <= RESTART_WINDOW_MS
  }
}

export interface TextRangeLike {
  readonly startOffset: number
  readonly endOffset: number
  readonly collapsed: boolean
  readonly segmentId?: string
}

/**
 * The range a restarted composition should start on: the caret widened back
 * over `committed` when that is exactly the text before the caret, otherwise
 * the caret as it was.
 */
export function coverCommittedText<T extends TextRangeLike>(
  range: T,
  committed: string,
  dataStream: string,
): T {
  if (!range.collapsed || !committed) return range
  const start = range.startOffset - committed.length
  if (start < 0 || dataStream.slice(start, range.startOffset) !== committed) return range
  return { ...range, startOffset: start, collapsed: false }
}

interface DocModelLike {
  getSelfOrHeaderFooterModel?(segmentId: string): {
    getBody?(): { dataStream?: string } | undefined
  }
  getBody?(): { dataStream?: string } | undefined
}

function dataStreamOf(unit: DocModelLike | undefined, segmentId: string): string {
  const model = unit?.getSelfOrHeaderFooterModel?.(segmentId) ?? unit
  return model?.getBody?.()?.dataStream ?? ''
}

function editorUnitIdOf(target: EventTarget | null): string | null {
  const element = target as { id?: unknown; dataset?: { uComp?: string } } | null
  if (!element || element.dataset?.uComp !== 'editor' || typeof element.id !== 'string') return null
  return element.id.startsWith(EDITOR_ID_PREFIX) ? element.id.slice(EDITOR_ID_PREFIX.length) : null
}

/** The restart being started right now: set while its compositionstart is dispatched. */
let pending: { unitId: string; text: string } | null = null
let installed = false

export function installHanjaCompositionRestart(doc: Document = document): void {
  if (installed) return
  installed = true

  const proto = DocIMEInputManagerService.prototype as unknown as {
    setActiveRange(range: TextRangeLike | null): void
  }
  const setActiveRange = proto.setActiveRange
  proto.setActiveRange = function (
    this: { _context?: { unitId?: string; unit?: DocModelLike } },
    range: TextRangeLike | null,
  ): void {
    const restart = pending
    if (range && restart && restart.unitId === this._context?.unitId) {
      pending = null
      const stream = dataStreamOf(this._context?.unit, range.segmentId ?? '')
      range = coverCommittedText(range, restart.text, stream)
    }
    setActiveRange.call(this, range)
  }

  const tracker = new HanjaRestartTracker()
  // capture on the document: these run before Univer's own listeners on the input
  doc.addEventListener(
    'keydown',
    (event) => {
      if (editorUnitIdOf(event.target) !== null) tracker.keydown(event, Date.now())
    },
    true,
  )
  doc.addEventListener(
    'compositionend',
    (event) => {
      const unitId = editorUnitIdOf(event.target)
      if (unitId !== null) tracker.compositionEnd(unitId, event.data ?? '', Date.now())
    },
    true,
  )
  doc.addEventListener(
    'compositionstart',
    (event) => {
      const unitId = editorUnitIdOf(event.target)
      if (unitId === null) return
      const text = tracker.compositionStart(unitId, Date.now())
      if (text === null) return
      pending = { unitId, text }
      // Univer records the range while this event is dispatched; never let it outlive it
      setTimeout(() => {
        if (pending?.unitId === unitId) pending = null
      }, 0)
    },
    true,
  )
}
