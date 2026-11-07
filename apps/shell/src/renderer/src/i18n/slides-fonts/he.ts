import type { zh } from './zh'

export const he = {
  setSlidesFonts: 'גופני שקופיות AI',
  setSlidesFontsDesc:
    'הגופנים ש-AI משתמש בהם במצגת חדשה כשהבקשה לא מציינת גופן. תבנית עיצוב שבחרת משתמשת בגופנים משלה.',
  slidesFontModeAuto: 'אוטומטי',
  slidesFontModeAutoDesc: 'ה-AI בוחר',
  slidesFontModeSans: 'ללא תגים',
  slidesFontModeSerif: 'עם תגים',
  slidesFontModeSerifTitle: 'כותרות עם תגים',
  slidesFontSampleTitle: 'כותרת Aa',
  slidesFontSampleBody: 'טקסט Aa',
  setSlidesFontSans: 'גופן ללא תגים',
  setSlidesFontSerif: 'גופן עם תגים',
  slidesFontGroupSuggested: 'גופנים מומלצים',
  slidesFontGroupPc: 'גופנים במחשב הזה',
  slidesFontPortableHint:
    'במחשב שאין בו גופן זה, PowerPoint מציג גופן אחר. קובצי PDF מיוצאים שומרים עליו.',
} satisfies Record<keyof typeof zh, string>
