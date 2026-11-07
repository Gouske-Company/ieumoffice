import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  DEFAULT_SANS_FONT,
  DEFAULT_SERIF_FONT,
  SANS_FONT_SUGGESTIONS,
  SERIF_FONT_SUGGESTIONS,
  defaultSlidesAiFonts,
  isWindowsStandardFont,
  normalizeSlidesAiFonts,
  slidesAiFontRoles,
} from '../src/slides-ai-fonts'
import { TEMPLATE_FONT_FAMILY_NAMES } from '../src/template-fonts'

describe('defaultSlidesAiFonts', () => {
  it('Korean and English start on the bundled gothic face; other languages on auto', () => {
    for (const lang of LANGS) {
      const expected = lang === 'ko' || lang === 'en' ? 'sans' : 'auto'
      expect(defaultSlidesAiFonts(lang).mode).toBe(expected)
    }
  })

  it('the default families ship with the app', () => {
    expect(TEMPLATE_FONT_FAMILY_NAMES).toContain(DEFAULT_SANS_FONT)
    expect(TEMPLATE_FONT_FAMILY_NAMES).toContain(DEFAULT_SERIF_FONT)
    expect(SANS_FONT_SUGGESTIONS[0]).toBe(DEFAULT_SANS_FONT)
    expect(SERIF_FONT_SUGGESTIONS[0]).toBe(DEFAULT_SERIF_FONT)
  })
})

describe('normalizeSlidesAiFonts', () => {
  it('keeps a valid stored value', () => {
    const v = { mode: 'serif', sans: 'Malgun Gothic', serif: 'Batang' }
    expect(normalizeSlidesAiFonts(v, 'ja')).toEqual(v)
  })

  it('anything absent or unknown falls back part by part', () => {
    expect(normalizeSlidesAiFonts(undefined, 'ko')).toEqual(defaultSlidesAiFonts('ko'))
    expect(normalizeSlidesAiFonts([], 'ko')).toEqual(defaultSlidesAiFonts('ko'))
    expect(normalizeSlidesAiFonts({ mode: 'comic', sans: 'Arial' }, 'fr')).toEqual({
      mode: 'auto',
      sans: 'Arial',
      serif: DEFAULT_SERIF_FONT,
    })
  })

  it('a family name loses quotes and control characters, and long or empty ones are dropped', () => {
    expect(normalizeSlidesAiFonts({ sans: ' My "Font"\n' }, 'ko').sans).toBe('My Font')
    expect(normalizeSlidesAiFonts({ sans: '   ' }, 'ko').sans).toBe(DEFAULT_SANS_FONT)
    expect(normalizeSlidesAiFonts({ serif: 'x'.repeat(81) }, 'ko').serif).toBe(DEFAULT_SERIF_FONT)
    expect(normalizeSlidesAiFonts({ serif: 42 }, 'ko').serif).toBe(DEFAULT_SERIF_FONT)
  })
})

describe('slidesAiFontRoles', () => {
  const fonts = { sans: 'S', serif: 'M' }
  it('maps each mode to its title and body families', () => {
    expect(slidesAiFontRoles({ ...fonts, mode: 'auto' })).toBeNull()
    expect(slidesAiFontRoles({ ...fonts, mode: 'sans' })).toEqual({ title: 'S', body: 'S' })
    expect(slidesAiFontRoles({ ...fonts, mode: 'serif' })).toEqual({ title: 'M', body: 'M' })
    expect(slidesAiFontRoles({ ...fonts, mode: 'serifTitle' })).toEqual({ title: 'M', body: 'S' })
  })
})

describe('isWindowsStandardFont', () => {
  it('knows the Windows families in either spelling and nothing bundled', () => {
    expect(isWindowsStandardFont('Malgun Gothic')).toBe(true)
    expect(isWindowsStandardFont('맑은 고딕')).toBe(true)
    expect(isWindowsStandardFont('batang')).toBe(true)
    expect(isWindowsStandardFont('Pretendard')).toBe(false)
    expect(isWindowsStandardFont('Noto Serif KR')).toBe(false)
  })
})
