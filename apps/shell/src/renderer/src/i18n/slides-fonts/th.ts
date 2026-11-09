import type { zh } from './zh'

export const th = {
  setSlidesFonts: 'ฟอนต์สไลด์ AI',
  setSlidesFontsDesc:
    'ฟอนต์ที่ AI ใช้ในงานนำเสนอใหม่เมื่อคำขอไม่ได้ระบุฟอนต์ เทมเพลตการออกแบบที่เลือกจะใช้ฟอนต์ของตัวเอง',
  slidesFontModeAuto: 'อัตโนมัติ',
  slidesFontModeAutoDesc: 'AI เลือก',
  slidesFontModeSans: 'ไม่มีเชิง',
  slidesFontModeSerif: 'มีเชิง',
  slidesFontModeSerifTitle: 'หัวเรื่องแบบมีเชิง',
  slidesFontSampleTitle: 'หัวเรื่อง Aa',
  slidesFontSampleBody: 'เนื้อความ Aa',
  setSlidesFontSans: 'ฟอนต์ไม่มีเชิง',
  setSlidesFontSerif: 'ฟอนต์มีเชิง',
  slidesFontGroupSuggested: 'ฟอนต์แนะนำ',
  slidesFontGroupPc: 'ฟอนต์ในพีซีเครื่องนี้',
  slidesFontPortableHint:
    'บนพีซีที่ไม่มีฟอนต์นี้ PowerPoint จะแสดงฟอนต์อื่นแทน ส่วน PDF ที่ส่งออกจะคงฟอนต์ไว้',
} satisfies Record<keyof typeof zh, string>
