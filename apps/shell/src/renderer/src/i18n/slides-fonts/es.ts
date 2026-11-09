import type { zh } from './zh'

export const es = {
  setSlidesFonts: 'Fuentes de diapositivas con IA',
  setSlidesFontsDesc:
    'Las fuentes que usa la IA en una presentación nueva cuando su solicitud no nombra ninguna. Una plantilla de diseño elegida usa sus propias fuentes.',
  slidesFontModeAuto: 'Automático',
  slidesFontModeAutoDesc: 'La IA elige',
  slidesFontModeSans: 'Sin serifa',
  slidesFontModeSerif: 'Con serifa',
  slidesFontModeSerifTitle: 'Títulos con serifa',
  slidesFontSampleTitle: 'Título Aa',
  slidesFontSampleBody: 'Texto Aa',
  setSlidesFontSans: 'Fuente sin serifa',
  setSlidesFontSerif: 'Fuente con serifa',
  slidesFontGroupSuggested: 'Fuentes sugeridas',
  slidesFontGroupPc: 'Fuentes de este PC',
  slidesFontPortableHint:
    'En un PC sin esta fuente, PowerPoint muestra otra en su lugar. Los PDF exportados la conservan.',
} satisfies Record<keyof typeof zh, string>
