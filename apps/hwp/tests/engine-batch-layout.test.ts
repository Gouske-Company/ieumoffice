/**
 * A batch of paragraph formats, styles and object edits is laid out once, at endBatch, and
 * ends where the same calls made one by one end (rhwp patch 0043).
 *
 * Inside beginBatch/endBatch the engine already left character formats and text edits to
 * endBatch. A paragraph format, a style or a header format still laid its whole section out
 * again on every call, and a cell, table, picture or note edit composed the whole section
 * again. Writing a long document paragraph by paragraph (the Word to Hangul export) then took
 * time in the square of its length: 2,484 paragraphs took over two minutes.
 */
import { createHash } from 'node:crypto'
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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
)
const PARAGRAPHS = 40

/** forty short paragraphs on one page */
function blank(): HwpDocument {
  const doc = HwpDocument.createEmpty()
  doc.createBlankDocument()
  for (let para = 0; para < PARAGRAPHS; para++) {
    if (para > 0) doc.splitParagraph(0, para - 1, 3)
    doc.insertText(0, para, 0, '앞ㅎ뒤')
  }
  return doc
}

const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

/** what a reader sees while the document is open, and what saving it writes */
function result(doc: HwpDocument) {
  const pages = doc.pageCount()
  return {
    pages,
    drawn: Array.from({ length: pages }, (_, page) => sha(doc.renderPageSvg(page))),
    hwp: sha(doc.exportHwp()),
    hwpx: sha(doc.exportHwpx()),
  }
}

/** the same edits once call by call and once in a batch; the batch's page count before endBatch */
function bothWays(make: () => HwpDocument, edit: (doc: HwpDocument) => void) {
  const eager = make()
  const batched = make()
  const before = batched.pageCount()
  edit(eager)
  batched.beginBatch()
  edit(batched)
  const duringBatch = batched.pageCount()
  batched.endBatch()
  const out = { before, duringBatch, eager: result(eager), batched: result(batched) }
  eager.free()
  batched.free()
  return out
}

const ok = (answer: string) => expect(JSON.parse(answer)).toMatchObject({ ok: true })

describe('a batch lays its section out once, at endBatch', () => {
  it('for paragraph formats, styles and restored paragraph shapes', () => {
    const run = bothWays(blank, (doc) => {
      for (let para = 0; para < PARAGRAPHS; para++) {
        ok(
          doc.applyParaFormat(
            0,
            para,
            JSON.stringify({ alignment: 'center', spacingBefore: 4000, lineSpacing: 200 }),
          ),
        )
        if (para % 3 === 1) ok(doc.applyStyle(0, para, 2))
        if (para % 5 === 4) {
          const first = JSON.parse(doc.getParaPropertiesAt(0, 0)).paraShapeId
          ok(doc.setParaShapeId(0, para, first))
        }
      }
    })
    expect(run.eager.pages).toBeGreaterThan(run.before)
    expect(run.duringBatch).toBe(run.before)
    expect(run.batched).toEqual(run.eager)
  })

  it('for header paragraph and character formats', () => {
    const withHeader = () => {
      const doc = blank()
      ok(doc.createHeaderFooter(0, true, 0))
      ok(doc.insertTextInHeaderFooter(0, true, 0, 0, 0, '머리말 글'))
      return doc
    }
    const run = bothWays(withHeader, (doc) => {
      for (let para = 0; para < PARAGRAPHS; para++) {
        // a body edit the batch already left to endBatch, which moves the page breaks
        ok(doc.applyCharFormat(0, para, 1, 2, JSON.stringify({ fontSize: 3000 })))
        ok(doc.applyParaFormatInHf(0, true, 0, 0, JSON.stringify({ alignment: 'right' })))
        ok(
          doc.applyCharFormatInHeaderFooter(
            0,
            true,
            0,
            0,
            0,
            0,
            2,
            JSON.stringify({ bold: para % 2 === 0 }),
          ),
        )
      }
    })
    expect(run.eager.pages).toBeGreaterThan(run.before)
    expect(run.duringBatch).toBe(run.before)
    expect(run.batched).toEqual(run.eager)
  })
})

describe('a batch ends where the same edits made one by one end', () => {
  it('for cell, table and picture properties and notes inserted ahead of a note', () => {
    const withObjects = () => {
      const doc = blank()
      ok(doc.createTable(0, 5, 0, 2, 2))
      ok(doc.insertPicture(0, 8, 0, '', PNG, 3000, 3000, 1, 1, 'png', ''))
      ok(doc.insertFootnote(0, 20, 1))
      return doc
    }
    const controlOf = (doc: HwpDocument, para: number, id: string) =>
      (
        JSON.parse(doc.getControls()) as Array<{
          ctrlId: string
          para: number
          controlIndex: number
        }>
      ).find((c) => c.para === para && c.ctrlId === id)!.controlIndex
    const run = bothWays(withObjects, (doc) => {
      const table = controlOf(doc, 5, 'tbl')
      for (let cell = 0; cell < 4; cell++) {
        ok(
          doc.setCellProperties(
            0,
            5,
            table,
            cell,
            JSON.stringify({
              verticalAlign: 1,
              paddingLeft: 700,
              fillType: 'solid',
              fillColor: '#d9e2f3',
              patternType: -1,
            }),
          ),
        )
      }
      ok(doc.setTableProperties(0, 5, table, JSON.stringify({ repeatHeader: true })))
      ok(
        doc.setPictureProperties(
          0,
          8,
          controlOf(doc, 8, 'gso'),
          JSON.stringify({ treatAsChar: true }),
        ),
      )
      // ahead of the note in paragraph 20, which becomes the second one
      ok(doc.insertFootnote(0, 10, 1))
      ok(doc.insertEndnote(0, 12, 1))
    })
    expect(run.batched).toEqual(run.eager)
  })
})
