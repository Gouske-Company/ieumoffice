/**
 * The fonts of Settings › General in deck generation: they reach the style generator
 * and the page writer only where nothing else decides the fonts (no design template,
 * a new deck or one made in these fonts). Every model call is a fake on DeckAccess;
 * nothing here reaches a provider.
 */
import { describe, expect, it, vi } from 'vitest'
import { listSlideTemplates } from '@genoffice/pipelines/slides/templates'
import type { RenderSlide } from '@genoffice/pptx-render'
import type { SlidesAiFontRoles } from '@genoffice/ui/slides-ai-fonts'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'
import { createTemplateSelectionState } from '../src/renderer/ai/template-selection-state'
import { normalizeTemplateSelection } from '../src/shared/template-selection'
import type { AgentToolCall } from '../src/shared/ipc'
import {
  deckTakesDefaultFonts,
  defaultFontsPageNote,
  defaultFontsStyleNote,
} from '../src/renderer/ai/default-fonts'

type PageArgs = Parameters<NonNullable<DeckAccess['generatePageLocal']>>[0]
type StyleArgs = Parameters<NonNullable<DeckAccess['generateStyleSkill']>>[0]

const SERIF_TITLE: SlidesAiFontRoles = { title: 'Noto Serif KR', body: 'Pretendard' }

/** A slide whose one text box holds runs in the given explicit fonts (undefined: theme font). */
function slideWithRuns(fonts: Array<string | undefined>): RenderSlide {
  return {
    widthPx: 1280,
    heightPx: 720,
    nodes: [
      {
        type: 'text',
        sourceId: 'e1',
        box: { x: 0, y: 0, w: 100, h: 20 },
        text: {
          lines: [
            {
              runs: fonts.map((f) => ({
                text: 'Hello',
                fontFamily: f ?? 'Calibri',
                ...(f ? { srcFontFamily: f } : {}),
              })),
            },
          ],
        },
      },
    ],
  } as unknown as RenderSlide
}

const blankSlide = { widthPx: 1280, heightPx: 720, nodes: [] } as unknown as RenderSlide

function makeDeck(opts: {
  fonts: SlidesAiFontRoles | null
  slides?: RenderSlide[]
  template?: boolean
  fontsFail?: boolean
}) {
  const pageCalls: PageArgs[] = []
  const styleCalls: StyleArgs[] = []
  const stored = opts.template
    ? normalizeTemplateSelection({ kind: 'builtin', key: listSlideTemplates()[0]!.id }, 1)
    : null
  const templateSelection = createTemplateSelectionState({
    getTemplateSelection: async () => stored,
    setTemplateSelection: async () => stored,
    loadStyleTemplate: async () => ({ ok: false }),
  })
  const getAiDefaultFonts = vi.fn(async () => {
    if (opts.fontsFail) throw new Error('no handler')
    return opts.fonts
  })
  const access: DeckAccess = {
    getSlides: () => opts.slides ?? [blankSlide],
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 1280,
    retryBackoffMs: 0,
    getAiDefaultFonts,
    landGeneratedPages: async (markers) => ({ ok: true, pages: markers.length, appendedFrom: 0 }),
    regenerateSlide: async () => ({ ok: true }),
    generatePageLocal: async (args) => {
      pageCalls.push(args)
      return { ok: true, marker: `localpptx:PAGE${args.pageIndex}` }
    },
    generateStyleSkill: async (a) => {
      styleCalls.push(a)
      return { ok: true, styleSkill: 'STYLE' }
    },
    planDeckOutline: async (a) => ({
      ok: true,
      outline: {
        core_hook: 'CH',
        pages: Array.from({ length: a.count }, (_, i) => ({
          title: `P${a.startPage + i}`,
          brief: 'b',
          layout: 'data',
          image_queries: [],
        })),
      },
    }),
    listStyleTemplates: async () => [],
    loadStyleTemplate: async () => ({ ok: false, error: 'none' }),
    templateSelection,
  }
  return { skill: createSlidesSkill(access), pageCalls, styleCalls, getAiDefaultFonts }
}

const call = (name: string, input: Record<string, unknown>): AgentToolCall => ({
  id: 'c',
  name,
  input,
})
const topicCall = (extra?: Record<string, unknown>) =>
  call('generate_deck', { topic: 'Quarterly review', approx_pages: 2, ...(extra ?? {}) })
const appendCall = () =>
  call('generate_deck', {
    core_hook: 'Hook',
    pages: [{ title: 'New page', brief: 'b', layout: 'data' }],
    insert_mode: 'append',
  })

describe('generate_deck with the Settings › General fonts', () => {
  it('a new deck: the style generator and every page get the fonts', async () => {
    const deck = makeDeck({ fonts: SERIF_TITLE })
    const res = (await deck.skill.executeTool(topicCall())) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    expect(deck.styleCalls).toHaveLength(1)
    expect(deck.styleCalls[0]!.defaultFonts).toEqual(SERIF_TITLE)
    expect(deck.pageCalls).toHaveLength(2)
    for (const args of deck.pageCalls) expect(args.defaultFonts).toEqual(SERIF_TITLE)
  })

  it('"auto" (null) sends nothing: the request is the one it always was', async () => {
    const deck = makeDeck({ fonts: null })
    await deck.skill.executeTool(topicCall())
    expect(deck.styleCalls[0]).not.toHaveProperty('defaultFonts')
    for (const args of deck.pageCalls) expect(args).not.toHaveProperty('defaultFonts')
  })

  it('a design template wins: the setting is not even read', async () => {
    const deck = makeDeck({ fonts: SERIF_TITLE, template: true })
    await deck.skill.executeTool(topicCall())
    expect(deck.getAiDefaultFonts).not.toHaveBeenCalled()
    for (const args of deck.pageCalls) expect(args).not.toHaveProperty('defaultFonts')
  })

  it('a setting that cannot be read leaves generation as it was', async () => {
    const deck = makeDeck({ fonts: SERIF_TITLE, fontsFail: true })
    const res = (await deck.skill.executeTool(topicCall())) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    for (const args of deck.pageCalls) expect(args).not.toHaveProperty('defaultFonts')
  })

  it('appending to a deck in other fonts keeps that deck’s look', async () => {
    const deck = makeDeck({ fonts: SERIF_TITLE, slides: [slideWithRuns(['Arial'])] })
    await deck.skill.executeTool(appendCall())
    expect(deck.pageCalls).toHaveLength(1)
    expect(deck.pageCalls[0]).not.toHaveProperty('defaultFonts')
  })

  it('appending to a deck made in these fonts continues in them', async () => {
    const deck = makeDeck({
      fonts: SERIF_TITLE,
      slides: [slideWithRuns(['Noto Serif KR', 'Pretendard'])],
    })
    await deck.skill.executeTool(appendCall())
    expect(deck.pageCalls[0]!.defaultFonts).toEqual(SERIF_TITLE)
  })

  it('a whole-deck replace takes the fonts whatever the old deck used', async () => {
    const deck = makeDeck({ fonts: SERIF_TITLE, slides: [slideWithRuns(['Arial'])] })
    await deck.skill.executeTool(topicCall())
    for (const args of deck.pageCalls) expect(args.defaultFonts).toEqual(SERIF_TITLE)
  })

  it('regenerate_slide judges the deck by the pages it keeps', async () => {
    const kept = makeDeck({
      fonts: SERIF_TITLE,
      slides: [slideWithRuns(['Pretendard']), slideWithRuns(['Arial'])],
    })
    await kept.skill.executeTool(call('regenerate_slide', { slideIndex: 1, brief: 'redo' }))
    expect(kept.pageCalls[0]!.defaultFonts).toEqual(SERIF_TITLE)

    const other = makeDeck({
      fonts: SERIF_TITLE,
      slides: [slideWithRuns(['Arial']), slideWithRuns(['Pretendard'])],
    })
    await other.skill.executeTool(call('regenerate_slide', { slideIndex: 1, brief: 'redo' }))
    expect(other.pageCalls[0]).not.toHaveProperty('defaultFonts')
  })
})

describe('deckTakesDefaultFonts', () => {
  it('a deck without text takes them', () => {
    expect(deckTakesDefaultFonts([blankSlide], SERIF_TITLE)).toBe(true)
    expect(deckTakesDefaultFonts([], SERIF_TITLE)).toBe(true)
  })

  it('text only in the two families (any case) takes them', () => {
    expect(
      deckTakesDefaultFonts([slideWithRuns(['pretendard', 'NOTO SERIF KR'])], SERIF_TITLE),
    ).toBe(true)
  })

  it('any other named font, or text on the theme font alone, keeps the deck’s look', () => {
    expect(deckTakesDefaultFonts([slideWithRuns(['Pretendard', 'Arial'])], SERIF_TITLE)).toBe(false)
    expect(deckTakesDefaultFonts([slideWithRuns([undefined])], SERIF_TITLE)).toBe(false)
  })
})

describe('the notes the model reads', () => {
  it('the style note names both roles and gives way to a requested font', () => {
    const note = defaultFontsStyleNote(SERIF_TITLE)
    expect(note).toContain('CJK title font: Noto Serif KR')
    expect(note).toContain('Body font: Pretendard')
    expect(note).toContain('unless the style preference')
  })

  it('the page note gives one family, or a title and a body family', () => {
    expect(defaultFontsPageNote({ title: 'Pretendard', body: 'Pretendard' })).toContain(
      '"font":"Pretendard" on every run',
    )
    const two = defaultFontsPageNote(SERIF_TITLE)
    expect(two).toContain('"font":"Noto Serif KR" on title runs')
    expect(two).toContain('"font":"Pretendard" on every other run')
  })
})
