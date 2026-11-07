import type { zh } from './zh'

export const ru = {
  setSlidesFonts: 'Шрифты слайдов ИИ',
  setSlidesFontsDesc:
    'Шрифты, которые ИИ использует в новой презентации, если в запросе шрифт не указан. Выбранный шаблон оформления использует свои шрифты.',
  slidesFontModeAuto: 'Авто',
  slidesFontModeAutoDesc: 'Выбирает ИИ',
  slidesFontModeSans: 'Без засечек',
  slidesFontModeSerif: 'С засечками',
  slidesFontModeSerifTitle: 'Заголовки с засечками',
  slidesFontSampleTitle: 'Заголовок Aa',
  slidesFontSampleBody: 'Текст Aa',
  setSlidesFontSans: 'Шрифт без засечек',
  setSlidesFontSerif: 'Шрифт с засечками',
  slidesFontGroupSuggested: 'Рекомендуемые шрифты',
  slidesFontGroupPc: 'Шрифты на этом ПК',
  slidesFontPortableHint:
    'На ПК без этого шрифта PowerPoint покажет другой. В экспортированном PDF он сохраняется.',
} satisfies Record<keyof typeof zh, string>
