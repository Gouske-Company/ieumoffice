import type { zh } from './zh'

export const de = {
  setSlidesFonts: 'Schriftarten für KI-Folien',
  setSlidesFontsDesc:
    'Die Schriftarten, die die KI für eine neue Präsentation verwendet, wenn Ihre Anfrage keine nennt. Eine gewählte Designvorlage verwendet ihre eigenen Schriftarten.',
  slidesFontModeAuto: 'Automatisch',
  slidesFontModeAutoDesc: 'KI wählt',
  slidesFontModeSans: 'Serifenlos',
  slidesFontModeSerif: 'Serifen',
  slidesFontModeSerifTitle: 'Titel mit Serifen',
  slidesFontSampleTitle: 'Titel Aa',
  slidesFontSampleBody: 'Text Aa',
  setSlidesFontSans: 'Serifenlose Schrift',
  setSlidesFontSerif: 'Serifenschrift',
  slidesFontGroupSuggested: 'Vorgeschlagene Schriftarten',
  slidesFontGroupPc: 'Schriftarten auf diesem PC',
  slidesFontPortableHint:
    'PowerPoint zeigt auf einem PC ohne diese Schriftart eine andere an. Exportierte PDFs behalten sie.',
} satisfies Record<keyof typeof zh, string>
