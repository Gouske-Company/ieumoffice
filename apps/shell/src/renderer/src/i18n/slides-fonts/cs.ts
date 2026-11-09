import type { zh } from './zh'

export const cs = {
  setSlidesFonts: 'Písma snímků s AI',
  setSlidesFontsDesc:
    'Písma, která AI použije v nové prezentaci, když žádost žádné neuvádí. Zvolená šablona návrhu používá vlastní písma.',
  slidesFontModeAuto: 'Automaticky',
  slidesFontModeAutoDesc: 'Vybere AI',
  slidesFontModeSans: 'Bezpatkové',
  slidesFontModeSerif: 'Patkové',
  slidesFontModeSerifTitle: 'Patkové nadpisy',
  slidesFontSampleTitle: 'Nadpis Aa',
  slidesFontSampleBody: 'Text Aa',
  setSlidesFontSans: 'Bezpatkové písmo',
  setSlidesFontSerif: 'Patkové písmo',
  slidesFontGroupSuggested: 'Navrhovaná písma',
  slidesFontGroupPc: 'Písma v tomto počítači',
  slidesFontPortableHint:
    'Na počítači bez tohoto písma zobrazí PowerPoint jiné. Exportované PDF si ho zachovají.',
} satisfies Record<keyof typeof zh, string>
