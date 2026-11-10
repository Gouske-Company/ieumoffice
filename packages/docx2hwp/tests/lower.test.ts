import { readFileSync } from 'node:fs'
import {
  parseDocx,
  type Block as WordBlock,
  type ParsedDoc,
  type Run,
} from '@genoffice/docx-engine'
import { describe, expect, it } from 'vitest'
import { lowerDocument, DEFAULT_FACE } from '../src/lower'
import { LossLedger } from '../src/losses'
import type { Block, Cell, HwpPlan, Inline, Para, Table } from '../src/model'
import { CORPUS, FIXTURES } from './helpers/paths'

async function parse(path: string): Promise<ParsedDoc> {
  return parseDocx(new Uint8Array(readFileSync(path)))
}

function lower(parsed: ParsedDoc): { plan: HwpPlan; losses: ReturnType<LossLedger['list']> } {
  const ledger = new LossLedger()
  const plan = lowerDocument(parsed, ledger)
  return { plan, losses: ledger.list() }
}

const paras = (story: readonly Block[]): Para[] => story.filter((b): b is Para => b.kind === 'para')
const textOf = (para: Para): string =>
  para.inlines.map((i) => (i.kind === 'text' ? i.text : `[${i.kind}]`)).join('')
const texts = (story: readonly Block[]): string[] =>
  story.map((b) => (b.kind === 'para' ? textOf(b) : '[table]'))

/** the fixture's own section, with test blocks in place of its body */
async function withBlocks(blocks: Partial<WordBlock>[]): Promise<ParsedDoc> {
  const parsed = await parse(`${FIXTURES}/tabs.docx`)
  const sectPr = parsed.blocks.filter((b) => b.hidden)
  const made = blocks.map((b, i) => ({
    id: `t${i}`,
    docxIndex: null,
    originalXml: null,
    type: 'paragraph',
    ...b,
  }))
  return { ...parsed, blocks: [...(made as WordBlock[]), ...sectPr] }
}
const run = (text: string, extra: Partial<Run> = {}): Run => ({ text, ...extra })

describe('lowering the school notice', async () => {
  const { plan, losses } = lower(await parse(`${FIXTURES}/notice.docx`))
  const body = plan.body

  it('loses nothing the plan cannot hold', () => {
    expect(losses).toEqual([])
  })

  it('puts the header band inside the Word top margin', () => {
    // A4, 20 mm sides, 15 mm top and bottom, Word's 0.5 inch header distance
    expect(plan.page).toMatchObject({
      width: 59530,
      height: 84190,
      landscape: false,
      marginLeft: 5670,
      marginRight: 5670,
      marginTop: 3600,
      marginHeader: 650,
      marginBottom: 3600,
      marginFooter: 650,
    })
  })

  it('makes the heading an outline paragraph with its own look', () => {
    const heading = body[0] as Para
    expect(heading.style).toEqual({ kind: 'outline', level: 1 })
    expect(heading.shape.align).toBe('center')
    const [first] = heading.inlines
    expect(first).toMatchObject({ kind: 'text', text: '2026학년도 겨울방학 안내' })
    // the heading names only a Latin face: the Hangul slots keep Hangul's own
    expect(first.kind === 'text' && first.chars).toMatchObject({
      eastAsiaFace: DEFAULT_FACE,
      latinFace: 'Calibri',
      bold: true,
      size: 1400,
      color: '#376092',
    })
  })

  it('carries each run format', () => {
    const runs = (body[1] as Para).inlines.filter((i) => i.kind === 'text')
    const at = (text: string) => runs.find((i) => i.kind === 'text' && i.text === text)
    expect(at('굵게')).toMatchObject({ chars: { bold: true } })
    expect(at('기울임')).toMatchObject({ chars: { italic: true } })
    expect(at('밑줄')).toMatchObject({ chars: { underline: true } })
    expect(at('빨간 글')).toMatchObject({ chars: { color: '#c00000' } })
    expect(at('형광펜')).toMatchObject({ chars: { shade: '#ffff00' } })
    expect(at('취소선')).toMatchObject({ chars: { strike: true } })
    expect(at('첨자')).toMatchObject({ chars: { script: 'superscript' } })
    expect(at(' 맑은 고딕 14pt')).toMatchObject({
      chars: { eastAsiaFace: '맑은 고딕', latinFace: '맑은 고딕', size: 1400 },
    })
    // first line indent 10 pt, 1.5 lines
    expect((body[1] as Para).shape).toMatchObject({
      indent: 2000,
      line: { kind: 'percent', percent: 240 },
    })
  })

  it('numbers the list and keeps Word hanging indent as Hangul margins', () => {
    const item = body[3] as Para
    expect(item.shape.list).toMatchObject({ kind: 'number', level: 0 })
    // Word: text at 18 pt, first line hanging back to 0; Hangul: margin 0, the rest pushed 18 pt
    expect(item.shape).toMatchObject({ marginLeft: 0, indent: -3600 })
    const key = item.shape.list?.kind === 'number' ? item.shape.list.numbering : ''
    expect(plan.numberings.get(key)).toMatchObject({ start: 1 })
    expect(plan.numberings.get(key)?.levelFormats[0]).toBe('^1. ')
    expect(plan.numberings.get(key)?.numberFormats[0]).toBe(0)
    expect((body[6] as Para).shape.list).toMatchObject({ kind: 'bullet', level: 0 })
  })

  it('resolves the merged cells and their fills', () => {
    const table = body.find((b): b is Table => b.kind === 'table')!
    const cell = (row: number, col: number): Cell =>
      table.cells.find((c) => c.row === row && c.col === col)!
    expect(table.cells).toHaveLength(7)
    expect(cell(0, 0)).toMatchObject({ colSpan: 2, rowSpan: 1, fill: '#d9e2f3' })
    expect(cell(1, 0)).toMatchObject({ colSpan: 1, rowSpan: 2, fill: null })
    expect(cell(1, 1).borders.top).toEqual({ style: 'solid', widthPt: 0.5, color: '#000000' })
    expect(texts(cell(0, 0).body)).toEqual(['합친 머리 칸'])
    expect(table.colWidths).toEqual([16065, 16065, 16065])
  })

  it('keeps the picture in its own paragraph at its size', () => {
    const picture = paras(body)
      .flatMap((p) => p.inlines)
      .find((i) => i.kind === 'picture')
    expect(picture).toMatchObject({ picture: { ext: 'png', width: 8504, height: 5669 } })
  })

  it('turns the page break into a paragraph that starts a page', () => {
    const at = texts(body).indexOf('쪽 나눔 뒤 문단')
    const breakPara = body[at - 1] as Para
    expect(textOf(breakPara)).toBe('')
    expect(breakPara.shape.pageBreakBefore).toBe(true)
    expect((body[at - 2] as Para).shape.pageBreakBefore).toBe(false)
  })

  it('writes the footer page field where Word had it', () => {
    expect(plan.header && texts(plan.header)).toEqual(['○○초등학교 가정통신문'])
    const footer = plan.footer![0] as Para
    expect(footer.shape.align).toBe('center')
    expect(
      footer.inlines.map((i: Inline) =>
        i.kind === 'field' ? `{${i.field}}` : i.kind === 'text' ? i.text : i.kind,
      ),
    ).toEqual(['- ', '{page}', ' -'])
  })
})

describe('lowering other documents', () => {
  it('puts each footnote after the text that cites it, without Word reference mark', async () => {
    const { plan, losses } = lower(await parse(`${CORPUS}/06-with-footnotes.docx`))
    const first = plan.body[1] as Para
    expect(first.inlines.map((i) => i.kind)).toEqual(['text', 'note'])
    expect(first.inlines[1]).toEqual({
      kind: 'note',
      note: 'footnote',
      paras: ['这是第1条脚注内容，详见参考文献。'],
    })
    expect(losses).toEqual([])
  })

  it('reports the kitchen sink hyperlink and equation, and draws its style grid', async () => {
    const { plan, losses } = lower(await parse(`${CORPUS}/fixture-kitchen-sink.docx`))
    expect(losses).toEqual([
      { feature: 'equation', kind: 'dropped', count: 1 },
      { feature: 'hyperlink', kind: 'changed', count: 1 },
    ])
    const table = plan.body.find((b): b is Table => b.kind === 'table')!
    expect(table.cells[0].borders.left).toMatchObject({ style: 'solid', widthPt: 0.5 })
    expect(texts(plan.body)).toContain('链接示例:示例网站')
  })

  it('carries a custom right tab with dot leader', async () => {
    const { plan, losses } = lower(await parse(`${FIXTURES}/tabs.docx`))
    expect((plan.body[1] as Para).shape.tabStops).toEqual([
      { position: 80000, align: 'right', leader: 'dot' },
    ])
    expect(textOf(plan.body[0] as Para)).toBe('성명:\t홍길동\t학번:\t20261234')
    expect(losses).toEqual([])
  })
})

describe('lowering rules', () => {
  it('keeps a note before a page break in its paragraph and continues on a new page', async () => {
    const parsed = await withBlocks([
      { runs: [run('AAA'), run('1', { noteRef: { kind: 'footnote', id: 'n1' } }), run('\fBBB')] },
    ])
    parsed.footnotes = [
      { id: 'n1', text: '1 note', richParas: [[{ text: '1' }, { text: ' note' }]] },
    ]
    const { plan } = lower(parsed)
    const [before, after] = plan.body as Para[]
    expect(before.inlines.map((i) => i.kind)).toEqual(['text', 'note'])
    expect(before.shape.pageBreakBefore).toBe(false)
    expect(textOf(after)).toBe('BBB')
    expect(after.shape.pageBreakBefore).toBe(true)
  })

  it('shows tracked changes accepted and reports the marks', async () => {
    const info = { author: 'a', id: '1' }
    const { plan, losses } = lower(
      await withBlocks([
        { runs: [run('old', { del: info }), run('new', { ins: info }), run(' text')] },
      ]),
    )
    expect(texts(plan.body)).toEqual(['new text'])
    expect(losses).toEqual([{ feature: 'revision', kind: 'dropped', count: 1 }])
  })

  it('leaves hidden text out and says so', async () => {
    const { plan, losses } = lower(
      await withBlocks([{ runs: [run('seen '), run('secret', { vanish: true })] }]),
    )
    expect(texts(plan.body)).toEqual(['seen '])
    expect(losses).toEqual([{ feature: 'hidden_text', kind: 'dropped', count: 1 }])
  })

  it('removes the space between paragraphs that ask for contextual spacing', async () => {
    const item = (text: string) => ({
      styleId: 'ListParagraph',
      format: { contextualSpacing: true, spaceBefore: 120, spaceAfter: 160 },
      runs: [run(text)],
    })
    const { plan } = lower(
      await withBlocks([item('a'), item('b'), item('c'), { runs: [run('after')] }]),
    )
    const [a, b, c] = paras(plan.body)
    // one list of one style: only its outer edges keep Word's spacing (6 pt before, 8 pt after)
    expect([a, b, c].map((p) => [p.shape.before, p.shape.after])).toEqual([
      [1200, 0],
      [0, 0],
      [0, 1600],
    ])
  })

  it('reports what a block docx-engine could not model is, keeping text it can', async () => {
    const { plan, losses } = lower(
      await withBlocks([
        { type: 'passthrough', label: 'Equation' },
        { type: 'passthrough', label: 'Drawing object', chartDisplay: {} as never },
        {
          type: 'passthrough',
          label: 'Text box',
          textboxes: [{} as never, {} as never],
          strayRuns: [run('beside')],
        },
        { type: 'passthrough', label: 'Content control', previewText: 'kept text' },
        { type: 'passthrough', label: 'Embedded object', oleProgId: 'Excel.Sheet.12' },
      ]),
    )
    expect(texts(plan.body)).toEqual(['beside', 'kept text'])
    expect(losses).toEqual([
      { feature: 'equation', kind: 'dropped', count: 1 },
      { feature: 'chart', kind: 'dropped', count: 1 },
      { feature: 'textbox', kind: 'dropped', count: 2 },
      { feature: 'object', kind: 'dropped', count: 1 },
      { feature: 'plain_paragraph', kind: 'changed', count: 1 },
    ])
  })

  it('keeps a nested table where Word put it, its percent widths of the cell', async () => {
    const nested = {
      rows: [[{ paras: ['in 1'] }, { paras: ['in 2'] }]],
      widthPct: 50,
      colWidthsPct: [50, 50],
    }
    const { plan, losses } = lower(
      await withBlocks([
        {
          type: 'table',
          table: {
            colWidthsTwips: [4000],
            rows: [
              [{ paras: ['before', 'after'], nestedTables: [nested], nestedTableAnchors: [1] }],
            ],
          },
        },
      ]),
    )
    const [cell] = (plan.body[0] as Table).cells
    expect(texts(cell.body)).toEqual(['before', '[table]', 'after'])
    const inner = cell.body[1] as Table
    expect(inner.cells.map((c) => texts(c.body))).toEqual([['in 1'], ['in 2']])
    // half of the cell inside Word's 0.08 inch side margins (4000 - 2 * 108 twips), in halves
    expect(inner.colWidths).toEqual([4730, 4730])
    expect(losses).toEqual([])
  })

  it('narrows a nested table wider than its cell to fit inside the cell margins', async () => {
    const nested = { rows: [[{ paras: ['a'] }, { paras: ['b'] }]], colWidthsTwips: [3000, 1000] }
    const { plan } = lower(
      await withBlocks([
        {
          type: 'table',
          table: { colWidthsTwips: [4000], rows: [[{ paras: [''], nestedTables: [nested] }]] },
        },
      ]),
    )
    const inner = (plan.body[0] as Table).cells[0].body[1] as Table
    // 4000 - 2 * 108 twips, shared 3 : 1, in halves
    expect(inner.colWidths).toEqual([14190, 4730])
  })

  it('says so when Word nests tables deeper than docx-engine reads them', async () => {
    // twelve tables, each in the last: docx-engine reads eight and hands the other four over
    // as one table of plain paragraphs
    const nested = (story: readonly Block[]): Table | undefined =>
      story.find((b): b is Table => b.kind === 'table')
    let table = nested(lower(await parse(`${FIXTURES}/deep.docx`)).plan.body)
    let tables = 0
    for (; table; table = nested(table.cells[0].body)) tables++
    expect(tables).toBe(9)
    expect(lower(await parse(`${FIXTURES}/deep.docx`)).losses).toEqual([
      { feature: 'nested_table', kind: 'changed', count: 1 },
    ])
    expect(lower(await parse(`${FIXTURES}/nested.docx`)).losses).toEqual([])
  })

  it('writes a table of contents line as text with a right tab', async () => {
    const { plan, losses } = lower(
      await withBlocks([
        {
          type: 'passthrough',
          label: 'TOC entry',
          fieldDisplay: { kind: 'tocLine', left: 'Intro', right: '3', level: 1 },
        },
      ]),
    )
    const line = plan.body[0] as Para
    expect(textOf(line)).toBe('Intro\t3')
    expect(line.shape.tabStops).toMatchObject([{ align: 'right', leader: 'dot' }])
    expect(losses).toEqual([{ feature: 'toc', kind: 'changed', count: 1 }])
  })
})
