/**
 * The plugin's checkLayout against the real rhwp engine: the table cells whose text is cut
 * off on the page. fixtures/format-copy-table.hwp is a 2×2 table made in Hancom Hangul whose
 * rows are exactly one line high. A row that really cuts its text off is made from
 * fixtures/generated-form-tables-hancom.hwpx (saved by Hangul 2024): the text of its first
 * cell is lengthened in the XML while the cell keeps the height and the one stored line the
 * file gives it, as a file written by another program over a Hancom form reads. rhwp keeps
 * that row height and draws the lines below the row's edge, where they are clipped.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { agentPlugin, type AgentPluginHost } from '../studio-plugin/agent-plugin.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name))
const TABLE = fixture('format-copy-table.hwp')

interface CellBox {
  cellIdx: number
  h: number
}

/**
 * The plugin over the document. `shrink` (cell index → CSS px) takes that much off the
 * height of those cells' boxes, to put a line exactly on the threshold.
 */
function open(bytes: Uint8Array, shrink: Record<number, number> = {}) {
  const doc = new HwpDocument(new Uint8Array(bytes))
  doc.pageCount()
  const calls = new Map<string, number>()
  const view = new Proxy(doc, {
    get(target, key) {
      if (typeof key === 'string') calls.set(key, (calls.get(key) ?? 0) + 1)
      if (key === 'getTableCellBboxesByPath') {
        return (...args: [number, number, string]) => {
          const boxes = JSON.parse(target.getTableCellBboxesByPath(...args)) as CellBox[]
          return JSON.stringify(boxes.map((b) => ({ ...b, h: b.h - (shrink[b.cellIdx] ?? 0) })))
        }
      }
      const value = Reflect.get(target, key, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const host = {
    read: (fn: (d: never) => unknown) => fn(view as never),
    transaction: () => {
      throw new Error('checking the layout changes nothing')
    },
    events: { on: () => 0 },
    automation: { registerCommand: () => {}, execute: () => null },
  } as unknown as AgentPluginHost
  return { plugin: agentPlugin.activate(host), doc, calls }
}

/** A cell's text made long enough to take three lines, through the engine (the row grows). */
function withLongText(cell: number): Uint8Array {
  const doc = new HwpDocument(new Uint8Array(TABLE))
  const end = doc.getCellParagraphLength(0, 1, 0, cell, 0)
  doc.insertTextInCell(
    0,
    1,
    0,
    cell,
    0,
    end,
    ' 이 칸에는 칸의 폭보다 훨씬 긴 글을 넣어서 여러 줄로 접히게 만듭니다 마지막 줄',
  )
  doc.pageCount()
  const bytes = doc.exportHwp()
  doc.free()
  return bytes
}

const LONG =
  '가가가 가가 이 칸에는 칸의 폭보다 훨씬 긴 글을 넣어서 여러 줄로 접히게 만듭니다 그래도 행의 높이는 파일에 적힌 그대로입니다 마지막 줄'

/** The Hancom form with its first cell's text lengthened in the XML, row height and line kept. */
async function staleRowHeight(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(fixture('generated-form-tables-hancom.hwpx'))
  const section = await zip.file('Contents/section0.xml')!.async('string')
  expect(section).toContain('<hp:t>가가가 가가</hp:t>')
  zip.file(
    'Contents/section0.xml',
    section.replace('<hp:t>가가가 가가</hp:t>', `<hp:t>${LONG}</hp:t>`),
  )
  return zip.generateAsync({ type: 'uint8array' })
}

/** A blank document with one table of `rows` × 3 cells, each holding a short line. */
function bigTable(rows: number): Uint8Array {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  const made = JSON.parse(doc.createTable(0, 0, 0, rows, 3)) as {
    paraIdx: number
    controlIdx: number
  }
  // split across pages at row boundaries, as a long quotation table is
  doc.setTableProperties(0, made.paraIdx, made.controlIdx, JSON.stringify({ pageBreak: 1 }))
  doc.beginBatch()
  for (let cell = 0; cell < rows * 3; cell++) {
    doc.insertTextInCellByPath(
      0,
      made.paraIdx,
      JSON.stringify([{ controlIndex: made.controlIdx, cellIndex: cell, cellParaIndex: 0 }]),
      0,
      `칸 ${cell}`,
    )
  }
  doc.endBatch()
  doc.pageCount()
  const bytes = doc.exportHwp()
  doc.free()
  return bytes
}

describe('checkLayout', () => {
  it('reports nothing for text that only touches the border of a tight row', () => {
    const { plugin } = open(TABLE)
    expect(plugin.checkLayout()).toEqual({
      tables: 1,
      from: { table: 1, row: 1 },
      cells: [],
      measured: 4,
    })
  })

  it('reports nothing when the row grows with its text', () => {
    const { plugin } = open(withLongText(1))
    expect(plugin.checkLayout()).toMatchObject({ cells: [], measured: 4 })
  })

  it('lists a cell whose stored row height cuts its text off', async () => {
    const { plugin } = open(await staleRowHeight())
    const checked = plugin.checkLayout()
    expect(checked.next).toBeUndefined()
    expect(checked.cells).toHaveLength(1)
    const [cell] = checked.cells
    expect(cell).toMatchObject({ table: 1, row: 1, col: 1, page: 1 })
    expect(cell.over).toBeGreaterThan(15)
    expect(cell.text).toContain('가가가 가가 이 칸에는')
    // the unchanged form fits
    expect(open(fixture('generated-form-tables-hancom.hwpx')).plugin.checkLayout().cells).toEqual(
      [],
    )
  })

  it('names cells by their place and leaves the master page text out', () => {
    // the layout numbers this table's cells one past the document's own numbers
    expect(open(fixture('title-table-zone-fill.hwpx')).plugin.checkLayout()).toMatchObject({
      tables: 3,
      measured: 9,
      cells: [],
    })
    // the master page draws text addressed like the body table's cell, far below it
    expect(open(fixture('master-page-duplex-both.hwpx')).plugin.checkLayout()).toMatchObject({
      measured: 1,
      cells: [],
    })
  })

  it('does not count the half of a line that stays inside the cell', () => {
    // the line already ends 1.9 px past the border: up to a fifth of its 13.3 px it reads
    // whole, half of it does not
    expect(open(TABLE, { 0: 0.5 }).plugin.checkLayout().cells).toEqual([])
    expect(open(TABLE, { 0: 4.5 }).plugin.checkLayout().cells).toMatchObject([
      { table: 1, row: 1, col: 1 },
    ])
  })

  it('starts at the table and row it is given', async () => {
    const { plugin } = open(await staleRowHeight())
    const later = plugin.checkLayout(1, 2)
    expect(later.from).toEqual({ table: 1, row: 2 })
    expect(later.cells).toEqual([])
    expect(plugin.checkLayout(2).cells).toEqual([])
    expect(plugin.checkLayout(99)).toMatchObject({ cells: [], measured: 0 })
  })

  it('goes on from where a call ran out of time until every cell is measured', async () => {
    const { plugin } = open(await staleRowHeight())
    const whole = plugin.checkLayout()
    // every row takes longer than the call's budget: each call measures one row
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 5000))
    const found = []
    let measured = 0
    let calls = 0
    let place: { table: number; row: number } | undefined = { table: 1, row: 1 }
    while (place) {
      const part = plugin.checkLayout(place.table, place.row)
      expect(part.from).toEqual(place)
      found.push(...part.cells)
      measured += part.measured
      place = part.next
      calls += 1
      expect(calls).toBeLessThan(200)
    }
    expect(calls).toBeGreaterThan(2)
    expect(measured).toBe(whole.measured)
    expect(found).toEqual(whole.cells)
  })

  it('measures a 900-cell table in one call with one layout read per page and per table', () => {
    const { plugin, doc, calls } = open(bigTable(300))
    calls.clear()
    const began = performance.now()
    const checked = plugin.checkLayout()
    const took = performance.now() - began
    expect(checked.measured).toBe(900)
    expect(checked.next).toBeUndefined()
    expect(checked.cells).toEqual([])
    expect(calls.get('getTableCellBboxesByPath')).toBe(1)
    expect(doc.pageCount()).toBeGreaterThan(3)
    expect(calls.get('getPageTextLayout')).toBe(doc.pageCount())
    expect(calls.get('getSelectionRectsInCellByPath')).toBeUndefined()
    // the bridge gives a call ten seconds
    expect(took).toBeLessThan(5000)
  })
})
