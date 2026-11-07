import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SLIDES_AI_FONTS_KEY,
  normalizeSlidesAiFonts,
  type SlidesAiFontRoles,
  type SlidesAiFonts,
} from '@genoffice/ui/slides-ai-fonts'
import type { PageSpec, SpecParagraph } from '@genoffice/pipelines/slides'

/**
 * The fonts AI slide generation uses when the request names none (Settings › General,
 * written by the shell). Read from userData/app-settings.json on every call, so a
 * change applies to the next generation without a restart.
 */

/** The subset of Electron's `app` this module needs (kept structural for tests). */
export interface SettingsPathProvider {
  getPath(name: 'userData'): string
}

/**
 * The stored choice, or the default for `lang` (the renderer's UI language) when the
 * file or the key is missing or unreadable.
 */
export function readSlidesAiFonts(app: SettingsPathProvider, lang: string): SlidesAiFonts {
  try {
    const raw: unknown = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'app-settings.json'), 'utf8'),
    )
    const value =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)[SLIDES_AI_FONTS_KEY]
        : undefined
    return normalizeSlidesAiFonts(value, lang)
  } catch {
    return normalizeSlidesAiFonts(undefined, lang)
  }
}

/**
 * Text at or above this size takes the title family. The page writer sizes big titles
 * 32-48pt, subtitles 18-24pt and body 12-15pt, so 28pt splits titles (and hero numbers)
 * from everything else.
 */
export const TITLE_ROLE_MIN_PT = 28

/**
 * Gives every run the page writer left without a font the configured family, by size:
 * titles get the title family, the rest the body family. A run that names a font keeps
 * it (the user may have asked for that font, or the deck style names it). Runs with no
 * size count as body text. Returns the same spec object when nothing changes.
 */
export function fillMissingRunFonts(spec: PageSpec, roles: SlidesAiFontRoles): PageSpec {
  let changed = false
  const fillParagraphs = (paragraphs: SpecParagraph[]): SpecParagraph[] =>
    paragraphs.map((p) => ({
      ...p,
      runs: p.runs.map((r) => {
        if (r.font) return r
        changed = true
        const title = typeof r.sizePt === 'number' && r.sizePt >= TITLE_ROLE_MIN_PT
        return { ...r, font: title ? roles.title : roles.body }
      }),
    }))
  const elements = spec.elements.map((el) => {
    if (el.type === 'image' || !el.paragraphs) return el
    return { ...el, paragraphs: fillParagraphs(el.paragraphs) }
  })
  return changed ? { ...spec, elements } : spec
}

/** The roles an IPC caller sent, or null when they are not two usable family names. */
export function parseFontRoles(value: unknown): SlidesAiFontRoles | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const name = (x: unknown) =>
    typeof x === 'string' && x.trim() && x.length <= 80 ? x.trim() : undefined
  const title = name(v.title)
  const body = name(v.body)
  return title && body ? { title, body } : null
}
