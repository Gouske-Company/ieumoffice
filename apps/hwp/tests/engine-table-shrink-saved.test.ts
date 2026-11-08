/**
 * Rows of a table in a saved .hwp shrink while the document is open (rhwp patch 0041).
 *
 * In an editing session the engine floors every re-measured row at the height it was measured
 * at when the file was opened, so a cell that grows does not take the other rows' share. That
 * floor also held the rows the user made shorter: dragging a border, Shift/Ctrl+arrow, or the
 * table and cell dialogs could make rows taller but never shorter, until the file was opened
 * again (a school newsletter, 2026-11-09). The floor now comes down by what a row's cells
 * gave up of their stored height.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'
import { hancomRowDragUpdates } from '../studio-plugin/hancom-keys.mjs'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** The table createTable puts in a blank document: section 0, paragraph 0, control 2. */
const AT = [0, 0, 2] as const

/** Drawn row heights (px, one decimal), from the first column's cells. */
function rows(doc: HwpDocument): number[] {
  return JSON.parse(doc.getTableCellBboxes(...AT))
    .filter((box: { col: number }) => box.col === 0)
    .map((box: { h: number }) => Math.round(box.h * 10) / 10)
}

/** One decimal, as rows() gives. */
const r1 = (v: number) => Math.round(v * 10) / 10

const resize = (doc: HwpDocument, updates: unknown[]) =>
  JSON.parse(doc.resizeTableCells(...AT, JSON.stringify(updates)))

/** Row (0-based) of a 3×2 table: its two cells. */
const rowCells = (row: number) => [row * 2, row * 2 + 1]

/**
 * A 3×2 table whose rows were made taller (the first by 3000 HWPUNIT, the others by 1500) and
 * the file saved and opened again, as a .hwp written by Hangul: the open document is an editing
 * session, every row draws at the height its cells store, and every row has room to give back.
 */
function savedTable(): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  expect(JSON.parse(doc.createTable(0, 0, 0, 3, 2))).toMatchObject({ ok: true, controlIdx: 2 })
  resize(doc, [
    ...rowCells(0).map((cellIdx) => ({ cellIdx, heightDelta: 3000 })),
    ...[1, 2].flatMap((row) => rowCells(row).map((cellIdx) => ({ cellIdx, heightDelta: 1500 }))),
  ])
  const saved = new HwpDocument(doc.exportHwp())
  // every row draws at its cells' stored height
  const stored = [0, 2, 4].map(
    (cellIdx) => JSON.parse(saved.getCellProperties(...AT, cellIdx)).height * (96 / 7200),
  )
  expect(rows(saved)).toEqual(stored.map(r1))
  return saved
}

describe('rows of a saved .hwp table shrink in the open document', () => {
  it('draws a row shorter after its cells were made shorter', () => {
    const doc = savedTable()
    const [first, second, third] = rows(doc)
    expect(first).toBeGreaterThan(second + 10)

    expect(
      resize(
        doc,
        rowCells(0).map((cellIdx) => ({ cellIdx, heightDelta: -2000 })),
      ),
    ).toMatchObject({ ok: true })
    // 2000 HWPUNIT is 26.7 px at 96 dpi
    expect(rows(doc)).toEqual([r1(first - 26.7), second, third])

    // and the next edit keeps it: the floor stays where the user put it
    expect(
      resize(
        doc,
        rowCells(2).map((cellIdx) => ({ cellIdx, heightDelta: 750 })),
      ),
    ).toMatchObject({ ok: true })
    expect(rows(doc)).toEqual([r1(first - 26.7), second, r1(third + 10)])
  })

  it('moves a border between two rows (a mouse drag): one row grows by what the other gives', () => {
    const doc = savedTable()
    const [first, second, third] = rows(doc)
    // the border under row 1 moved up by 1500 HWPUNIT (20 px)
    expect(
      resize(doc, [
        ...rowCells(0).map((cellIdx) => ({ cellIdx, heightDelta: -1500 })),
        ...rowCells(1).map((cellIdx) => ({ cellIdx, heightDelta: 1500 })),
      ]),
    ).toMatchObject({ ok: true })
    expect(rows(doc)).toEqual([r1(first - 20), r1(second + 20), third])
  })

  it('places a row shorter with setTableCellExtents (Shift+Up)', () => {
    const doc = savedTable()
    const [first, second, third] = rows(doc)
    const px = 7200 / 96
    const lines = [0, first - 20, first - 20 + second, first - 20 + second + third].map((y) =>
      Math.round(y * px),
    )
    const extents = [0, 1, 2, 3, 4, 5].map((cellIdx) => {
      const row = Math.floor(cellIdx / 2)
      return { cellIdx, start: lines[row], end: lines[row + 1] }
    })
    expect(JSON.parse(doc.setTableCellExtents(...AT, true, JSON.stringify(extents)))).toMatchObject(
      { ok: true },
    )
    expect(rows(doc)).toEqual([r1(first - 20), second, third])
  })

  it('drags a row border up with the mouse through the app (hancomRowDragUpdates)', () => {
    const doc = savedTable()
    const [first, second, third] = rows(doc)
    const bridge = {
      getTableDimensions: (s: number, p: number, c: number) =>
        JSON.parse(doc.getTableDimensions(s, p, c)),
      getCellInfo: (s: number, p: number, c: number, i: number) =>
        JSON.parse(doc.getCellInfo(s, p, c, i)),
      getCellProperties: (s: number, p: number, c: number, i: number) =>
        JSON.parse(doc.getCellProperties(s, p, c, i)),
      getTableCellBboxes: (s: number, p: number, c: number) =>
        JSON.parse(doc.getTableCellBboxes(s, p, c)),
      resizeTableCells: (s: number, p: number, c: number, updates: unknown[]) =>
        JSON.parse(doc.resizeTableCells(s, p, c, JSON.stringify(updates))),
      setTableCellExtents: (s: number, p: number, c: number, v: boolean, e: unknown[]) =>
        JSON.parse(doc.setTableCellExtents(s, p, c, v, JSON.stringify(e))),
    }
    // the studio's input handler: one snapshot runs the operation on the bridge
    const ih = {
      wasm: bridge,
      executeOperation: ({ operation }: { operation: (b: typeof bridge) => unknown }) =>
        operation(bridge),
      getCursorPosition: () => ({}),
      cursor: { isInCellSelectionMode: () => false },
    }
    const state = {
      edge: { type: 'row' },
      tableRef: { sec: AT[0], ppi: AT[1], ci: AT[2] },
      affectedCellIndices: rowCells(0),
    }
    // the border under the first row, 1500 HWPUNIT (20 px) up: the first row and the table shrink
    expect(hancomRowDragUpdates(ih, state, -1500, false)).toEqual([])
    expect(rows(doc)).toEqual([r1(first - 20), second, third])
  })

  it('still keeps the opened heights when only a cell’s text came and went', () => {
    const doc = savedTable()
    const opened = rows(doc)
    // Enter four times at the end of the last row's first cell, then join the lines back
    const cell = 4
    for (let i = 0; i < 4; i += 1) {
      expect(JSON.parse(doc.splitParagraphInCell(...AT, cell, i, 0)).ok).toBe(true)
    }
    expect(rows(doc)[2]).toBeGreaterThan(opened[2])
    for (let i = 4; i > 0; i -= 1) {
      expect(JSON.parse(doc.mergeParagraphInCell(...AT, cell, i)).ok).toBe(true)
    }
    expect(rows(doc)).toEqual(opened)
  })
})
