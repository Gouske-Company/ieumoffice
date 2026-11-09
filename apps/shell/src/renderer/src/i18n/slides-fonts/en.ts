import type { zh } from './zh'

export const en = {
  setSlidesFonts: 'AI slide fonts',
  setSlidesFontsDesc:
    'The fonts AI uses for a new presentation when your request names none. A design template you choose uses its own fonts.',
  slidesFontModeAuto: 'Auto',
  slidesFontModeAutoDesc: 'AI picks',
  slidesFontModeSans: 'Sans serif',
  slidesFontModeSerif: 'Serif',
  slidesFontModeSerifTitle: 'Serif titles',
  slidesFontSampleTitle: 'Title Aa',
  slidesFontSampleBody: 'Body Aa',
  setSlidesFontSans: 'Sans-serif font',
  setSlidesFontSerif: 'Serif font',
  slidesFontGroupSuggested: 'Suggested fonts',
  slidesFontGroupPc: 'Fonts on this PC',
  slidesFontPortableHint:
    'PowerPoint on a PC without this font shows another font instead. Exported PDFs keep it.',
} satisfies Record<keyof typeof zh, string>
