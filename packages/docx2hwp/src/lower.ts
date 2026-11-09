/**
 * docx-engine's model to the Hangul plan: pure, no engine. Everything the
 * plan cannot hold is noted in the ledger here, so the report exists before
 * any engine call.
 */
import {
  PAGE_MARK,
  SECTION_PAGES_MARK,
  TOTAL_PAGES_MARK,
  decodeSymbolText,
  isSymbolFont,
  readSections,
  readSectionSettings,
  type Block as WordBlock,
  type BlockType,
  type CellBorder,
  type HfParagraph,
  type NoteInfo,
  type NumberingDef,
  type NumberingLevel,
  type ParaFormat,
  type ParsedDoc,
  type Run,
  type TableCell,
  type TableModel,
  type TabStop as WordTabStop,
} from '@genoffice/docx-engine'
import type { LossFeature, LossLedger } from './losses'
import type {
  Align,
  Block,
  Border,
  Cell,
  CharShape,
  HwpPlan,
  Inline,
  LineSpacing,
  ListRef,
  NumberingPlan,
  PageSetup,
  Para,
  ParaShape,
  Picture,
  Story,
  TabStop,
  Table,
} from './model'
import {
  fillOf,
  highlightOf,
  hwpFromHalfPoints,
  hwpFromPx,
  hwpFromTwips,
  paraFromTwips,
  percentFromAutoLine,
  ratioPercent,
  rgbOf,
  spacingPercent,
  type HwpUnit,
} from './units'

/** Hangul's own body face: kept for a slot the Word run leaves empty */
export const DEFAULT_FACE = '함초롬바탕'

/** Word's HTML auto spacing (w:beforeAutospacing): 14 pt */
const AUTO_SPACING_TWIPS = 280
/** Word's default cell margins: 0.08 inch left and right, none above and below */
const WORD_CELL_MARGIN_LR = 108
/** Hangul numbering has seven levels */
const MAX_LEVEL = 6

/** faces with no Hangul or Hanja glyphs: never put on the East Asian slots */
const LATIN_ONLY_FACE =
  /^(calibri|calibri light|cambria|aptos|arial|times new roman|verdana|tahoma|georgia|segoe ui|helvetica|courier new|consolas|garamond|trebuchet ms|century gothic|book antiqua|liberation (sans|serif|mono))$/i

type Place = 'body' | 'cell' | 'hf'

interface Cx {
  readonly parsed: ParsedDoc
  readonly ledger: LossLedger
  /** body width in twips: the base of percent widths */
  readonly bodyTwips: number
  readonly numberings: Map<string, NumberingPlan>
}

export function lowerDocument(parsed: ParsedDoc, ledger: LossLedger): HwpPlan {
  const sections = readSections(parsed)
  const settings = sections[0]?.settings ?? readSectionSettings(parsed)
  sections.forEach((section, i) => {
    if (i > 0) ledger.note('section', `s${i}`)
    if (section.settings.columns > 1) ledger.note('columns', `s${i}`)
    if (section.settings.lineNumbers) ledger.note('line_numbers', `s${i}`)
    if (section.settings.pageBorder) ledger.note('page_border', `s${i}`)
    if (section.settings.textDirection && section.settings.textDirection !== 'lrTb') {
      ledger.note('text_direction', `s${i}`)
    }
  })
  const cx: Cx = {
    parsed,
    ledger,
    bodyTwips: Math.max(1, settings.pageWidth - settings.marginLeft - settings.marginRight),
    numberings: new Map(),
  }
  noteDocumentLosses(cx)
  return {
    page: pageOf(settings),
    header: headerFooterOf(cx, 'header'),
    footer: headerFooterOf(cx, 'footer'),
    body: lowerBody(cx, parsed.blocks),
    numberings: cx.numberings,
  }
}

function noteDocumentLosses(cx: Cx): void {
  const { parsed, ledger } = cx
  for (const comment of parsed.comments) ledger.note('comment', `c${comment.id}`)
  parsed.inks.forEach((_, i) => ledger.note('ink', `i${i}`))
  if (parsed.watermarkText || parsed.watermarkPicture) ledger.note('watermark', 'w')
  if (parsed.protection?.enforced) ledger.note('protection', 'p')
}

// ---------------------------------------------------------------- page

function pageOf(s: ReturnType<typeof readSectionSettings>): PageSetup {
  // Hangul gives the paper upright and turns it with the landscape flag
  const landscape = s.pageWidth > s.pageHeight
  const headerDist = Math.min(s.headerDist ?? 720, s.marginTop)
  const footerDist = Math.min(s.footerDist ?? 720, s.marginBottom)
  return {
    width: hwpFromTwips(Math.min(s.pageWidth, s.pageHeight)),
    height: hwpFromTwips(Math.max(s.pageWidth, s.pageHeight)),
    landscape,
    // Word's top margin reaches the body; Hangul's body starts below its top margin plus the header band
    marginTop: hwpFromTwips(headerDist),
    marginHeader: hwpFromTwips(s.marginTop - headerDist),
    marginBottom: hwpFromTwips(footerDist),
    marginFooter: hwpFromTwips(s.marginBottom - footerDist),
    marginLeft: hwpFromTwips(s.marginLeft - (s.gutterAtTop ? 0 : (s.gutter ?? 0))),
    marginRight: hwpFromTwips(s.marginRight),
    marginGutter: hwpFromTwips(s.gutterAtTop ? 0 : (s.gutter ?? 0)),
  }
}

// ---------------------------------------------------------------- body

/** one entry per docx-engine block type: a new type fails the build until it is lowered */
const BLOCK_LOWERINGS: { [T in BlockType]: (cx: Cx, block: WordBlock, where: string) => Block[] } =
  {
    paragraph: (cx, block, where) => paragraphBlocks(cx, block, where),
    heading: (cx, block, where) => paragraphBlocks(cx, block, where),
    listItem: (cx, block, where) => paragraphBlocks(cx, block, where),
    table: (cx, block, where) => (block.table ? [tableOf(cx, block.table, where)] : []),
    image: (cx, block, where) => imageBlocks(cx, block, where),
    passthrough: (cx, block, where) => passthroughBlocks(cx, block, where),
  }

function lowerBody(cx: Cx, blocks: readonly WordBlock[]): Story {
  const out: Block[] = []
  const styleIds: (string | undefined)[] = []
  const contextual: boolean[] = []
  blocks.forEach((block, i) => {
    const where = `b${i}`
    noteBlockLosses(cx, block, where)
    if (block.blockRevision?.kind === 'del' || block.moveRevision === 'from') return
    for (const lowered of BLOCK_LOWERINGS[block.type](cx, block, where)) {
      out.push(lowered)
      styleIds.push(block.styleId)
      contextual.push(
        (block.format?.effective?.contextualSpacing ?? block.format?.contextualSpacing) === true,
      )
    }
  })
  return withContextualSpacing(out, styleIds, contextual)
}

/**
 * Word drops the space between two paragraphs of one style when they ask for
 * it (w:contextualSpacing, on by default for list paragraphs).
 */
function withContextualSpacing(
  blocks: Block[],
  styleIds: (string | undefined)[],
  contextual: boolean[],
): Block[] {
  return blocks.map((block, i) => {
    if (block.kind !== 'para') return block
    const prev = blocks[i - 1]
    const next = blocks[i + 1]
    const samePrev = prev?.kind === 'para' && styleIds[i - 1] === styleIds[i]
    const sameNext = next?.kind === 'para' && styleIds[i + 1] === styleIds[i]
    if (!contextual[i] || (!samePrev && !sameNext)) return block
    const shape = {
      ...block.shape,
      before: samePrev ? paraFromTwips(0) : block.shape.before,
      after: sameNext ? paraFromTwips(0) : block.shape.after,
    }
    return { ...block, shape }
  })
}

function noteBlockLosses(cx: Cx, block: WordBlock, where: string): void {
  const { ledger } = cx
  if (
    block.blockRevision ||
    block.moveRevision ||
    block.paraMarkDel ||
    block.paraMarkIns ||
    block.paraMarkRPrChange ||
    block.pPrChangeInfo ||
    block.numberingChange
  ) {
    ledger.note('revision', where)
  }
  block.textboxes?.forEach((_, i) => ledger.note('textbox', `${where}/t${i}`))
}

function paragraphBlocks(cx: Cx, block: WordBlock, where: string): Block[] {
  const format = block.format ?? {}
  const runs = block.runs ?? []
  const visible = runs.filter((run) => !isHiddenRun(run))
  if (format.effective?.hidden && runs.length > 0 && visible.length === 0) {
    cx.ledger.note('hidden_text', where)
    return []
  }
  const style: Para['style'] =
    block.type === 'heading' && block.level && !block.outlineOnly
      ? { kind: 'outline', level: Math.min(10, Math.max(1, block.level)) }
      : { kind: 'body' }
  const list = listOf(cx, block.list ?? format.effective?.list, where)
  const shape = paraShapeOf(cx, format, where, list)
  const stray = block.strayRuns?.length
    ? [paraOf({ kind: 'body' }, shape, inlinesOf(cx, block.strayRuns, where, 'body'))]
    : []
  return [...stray, ...splitAtPageBreaks(style, shape, inlinesOf(cx, runs, where, 'body'))]
}

const paraOf = (style: Para['style'], shape: ParaShape, inlines: readonly Inline[]): Para => ({
  kind: 'para',
  style,
  shape,
  inlines,
})

/**
 * A Word page break inside a paragraph: what follows continues as a new
 * paragraph of the same shape that starts a page. The writer never splits a
 * written paragraph, so a footnote before the break stays where it is.
 */
function splitAtPageBreaks(
  style: Para['style'],
  shape: ParaShape,
  inlines: readonly Inline[],
): Para[] {
  const paras: Para[] = []
  let current: Inline[] = []
  let first = true
  const flush = () => {
    paras.push(paraOf(style, first ? shape : { ...shape, pageBreakBefore: true }, current))
    current = []
    first = false
  }
  for (const inline of inlines) {
    if (inline.kind === 'pageBreak') flush()
    else current.push(inline)
  }
  flush()
  return paras
}

// ---------------------------------------------------------------- paragraph shape

const ALIGN: Readonly<Record<string, Align>> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  justify: 'justify',
  both: 'justify',
  distribute: 'distribute',
}

function paraShapeOf(cx: Cx, format: ParaFormat, where: string, list: ListRef | null): ParaShape {
  const e = format.effective
  const left = e?.indent.left ?? format.indentLeft ?? 0
  const right = e?.indent.right ?? format.indentRight ?? 0
  const firstLine = e?.indent.firstLine ?? format.indentFirstLine ?? 0
  const beforeAuto = e?.spacing.beforeAuto ?? format.spaceBeforeAuto
  const afterAuto = e?.spacing.afterAuto ?? format.spaceAfterAuto
  const before = beforeAuto ? AUTO_SPACING_TWIPS : (e?.spacing.before ?? format.spaceBefore ?? 0)
  const after = afterAuto ? AUTO_SPACING_TWIPS : (e?.spacing.after ?? format.spaceAfter ?? 0)
  if (e?.borders && Object.values(e.borders).some(Boolean)) cx.ledger.note('para_border', where)
  else if (e?.shading ?? format.shadingFill) cx.ledger.note('para_border', where)
  if (format.dropCap) cx.ledger.note('text_effect', where)
  return {
    align: ALIGN[e?.align ?? format.align ?? 'left'] ?? 'left',
    // Word hangs the first line left of the indent, Hangul pushes the other lines right
    marginLeft: paraFromTwips(left + Math.min(firstLine, 0)),
    marginRight: paraFromTwips(right),
    indent: paraFromTwips(firstLine),
    before: paraFromTwips(before),
    after: paraFromTwips(after),
    line: lineOf(e?.spacing.line ?? lineFromFormat(format)),
    pageBreakBefore: e?.pageBreakBefore ?? format.pageBreakBefore ?? false,
    keepWithNext: e?.keepNext ?? format.keepNext ?? false,
    keepLines: e?.keepLines ?? format.keepLines ?? false,
    widowOrphan: e?.widowControl ?? format.widowControl ?? true,
    tabStops: tabStopsOf(cx, e?.tabStops ?? format.tabStops ?? [], where),
    list,
  }
}

function lineFromFormat(format: ParaFormat): { rule: 'auto' | 'atLeast' | 'exact'; raw: number } {
  if (format.lineRule === 'exact' || format.lineRule === 'atLeast') {
    return { rule: format.lineRule, raw: format.lineRawTwips ?? 240 }
  }
  return { rule: 'auto', raw: Math.round((format.lineSpacing ?? 1) * 240) }
}

function lineOf(line: { rule: 'auto' | 'atLeast' | 'exact'; raw: number }): LineSpacing {
  if (line.rule === 'exact') return { kind: 'fixed', value: paraFromTwips(line.raw) }
  if (line.rule === 'atLeast') return { kind: 'atLeast', value: paraFromTwips(line.raw) }
  return { kind: 'percent', percent: percentFromAutoLine(line.raw) }
}

const TAB_ALIGN: Readonly<Record<string, TabStop['align']>> = {
  left: 'left',
  start: 'left',
  right: 'right',
  end: 'right',
  center: 'center',
  decimal: 'decimal',
}
const TAB_LEADER: Readonly<Record<string, TabStop['leader']>> = {
  none: 'none',
  dot: 'dot',
  hyphen: 'dash',
  underscore: 'solid',
}

function tabStopsOf(cx: Cx, stops: readonly WordTabStop[], where: string): TabStop[] {
  const out: TabStop[] = []
  for (const stop of stops) {
    if (stop.val === 'clear' || stop.rel) continue
    const align = TAB_ALIGN[stop.val]
    const leader = TAB_LEADER[stop.leader ?? 'none']
    if (!align) {
      cx.ledger.note('tab_stop', where)
      continue
    }
    if (!leader) cx.ledger.note('tab_stop', where)
    out.push({ position: paraFromTwips(stop.pos), align, leader: leader ?? 'dot' })
  }
  return out.sort((a, b) => a.position - b.position)
}

// ---------------------------------------------------------------- lists

/** Word number formats Hangul draws the same way */
const NUMBER_FORMAT: Readonly<Record<string, number>> = {
  decimal: 0,
  decimalEnclosedCircle: 1,
  upperRoman: 2,
  lowerRoman: 3,
  upperLetter: 4,
  lowerLetter: 5,
  ganada: 8,
  chosung: 10,
  koreanDigital: 12,
  koreanCounting: 12,
  koreanDigital2: 12,
  ideographDigital: 13,
  chineseCounting: 13,
  japaneseCounting: 13,
  taiwaneseCounting: 13,
  ideographTraditional: 15,
  ideographZodiac: 16,
}

const DEFAULT_BULLET = '●'

function listOf(
  cx: Cx,
  ref: { numId: string; ilvl: number } | undefined,
  where: string,
): ListRef | null {
  if (!ref) return null
  const def = cx.parsed.numbering.get(ref.numId)
  const levelDef = def?.levels[ref.ilvl]
  if (!def || !levelDef || levelDef.numFmt === 'none') return null
  if (ref.ilvl > MAX_LEVEL) cx.ledger.note('numbering', where)
  const level = Math.min(ref.ilvl, MAX_LEVEL)
  if (levelDef.numFmt === 'bullet') {
    if (levelDef.picBulletId !== undefined) cx.ledger.note('numbering', where)
    return { kind: 'bullet', char: bulletChar(levelDef), level }
  }
  const key = numberingKey(def)
  if (!cx.numberings.has(key)) cx.numberings.set(key, numberingOf(cx, def, `n${key}`))
  return { kind: 'number', numbering: key, level }
}

/** numbers continue across Word lists that share an abstract list, unless one restarts */
const numberingKey = (def: NumberingDef): string =>
  Object.keys(def.startOverrides).length > 0
    ? `${def.abstractNumId}#${def.numId}`
    : def.abstractNumId

function numberingOf(cx: Cx, def: NumberingDef, where: string): NumberingPlan {
  const levelFormats: string[] = []
  const numberFormats: number[] = []
  const start = def.startOverrides[0] ?? def.levels[0]?.start ?? 1
  for (let ilvl = 0; ilvl <= MAX_LEVEL; ilvl++) {
    const level: NumberingLevel | undefined = def.levels[ilvl]
    if (!level || level.numFmt === 'bullet' || level.numFmt === 'none') {
      levelFormats.push(`^${ilvl + 1}.`)
      numberFormats.push(0)
      continue
    }
    const shape = NUMBER_FORMAT[level.numFmt]
    if (shape === undefined || level.isLgl || (ilvl > 0 && level.start !== 1)) {
      cx.ledger.note('numbering', where)
    }
    levelFormats.push(level.lvlText.replace(/%(\d)/g, '^$1'))
    numberFormats.push(shape ?? 0)
  }
  return { levelFormats, numberFormats, start }
}

function bulletChar(level: NumberingLevel): string {
  const raw = level.lvlText
  const decoded = level.font && isSymbolFont(level.font) ? decodeSymbolText(level.font, raw) : raw
  const glyph = [...(decoded ?? '')][0]
  // private-use glyphs belong to a symbol font Hangul may not have
  if (!glyph || /[\uE000-\uF8FF]/.test(glyph)) return DEFAULT_BULLET
  return glyph
}

// ---------------------------------------------------------------- runs

const isHiddenRun = (run: Run): boolean => run.vanish === true && !run.noteRef

function inlinesOf(cx: Cx, runs: readonly Run[], where: string, place: Place): Inline[] {
  const out: Inline[] = []
  for (const run of runs) {
    for (const inline of runInlines(cx, run, where, place)) out.push(inline)
  }
  return out
}

function runInlines(cx: Cx, run: Run, where: string, place: Place): Inline[] {
  const { ledger } = cx
  if (run.del || run.ins || run.rPrChange) ledger.note('revision', where)
  if (run.del) return []
  if (isHiddenRun(run)) {
    ledger.note('hidden_text', where)
    return []
  }
  if (run.noteRef) return noteInlines(cx, run.noteRef, run.text, where, place)
  if (run.math) {
    ledger.note('equation', where)
    return []
  }
  if (run.image) return runPicture(cx, run.image, where)
  if (run.link) ledger.note('hyperlink', where)
  if (
    run.refField ||
    run.instrField ||
    run.fldBeginXml ||
    run.sdtCheckboxXml ||
    run.zoteroFieldId
  ) {
    ledger.note('field', where)
  }
  if (run.ruby) ledger.note('text_effect', where)
  noteTextEffects(cx, run, where)
  const chars = charShapeOf(run)
  const text = run.caps === 'all' ? run.text.toUpperCase() : run.text
  return place === 'hf' ? hfTextInlines(text, chars) : bodyTextInlines(text, chars, place)
}

function noteTextEffects(cx: Cx, run: Run, where: string): void {
  const effect =
    run.caps === 'small' ||
    run.dstrike === true ||
    run.textEffect !== undefined ||
    run.textOutline !== undefined ||
    run.glow !== undefined ||
    run.em !== undefined ||
    run.bdr !== undefined ||
    (run.positionHalfPoints !== undefined && run.positionHalfPoints !== 0)
  if (effect) cx.ledger.note('text_effect', where)
}

function bodyTextInlines(text: string, chars: CharShape, place: Place): Inline[] {
  const out: Inline[] = []
  text.split('\f').forEach((part, i) => {
    // a page break means nothing inside a table cell
    if (i > 0 && place === 'body') out.push({ kind: 'pageBreak' })
    if (part) out.push({ kind: 'text', text: part, chars })
  })
  return out
}

/** header and footer text: Word's page fields come through as private-use marks */
function hfTextInlines(text: string, chars: CharShape): Inline[] {
  const out: Inline[] = []
  for (const piece of text.replace(/\f/g, '').split(/([\uE000-\uE002])/)) {
    if (!piece) continue
    if (piece === PAGE_MARK) out.push({ kind: 'field', field: 'page', chars })
    else if (piece === TOTAL_PAGES_MARK || piece === SECTION_PAGES_MARK) {
      // one section: its page count is the document's
      out.push({ kind: 'field', field: 'pageCount', chars })
    } else out.push({ kind: 'text', text: piece, chars })
  }
  return out
}

function charShapeOf(run: Run): CharShape {
  const e = run.effective
  const size = e?.sizeHalfPoints ?? run.sizeHalfPoints ?? 20
  const eastAsia =
    run.eastAsiaFont ?? (e?.fonts.eaSlotEmpty ? undefined : e?.fonts.eastAsia) ?? undefined
  const latin = e?.fonts.ascii ?? run.fontAscii
  const eastAsiaFace = eastAsia && !LATIN_ONLY_FACE.test(eastAsia) ? eastAsia : DEFAULT_FACE
  return {
    eastAsiaFace,
    latinFace: latin || eastAsiaFace,
    size: hwpFromHalfPoints(size),
    bold: e?.bold ?? run.bold ?? false,
    italic: e?.italic ?? run.italic ?? false,
    underline: e?.underline ?? run.underline ?? false,
    strike: (e?.strike ?? run.strike ?? false) || run.dstrike === true,
    script: (run.vertAlign ?? e?.vertAlign) || 'normal',
    color: rgbOf(e?.color ?? run.color, '#000000'),
    shade: highlightOf(run.highlight) ?? fillOf(run.shading ?? e?.shading),
    spacing: spacingPercent(e?.charSpacingTwips ?? run.charSpacingTwips ?? 0, size),
    ratio: ratioPercent(run.charScalePct),
  }
}

function noteInlines(
  cx: Cx,
  ref: { kind: 'footnote' | 'endnote'; id: string },
  mark: string,
  where: string,
  place: Place,
): Inline[] {
  const notes = ref.kind === 'footnote' ? cx.parsed.footnotes : cx.parsed.endnotes
  const note = notes.find((n) => n.id === ref.id)
  // the engine places notes only in body paragraphs
  if (place !== 'body' || !note) {
    cx.ledger.note('note', `${where}/${ref.kind}${ref.id}`)
    return []
  }
  if (noteHasFormatting(note)) cx.ledger.note('note_format', `${ref.kind}${ref.id}`)
  return [{ kind: 'note', note: ref.kind, paras: noteParas(note, mark.trim()) }]
}

/**
 * The note's paragraphs without Word's reference mark: Hangul numbers the note
 * itself. A note typed without the mark field but starting with the citing
 * number would show that number twice, so it goes too.
 */
function noteParas(note: NoteInfo, mark: string): string[] {
  const texts = note.richParas
    ? note.richParas.map((runs, i) =>
        (i === 0 && !note.noRefMark ? runs.slice(1) : runs)
          .map((r) => (r.del ? '' : r.text))
          .join(''),
      )
    : note.text.split('\n')
  if (texts.length === 0) return texts
  const first = texts[0]
  if (!note.richParas && !note.noRefMark) texts[0] = first.replace(/^\s*\S+/, '')
  else if (
    note.noRefMark &&
    mark &&
    first.startsWith(mark) &&
    /^\s/.test(first.slice(mark.length))
  ) {
    texts[0] = first.slice(mark.length)
  }
  texts[0] = texts[0].replace(/^\s+/, '')
  return texts
}

const noteHasFormatting = (note: NoteInfo): boolean =>
  (note.richParas ?? []).some((runs) =>
    runs
      .slice(note.noRefMark ? 0 : 1)
      .some(
        (r) => r.bold || r.italic || r.underline || r.strike || (r.color && r.color !== 'auto'),
      ),
  )

// ---------------------------------------------------------------- pictures

const MIME_EXT: Readonly<Record<string, Picture['ext']>> = {
  png: 'png',
  jpeg: 'jpg',
  jpg: 'jpg',
  gif: 'gif',
  bmp: 'bmp',
}

export function pictureOf(
  dataUrl: string | undefined,
  widthPx: number,
  heightPx: number,
): Picture | null {
  const match = /^data:image\/([\w.+-]+);base64,(.*)$/s.exec(dataUrl ?? '')
  const ext = match ? MIME_EXT[match[1].toLowerCase()] : undefined
  if (!match || !ext) return null
  const width = Math.max(1, Math.round(widthPx))
  const height = Math.max(1, Math.round(heightPx))
  return {
    bytes: bytesOfBase64(match[2]),
    ext,
    width: hwpFromPx(widthPx),
    height: hwpFromPx(heightPx),
    widthPx: width,
    heightPx: height,
  }
}

function bytesOfBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function runPicture(cx: Cx, image: NonNullable<Run['image']>, where: string): Inline[] {
  if (image.rule) {
    cx.ledger.note('shape', where)
    return []
  }
  const picture = pictureOf(image.dataUrl, image.widthPx ?? 96, image.heightPx ?? 96)
  if (!picture) {
    cx.ledger.note('picture', where)
    return []
  }
  if (image.wrap) cx.ledger.note('floating_picture', where)
  if (image.rotDeg || image.flipH || image.flipV || image.layers) {
    cx.ledger.note('floating_picture', where)
  }
  return [{ kind: 'picture', picture }]
}

function imageBlocks(cx: Cx, block: WordBlock, where: string): Block[] {
  const picture = block.brokenImage
    ? null
    : pictureOf(block.imageDataUrl, block.imageWidthPx ?? 96, block.imageHeightPx ?? 96)
  if (!picture) {
    cx.ledger.note('picture', where)
    return []
  }
  if (block.imageWrap) cx.ledger.note('floating_picture', where)
  if (block.imageCrop || block.imageRotDeg || block.imageFlipH || block.imageFlipV) {
    cx.ledger.note('floating_picture', where)
  }
  const shape = paraShapeOf(cx, block.anchorLine?.format ?? {}, where, null)
  return [
    paraOf(
      { kind: 'body' },
      {
        ...shape,
        align: ALIGN[block.imageAlign ?? 'left'] ?? 'left',
        before: paraFromTwips(block.imageParagraphSpaceBefore ?? 0),
        after: paraFromTwips(block.imageParagraphSpaceAfter ?? 0),
      },
      [{ kind: 'picture', picture }],
    ),
  ]
}

// ---------------------------------------------------------------- passthrough

/**
 * What a block docx-engine could not model becomes: matched in order, the
 * first that applies decides. Text that can be kept is kept as plain text.
 */
const PASSTHROUGH_KINDS: ReadonlyArray<{
  readonly test: (block: WordBlock) => boolean
  readonly lower: (cx: Cx, block: WordBlock, where: string) => Block[]
}> = [
  { test: (b) => b.hidden === true || b.invisibleMarker === true, lower: () => [] },
  {
    test: (b) => b.fieldDisplay?.kind === 'pageBreak' || b.label === 'Page break',
    lower: (cx) => [paraOf({ kind: 'body' }, { ...plainShape(cx), pageBreakBefore: true }, [])],
  },
  { test: (b) => b.fieldDisplay?.kind === 'tocLine', lower: (cx, b, w) => tocLine(cx, b, w) },
  { test: (b) => b.fieldDisplay?.kind === 'text', lower: (cx, b, w) => fieldText(cx, b, w) },
  { test: (b) => !!b.formulaDisplay || b.label === 'Equation', lower: dropped('equation') },
  { test: (b) => !!b.chartDisplay, lower: dropped('chart') },
  { test: (b) => !!b.diagramDisplay || b.decorative === true, lower: dropped('shape') },
  { test: (b) => (b.textboxes?.length ?? 0) > 0, lower: (cx, b, w) => strayText(cx, b, w) },
  { test: (b) => !!b.oleProgId || b.label === 'Embedded object', lower: dropped('object') },
  { test: (b) => b.brokenImage === true, lower: dropped('picture') },
  { test: (b) => b.label === 'Hidden paragraph', lower: dropped('hidden_text') },
  { test: (b) => b.label === 'Drawing object', lower: dropped('shape') },
  { test: () => true, lower: (cx, b, w) => plainText(cx, b, w) },
]

function passthroughBlocks(cx: Cx, block: WordBlock, where: string): Block[] {
  const kind = PASSTHROUGH_KINDS.find((k) => k.test(block))!
  return kind.lower(cx, block, where)
}

function dropped(feature: LossFeature) {
  return (cx: Cx, _block: WordBlock, where: string): Block[] => {
    cx.ledger.note(feature, where)
    return []
  }
}

/** a body paragraph of Word's defaults: what a block without its own format gets */
function plainShape(cx: Cx): ParaShape {
  return paraShapeOf(cx, {}, '', null)
}

function plainChars(): CharShape {
  return charShapeOf({ text: '' })
}

function strayText(cx: Cx, block: WordBlock, where: string): Block[] {
  const runs = block.strayRuns ?? []
  if (runs.length === 0) return []
  return [paraOf({ kind: 'body' }, plainShape(cx), inlinesOf(cx, runs, where, 'body'))]
}

function tocLine(cx: Cx, block: WordBlock, _where: string): Block[] {
  cx.ledger.note('toc', 'toc')
  const field = block.fieldDisplay!
  if (field.deleted) return []
  const text = `${field.num ? `${field.num} ` : ''}${field.left ?? ''}\t${field.right ?? ''}`
  const leader = TAB_LEADER[field.leader ?? 'dot'] ?? 'dot'
  const shape: ParaShape = {
    ...plainShape(cx),
    marginLeft: paraFromTwips(Math.max(0, ((field.level ?? 1) - 1) * 220)),
    tabStops: [
      { position: paraFromTwips(field.rightTabTwips ?? cx.bodyTwips), align: 'right', leader },
    ],
  }
  return [paraOf({ kind: 'body' }, shape, [{ kind: 'text', text, chars: plainChars() }])]
}

function fieldText(cx: Cx, block: WordBlock, where: string): Block[] {
  cx.ledger.note('field', where)
  const field = block.fieldDisplay!
  const inlines: Inline[] = field.runs?.length
    ? field.runs.map((run) => ({ kind: 'text', text: run.text, chars: charShapeOf(run) }))
    : [{ kind: 'text', text: field.left ?? '', chars: plainChars() }]
  return [paraOf({ kind: 'body' }, plainShape(cx), inlines.filter(hasText))]
}

function plainText(cx: Cx, block: WordBlock, where: string): Block[] {
  const text = (block.previewText ?? '').replace(/\f/g, '')
  if (!text.trim()) {
    cx.ledger.note('object', where)
    return []
  }
  cx.ledger.note('plain_paragraph', where)
  return [paraOf({ kind: 'body' }, plainShape(cx), [{ kind: 'text', text, chars: plainChars() }])]
}

const hasText = (inline: Inline): boolean => inline.kind !== 'text' || inline.text.length > 0

// ---------------------------------------------------------------- tables

const BORDER_STYLE: Readonly<Record<string, Border['style']>> = {
  single: 'solid',
  thick: 'solid',
  double: 'double',
  dotted: 'dotted',
  dashed: 'dashed',
  dashSmallGap: 'dashed',
  none: 'none',
  nil: 'none',
}

const NO_BORDER: Border = { style: 'none', widthPt: 0, color: rgbOf(undefined, '#000000') }
const GRID_LINE: Border = { style: 'solid', widthPt: 0.5, color: rgbOf(undefined, '#000000') }

function borderOf(cx: Cx, border: CellBorder | undefined, where: string): Border | undefined {
  if (!border) return undefined
  const style = BORDER_STYLE[border.style]
  if (!style) cx.ledger.note('table_layout', where)
  if (style === 'none') return NO_BORDER
  return {
    style: style ?? 'solid',
    widthPt: (border.szEighths ?? 4) / 8,
    color: rgbOf(border.color, '#000000'),
  }
}

function tableOf(cx: Cx, table: TableModel, where: string): Table {
  const { ledger } = cx
  if (table.floatPos || table.floatSide || (table.cellSpacingTwips ?? 0) > 0 || table.bidiVisual) {
    ledger.note('table_layout', where)
  }
  if (table.rowRevisions?.some(Boolean) || table.tblPrChange || table.tblGridChange) {
    ledger.note('revision', where)
  }
  // the grid: each cell's first column, and how far a vertical merge reaches down
  const grid = table.rows.map((row) => {
    let col = 0
    return row.map((cell) => {
      const at = col
      col += Math.max(1, cell.colSpan ?? 1)
      return { cell, col: at }
    })
  })
  const colCount = Math.max(
    1,
    ...grid.map((row) => row.reduce((n, c) => n + Math.max(1, c.cell.colSpan ?? 1), 0)),
  )
  const rowSpanAt = (r: number, col: number): number => {
    let span = 1
    for (let below = r + 1; below < grid.length; below++) {
      const hit = grid[below].find((c) => c.col === col)
      if (hit?.cell.vMerge !== 'continue') break
      span++
    }
    return span
  }
  const tableBorders = table.borders
  // no declared borders: a table style draws Word's grid, a bare table draws none
  const fallback = tableBorders || !table.tblStyleId ? NO_BORDER : GRID_LINE
  const side = (
    cell: TableCell,
    own: keyof NonNullable<TableCell['borders']>,
    edge: boolean,
    outer: 'top' | 'bottom' | 'left' | 'right',
    inner: 'insideH' | 'insideV',
    cellWhere: string,
  ): Border =>
    borderOf(cx, cell.borders?.[own], cellWhere) ??
    borderOf(cx, edge ? tableBorders?.[outer] : tableBorders?.[inner], cellWhere) ??
    fallback

  const cells: Cell[] = []
  grid.forEach((row, r) => {
    for (const { cell, col } of row) {
      if (cell.vMerge === 'continue') continue
      const cellWhere = `${where}/r${r}c${col}`
      const colSpan = Math.max(1, cell.colSpan ?? 1)
      const rowSpan = cell.vMerge === 'restart' ? rowSpanAt(r, col) : 1
      if (cell.cellRevision) ledger.note('revision', cellWhere)
      if (cell.textDirection && cell.textDirection !== 'lrTb')
        ledger.note('text_direction', cellWhere)
      if (cell.anchoredBoxes?.length) ledger.note('textbox', cellWhere)
      const margins = { ...table.cellMarTwips, ...cell.cellMarTwips }
      const gap = cell.gridGap === true
      cells.push({
        row: r,
        col,
        rowSpan,
        colSpan,
        fill: gap ? null : (fillOf(cell.fill) ?? fillOf(table.fill)),
        borders: gap
          ? { top: NO_BORDER, right: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER }
          : {
              top: side(cell, 'top', r === 0, 'top', 'insideH', cellWhere),
              bottom: side(
                cell,
                'bottom',
                r + rowSpan >= grid.length,
                'bottom',
                'insideH',
                cellWhere,
              ),
              left: side(cell, 'left', col === 0, 'left', 'insideV', cellWhere),
              right: side(cell, 'right', col + colSpan >= colCount, 'right', 'insideV', cellWhere),
            },
        vAlign: cell.vAlign ?? 'top',
        padding: {
          top: hwpFromTwips(margins.top ?? 0),
          bottom: hwpFromTwips(margins.bottom ?? 0),
          left: hwpFromTwips(margins.left ?? WORD_CELL_MARGIN_LR),
          right: hwpFromTwips(margins.right ?? WORD_CELL_MARGIN_LR),
        },
        body: gap ? [] : cellBody(cx, cell, cellWhere),
      })
    }
  })
  return {
    kind: 'table',
    colWidths: columnWidths(cx, table, colCount),
    rowHeights: table.rows.map((_, r) => {
      const twips = table.rowHeightsTwips?.[r]
      return twips ? hwpFromTwips(twips) : null
    }),
    cells,
    repeatHeader: table.repeatHeaderRows?.[0] === true,
    align: table.align ?? 'left',
  }
}

function columnWidths(cx: Cx, table: TableModel, colCount: number): HwpUnit[] {
  const tableTwips = table.widthPct ? (cx.bodyTwips * table.widthPct) / 100 : cx.bodyTwips
  const twips =
    table.colWidthsTwips?.length === colCount && !table.widthPct
      ? table.colWidthsTwips
      : table.colWidthsPct?.length === colCount
        ? table.colWidthsPct.map((pct) => (tableTwips * pct) / 100)
        : Array.from({ length: colCount }, () => tableTwips / colCount)
  return twips.map((w) => hwpFromTwips(w))
}

function cellBody(cx: Cx, cell: TableCell, where: string): Para[] {
  const paras: Para[] = cell.richParas
    ? cell.richParas.map((p, i) =>
        paraOf(
          { kind: 'body' },
          paraShapeOf(cx, p, `${where}/p${i}`, listOf(cx, p.list, `${where}/p${i}`)),
          inlinesOf(cx, p.runs, `${where}/p${i}`, 'cell'),
        ),
      )
    : cell.paras.map((text) =>
        paraOf(
          { kind: 'body' },
          plainShape(cx),
          text ? [{ kind: 'text', text, chars: plainChars() }] : [],
        ),
      )
  const nested = cell.nestedTables ?? []
  if (nested.length === 0) return paras
  // the engine builds no table inside a cell: a nested table's paragraphs take
  // its place, after the cell paragraphs that precede it in Word
  const out = [...paras]
  nested
    .map((table, i) => ({ table, at: cell.nestedTableAnchors?.[i] ?? paras.length, i }))
    .sort((a, b) => b.at - a.at || b.i - a.i)
    .forEach(({ table, at, i }) => {
      cx.ledger.note('nested_table', `${where}/t${i}`)
      out.splice(at, 0, ...flattened(tableOf(cx, table, `${where}/t${i}`)))
    })
  return out
}

const flattened = (table: Table): Para[] => table.cells.flatMap((cell) => cell.body)

// ---------------------------------------------------------------- header and footer

function headerFooterOf(cx: Cx, kind: 'header' | 'footer'): Story | null {
  const { parsed, ledger } = cx
  const paras = kind === 'header' ? parsed.headerParas : parsed.footerParas
  const first = kind === 'header' ? parsed.headerFirst : parsed.footerFirst
  const even = kind === 'header' ? parsed.headerEven : parsed.footerEven
  if ((parsed.titlePg && first) || (parsed.evenAndOddHeaders && even)) {
    ledger.note('header_variant', kind)
  }
  if ((kind === 'header' ? parsed.headerImages : parsed.footerImages)?.length) {
    ledger.note('header_content', kind)
  }
  if (!paras?.length) return null
  const story: Block[] = []
  paras.forEach((para: HfParagraph, i) => {
    const where = `${kind}/p${i}`
    if (para.lineOnly) {
      ledger.note('header_content', where)
      return
    }
    if (para.cells?.length || para.box) ledger.note('header_content', where)
    const runs = para.cells?.length
      ? para.cells.flatMap((cell, c) => [
          ...(c > 0 ? [{ text: '\t' } as Run] : []),
          ...cell.paras.flatMap((runs, p) => (p > 0 ? [{ text: ' ' } as Run, ...runs] : runs)),
        ])
      : para.runs
    story.push(
      paraOf(
        { kind: 'body' },
        paraShapeOf(cx, para, where, null),
        inlinesOf(cx, runs, where, 'hf'),
      ),
    )
  })
  const empty = story.every(
    (b) => b.kind === 'para' && b.inlines.every((i) => i.kind === 'text' && !i.text.trim()),
  )
  return empty ? null : story
}
