import type { RenderNode, RenderSlide, ShapeRenderNode } from '@genoffice/pptx-render'
import type { SlidesAiFontRoles } from '@genoffice/ui/slides-ai-fonts'

/**
 * The fonts of Settings › General in deck generation (generate_deck).
 *
 * They apply only where nothing else decides the fonts: no design template is chosen,
 * and the deck is new, blank, or was itself made with these fonts. A deck that already
 * has text in other fonts keeps its look. A font the user's request names wins: the
 * notes below tell the model to use the defaults only where the request and the deck
 * style name none.
 */

/** Explicit font names of every text run in the nodes (group children included). */
function collectRunFonts(nodes: readonly RenderNode[], out: Set<string>, seen: { text: boolean }) {
  for (const n of nodes) {
    const children = (n as { children?: RenderNode[] }).children
    if (Array.isArray(children)) collectRunFonts(children, out, seen)
    if (n.type !== 'shape' && n.type !== 'text') continue
    for (const line of (n as ShapeRenderNode).text?.lines ?? []) {
      for (const r of line.runs) {
        if (!r.text.trim()) continue
        seen.text = true
        if (r.srcFontFamily) out.add(r.srcFontFamily)
      }
    }
  }
}

/**
 * Whether new pages of this deck take the configured fonts: the deck holds no text yet,
 * or every font its text names is one of the two (a deck generated with this setting
 * earlier gets more pages in the same faces). Text in any other named font, or text
 * that only inherits the theme's font, means the deck has a look of its own.
 */
export function deckTakesDefaultFonts(
  slides: readonly RenderSlide[],
  roles: SlidesAiFontRoles,
): boolean {
  const fonts = new Set<string>()
  const seen = { text: false }
  for (const s of slides) collectRunFonts(s.nodes, fonts, seen)
  if (!seen.text) return true
  if (fonts.size === 0) return false
  const allowed = new Set([roles.title.toLowerCase(), roles.body.toLowerCase()])
  return [...fonts].every((f) => allowed.has(f.toLowerCase()))
}

/** Appended to the style generator's request: the Fonts section names the defaults. */
export function defaultFontsStyleNote(roles: SlidesAiFontRoles): string {
  return (
    `\nDefault fonts (the user's setting): unless the style preference or the questionnaire answers name a font or a typeface (serif, sans-serif, handwriting, rounded, …), the Fonts section must name exactly these: ` +
    `CJK title font: ${roles.title}; Latin title font: ${roles.title}; Body font: ${roles.body}.`
  )
}

/** Added to each page writer request: the families for runs the deck style leaves open. */
export function defaultFontsPageNote(roles: SlidesAiFontRoles): string {
  return roles.title === roles.body
    ? `\n\nFonts: where the deck style above names no font, write "font":"${roles.body}" on every run.`
    : `\n\nFonts: where the deck style above names no font, write "font":"${roles.title}" on title runs (and hero numbers) and "font":"${roles.body}" on every other run.`
}
