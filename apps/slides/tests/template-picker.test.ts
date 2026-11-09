/**
 * The template picker in the AI panel: the gallery (built-in templates with a
 * cover preview, the user's saved styles, the fonts notice), the selection
 * display above the input, and where both mount in the panel. Picking only
 * changes the document's remembered selection: no AI, no network, no edit.
 */
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lang } from '@genoffice/i18n'
import { listSlideTemplates } from '@genoffice/pipelines/slides/templates'

// react-konva's node entry requires the native 'canvas' package; nothing here draws
vi.mock('react-konva', () => {
  const stub = () => null
  return {
    Stage: stub,
    Layer: stub,
    Rect: stub,
    Group: stub,
    Transformer: stub,
    Line: stub,
    Arrow: stub,
    Text: stub,
    Ellipse: stub,
    Image: stub,
    Path: stub,
    Circle: stub,
    Arc: stub,
  }
})

import { LocaleProvider } from '../src/renderer/i18n/locale'
import { strings } from '../src/renderer/i18n/strings'
import { TemplateGallery, TemplateStartGallery } from '../src/renderer/ai/TemplateGallery'
import { TemplatePicker } from '../src/renderer/ai/TemplatePicker'
import { clearTemplateCoverCache, templateCoverLang } from '../src/renderer/ai/template-cover'
import {
  createTemplateSelectionState,
  templateSelectionState,
  type TemplateSelectionState,
} from '../src/renderer/ai/template-selection-state'
import {
  normalizeTemplateSelection,
  type TemplateSelection,
} from '../src/shared/template-selection'
import { AiPanel } from '../src/renderer/ai/AiPanel'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'

const TEMPLATES = listSlideTemplates()
type Dict = (typeof strings)['en']
const str = (lang: Lang, key: keyof Dict, params: Record<string, string> = {}): string =>
  Object.entries(params).reduce(
    (text, [k, v]) => text.replace(`{${k}}`, v),
    (strings[lang] as Dict)[key] as string,
  )
const descKey = (id: string) => `aiTplDesc_${id.replace(/-/g, '_')}` as keyof Dict
const schemeKey = (scheme: string) =>
  (scheme === 'light'
    ? 'aiTplSchemeLight'
    : scheme === 'dark'
      ? 'aiTplSchemeDark'
      : 'aiTplSchemeMixed') as keyof Dict

// ── window.slidesApi fake ────────────────────────────────────────────────

/** Calls a pick or a preview may make; anything else would reach the document, the AI or the network */
const PICKER_CALLS = new Set([
  'getTemplateSelection',
  'setTemplateSelection',
  'loadStyleTemplate',
  'listStyleTemplates',
  'renderTemplateCover',
  'openTemplateFontsFolder',
  'privateFontFaces',
  'privateFontData',
  'onLanguageChanged',
  // the default fonts line: reads Settings › General, and its "Change" opens Settings
  'getAiDefaultFonts',
  'openFontSettings',
])

interface Fake {
  api: Record<string, ReturnType<typeof vi.fn>>
  touched: Set<string>
  saved: Array<{ name: string; topic: string; createdAt: string }>
  stored: () => TemplateSelection | null
}

let fake: Fake

function installSlidesApi(opts: { saved?: Fake['saved'] } = {}): Fake {
  let stored: TemplateSelection | null = null
  let clock = 1
  const saved = opts.saved ?? []
  const api: Record<string, ReturnType<typeof vi.fn>> = {
    getTemplateSelection: vi.fn(async () => stored),
    setTemplateSelection: vi.fn(async (input: unknown) => {
      stored =
        input === null
          ? null
          : (normalizeTemplateSelection(
              input as Parameters<typeof normalizeTemplateSelection>[0],
              ++clock,
            ) ?? stored)
      return stored
    }),
    loadStyleTemplate: vi.fn(async (name: string) => ({
      ok: saved.some((s) => s.name === name),
    })),
    listStyleTemplates: vi.fn(async () => saved),
    renderTemplateCover: vi.fn(async () => null),
    openTemplateFontsFolder: vi.fn(async () => true),
    privateFontFaces: vi.fn(async () => []),
    privateFontData: vi.fn(async () => null),
    onLanguageChanged: vi.fn(() => () => {}),
    // the panel's own wiring (not the picker's)
    beginHistoryBatch: vi.fn(async () => false),
    endHistoryBatch: vi.fn(async () => null),
    aiLogRunFailure: vi.fn(async () => undefined),
  }
  const touched = new Set<string>()
  const proxy = new Proxy(api, {
    get(target, key) {
      if (typeof key === 'string') touched.add(key)
      return target[key as string]
    },
  })
  Object.defineProperty(window, 'slidesApi', { configurable: true, value: proxy })
  return { api, touched, saved, stored: () => stored }
}

/** A selection state of its own over the fake, so tests do not share the app's singleton */
function freshState(): TemplateSelectionState {
  return createTemplateSelectionState({
    getTemplateSelection: async () => window.slidesApi.getTemplateSelection(),
    setTemplateSelection: async (s) => window.slidesApi.setTemplateSelection(s),
    loadStyleTemplate: async (name) => window.slidesApi.loadStyleTemplate(name),
  })
}

// ── mounting ─────────────────────────────────────────────────────────────

const mounted: Array<{ root: Root; container: HTMLElement }> = []

function mount(element: ReactElement, lang: Lang = 'en'): HTMLElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(LocaleProvider, { initial: lang, children: element })))
  mounted.push({ root, container })
  return container
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
  })
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el).toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

const builtinCards = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLButtonElement>('.ai-tpl-group-builtin .ai-tpl-card'),
]
const savedCards = (root: ParentNode) => [
  ...root.querySelectorAll<HTMLButtonElement>('.ai-tpl-group-saved .ai-tpl-card'),
]
const chip = (root: ParentNode) => root.querySelector<HTMLButtonElement>('.ai-tpl-chip-main')

beforeAll(() => {
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
})

beforeEach(() => {
  clearTemplateCoverCache()
  fake = installSlidesApi()
  Object.defineProperty(window, 'projectApi', { configurable: true, value: undefined })
  Object.defineProperty(window, 'desktop', {
    configurable: true,
    value: { readAttachmentImage: vi.fn(async () => ({ ok: false })) },
  })
})

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

// ── gallery ──────────────────────────────────────────────────────────────

describe('template gallery', () => {
  it('lists the 12 built-in templates in catalog order, names as is, descriptions and brightness from the strings', async () => {
    const state = freshState()
    const root = mount(createElement(TemplateGallery, { state }), 'ko')
    await flush()
    const group = root.querySelector('.ai-tpl-group-builtin')!
    expect(group.textContent).toContain(str('ko', 'aiTplSectionBuiltin'))
    const cards = builtinCards(root)
    expect(TEMPLATES).toHaveLength(12)
    expect(cards.map((c) => c.dataset.templateId)).toEqual(TEMPLATES.map((t) => t.id))
    cards.forEach((card, i) => {
      const tpl = TEMPLATES[i]!
      expect(card.querySelector('.ai-tpl-card-name')!.textContent).toBe(tpl.name)
      expect(card.querySelector('.ai-tpl-card-desc')!.textContent).toBe(str('ko', descKey(tpl.id)))
      expect(card.querySelector('.ai-tpl-card-scheme')!.textContent).toBe(
        str('ko', schemeKey(tpl.scheme)),
      )
    })
  })

  it('hides the saved group without saved styles', async () => {
    const root = mount(createElement(TemplateGallery, { state: freshState() }))
    await flush()
    expect(fake.api.listStyleTemplates).toHaveBeenCalled()
    expect(root.querySelector('.ai-tpl-group-saved')).toBeNull()
  })

  it('shows saved styles by name and saved date, without a preview', async () => {
    const createdAt = '2026-03-05T10:00:00.000Z'
    fake = installSlidesApi({ saved: [{ name: 'Quarterly look', topic: 'q3', createdAt }] })
    const state = freshState()
    const root = mount(createElement(TemplateGallery, { state }))
    await flush()
    const group = root.querySelector('.ai-tpl-group-saved')!
    expect(group.textContent).toContain(str('en', 'aiTplSectionSaved'))
    const [card] = savedCards(root)
    expect(card!.querySelector('.ai-tpl-card-name')!.textContent).toBe('Quarterly look')
    expect(card!.textContent).toContain(
      str('en', 'aiTplSavedOn', { date: new Date(createdAt).toLocaleDateString('en-US') }),
    )
    expect(card!.querySelector('[role="img"]')).toBeNull()
    await click(card)
    expect(state.current()).toMatchObject({ kind: 'saved', key: 'Quarterly look' })
  })

  it('cards are buttons named by the template, with the preview named by aiTplPreviewAlt', async () => {
    const root = mount(createElement(TemplateGallery, { state: freshState() }))
    await flush()
    for (const [i, card] of builtinCards(root).entries()) {
      const tpl = TEMPLATES[i]!
      expect(card.tagName).toBe('BUTTON')
      expect(card.type).toBe('button')
      expect(card.tabIndex).toBeGreaterThanOrEqual(0)
      const labelled = card.getAttribute('aria-labelledby')!
      expect(document.getElementById(labelled)!.textContent).toBe(tpl.name)
      const described = card.getAttribute('aria-describedby')!.split(' ')
      expect(described.map((id) => document.getElementById(id)!.textContent)).toEqual([
        str('en', descKey(tpl.id)),
        str('en', schemeKey(tpl.scheme)),
      ])
      expect(card.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe(
        str('en', 'aiTplPreviewAlt', { name: tpl.name }),
      )
    }
  })

  it('clicking a card selects it, and it shows as selected', async () => {
    const state = freshState()
    const root = mount(createElement(TemplateGallery, { state }))
    await flush()
    const card = builtinCards(root)[3]!
    expect(card.getAttribute('aria-pressed')).toBe('false')
    await click(card)
    expect(state.current()).toMatchObject({ kind: 'builtin', key: TEMPLATES[3]!.id })
    expect(fake.stored()).toMatchObject({ kind: 'builtin', key: TEMPLATES[3]!.id })
    expect(builtinCards(root)[3]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('a card is reachable and activated from the keyboard', async () => {
    const state = freshState()
    const root = mount(createElement(TemplateGallery, { state }))
    await flush()
    const card = builtinCards(root)[1]!
    card.focus()
    expect(document.activeElement).toBe(card)
    // a native button: Enter and Space activate it by dispatching a click
    await act(async () => {
      card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    })
    await flush()
    expect(state.current()).toMatchObject({ kind: 'builtin', key: TEMPLATES[1]!.id })
  })

  it('the preview cover follows the UI language: ko for Korean, en for the other 20', async () => {
    mount(createElement(TemplateGallery, { state: freshState() }), 'ko')
    await flush()
    const calls = () => fake.api.renderTemplateCover.mock.calls as Array<[string, string]>
    expect(
      calls()
        .map(([id]) => id)
        .sort(),
    ).toEqual(TEMPLATES.map((t) => t.id).sort())
    expect(new Set(calls().map(([, lang]) => lang))).toEqual(new Set(['ko']))

    fake.api.renderTemplateCover.mockClear()
    clearTemplateCoverCache()
    mount(createElement(TemplateGallery, { state: freshState() }), 'ja')
    await flush()
    expect(calls()).toHaveLength(12)
    expect(new Set(calls().map(([, lang]) => lang))).toEqual(new Set(['en']))

    for (const lang of Object.keys(strings) as Lang[]) {
      expect(templateCoverLang(lang)).toBe(lang === 'ko' ? 'ko' : 'en')
    }
  })

  it('browsing and picking reach neither the AI nor the document', async () => {
    const state = freshState()
    const root = mount(createElement(TemplateGallery, { state }))
    await flush()
    await click(builtinCards(root)[0])
    await click(builtinCards(root)[5])
    const outside = [...fake.touched].filter((key) => !PICKER_CALLS.has(key))
    expect(outside).toEqual([])
  })

  it('ends with the fonts notice and a button that opens the fonts folder', async () => {
    const root = mount(createElement(TemplateGallery, { state: freshState() }))
    await flush()
    const foot = root.querySelector('.ai-tpl-foot')!
    expect(foot.textContent).toContain(str('en', 'aiTplFontsNotice'))
    const button = [...foot.querySelectorAll('button')].find(
      (b) => b.textContent === str('en', 'aiTplOpenFonts'),
    )
    await click(button)
    expect(fake.api.openTemplateFontsFolder).toHaveBeenCalledTimes(1)
  })

  describe('the default fonts line (Settings › General)', () => {
    const fontsLine = (root: ParentNode) =>
      root.querySelector<HTMLElement>('[data-testid="ai-tpl-default-fonts"]')

    const withFonts = (fonts: { mode: string; sans: string; serif: string }) => {
      fake.api.getAiDefaultFonts = vi.fn(async () => fonts)
      fake.api.openFontSettings = vi.fn(async () => undefined)
    }

    it('names the one family, the title and body families, or the AI', async () => {
      withFonts({ mode: 'sans', sans: 'Pretendard', serif: 'Noto Serif KR' })
      let root = mount(createElement(TemplateGallery, { state: freshState() }))
      await flush()
      expect(fontsLine(root)?.textContent).toContain(
        str('en', 'aiTplFontsOne', { font: 'Pretendard' }),
      )
      expect(fake.api.getAiDefaultFonts).toHaveBeenCalledWith('en')

      withFonts({ mode: 'serifTitle', sans: 'Pretendard', serif: 'Batang' })
      root = mount(createElement(TemplateGallery, { state: freshState() }))
      await flush()
      expect(fontsLine(root)?.textContent).toContain(
        str('en', 'aiTplFontsTwo', { title: 'Batang', body: 'Pretendard' }),
      )

      withFonts({ mode: 'auto', sans: 'Pretendard', serif: 'Batang' })
      root = mount(createElement(TemplateGallery, { state: freshState() }))
      await flush()
      expect(fontsLine(root)?.textContent).toContain(str('en', 'aiTplFontsAuto'))
    })

    it('says the template decides once one is chosen, and "Change" opens Settings', async () => {
      withFonts({ mode: 'sans', sans: 'Pretendard', serif: 'Noto Serif KR' })
      const root = mount(createElement(TemplateGallery, { state: freshState() }))
      await flush()
      await click(builtinCards(root)[0])
      expect(fontsLine(root)?.textContent).toContain(str('en', 'aiTplFontsTemplate'))
      const change = [...fontsLine(root)!.querySelectorAll('button')].find(
        (b) => b.textContent === str('en', 'aiTplFontsChange'),
      )
      await click(change)
      expect(fake.api.openFontSettings).toHaveBeenCalledTimes(1)
    })

    it('is not shown where the main process does not answer', async () => {
      const root = mount(createElement(TemplateGallery, { state: freshState() }))
      await flush()
      expect(fontsLine(root)).toBeNull()
    })
  })
})

// ── selection display ────────────────────────────────────────────────────

describe('selection display', () => {
  it('reads "Template" without a selection and the selected name with one', async () => {
    fake = installSlidesApi({ saved: [{ name: 'Mine', topic: '', createdAt: '' }] })
    const state = freshState()
    const root = mount(createElement(TemplatePicker, { state, deckEmpty: false }))
    await flush()
    expect(chip(root)!.textContent).toBe(str('en', 'aiTplChipPick'))
    await act(async () => {
      await state.select('builtin', TEMPLATES[2]!.id)
    })
    expect(chip(root)!.textContent).toBe(TEMPLATES[2]!.name)
    expect(chip(root)!.getAttribute('aria-label')).toContain(str('en', 'aiTplChipChange'))
    await act(async () => {
      await state.select('saved', 'Mine')
    })
    expect(chip(root)!.textContent).toBe('Mine')
  })

  it('the chip opens the gallery to change the selection; a pick closes it', async () => {
    const state = freshState()
    await state.select('builtin', TEMPLATES[0]!.id)
    const root = mount(createElement(TemplatePicker, { state, deckEmpty: true }))
    await flush()
    expect(root.querySelector('.ai-tpl-gallery')).toBeNull()
    await click(chip(root))
    expect(chip(root)!.getAttribute('aria-expanded')).toBe('true')
    expect(root.querySelector('.ai-tpl-gallery')).not.toBeNull()
    await click(builtinCards(root)[4])
    expect(state.current()).toMatchObject({ kind: 'builtin', key: TEMPLATES[4]!.id })
    expect(root.querySelector('.ai-tpl-gallery')).toBeNull()
  })

  it('Escape closes the opened gallery', async () => {
    const root = mount(createElement(TemplatePicker, { state: freshState(), deckEmpty: false }))
    await flush()
    await click(chip(root))
    const gallery = root.querySelector('.ai-tpl-gallery')!
    await act(async () => {
      gallery.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(root.querySelector('.ai-tpl-gallery')).toBeNull()
  })

  it('"Remove template" removes the selection', async () => {
    const state = freshState()
    await state.select('builtin', TEMPLATES[0]!.id)
    const root = mount(createElement(TemplatePicker, { state, deckEmpty: false }))
    await flush()
    const remove = root.querySelector(`[aria-label="${str('en', 'aiTplChipRemove')}"]`)
    await click(remove)
    expect(state.current()).toBeNull()
    expect(chip(root)!.textContent).toBe(str('en', 'aiTplChipPick'))
    expect(root.querySelector(`[aria-label="${str('en', 'aiTplChipRemove')}"]`)).toBeNull()
  })

  it('added requests show a mark; clearing them keeps the selection', async () => {
    const state = freshState()
    await state.select('builtin', TEMPLATES[0]!.id)
    const root = mount(createElement(TemplatePicker, { state, deckEmpty: false }))
    await flush()
    expect(root.textContent).not.toContain(str('en', 'aiTplAdjustMark'))
    await act(async () => {
      await state.addRequest('mostly blue')
    })
    expect(root.textContent).toContain(str('en', 'aiTplAdjustMark'))
    const clear = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === str('en', 'aiTplAdjustClear'),
    )
    await click(clear)
    expect(state.current()).toMatchObject({
      kind: 'builtin',
      key: TEMPLATES[0]!.id,
      adjustments: [],
    })
    expect(root.textContent).not.toContain(str('en', 'aiTplAdjustMark'))
  })

  it('in a deck with slides, a pick tells once that existing slides stay as they are', async () => {
    const state = freshState()
    const root = mount(createElement(TemplatePicker, { state, deckEmpty: false }))
    await flush()
    const notices = () =>
      [...root.querySelectorAll('.ai-tpl-notice')].filter(
        (n) => n.textContent === str('en', 'aiTplAppliesToNew'),
      )
    expect(notices()).toHaveLength(0)
    await click(chip(root))
    await click(builtinCards(root)[1])
    expect(notices()).toHaveLength(1)
    // picking what is already selected is no new pick
    await click(chip(root))
    await click(builtinCards(root)[1])
    expect(notices()).toHaveLength(1)
    await click(chip(root))
    await click(builtinCards(root)[2])
    expect(notices()).toHaveLength(1)
  })

  it('in an empty deck a pick shows no such notice', async () => {
    const root = mount(createElement(TemplatePicker, { state: freshState(), deckEmpty: true }))
    await flush()
    await click(chip(root))
    await click(builtinCards(root)[1])
    expect(root.querySelector('.ai-tpl-notice')).toBeNull()
  })

  it('with the gallery already on the start screen, the chip moves to it instead of opening another', async () => {
    const state = freshState()
    const root = mount(
      createElement('div', null, [
        createElement(TemplateStartGallery, { key: 'g', state }),
        createElement(TemplatePicker, { key: 'p', state, deckEmpty: true, galleryShown: true }),
      ]),
    )
    await flush()
    await click(chip(root))
    expect(root.querySelectorAll('.ai-tpl-gallery')).toHaveLength(1)
    expect(document.activeElement?.classList.contains('ai-tpl-card')).toBe(true)
  })
})

// ── in the AI panel ──────────────────────────────────────────────────────

const settings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

function panelProps(overrides: Record<string, unknown> = {}) {
  return {
    slides: [],
    current: 0,
    selectedIds: [],
    images: new Map<string, HTMLImageElement>(),
    applySlide: vi.fn(),
    applyDeck: vi.fn(),
    fitWidthPx: 960,
    settings,
    open: true,
    onExpand: () => {},
    onCollapse: () => {},
    ...overrides,
  }
}

describe('in the AI panel', () => {
  beforeEach(async () => {
    await templateSelectionState.remove()
  })

  it('an empty deck shows the gallery expanded on the start screen, guidance and examples kept', async () => {
    const root = mount(createElement(AiPanel, panelProps({ deckEmpty: true })))
    await flush()
    const empty = root.querySelector('.ai-chat-empty')!
    expect(empty.textContent).toContain(str('en', 'aiEmptyGenTitle'))
    expect(empty.querySelectorAll('.ai-starter').length).toBeGreaterThan(0)
    expect(empty.querySelector('.ai-tpl-gallery')).not.toBeNull()
    expect(builtinCards(empty)).toHaveLength(12)
    // the selection display sits in the composer, above the input
    const composer = root.querySelector('.ai-composer')!
    expect(chip(composer)!.textContent).toBe(str('en', 'aiTplChipPick'))
    const bar = composer.querySelector('.ai-tpl-bar')!
    const input = composer.querySelector('.ai-input-box')!
    expect(bar.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a deck with slides keeps the gallery behind the chip; a pick leaves the document alone', async () => {
    const props = panelProps({ deckEmpty: false })
    const root = mount(createElement(AiPanel, props))
    await flush()
    expect(root.querySelector('.ai-tpl-gallery')).toBeNull()
    await click(chip(root))
    await click(builtinCards(root)[0])
    expect(templateSelectionState.current()).toMatchObject({ key: TEMPLATES[0]!.id })
    expect(root.textContent).toContain(str('en', 'aiTplAppliesToNew'))
    expect(props.applyDeck).not.toHaveBeenCalled()
    expect(props.applySlide).not.toHaveBeenCalled()
  })
})
