import type { zh } from './zh'

export const nl = {
  setSlidesFonts: 'Lettertypen voor AI-dia’s',
  setSlidesFontsDesc:
    'De lettertypen die de AI gebruikt voor een nieuwe presentatie als uw verzoek er geen noemt. Een gekozen ontwerpsjabloon gebruikt zijn eigen lettertypen.',
  slidesFontModeAuto: 'Automatisch',
  slidesFontModeAutoDesc: 'AI kiest',
  slidesFontModeSans: 'Schreefloos',
  slidesFontModeSerif: 'Schreef',
  slidesFontModeSerifTitle: 'Titels met schreef',
  slidesFontSampleTitle: 'Titel Aa',
  slidesFontSampleBody: 'Tekst Aa',
  setSlidesFontSans: 'Schreefloos lettertype',
  setSlidesFontSerif: 'Schreeflettertype',
  slidesFontGroupSuggested: 'Voorgestelde lettertypen',
  slidesFontGroupPc: 'Lettertypen op deze pc',
  slidesFontPortableHint:
    'Op een pc zonder dit lettertype toont PowerPoint een ander. Geëxporteerde pdf’s behouden het.',
} satisfies Record<keyof typeof zh, string>
