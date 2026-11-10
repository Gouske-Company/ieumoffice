/**
 * Every unit the conversion crosses, and the only place a plain number becomes
 * one. Word measures in twips (1/20 pt), half-points and CSS pixels; the rhwp
 * engine takes HWPUNIT (1/7200 inch, 1 pt = 100) for pages, characters,
 * pictures and tables, and a paragraph unit twice as fine (1 pt = 200) for
 * paragraph margins, spacing, fixed line heights and tab positions.
 */

declare const unit: unique symbol

/** HWPUNIT: 1 pt = 100 */
export type HwpUnit = number & { readonly [unit]: 'hwp' }
/** the engine's paragraph JSON unit: 1 pt = 200 (twips x 10) */
export type ParaUnit = number & { readonly [unit]: 'para' }
/** '#rrggbb', lower case */
export type Rgb = string & { readonly [unit]: 'rgb' }

export const hwpFromTwips = (twips: number): HwpUnit => Math.round(twips * 5) as HwpUnit
export const paraFromTwips = (twips: number): ParaUnit => Math.round(twips * 10) as ParaUnit
export const hwpFromHalfPoints = (halfPoints: number): HwpUnit =>
  Math.round(halfPoints * 50) as HwpUnit
/** CSS pixels at 96 dpi */
export const hwpFromPx = (px: number): HwpUnit => Math.round(px * 75) as HwpUnit
export const ptFromHwp = (value: HwpUnit): number => value / 100

/**
 * Word "auto" line spacing (240 = single) as a Hangul percent. Single spacing
 * draws like Hangul's 160 percent: the spike's pages matched Hancom Hangul
 * with this factor.
 */
export const percentFromAutoLine = (raw: number): number => Math.round((raw / 240) * 160)

/**
 * Character spacing: Word gives twips, Hangul a percent of the font size,
 * kept inside the range Hangul's dialog accepts.
 */
export function spacingPercent(spacingTwips: number, sizeHalfPoints: number): number {
  if (!spacingTwips || sizeHalfPoints <= 0) return 0
  const percent = Math.round((spacingTwips / 20 / (sizeHalfPoints / 2)) * 100)
  return Math.max(-50, Math.min(50, percent))
}

/** Word's horizontal scale (w:w) as Hangul's width ratio, inside Hangul's range */
export const ratioPercent = (scalePct: number | undefined): number =>
  scalePct === undefined ? 100 : Math.max(50, Math.min(200, Math.round(scalePct)))

const HEX = /^[0-9a-f]{6}$/i

/** Word's hex without '#' ('auto' and absent mean the fallback) */
export function rgbOf(hex: string | undefined, fallback: '#000000' | '#ffffff'): Rgb {
  if (!hex || !HEX.test(hex)) return fallback as Rgb
  return `#${hex.toLowerCase()}` as Rgb
}

/** a Word hex fill, or null when there is none */
export function fillOf(hex: string | undefined): Rgb | null {
  return hex && HEX.test(hex) ? (`#${hex.toLowerCase()}` as Rgb) : null
}

/** Word's named highlight colours (w:highlight) */
const HIGHLIGHT: Readonly<Record<string, string>> = {
  yellow: '#ffff00',
  green: '#00ff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  blue: '#0000ff',
  red: '#ff0000',
  darkBlue: '#000080',
  darkCyan: '#008080',
  darkGreen: '#008000',
  darkMagenta: '#800080',
  darkRed: '#800000',
  darkYellow: '#808000',
  darkGray: '#808080',
  lightGray: '#c0c0c0',
  black: '#000000',
  white: '#ffffff',
}

export function highlightOf(name: string | undefined): Rgb | null {
  const hex = name ? HIGHLIGHT[name] : undefined
  return hex ? (hex as Rgb) : null
}
