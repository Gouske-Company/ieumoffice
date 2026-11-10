import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import JSZip from 'jszip'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseDocx } from '@genoffice/docx-engine'
import { convert } from '../src/convert'
import { exportDocument, withNewDocument } from '../src/engine'
import { Docx2HwpError, HwpEngine, docxToHwp, type HwpFormat } from '../src/index'
import { LossLedger } from '../src/losses'
import { lowerDocument } from '../src/lower'
import type { Cell, HwpPlan } from '../src/model'
import { writePlan } from '../src/write'
import { CORPUS, FIXTURES } from './helpers/paths'
import { readBack, type ReadBack, type ReadCell } from './helpers/read-back'

let engine: HwpEngine
beforeAll(async () => {
  engine = await HwpEngine.start(
    readFileSync(createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')),
  )
})

async function converted(path: string, format: HwpFormat) {
  const { bytes, losses } = await docxToHwp(new Uint8Array(readFileSync(path)), format, engine)
  return { back: await readBack(engine, bytes), losses }
}

const textAt = (back: ReadBack, text: string): number => back.body.findIndex((p) => p.text === text)

describe.each(['hwpx', 'hwp'] as const)('%s', (format) => {
  describe('the school notice', () => {
    let back: ReadBack
    let losses: unknown
    beforeAll(async () => ({ back, losses } = await converted(`${FIXTURES}/notice.docx`, format)))

    it('loses nothing', () => {
      expect(losses).toEqual([])
    })

    it('keeps every paragraph in order, the table and picture in their own', () => {
      expect(back.body.map((p) => p.text)).toEqual([
        '2026학년도 겨울방학 안내',
        '보통 글 굵게 기울임 밑줄 빨간 글 형광펜 취소선 위첨자 맑은 고딕 14pt',
        '1. 방학 기간',
        '방학식: 12월 31일',
        '개학식: 2월 2일',
        '2. 준비물',
        '필통',
        '연필 두 자루',
        '공책',
        '',
        '그림:',
        '',
        '오른쪽 정렬 문단',
        '',
        '',
        '쪽 나눔 뒤 문단',
      ])
      expect(back.body.map((p) => p.controls.join())).toEqual([
        ...Array(9).fill(''),
        'tbl',
        '',
        'gso',
        ...Array(4).fill(''),
      ])
    })

    it('gives headings the outline styles and lists their numbers', () => {
      expect(back.body.map((p) => p.style).filter((s) => s !== '바탕글')).toEqual([
        '개요 1',
        '개요 2',
        '개요 2',
      ])
      const head = (text: string) => back.body[textAt(back, text)].para.headType
      expect(head('방학식: 12월 31일')).toBe('Number')
      expect(head('필통')).toBe('Bullet')
      expect(head('그림:')).toBe('None')
      // Hangul draws "1.방학식" unless the number head leaves a gap before the text
      const number = back.body[textAt(back, '방학식: 12월 31일')].shape?.numberHead
      expect(number?.text.startsWith('^1.')).toBe(true)
      expect(/\s$/.test(number!.text) || number!.textOffset > 0).toBe(true)
    })

    it('saves Word paragraph geometry in points', () => {
      const shape = (text: string) => back.body[textAt(back, text)].shape
      expect(shape('2026학년도 겨울방학 안내')).toMatchObject({ before: 24, line: 'PERCENT 184' })
      expect(
        shape('보통 글 굵게 기울임 밑줄 빨간 글 형광펜 취소선 위첨자 맑은 고딕 14pt'),
      ).toMatchObject({
        indent: 10,
        after: 10,
        line: 'PERCENT 240',
      })
      // Word: text at 18 pt with the first line hanging back to the margin
      expect(shape('연필 두 자루')).toMatchObject({ left: 18, indent: -18 })
      expect(back.body[textAt(back, '오른쪽 정렬 문단')].para.alignment).toBe('right')
      expect(back.body[textAt(back, '쪽 나눔 뒤 문단') - 1].shape?.pageBreakBefore).toBe(true)
    })

    it('formats characters as Word did', () => {
      const p = 1
      const text = back.body[p].text
      const at = (word: string) => back.charAt(p, text.indexOf(word))
      expect(at('굵게')).toMatchObject({ bold: true, italic: false })
      expect(at('기울임')).toMatchObject({ italic: true })
      expect(at('밑줄')).toMatchObject({ underline: true })
      expect(at('빨간')).toMatchObject({ textColor: '#c00000' })
      expect(at('형광펜')).toMatchObject({ shadeColor: '#ffff00' })
      expect(at('취소선')).toMatchObject({ strikethrough: true })
      expect(at('첨자')).toMatchObject({ superscript: true })
      expect(at('맑은')).toMatchObject({ fontFamily: '맑은 고딕', fontSize: 1400 })
      // a Latin-only heading face stays off the Hangul slot; the symbol slot
      // follows the East Asian face, as Word draws ○ in a Korean document
      expect(back.charAt(0, 0).fontFamilies).toEqual([
        '함초롬바탕',
        'Calibri',
        '함초롬바탕',
        '함초롬바탕',
        'Calibri',
        '함초롬바탕',
        'Calibri',
      ])
    })

    it('sets the A4 page with the header band inside Word top margin', () => {
      expect(back.page).toMatchObject({
        width: 59530,
        height: 84190,
        landscape: false,
        marginLeft: 5670,
        marginRight: 5670,
        marginTop: 3600,
        marginHeader: 650,
      })
      expect(back.pages).toBe(2)
    })

    it('rebuilds the table: spans, cell texts, one cell filled and no table fill', () => {
      expect(back.tables).toHaveLength(1)
      const [table] = back.tables
      expect(table).toMatchObject({ para: 9, rows: 3, cols: 3, tableFill: 'none' })
      expect(
        table.cells.map((c) => [c.row, c.col, c.rowSpan, c.colSpan, c.texts.join('|'), c.fill]),
      ).toEqual([
        [0, 0, 1, 2, '합친 머리 칸', '#d9e2f3'],
        [0, 2, 1, 1, '비고', null],
        [1, 0, 2, 1, '세로 합침', null],
        [1, 1, 1, 1, 'B2', null],
        [1, 2, 1, 1, 'C2', null],
        [2, 1, 1, 1, 'B3', null],
        [2, 2, 1, 1, 'C3', null],
      ])
      // Word cells start at the top
      expect(new Set(table.cells.map((c) => c.verticalAlign))).toEqual(new Set([0]))
    })

    it('keeps the header text and the footer page number', () => {
      expect(back.header).toBe('○○초등학교 가정통신문')
      expect(back.footerFields).toEqual(['PAGE'])
      expect(back.footer?.startsWith('- ')).toBe(true)
      expect(back.footer?.endsWith(' -')).toBe(true)
    })
  })

  it('keeps each footnote in the paragraph that cites it, its text after the number', async () => {
    const { back, losses } = await converted(`${CORPUS}/06-with-footnotes.docx`, format)
    expect(losses).toEqual([])
    const cited = back.body
      .map((p, i) => (p.controls.includes('fn') ? i : -1))
      .filter((i) => i >= 0)
    expect(cited).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    for (const p of cited) expect(back.body[p].text).toBe(`第${p}段正文，包含参考引用。`)
    // the engine shows a note as its number slot and a space, then the text
    expect(back.notes.map((n) => n.texts)).toEqual(
      Array.from({ length: 20 }, (_, i) => [`  这是第${i + 1}条脚注内容，详见参考文献。`]),
    )
  })

  it('fills each header cell of the mixed document and never the tables', async () => {
    const { back, losses } = await converted(`${CORPUS}/15-mixed-content.docx`, format)
    expect(losses).toEqual([])
    // the document holds four w:tbl elements
    expect(back.tables).toHaveLength(4)
    for (const table of back.tables) {
      expect(table.tableFill).toBe('none')
      expect(table.cells.map((c) => c.fill)).toEqual([
        ...Array(3).fill('#d9d9d9'),
        ...Array(15).fill(null),
      ])
      expect(table.cells[0].texts).toEqual(['列1标题'])
    }
    expect(back.body.filter((p) => p.style.startsWith('개요')).map((p) => p.style)).toContain(
      '개요 3',
    )
    // each table follows a level 3 heading and still sits in a body paragraph
    expect(back.tables.map((t) => back.body[t.para - 1].style)).toEqual(Array(4).fill('개요 3'))
    expect(back.tables.map((t) => back.body[t.para].style)).toEqual(Array(4).fill('바탕글'))
  })

  it('reports the kitchen sink equation and link, keeping the link text', async () => {
    const { back, losses } = await converted(`${CORPUS}/fixture-kitchen-sink.docx`, format)
    expect(losses).toEqual([
      { feature: 'equation', kind: 'dropped', count: 1 },
      { feature: 'hyperlink', kind: 'changed', count: 1 },
    ])
    expect(back.body.map((p) => p.text)).toContain('链接示例:示例网站')
    expect(back.tables[0].cells.map((c) => c.texts.join())).toEqual(['A1', 'B1', 'A2', 'B2'])
    expect(back.body.some((p) => p.controls.includes('gso'))).toBe(true)
  })

  it('builds a table inside a table cell, between the paragraphs Word put around it', async () => {
    const { back, losses } = await converted(`${FIXTURES}/nested.docx`, format)
    expect(losses).toEqual([])
    expect(back.body.map((p) => p.text)).toEqual(['중첩 표 시험', '', '표 뒤 문단'])
    expect(back.tables).toHaveLength(1)
    const [outer] = back.tables
    expect(outer).toMatchObject({ para: 1, rows: 2, cols: 2 })
    expect(outer.cells.map((c) => [c.texts.join('|'), c.tables.length])).toEqual([
      ['바깥 1', 0],
      ['앞 문단||뒤 문단', 1],
      ['바깥 3', 0],
      ['바깥 4', 0],
    ])
    const [inner] = outer.cells[1].tables
    expect(inner).toMatchObject({ para: 1, rows: 3, cols: 3 })
    const grid = (cells: ReadCell[]) =>
      cells.map((c) => [c.row, c.col, c.rowSpan, c.colSpan, c.texts.join('|'), c.fill])
    expect(grid(inner.cells)).toEqual([
      [0, 0, 1, 2, '합친 칸', '#fff2cc'],
      [0, 2, 1, 1, '셋', null],
      [1, 0, 2, 1, '세로', null],
      [1, 1, 1, 1, '굵은 글', null],
      [1, 2, 1, 1, '가', null],
      [2, 1, 1, 1, '나', null],
      [2, 2, 1, 1, '깊은 앞||', null],
    ])
    expect(new Set(inner.cells.map((c) => c.verticalAlign))).toEqual(new Set([0]))
    const [deep] = inner.cells[6].tables
    expect(deep).toMatchObject({ para: 1, rows: 1, cols: 2 })
    expect(grid(deep.cells)).toEqual([
      [0, 0, 1, 1, '깊은 1', null],
      [0, 1, 1, 1, '깊은 2', '#ddebf7'],
    ])
  })

  it('carries the right tab stop with its dot leader', async () => {
    const { back, losses } = await converted(`${FIXTURES}/tabs.docx`, format)
    expect(losses).toEqual([])
    expect(back.body[1].para.tabStops).toEqual([{ position: 80000, type: 1, fill: 2 }])
    expect(back.body[0].text).toBe('성명:\t홍길동\t학번:\t20261234')
  })
})

it('writes a nested table the engine refuses as its paragraphs, and says so', async () => {
  const ledger = new LossLedger()
  const plan = lowerDocument(await parseDocx(readFileSync(`${FIXTURES}/nested.docx`)), ledger)
  // no rows: the engine refuses to paste an empty table
  const frameless = (cell: Cell): Cell => ({
    ...cell,
    body: cell.body.map((b) => (b.kind === 'table' ? { ...b, rowHeights: [] } : b)),
  })
  const refusing: HwpPlan = {
    ...plan,
    body: plan.body.map((b) => (b.kind === 'table' ? { ...b, cells: b.cells.map(frameless) } : b)),
  }
  const bytes = withNewDocument(engine, (doc) => {
    writePlan(doc, refusing, ledger)
    return exportDocument(doc, 'hwpx').bytes
  })
  const back = await readBack(engine, bytes)
  expect(ledger.list()).toEqual([{ feature: 'nested_table', kind: 'changed', count: 1 }])
  expect(back.body.map((p) => p.text)).toEqual(['중첩 표 시험', '', '표 뒤 문단'])
  const host = back.tables[0].cells[1]
  expect(host.tables).toEqual([])
  expect(host.texts).toEqual([
    '앞 문단',
    ...['합친 칸', '셋', '세로', '굵은 글', '가', '나', '깊은 앞', '깊은 1', '깊은 2', ''],
    '뒤 문단',
  ])
})

it('refuses bytes that are not a Word document', async () => {
  const fail = docxToHwp(new TextEncoder().encode('not a zip'), 'hwpx', engine)
  await expect(fail).rejects.toBeInstanceOf(Docx2HwpError)
  await expect(fail).rejects.toMatchObject({ code: 'not-docx' })
})

describe('writing strategy', () => {
  const summary = async (path: string, options: Parameters<typeof convert>[3]) => {
    const { bytes, losses } = await convert(
      new Uint8Array(readFileSync(path)),
      'hwpx',
      engine,
      options,
    )
    const { charAt: _, ...back } = await readBack(engine, bytes)
    return { back, losses }
  }

  it('a long document reads back as its parts do', async () => {
    const notice = readFileSync(`${FIXTURES}/notice.docx`)
    const copies = 10
    const zip = await JSZip.loadAsync(notice)
    const xml = await zip.file('word/document.xml')!.async('string')
    // the body's content ten times over, before the one section setting that ends it
    const long = xml.replace(
      /(<w:body>)([\s\S]*)(<w:sectPr[\s\S]*<\/w:body>)/,
      (_, open: string, content: string, close: string) => open + content.repeat(copies) + close,
    )
    zip.file('word/document.xml', long)
    const { bytes } = await docxToHwp(
      await zip.generateAsync({ type: 'uint8array' }),
      'hwpx',
      engine,
    )
    const back = await readBack(engine, bytes)
    const one = (await summary(`${FIXTURES}/notice.docx`, { batch: true })).back
    // a list in a later copy continues the numbers of the copy before it, as in Word
    const continuing = (body: ReadBack['body']) =>
      body.map(({ para: { numberingRestartMode: _, ...para }, ...p }) => ({ ...p, para }))
    const withoutPlace = (tables: ReadBack['tables']) => tables.map(({ para: _, ...t }) => t)
    expect(back.body.length).toBeGreaterThan(100)
    expect(back.body.slice(0, one.body.length)).toEqual(one.body)
    expect(continuing(back.body)).toEqual(
      continuing(Array.from({ length: copies }, () => one.body).flat()),
    )
    expect(withoutPlace(back.tables)).toEqual(
      Array.from({ length: copies }, () => withoutPlace(one.tables)).flat(),
    )
  })

  it('batch mode writes the same document as call by call', async () => {
    const path = `${FIXTURES}/notice.docx`
    expect(await summary(path, { batch: true })).toEqual(await summary(path, { batch: false }))
  })
})
