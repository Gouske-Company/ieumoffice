/**
 * A row added to a treat-as-char table moves what follows it, and the .hwp save check
 * agrees (rhwp patch 0042).
 *
 * Adding a row made the table taller but left the stored line the table sits on at the old
 * height. The edited document kept the paragraphs after a page-filling table on that page,
 * drawn below its bottom; the saved file, opened again, put them on the next page. The HWP
 * save compares the two page counts and refused every save (a school newsletter, 2026-11-09:
 * one row added above the last row of its last table). Deleting the row again put it back.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import init, { HwpDocument } from '@rhwp/core'

const require = createRequire(import.meta.url)

beforeAll(async () => {
  const wasm = join(dirname(require.resolve('@rhwp/core')), 'rhwp_bg.wasm')
  await init({ module_or_path: readFileSync(wasm) })
})

/** 45 rows: the table and the four closing lines just fit on the first page. */
const FULL_PAGE_ROWS = 45

/**
 * A treat-as-char table in paragraph 0 and four short paragraphs after it, saved as .hwp and
 * opened again, as a file Hangul wrote opens: its stored lines hold the table.
 */
function savedFullPage(): { doc: HwpDocument; at: [number, number, number] } {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  doc.insertText(0, 0, 0, 'x')
  doc.splitParagraph(0, 0, 1)
  for (let para = 1; para < 4; para++) doc.splitParagraph(0, para, 0)
  doc.deleteText(0, 0, 0, 1)
  for (let para = 1; para <= 4; para++) doc.insertText(0, para, 0, `closing line ${para}`)
  const made = JSON.parse(
    doc.createTableEx(
      JSON.stringify({
        sectionIdx: 0,
        paraIdx: 0,
        charOffset: 0,
        rowCount: FULL_PAGE_ROWS,
        colCount: 2,
        treatAsChar: true,
      }),
    ),
  )
  expect(made).toMatchObject({ ok: true })
  return { doc: new HwpDocument(doc.exportHwp()), at: [0, made.paraIdx, made.controlIdx] }
}

/** Page of each body paragraph (0-based). */
function pagesOf(doc: HwpDocument, count = 5): number[] {
  return Array.from({ length: count }, (_, para) => JSON.parse(doc.getPageOfPosition(0, para)).page)
}

function verify(doc: HwpDocument): {
  pageCountBefore: number
  pageCountAfter: number
  recovered: boolean
} {
  return JSON.parse(doc.exportHwpVerify())
}

describe('a row added to a treat-as-char table', () => {
  it('pushes the last line over in the open document as in the saved file', () => {
    const { doc, at } = savedFullPage()
    expect(doc.pageCount()).toBe(1)

    expect(JSON.parse(doc.insertTableRow(...at, 0, true))).toMatchObject({ ok: true, rowCount: 46 })
    // the edited document lays the last closing line out on the next page...
    expect(doc.pageCount()).toBe(2)
    const edited = pagesOf(doc)
    expect(edited[4]).toBe(1)
    // ...so the .hwp save check passes
    expect(verify(doc)).toMatchObject({ pageCountBefore: 2, pageCountAfter: 2, recovered: true })

    // and the saved file opens as it was edited
    const reopened = new HwpDocument(doc.exportHwp())
    expect(reopened.pageCount()).toBe(2)
    expect(pagesOf(reopened)).toEqual(edited)
    expect(JSON.parse(reopened.getTableDimensions(...at))).toMatchObject({ rowCount: 46 })
  })

  it('pushes the last line over for a row added above the last row', () => {
    const { doc, at } = savedFullPage()
    // the reported edit: one row right above the table's last row
    doc.insertTableRow(...at, FULL_PAGE_ROWS - 1, false)
    expect(doc.pageCount()).toBe(2)
    expect(verify(doc)).toMatchObject({ pageCountBefore: 2, pageCountAfter: 2, recovered: true })
  })

  it('comes back to one page when the row is deleted again', () => {
    const { doc, at } = savedFullPage()
    doc.insertTableRow(...at, 0, true)
    expect(JSON.parse(doc.deleteTableRow(...at, 1))).toMatchObject({ ok: true, rowCount: 45 })
    expect(doc.pageCount()).toBe(1)
    expect(verify(doc)).toMatchObject({ pageCountBefore: 1, pageCountAfter: 1, recovered: true })
  })
})
