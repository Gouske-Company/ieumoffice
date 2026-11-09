import type { zh } from './zh'

export const pt = {
  setSlidesFonts: 'Fontes dos slides com IA',
  setSlidesFontsDesc:
    'As fontes que a IA usa numa apresentação nova quando o seu pedido não indica nenhuma. Um modelo de design escolhido usa as próprias fontes.',
  slidesFontModeAuto: 'Automático',
  slidesFontModeAutoDesc: 'A IA escolhe',
  slidesFontModeSans: 'Sem serifa',
  slidesFontModeSerif: 'Com serifa',
  slidesFontModeSerifTitle: 'Títulos com serifa',
  slidesFontSampleTitle: 'Título Aa',
  slidesFontSampleBody: 'Texto Aa',
  setSlidesFontSans: 'Fonte sem serifa',
  setSlidesFontSerif: 'Fonte com serifa',
  slidesFontGroupSuggested: 'Fontes sugeridas',
  slidesFontGroupPc: 'Fontes deste PC',
  slidesFontPortableHint:
    'Num PC sem esta fonte, o PowerPoint mostra outra no lugar. Os PDF exportados mantêm-na.',
} satisfies Record<keyof typeof zh, string>
