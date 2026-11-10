/**
 * Where paragraphs are written, and the one rule for writing them.
 *
 * The engine splits paragraphs at a text offset, and tables, pictures and
 * notes have no text length: splitting a written paragraph at its end carries
 * them into the next one. So a place always ends in an empty spare paragraph.
 * Starting a paragraph splits the spare at offset 0, which makes an empty
 * paragraph to write into and a fresh spare after it; a written paragraph is
 * never split again. Closing removes the last spare, so a table cell keeps
 * Word's paragraph count.
 *
 * The spare is shaped before it is split, so both halves carry the shape: a
 * paragraph shaped like the one before it needs no format call. That matters
 * because every paragraph format call lays out its whole section again.
 */
import type { HwpDocument } from '@rhwp/core'
import { call, callNumber } from './engine'
import type { Picture } from './model'

export interface CellStep {
  readonly controlIndex: number
  readonly cellIndex: number
  readonly cellParaIndex: number
}

export type Place =
  | { readonly kind: 'body'; readonly sec: number }
  /** a top-level table's cell: `para` is the body paragraph holding the table */
  | { readonly kind: 'cell'; readonly sec: number; readonly para: number; readonly step: CellStep }
  | { readonly kind: 'hf'; readonly sec: number; readonly header: boolean }

/** the engine field types a header or footer paragraph takes */
export const HF_FIELD = { page: 1, pageCount: 2 } as const

/**
 * The engine calls one place supports, in one shape. A missing call is one
 * the place cannot do; the writer reports instead of calling.
 */
export interface PlaceOps {
  readonly place: Place
  count(): number
  /** in code points: the engine counts characters, not UTF-16 units */
  length(p: number): number
  split(p: number, at: number): void
  /** joins paragraph p into p - 1 */
  merge(p: number): void
  insertText(p: number, at: number, text: string): void
  applyChars?(p: number, from: number, to: number, json: string): void
  applyPara(p: number, json: string): void
  applyStyle?(p: number, styleId: number): void
  insertField?(p: number, at: number, field: keyof typeof HF_FIELD): void
  insertPicture?(p: number, at: number, picture: Picture): void
  insertNote?(p: number, at: number, kind: 'footnote' | 'endnote'): number
  /** pastes a table skeleton into the empty paragraph p; answers its control index */
  pasteTable?(p: number, html: string): number
}

export function opsOf(doc: HwpDocument, place: Place): PlaceOps {
  switch (place.kind) {
    case 'body':
      return bodyOps(doc, place)
    case 'cell':
      return cellOps(doc, place)
    case 'hf':
      return headerFooterOps(doc, place)
  }
}

function bodyOps(doc: HwpDocument, place: Place & { kind: 'body' }): PlaceOps {
  const sec = place.sec
  return {
    place,
    count: () => doc.getParagraphCount(sec),
    length: (p) => doc.getParagraphLength(sec, p),
    split: (p, at) => void call('split paragraph', () => doc.splitParagraph(sec, p, at)),
    merge: (p) => void call('merge paragraph', () => doc.mergeParagraph(sec, p)),
    insertText: (p, at, text) => void call('insert text', () => doc.insertText(sec, p, at, text)),
    applyChars: (p, from, to, json) =>
      void call('character format', () => doc.applyCharFormat(sec, p, from, to, json)),
    applyPara: (p, json) => void call('paragraph format', () => doc.applyParaFormat(sec, p, json)),
    applyStyle: (p, styleId) => void call('style', () => doc.applyStyle(sec, p, styleId)),
    insertPicture: (p, at, pic) => {
      const made = call<{ controlIdx: number }>('picture', () =>
        doc.insertPicture(
          sec,
          p,
          at,
          '',
          pic.bytes,
          pic.width,
          pic.height,
          pic.widthPx,
          pic.heightPx,
          pic.ext,
          '',
        ),
      )
      call('picture placement', () =>
        doc.setPictureProperties(sec, p, made.controlIdx, JSON.stringify({ treatAsChar: true })),
      )
    },
    insertNote: (p, at, kind) =>
      call<{ controlIdx: number }>(kind, () =>
        kind === 'footnote' ? doc.insertFootnote(sec, p, at) : doc.insertEndnote(sec, p, at),
      ).controlIdx,
    pasteTable: (p, html) => {
      const before = (JSON.parse(doc.getControlTextPositions(sec, p)) as unknown[]).length
      call('table', () => doc.pasteHtml(sec, p, 0, html))
      return before
    },
  }
}

function cellOps(doc: HwpDocument, place: Place & { kind: 'cell' }): PlaceOps {
  const { sec, para } = place
  const path = (p: number) => JSON.stringify([{ ...place.step, cellParaIndex: p }])
  return {
    place,
    count: () =>
      callNumber('cell paragraphs', () => doc.getCellParagraphCountByPath(sec, para, path(0))),
    length: (p) =>
      callNumber('cell paragraph', () => doc.getCellParagraphLengthByPath(sec, para, path(p))),
    split: (p, at) =>
      void call('split cell paragraph', () =>
        doc.splitParagraphInCellByPath(sec, para, path(p), at),
      ),
    merge: (p) =>
      void call('merge cell paragraph', () => doc.mergeParagraphInCellByPath(sec, para, path(p))),
    insertText: (p, at, text) =>
      void call('insert cell text', () => doc.insertTextInCellByPath(sec, para, path(p), at, text)),
    applyChars: (p, from, to, json) =>
      void call('cell character format', () =>
        doc.applyCharFormatInCellByPath(sec, para, path(p), from, to, json),
      ),
    applyPara: (p, json) =>
      void call('cell paragraph format', () =>
        doc.applyParaFormatInCellByPath(sec, para, path(p), json),
      ),
    insertPicture: (p, at, pic) => {
      const made = call<{ controlIdx: number }>('cell picture', () =>
        doc.insertPictureInCell(
          sec,
          para,
          at,
          path(p),
          pic.bytes,
          pic.width,
          pic.height,
          pic.widthPx,
          pic.heightPx,
          pic.ext,
          '',
        ),
      )
      call('cell picture placement', () =>
        doc.setCellPicturePropertiesByPath(
          sec,
          para,
          path(p),
          made.controlIdx,
          JSON.stringify({ treatAsChar: true }),
        ),
      )
    },
  }
}

function headerFooterOps(doc: HwpDocument, place: Place & { kind: 'hf' }): PlaceOps {
  const { sec, header } = place
  const info = (p: number) =>
    call<{ paraCount: number; charCount: number }>('header paragraph', () =>
      doc.getHeaderFooterParaInfo(sec, header, 0, p),
    )
  return {
    place,
    count: () => info(0).paraCount,
    length: (p) => info(p).charCount,
    split: (p, at) =>
      void call('split header paragraph', () =>
        doc.splitParagraphInHeaderFooter(sec, header, 0, p, at),
      ),
    merge: (p) =>
      void call('merge header paragraph', () =>
        doc.mergeParagraphInHeaderFooter(sec, header, 0, p),
      ),
    insertText: (p, at, text) =>
      void call('insert header text', () =>
        doc.insertTextInHeaderFooter(sec, header, 0, p, at, text),
      ),
    applyChars: (p, from, to, json) =>
      void call('header character format', () =>
        doc.applyCharFormatInHeaderFooter(sec, header, 0, p, from, p, to, json),
      ),
    applyPara: (p, json) =>
      void call('header paragraph format', () => doc.applyParaFormatInHf(sec, header, 0, p, json)),
    insertField: (p, at, field) =>
      void call('header field', () => doc.insertFieldInHf(sec, header, 0, p, at, HF_FIELD[field])),
  }
}

/** a paragraph's style and shape: `key` names it, `apply` gives it to a paragraph */
export interface Shaping {
  readonly key: string
  apply(ops: PlaceOps, p: number): void
}

/** Owns the trailing-spare rule for one place (see the module comment). */
export class ParagraphCursor {
  private written = 0
  /** the shape the spare carries; null = the place's own */
  private spareShape: string | null = null

  constructor(private ops: PlaceOps) {}

  /** opens an empty paragraph of this shape before the spare and answers its index */
  start(shaping: Shaping): number {
    // derived every time: an engine call inside a paragraph cannot desynchronize it
    const spare = this.ops.count() - 1
    if (shaping.key !== this.spareShape) {
      shaping.apply(this.ops, spare)
      this.spareShape = shaping.key
    }
    this.ops.split(spare, 0)
    this.written++
    return spare
  }

  /** the spare moved to another place (a new body section): go on writing there */
  moveTo(ops: PlaceOps): void {
    this.ops = ops
    // the move may have reshaped the spare
    this.spareShape = null
  }

  /** removes the spare; a place nothing was written to keeps its own paragraph */
  close(): void {
    if (this.written > 0) this.ops.merge(this.ops.count() - 1)
  }
}
