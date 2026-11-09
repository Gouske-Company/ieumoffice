import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './slides-fonts/zh'
import { en } from './slides-fonts/en'
import { ja } from './slides-fonts/ja'
import { ko } from './slides-fonts/ko'
import { fr } from './slides-fonts/fr'
import { de } from './slides-fonts/de'
import { es } from './slides-fonts/es'
import { th } from './slides-fonts/th'
import { id } from './slides-fonts/id'
import { ru } from './slides-fonts/ru'
import { ar } from './slides-fonts/ar'
import { pt } from './slides-fonts/pt'
import { it } from './slides-fonts/it'
import { pl } from './slides-fonts/pl'
import { cs } from './slides-fonts/cs'
import { nl } from './slides-fonts/nl'
import { ms } from './slides-fonts/ms'
import { he } from './slides-fonts/he'
import { hi } from './slides-fonts/hi'
import { zhTW } from './slides-fonts/zh-TW'
import { vi } from './slides-fonts/vi'

/**
 * Settings → General "AI slide fonts" field.
 * Sharded per language; `zh` defines the key set.
 */
export const slidesFontsStrings = defineStrings({
  zh,
  en,
  ja,
  ko,
  fr,
  de,
  es,
  th,
  id,
  ru,
  ar,
  pt,
  it,
  pl,
  cs,
  nl,
  ms,
  he,
  hi,
  'zh-TW': zhTW,
  vi,
})

export type SlidesFontsStringKey = keyof typeof zh

const translate = createI18n(slidesFontsStrings)

export function slidesFontsText(lang: Lang, key: SlidesFontsStringKey, params?: Params): string {
  return translate(lang, key, params)
}
