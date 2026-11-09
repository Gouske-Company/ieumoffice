/**
 * Opens a converted file with the engine, as the Hangul editor would, and
 * summarizes what is in it: the facts the conversion tests assert.
 */
import JSZip from 'jszip'
import type { HwpDocument } from '@rhwp/core'
import { withOpenedDocument, type HwpEngine } from '../../src/engine'

export interface ReadParagraph {
  text: string
  style: string
  /** controls anchored in this paragraph, in order: tbl, gso (picture), fn, en */
  controls: string[]
  para: Record<string, unknown>
  /** from the saved XML; set by readBack */
  shape?: SavedShape
}

export interface ReadCell {
  row: number
  col: number
  rowSpan: number
  colSpan: number
  texts: string[]
  fill: string | null
  verticalAlign: number
}

export interface ReadTable {
  para: number
  rows: number
  cols: number
  /** the table's own fill: none when only cells are filled */
  tableFill: string
  cells: ReadCell[]
}

export interface ReadBack {
  pages: number
  page: Record<string, unknown>
  body: ReadParagraph[]
  tables: ReadTable[]
  /** note texts by the paragraph that cites them */
  notes: Array<{ para: number; texts: string[] }>
  header: string | null
  footer: string | null
  /** auto-number fields in the footer's saved XML (PAGE, TOTAL_PAGE) */
  footerFields: string[]
  /** character properties at a caret just after the given offset */
  charAt: (para: number, offset: number) => Record<string, unknown>
}

const PLACING = new Set(['secd', 'cold', 'head', 'foot'])

export async function readBack(engine: HwpEngine, bytes: Uint8Array): Promise<ReadBack> {
  const chars = new Map<string, Record<string, unknown>>()
  const summary = withOpenedDocument(engine, bytes, (doc) => {
    const count = doc.getParagraphCount(0)
    const controls = JSON.parse(doc.getControls()) as Array<{
      ctrlId: string
      list: number
      para: number
      controlIndex: number
    }>
    const body: ReadParagraph[] = []
    for (let p = 0; p < count; p++) {
      const length = doc.getParagraphLength(0, p)
      body.push({
        text: length ? doc.getTextRange(0, p, 0, length) : '',
        style: JSON.parse(doc.getStyleAt(0, p)).name,
        controls: controls
          .filter((c) => c.list === 0 && c.para === p && !PLACING.has(c.ctrlId))
          .map((c) => c.ctrlId),
        para: JSON.parse(doc.getParaPropertiesAt(0, p)),
      })
      for (let offset = 0; offset < length; offset++) {
        chars.set(`${p}:${offset}`, JSON.parse(doc.getCharPropertiesAt(0, p, offset + 1)))
      }
    }
    const bodyControls = controls.filter((c) => c.list === 0)
    const tables = bodyControls
      .filter((c) => c.ctrlId === 'tbl')
      .map((c) => tableOf(doc, c.para, c.controlIndex))
    const notes = bodyControls
      .filter((c) => c.ctrlId === 'fn' || c.ctrlId === 'en')
      .map((c) => ({
        para: c.para,
        texts: (JSON.parse(doc.getFootnoteInfo(0, c.para, c.controlIndex)) as { texts: string[] })
          .texts,
      }))
    return {
      pages: doc.pageCount(),
      page: JSON.parse(doc.getPageDef(0)),
      body,
      tables,
      notes,
      header: headerText(doc, true),
      footer: headerText(doc, false),
      hwpx: doc.exportHwpx(),
    }
  })
  const zip = await JSZip.loadAsync(summary.hwpx)
  const section = await zip.file('Contents/section0.xml')!.async('string')
  const header = await zip.file('Contents/header.xml')!.async('string')
  const footerXml = /<hp:footer[\s\S]*?<\/hp:footer>/.exec(section)?.[0] ?? ''
  const footerFields = [...footerXml.matchAll(/<hp:autoNum [^>]*numType="(\w+)"/g)].map((m) => m[1])
  const shapes = bodyParaShapes(section, header)
  const { hwpx: _, ...rest } = summary
  return {
    ...rest,
    body: rest.body.map((p, i) => ({ ...p, shape: shapes[i] })),
    footerFields,
    charAt: (para, offset) => chars.get(`${para}:${offset}`) ?? {},
  }
}

/** a body paragraph's shape as saved, in points: what Hangul reads */
export interface SavedShape {
  left: number
  right: number
  indent: number
  before: number
  after: number
  line: string
  pageBreakBefore: boolean
}

/** the shapes of the section's top-level paragraphs, skipping those inside tables, notes and headers */
function bodyParaShapes(section: string, header: string): SavedShape[] {
  const shapes = new Map<string, SavedShape>()
  for (const pr of header.match(/<hh:paraPr id="\d+"[\s\S]*?<\/hh:paraPr>/g) ?? []) {
    const id = /id="(\d+)"/.exec(pr)![1]
    const value = (name: string) =>
      Number(new RegExp(`<hc:${name} value="(-?\\d+)"`).exec(pr)?.[1] ?? 0) / 100
    const line = /<hh:lineSpacing type="(\w+)" value="(\d+)"/.exec(pr)
    shapes.set(id, {
      left: value('left'),
      right: value('right'),
      indent: value('intent'),
      before: value('prev'),
      after: value('next'),
      line: line ? `${line[1]} ${line[2]}` : '',
      pageBreakBefore: /pageBreakBefore="1"/.test(pr),
    })
  }
  const out: SavedShape[] = []
  let depth = 0
  for (const tag of section.matchAll(/<hp:subList\b|<\/hp:subList>|<hp:p [^>]*>/g)) {
    if (tag[0] === '<hp:subList') depth++
    else if (tag[0] === '</hp:subList>') depth--
    else if (depth === 0) out.push(shapes.get(/paraPrIDRef="(\d+)"/.exec(tag[0])![1])!)
  }
  return out
}

function headerText(doc: HwpDocument, header: boolean): string | null {
  const info = JSON.parse(doc.getHeaderFooter(0, header, 0)) as { exists?: boolean }
  if (!info.exists) return null
  return (JSON.parse(doc.getHeaderFooterParaInfo(0, header, 0, 0)) as { text: string }).text
}

function tableOf(doc: HwpDocument, para: number, control: number): ReadTable {
  const dims = JSON.parse(doc.getTableDimensions(0, para, control)) as {
    rowCount: number
    colCount: number
    cellCount: number
  }
  const table = JSON.parse(doc.getTableProperties(0, para, control)) as { fillType: string }
  const cells: ReadCell[] = []
  for (let cell = 0; cell < dims.cellCount; cell++) {
    const info = JSON.parse(doc.getCellInfo(0, para, control, cell))
    const props = JSON.parse(doc.getCellProperties(0, para, control, cell))
    const path = (p: number) =>
      JSON.stringify([{ controlIndex: control, cellIndex: cell, cellParaIndex: p }])
    const paraCount = doc.getCellParagraphCountByPath(0, para, path(0))
    const texts = Array.from({ length: paraCount }, (_, p) => {
      const length = doc.getCellParagraphLengthByPath(0, para, path(p))
      return length ? doc.getTextInCellByPath(0, para, path(p), 0, length) : ''
    })
    cells.push({
      ...info,
      texts,
      fill: props.fillType === 'none' ? null : props.fillColor,
      verticalAlign: props.verticalAlign,
    })
  }
  return { para, rows: dims.rowCount, cols: dims.colCount, tableFill: table.fillType, cells }
}
