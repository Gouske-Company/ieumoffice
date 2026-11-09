/**
 * The Hangul plan into engine calls on a borrowed document. Text and format
 * failures throw (an unformatted paragraph would be a silent loss); an
 * object the engine refuses (a picture, a note, a table) is reported and the
 * rest of the document is still written.
 */
import type { HwpDocument } from '@rhwp/core'
import { opsOf, ParagraphCursor, type Place, type PlaceOps, type Shaping } from './cursor'
import { call, callNumber, EngineCallError } from './engine'
import type { LossFeature, LossLedger } from './losses'
import type {
  Block,
  Border,
  Cell,
  CharShape,
  HwpPlan,
  Inline,
  Para,
  ParaShape,
  Story,
  Table,
} from './model'
import { ptFromHwp } from './units'

const SECTION = 0

/**
 * Body paragraphs per section while writing. Every paragraph format or style
 * call lays out its whole section again, even in batch mode, so one long
 * section makes the conversion quadratic (1,000 paragraphs took 42 s); the
 * sections are joined into one at the end. Of 50, 100, 200 and 400, sections
 * of 100 were fastest on both 100-page test documents.
 */
export const SECTION_CHUNK = 100

/**
 * The engine's seven font slots: Hangul, Latin, Hanja, Japanese, other, symbol, user.
 * Hangul, Hanja, Japanese and symbol take the East Asian face: Word draws the
 * ambiguous-width symbols of a Korean document (○, ※) with its East Asian font.
 */
const EAST_ASIAN_SLOTS: ReadonlySet<number> = new Set([0, 2, 3, 5])
const FONT_SLOTS = [0, 1, 2, 3, 4, 5, 6] as const

const LINE_TYPE = { percent: 'Percent', fixed: 'Fixed', atLeast: 'Minimum' } as const
const TAB_TYPE = { left: 0, right: 1, center: 2, decimal: 3 } as const
const TAB_FILL = { none: 0, solid: 1, dot: 2, dash: 3 } as const
const VERTICAL_ALIGN = { top: 0, center: 1, bottom: 2 } as const

/** document-wide tables the writer fills lazily: one engine id per font, list and style */
class WriteContext {
  private readonly fonts = new Map<string, number>()
  private readonly numberings = new Map<string, number>()
  private readonly bullets = new Map<string, number>()
  private readonly styles: Map<string, number>

  constructor(
    readonly doc: HwpDocument,
    readonly plan: HwpPlan,
    readonly ledger: LossLedger,
  ) {
    const list = call<Array<{ id: number; name: string }>>('styles', () => doc.getStyleList())
    this.styles = new Map(list.map((s) => [s.name, s.id]))
  }

  styleId(style: Para['style']): number {
    const name = style.kind === 'outline' ? `개요 ${style.level}` : '바탕글'
    return this.styles.get(name) ?? this.styles.get('바탕글') ?? 0
  }

  fontId(slot: number, face: string): number {
    const key = `${slot}\u0000${face}`
    let id = this.fonts.get(key)
    if (id === undefined) {
      id = callNumber('font', () => this.doc.findOrCreateFontIdForLang(slot, face))
      this.fonts.set(key, id)
    }
    return id
  }

  listIds(list: NonNullable<ParaShape['list']>): { headType: 'Number' | 'Bullet'; id: number } {
    if (list.kind === 'bullet') {
      let id = this.bullets.get(list.char)
      if (id === undefined) {
        id = callNumber('bullet', () => this.doc.ensureDefaultBullet(list.char))
        this.bullets.set(list.char, id)
      }
      return { headType: 'Bullet', id }
    }
    let id = this.numberings.get(list.numbering)
    if (id === undefined) {
      const plan = this.plan.numberings.get(list.numbering)!
      const json = JSON.stringify({
        levelFormats: plan.levelFormats,
        numberFormats: plan.numberFormats,
        startNumber: plan.start,
      })
      id = callNumber('numbering', () => this.doc.createNumbering(json))
      this.numberings.set(list.numbering, id)
    }
    return { headType: 'Number', id }
  }
}

export function writePlan(
  doc: HwpDocument,
  plan: HwpPlan,
  ledger: LossLedger,
  sectionChunk = SECTION_CHUNK,
): void {
  const cx = new WriteContext(doc, plan, ledger)
  writePage(cx)
  writeBody(cx, plan.body, sectionChunk)
  for (const [header, story] of [
    [true, plan.header],
    [false, plan.footer],
  ] as const) {
    if (!story) continue
    call('header or footer', () => doc.createHeaderFooter(SECTION, header, 0))
    writeStory(cx, opsOf(doc, { kind: 'hf', sec: SECTION, header }), story)
  }
}

function writePage(cx: WriteContext): void {
  const current = call<Record<string, unknown>>('page', () => cx.doc.getPageDef(SECTION))
  const { page } = cx.plan
  const json = JSON.stringify({ ...current, ...page })
  call('page setup', () => cx.doc.setPageDef(SECTION, json))
}

/** the body in sections of `chunk` paragraphs, joined into the first one at the end */
function writeBody(cx: WriteContext, body: Story, chunk: number): void {
  const doc = cx.doc
  let sec = SECTION
  let ops = opsOf(doc, { kind: 'body', sec })
  const cursor = new ParagraphCursor(ops)
  body.forEach((block, i) => {
    if (i > 0 && i % chunk === 0) {
      // the spare moves whole into the new section, which takes this one's page setup
      call('section', () => doc.splitSection(sec, ops.count() - 1, 0))
      sec++
      ops = opsOf(doc, { kind: 'body', sec })
      cursor.moveTo(ops)
    }
    writeBlock(cx, ops, cursor, block)
  })
  for (let s = sec; s > SECTION; s--) call('section', () => doc.mergeSection(s))
  cursor.moveTo(opsOf(doc, { kind: 'body', sec: SECTION }))
  cursor.close()
}

function writeStory(cx: WriteContext, ops: PlaceOps, story: Story): void {
  const cursor = new ParagraphCursor(ops)
  for (const block of story) writeBlock(cx, ops, cursor, block)
  cursor.close()
}

function writeBlock(cx: WriteContext, ops: PlaceOps, cursor: ParagraphCursor, block: Block): void {
  if (block.kind === 'para') writePara(cx, ops, cursor.start(paraShaping(cx, block)), block)
  else writeTable(cx, ops, cursor.start(tableShaping(cx, block)), block)
}

function paraShaping(cx: WriteContext, para: Para): Shaping {
  return shapingOf(cx.styleId(para.style), paraJson(cx, para.shape))
}

/** a table sits in a body paragraph, whatever style the paragraph before it had */
function tableShaping(cx: WriteContext, table: Table): Shaping {
  return shapingOf(cx.styleId({ kind: 'body' }), tableParaJson(table))
}

function shapingOf(styleId: number, json: string): Shaping {
  return {
    key: `${styleId}|${json}`,
    apply: (ops, p) => {
      // a style sets the paragraph shape too: the shape goes on after it
      ops.applyStyle?.(p, styleId)
      ops.applyPara(p, json)
    },
  }
}

function writePara(cx: WriteContext, ops: PlaceOps, p: number, para: Para): void {
  let run: Array<{ text: string; chars: CharShape }> = []
  const flush = () => {
    if (run.length === 0) return
    const pieces = run
    run = []
    let at = ops.length(p)
    // one insert per stretch: every insert re-lays the paragraph out
    ops.insertText(p, at, pieces.map((piece) => piece.text).join(''))
    for (const piece of pieces) {
      const end = at + codePoints(piece.text)
      ops.applyChars?.(p, at, end, charJson(cx, piece.chars))
      at = end
    }
  }
  for (const inline of para.inlines) {
    if (inline.kind === 'text') {
      run.push(inline)
      continue
    }
    flush()
    writeObject(cx, ops, p, inline)
  }
  flush()
}

function writeObject(
  cx: WriteContext,
  ops: PlaceOps,
  p: number,
  inline: Exclude<Inline, { kind: 'text' }>,
): void {
  const where = `${placeKey(ops.place)}/p${p}`
  switch (inline.kind) {
    case 'field': {
      if (!ops.insertField) return cx.ledger.note('field', where)
      const at = ops.length(p)
      ops.insertField(p, at, inline.field)
      ops.applyChars?.(p, at, ops.length(p), charJson(cx, inline.chars))
      return
    }
    case 'picture':
      return refusable(cx, ops.place.kind === 'hf' ? 'header_content' : 'picture', where, () => {
        if (!ops.insertPicture) throw new EngineCallError('picture', 'not in this place')
        ops.insertPicture(p, ops.length(p), inline.picture)
      })
    case 'note':
      return refusable(cx, 'note', where, () => {
        if (!ops.insertNote) throw new EngineCallError('note', 'not in this place')
        const control = ops.insertNote(p, ops.length(p), inline.note)
        writeNote(cx.doc, ops.place.sec, p, control, inline.paras)
      })
    case 'pageBreak':
      // lowering turns page breaks into paragraphs that start a page
      return
  }
}

/** an engine refusal of one object is reported; the document goes on */
function refusable(cx: WriteContext, feature: LossFeature, where: string, write: () => void): void {
  try {
    write()
  } catch (err) {
    if (!(err instanceof EngineCallError)) throw err
    cx.ledger.note(feature, where)
  }
}

/**
 * Note text goes after the note's own number. A note holds only text, so its
 * paragraphs can be split at their ends.
 */
function writeNote(
  doc: HwpDocument,
  sec: number,
  para: number,
  control: number,
  paras: readonly string[],
): void {
  // a fresh note's only paragraph holds its number: the text starts after it
  const lengthOf = (i: number) =>
    codePoints(
      call<{ texts: string[] }>('note', () => doc.getFootnoteInfo(sec, para, control)).texts[i] ??
        '',
    )
  paras.forEach((text, i) => {
    if (i > 0) {
      const at = lengthOf(i - 1)
      call('note paragraph', () => doc.splitParagraphInFootnote(sec, para, control, i - 1, at))
    }
    if (!text) return
    const at = lengthOf(i)
    call('note text', () => doc.insertTextInFootnote(sec, para, control, i, at, text))
  })
}

// ---------------------------------------------------------------- tables

/**
 * The table's frame comes from the engine's HTML paste: spans, widths, row
 * heights and borders, with empty cells. Cell content then goes through the
 * same paragraph writer as everything else, and fills are set per cell so the
 * table itself carries none.
 */
function writeTable(cx: WriteContext, ops: PlaceOps, p: number, table: Table): void {
  const where = `${placeKey(ops.place)}/p${p}`
  const paste = ops.pasteTable
  if (!paste) return cx.ledger.note('table', where)
  const doc = cx.doc
  const sec = ops.place.sec
  let control: number
  try {
    control = paste(p, skeletonHtml(table))
  } catch (err) {
    if (!(err instanceof EngineCallError)) throw err
    return cx.ledger.note('table', where)
  }
  // the paste gives the paragraph its own shape: the table's alignment goes on after it
  ops.applyPara(p, tableParaJson(table))
  const cellCount = call<{ cellCount: number }>('table', () =>
    doc.getTableDimensions(sec, p, control),
  ).cellCount
  const byGrid = new Map(table.cells.map((cell) => [`${cell.row},${cell.col}`, cell]))
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const info = call<{ row: number; col: number }>('cell', () =>
      doc.getCellInfo(sec, p, control, cellIndex),
    )
    const cell = byGrid.get(`${info.row},${info.col}`)
    if (!cell) continue
    const place: Place = {
      kind: 'cell',
      sec: sec,
      para: p,
      step: { controlIndex: control, cellIndex, cellParaIndex: 0 },
    }
    writeStory(cx, opsOf(doc, place), cell.body)
    call('cell properties', () =>
      doc.setCellProperties(sec, p, control, cellIndex, cellJson(cell, table)),
    )
  }
  if (table.repeatHeader) {
    call('table properties', () =>
      doc.setTableProperties(sec, p, control, JSON.stringify({ repeatHeader: true })),
    )
  }
}

const BORDER_CSS: Record<Border['style'], string> = {
  none: 'none',
  solid: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
  double: 'double',
}

function borderCss(side: string, border: Border): string {
  if (border.style === 'none') return `border-${side}:none`
  return `border-${side}:${border.widthPt}pt ${BORDER_CSS[border.style]} ${border.color}`
}

function skeletonHtml(table: Table): string {
  const widthOf = (cell: Cell) =>
    table.colWidths.slice(cell.col, cell.col + cell.colSpan).reduce((pt, w) => pt + ptFromHwp(w), 0)
  const rows = table.rowHeights.map((height, r) => {
    const cells = table.cells
      .filter((cell) => cell.row === r)
      .map((cell) => {
        const style = [
          `width:${widthOf(cell)}pt`,
          ...(height ? [`height:${ptFromHwp(height)}pt`] : []),
          borderCss('top', cell.borders.top),
          borderCss('right', cell.borders.right),
          borderCss('bottom', cell.borders.bottom),
          borderCss('left', cell.borders.left),
        ].join(';')
        const spans = `${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''}${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ''}`
        return `<td${spans} style="${style}"></td>`
      })
      .join('')
    return `<tr>${cells}</tr>`
  })
  return `<table style="border-collapse:collapse">${rows.join('')}</table>`
}

function cellJson(cell: Cell, table: Table): string {
  return JSON.stringify({
    verticalAlign: VERTICAL_ALIGN[cell.vAlign],
    paddingTop: cell.padding.top,
    paddingRight: cell.padding.right,
    paddingBottom: cell.padding.bottom,
    paddingLeft: cell.padding.left,
    applyInnerMargin: true,
    ...(table.repeatHeader && cell.row === 0 ? { isHeader: true } : {}),
    // pattern -1 is none: left out, the engine puts in 0, which Hangul draws as lines
    ...(cell.fill ? { fillType: 'solid', fillColor: cell.fill, patternType: -1 } : {}),
  })
}

function tableParaJson(table: Table): string {
  return JSON.stringify({
    alignment: table.align,
    marginLeft: 0,
    marginRight: 0,
    indent: 0,
    spacingBefore: 0,
    spacingAfter: 0,
    lineSpacingType: 'Percent',
    lineSpacing: 100,
    pageBreakBefore: false,
    tabStops: [],
    headType: 'None',
    numberingId: 0,
    paraLevel: 0,
  })
}

// ---------------------------------------------------------------- formats

function paraJson(cx: WriteContext, shape: ParaShape): string {
  const list = shape.list ? cx.listIds(shape.list) : null
  return JSON.stringify({
    alignment: shape.align,
    marginLeft: shape.marginLeft,
    marginRight: shape.marginRight,
    indent: shape.indent,
    spacingBefore: shape.before,
    spacingAfter: shape.after,
    lineSpacingType: LINE_TYPE[shape.line.kind],
    lineSpacing: shape.line.kind === 'percent' ? shape.line.percent : shape.line.value,
    pageBreakBefore: shape.pageBreakBefore,
    keepWithNext: shape.keepWithNext,
    keepLines: shape.keepLines,
    widowOrphan: shape.widowOrphan,
    tabStops: shape.tabStops.map((tab) => ({
      position: tab.position,
      type: TAB_TYPE[tab.align],
      fill: TAB_FILL[tab.leader],
    })),
    // the Word text carries its own heading numbers, if any
    headType: list?.headType ?? 'None',
    numberingId: list?.id ?? 0,
    paraLevel: shape.list?.level ?? 0,
  })
}

function charJson(cx: WriteContext, chars: CharShape): string {
  return JSON.stringify({
    bold: chars.bold,
    italic: chars.italic,
    underline: chars.underline,
    strikethrough: chars.strike,
    textColor: chars.color,
    shadeColor: chars.shade ?? '#ffffff',
    fontSize: chars.size,
    superscript: chars.script === 'superscript',
    subscript: chars.script === 'subscript',
    fontIds: FONT_SLOTS.map((slot) =>
      cx.fontId(slot, EAST_ASIAN_SLOTS.has(slot) ? chars.eastAsiaFace : chars.latinFace),
    ),
    spacings: FONT_SLOTS.map(() => chars.spacing),
    ratios: FONT_SLOTS.map(() => chars.ratio),
  })
}

/** the engine counts characters; a string counts UTF-16 units */
const codePoints = (text: string): number => {
  let n = 0
  for (const _ of text) n++
  return n
}

function placeKey(place: Place): string {
  switch (place.kind) {
    case 'body':
      return 'body'
    case 'cell':
      return `cell${place.para}.${place.step.cellIndex}`
    case 'hf':
      return place.header ? 'header' : 'footer'
  }
}
