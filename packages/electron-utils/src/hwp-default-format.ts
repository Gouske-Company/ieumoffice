import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What a brand-new Hangul document is saved as the first time (Settings ›
 * General, decision 0089), kept in userData/app-settings.json. The Hangul
 * editor offers it on a new document's first save; the Word editor offers it
 * first when it exports a Hangul copy.
 */
export const HWP_DEFAULT_FORMAT_KEY = 'hwpDefaultFormat'

export type HwpDefaultFormat = 'hwp' | 'hwpx'

/** The subset of Electron's `app` this module needs (kept structural for tests). */
export interface SettingsPathProvider {
  getPath(name: 'userData'): string
}

/** Anything absent or unknown is HWP, the format new documents had before this setting. */
export function normalizeHwpDefaultFormat(value: unknown): HwpDefaultFormat {
  return value === 'hwpx' ? 'hwpx' : 'hwp'
}

/** The configured choice in userData/app-settings.json; HWP when the file cannot be read. */
export function readHwpDefaultFormat(app: SettingsPathProvider): HwpDefaultFormat {
  try {
    const path = join(app.getPath('userData'), 'app-settings.json')
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'hwp'
    return normalizeHwpDefaultFormat((raw as Record<string, unknown>)[HWP_DEFAULT_FORMAT_KEY])
  } catch {
    return 'hwp'
  }
}
