/**
 * What a brand-new document is saved as the first time (Settings › General).
 * A document that already has a file keeps that file's format; this choice only
 * decides what the first Save As of a new document offers. The rule is shared
 * with the Word editor's Hangul export, so it lives in electron-utils.
 */
export {
  HWP_DEFAULT_FORMAT_KEY,
  normalizeHwpDefaultFormat,
  readHwpDefaultFormat,
  type SettingsPathProvider,
} from '@genoffice/electron-utils'
