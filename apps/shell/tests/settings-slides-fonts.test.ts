/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlidesAiFonts } from '@genoffice/ui/slides-ai-fonts'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete window.aiOffice
})

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

async function click(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.click()
    await flush()
  })
}

async function openGeneral(
  stored: SlidesAiFonts | undefined,
  setFonts: (fonts: SlidesAiFonts) => Promise<SlidesAiFonts>,
  lang: 'en' | 'ko' = 'en',
) {
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getHwpDefaultFormat: async () => 'hwp',
    setHwpDefaultFormat: async (v: 'hwp' | 'hwpx') => v,
    ...(stored ? { getSlidesAiFonts: async () => stored } : {}),
    setSlidesAiFonts: setFonts,
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
  } as unknown as HomeApi
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(SettingsModal, { onClose: vi.fn() }),
      ),
    )
    await flush()
  })
  const general = Array.from(host.querySelectorAll<HTMLButtonElement>('.set-nav-item'))[3]
  await click(general!)
}

const field = () => host.querySelector<HTMLElement>('[data-testid="slides-ai-fonts"]')!
const cards = () => Array.from(field().querySelectorAll<HTMLButtonElement>('[role="radio"]'))
const checked = () => cards().find((c) => c.getAttribute('aria-checked') === 'true')
const trigger = (label: string) =>
  field().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!

describe('Settings → General: AI slide fonts', () => {
  it('four mode cards; before a choice, English starts on sans serif in Pretendard', async () => {
    await openGeneral(
      undefined,
      vi.fn(async (v) => v),
    )
    expect(cards().map((c) => c.querySelector('.set-slides-font-card-name')?.textContent)).toEqual([
      'Auto',
      'Sans serif',
      'Serif',
      'Serif titles',
    ])
    expect(checked()?.textContent).toContain('Sans serif')
    expect(trigger('Sans-serif font').dataset.value).toBe('Pretendard')
    expect(trigger('Serif font').dataset.value).toBe('Noto Serif KR')
  })

  it('each card draws its samples in the fonts it would use', async () => {
    await openGeneral(
      { mode: 'auto', sans: 'Pretendard', serif: 'Noto Serif KR' },
      vi.fn(async (v) => v),
    )
    const serifTitle = cards()[3]!
    const title = serifTitle.querySelector<HTMLElement>('.set-slides-font-sample-title')!
    const body = serifTitle.querySelector<HTMLElement>('.set-slides-font-sample-body')!
    expect(title.style.fontFamily).toContain('Noto Serif KR')
    expect(body.style.fontFamily).toContain('Pretendard')
    expect(cards()[0]!.querySelector('.set-slides-font-sample-title')).toBeNull()
  })

  it('picking a card stores the mode with the families unchanged', async () => {
    const setFonts = vi.fn(async (v: SlidesAiFonts) => v)
    await openGeneral({ mode: 'sans', sans: 'Malgun Gothic', serif: 'Batang' }, setFonts)
    await click(cards()[2]!)
    expect(setFonts).toHaveBeenCalledWith({ mode: 'serif', sans: 'Malgun Gothic', serif: 'Batang' })
    expect(checked()?.textContent).toContain('Serif')
  })

  it('picking a family stores it; a header row is not a choice', async () => {
    const setFonts = vi.fn(async (v: SlidesAiFonts) => v)
    await openGeneral({ mode: 'serifTitle', sans: 'Pretendard', serif: 'Noto Serif KR' }, setFonts)
    await click(trigger('Serif font'))
    const pop = host.querySelector<HTMLElement>('.gs-dd-pop')!
    expect(pop.textContent).toContain('Suggested fonts')
    await click(pop.querySelector<HTMLButtonElement>('[data-value="Gowun Batang"]')!)
    expect(setFonts).toHaveBeenCalledWith({
      mode: 'serifTitle',
      sans: 'Pretendard',
      serif: 'Gowun Batang',
    })
  })

  it('a family Windows lacks gets the PowerPoint note; Windows families and auto do not', async () => {
    await openGeneral(
      { mode: 'sans', sans: 'Pretendard', serif: 'Batang' },
      vi.fn(async (v) => v),
    )
    expect(field().querySelector('[data-testid="slides-ai-fonts-portable"]')).not.toBeNull()
    await click(cards()[2]!)
    expect(field().querySelector('[data-testid="slides-ai-fonts-portable"]')).toBeNull()
    await click(cards()[0]!)
    expect(field().querySelector('[data-testid="slides-ai-fonts-portable"]')).toBeNull()
  })

  it('Korean names the cards in Korean', async () => {
    await openGeneral(
      undefined,
      vi.fn(async (v) => v),
      'ko',
    )
    expect(field().textContent).toContain('AI 슬라이드 글꼴')
    expect(cards().map((c) => c.querySelector('.set-slides-font-card-name')?.textContent)).toEqual([
      '자동',
      '고딕',
      '명조',
      '제목만 명조',
    ])
  })
})

describe('the slide-fonts setting is wired through the shell and the slides editor', () => {
  const read = (path: string): string => readFileSync(join(__dirname, '..', path), 'utf8')

  it('the shell registers and exposes both calls on one stored key', () => {
    const main = read('src/main/index.ts')
    expect(main).toContain('HOME_CHANNELS.getSlidesAiFonts')
    expect(main).toContain('HOME_CHANNELS.setSlidesAiFonts')
    expect(main).toContain('SLIDES_AI_FONTS_KEY')
    const preload = read('src/preload/index.ts')
    expect(preload).toContain('async getSlidesAiFonts()')
    expect(preload).toContain('async setSlidesAiFonts(fonts)')
  })

  it('the slides editor reads the same key from the same file', () => {
    const slides = read('../slides/src/main/ai-default-fonts.ts')
    expect(slides).toContain('SLIDES_AI_FONTS_KEY')
    expect(slides).toContain("'app-settings.json'")
    expect(read('../slides/src/main/ai-ipc.ts')).toContain("'slides:ai-default-fonts'")
  })
})
