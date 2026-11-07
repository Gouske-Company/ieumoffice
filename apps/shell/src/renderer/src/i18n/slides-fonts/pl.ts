import type { zh } from './zh'

export const pl = {
  setSlidesFonts: 'Czcionki slajdów AI',
  setSlidesFontsDesc:
    'Czcionki, których AI używa w nowej prezentacji, gdy prośba nie wskazuje żadnej. Wybrany szablon projektu używa własnych czcionek.',
  slidesFontModeAuto: 'Automatycznie',
  slidesFontModeAutoDesc: 'Wybiera AI',
  slidesFontModeSans: 'Bezszeryfowa',
  slidesFontModeSerif: 'Szeryfowa',
  slidesFontModeSerifTitle: 'Tytuły szeryfowe',
  slidesFontSampleTitle: 'Tytuł Aa',
  slidesFontSampleBody: 'Tekst Aa',
  setSlidesFontSans: 'Czcionka bezszeryfowa',
  setSlidesFontSerif: 'Czcionka szeryfowa',
  slidesFontGroupSuggested: 'Sugerowane czcionki',
  slidesFontGroupPc: 'Czcionki na tym komputerze',
  slidesFontPortableHint:
    'Na komputerze bez tej czcionki PowerPoint pokaże inną. Wyeksportowane pliki PDF ją zachowują.',
} satisfies Record<keyof typeof zh, string>
