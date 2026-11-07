/**
 * The fonts AI slide generation uses when the request names none (Settings › General).
 *
 * Stored in userData/app-settings.json under SLIDES_AI_FONTS_KEY. The shell's settings
 * page writes it; the slides editor reads it for each generation, so a change applies
 * to the next deck without a restart. Plain data and pure helpers: the settings page,
 * the slides renderer and the main processes all read it.
 *
 * Order of precedence at generation time (the slides skill applies it): a font the
 * user's request names, then a design template's fonts, then a deck that already has
 * content (it keeps its own fonts), then this setting; 'auto' leaves the choice to the
 * model as before the setting existed.
 */

/** auto: the model picks; sans/serif: every text in that face; serifTitle: serif titles over sans body. */
export type SlidesAiFontMode = 'auto' | 'sans' | 'serif' | 'serifTitle'

export interface SlidesAiFonts {
  readonly mode: SlidesAiFontMode
  /** the sans-serif (gothic) family */
  readonly sans: string
  /** the serif (myeongjo) family */
  readonly serif: string
}

/** The two theme roles a deck has: title text and every other text. */
export interface SlidesAiFontRoles {
  readonly title: string
  readonly body: string
}

export const SLIDES_AI_FONTS_KEY = 'slidesAiFonts'

export const SLIDES_AI_FONT_MODES: readonly SlidesAiFontMode[] = [
  'auto',
  'sans',
  'serif',
  'serifTitle',
]

export const DEFAULT_SANS_FONT = 'Pretendard'
export const DEFAULT_SERIF_FONT = 'Noto Serif KR'

/**
 * The suggested families, the app's bundled ones first (they draw the same on every
 * machine running the app), then each OS's own. Pickers hide the OS names the
 * machine proves absent (partitionFontFamilies), as every font picker does.
 */
export const SANS_FONT_SUGGESTIONS: readonly string[] = [
  'Pretendard',
  'Gowun Dodum',
  'Malgun Gothic',
  'Apple SD Gothic Neo',
]
export const SERIF_FONT_SUGGESTIONS: readonly string[] = [
  'Noto Serif KR',
  'Gowun Batang',
  'Batang',
  'AppleMyungjo',
]

/**
 * Families every Windows PC has. A deck in any other family looks different in
 * PowerPoint on a PC without it, which the settings page says beside the picker.
 */
export const WINDOWS_STANDARD_FONTS: readonly string[] = [
  'Malgun Gothic',
  '맑은 고딕',
  'Batang',
  '바탕',
  'Dotum',
  '돋움',
  'Gulim',
  '굴림',
  'Gungsuh',
  '궁서',
  'Arial',
  'Times New Roman',
  'Calibri',
  'Segoe UI',
]

/** Longest family name kept; a hand-edited file cannot push a long string into every prompt. */
const MAX_FAMILY_LENGTH = 80

/**
 * The value before the person chooses: the bundled gothic face where the UI language
 * is one its glyphs cover (Korean, English); 'auto' elsewhere, since the bundled
 * faces carry no Japanese, Chinese, Arabic, Thai or Devanagari glyphs.
 */
export function defaultSlidesAiFonts(lang: string): SlidesAiFonts {
  return {
    mode: lang === 'ko' || lang === 'en' ? 'sans' : 'auto',
    sans: DEFAULT_SANS_FONT,
    serif: DEFAULT_SERIF_FONT,
  }
}

function familyOr(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  // a family name never holds control characters or quotes, and the prompt quotes it
  const name = [...value]
    .filter((ch) => {
      const code = ch.charCodeAt(0)
      return code >= 0x20 && code !== 0x7f && ch !== '"'
    })
    .join('')
    .trim()
  return name && name.length <= MAX_FAMILY_LENGTH ? name : fallback
}

/** Reads a stored value; anything absent or unknown falls back to the language's default. */
export function normalizeSlidesAiFonts(value: unknown, lang: string): SlidesAiFonts {
  const base = defaultSlidesAiFonts(lang)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base
  const v = value as Record<string, unknown>
  const mode = SLIDES_AI_FONT_MODES.includes(v.mode as SlidesAiFontMode)
    ? (v.mode as SlidesAiFontMode)
    : base.mode
  return { mode, sans: familyOr(v.sans, base.sans), serif: familyOr(v.serif, base.serif) }
}

/** The family for titles and for the rest; null for 'auto' (the model picks). */
export function slidesAiFontRoles(fonts: SlidesAiFonts): SlidesAiFontRoles | null {
  switch (fonts.mode) {
    case 'sans':
      return { title: fonts.sans, body: fonts.sans }
    case 'serif':
      return { title: fonts.serif, body: fonts.serif }
    case 'serifTitle':
      return { title: fonts.serif, body: fonts.sans }
    default:
      return null
  }
}

/** Whether every Windows PC has the family (spelling-insensitive to case). */
export function isWindowsStandardFont(family: string): boolean {
  const f = family.trim().toLowerCase()
  return WINDOWS_STANDARD_FONTS.some((w) => w.toLowerCase() === f)
}
