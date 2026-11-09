import type { zh } from './zh'

export const fr = {
  setSlidesFonts: 'Polices des diapositives IA',
  setSlidesFontsDesc:
    'Les polices que l’IA utilise pour une nouvelle présentation lorsque votre demande n’en nomme aucune. Un modèle de conception choisi utilise ses propres polices.',
  slidesFontModeAuto: 'Auto',
  slidesFontModeAutoDesc: 'Choisie par l’IA',
  slidesFontModeSans: 'Sans empattement',
  slidesFontModeSerif: 'Avec empattement',
  slidesFontModeSerifTitle: 'Titres avec empattement',
  slidesFontSampleTitle: 'Titre Aa',
  slidesFontSampleBody: 'Corps Aa',
  setSlidesFontSans: 'Police sans empattement',
  setSlidesFontSerif: 'Police avec empattement',
  slidesFontGroupSuggested: 'Polices suggérées',
  slidesFontGroupPc: 'Polices de ce PC',
  slidesFontPortableHint:
    'Sur un PC sans cette police, PowerPoint affiche une autre police. Les PDF exportés la conservent.',
} satisfies Record<keyof typeof zh, string>
