import type { zh } from './zh'

export const it = {
  setSlidesFonts: 'Caratteri delle diapositive IA',
  setSlidesFontsDesc:
    'I caratteri che l’IA usa per una nuova presentazione quando la richiesta non ne indica nessuno. Un modello di progettazione scelto usa i propri caratteri.',
  slidesFontModeAuto: 'Automatico',
  slidesFontModeAutoDesc: 'Sceglie l’IA',
  slidesFontModeSans: 'Senza grazie',
  slidesFontModeSerif: 'Con grazie',
  slidesFontModeSerifTitle: 'Titoli con grazie',
  slidesFontSampleTitle: 'Titolo Aa',
  slidesFontSampleBody: 'Testo Aa',
  setSlidesFontSans: 'Carattere senza grazie',
  setSlidesFontSerif: 'Carattere con grazie',
  slidesFontGroupSuggested: 'Caratteri consigliati',
  slidesFontGroupPc: 'Caratteri di questo PC',
  slidesFontPortableHint:
    'Su un PC senza questo carattere, PowerPoint ne mostra un altro. I PDF esportati lo mantengono.',
} satisfies Record<keyof typeof zh, string>
