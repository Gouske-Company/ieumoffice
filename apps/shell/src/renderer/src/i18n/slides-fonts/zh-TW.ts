import type { zh } from './zh'

export const zhTW = {
  setSlidesFonts: 'AI 投影片字型',
  setSlidesFontsDesc: '要求中未指定字型時，AI 新建簡報所用的字型。選擇設計範本時會使用範本的字型。',
  slidesFontModeAuto: '自動',
  slidesFontModeAutoDesc: '由 AI 選擇',
  slidesFontModeSans: '黑體',
  slidesFontModeSerif: '明體',
  slidesFontModeSerifTitle: '僅標題用明體',
  slidesFontSampleTitle: '標題 Aa',
  slidesFontSampleBody: '內文 Aa',
  setSlidesFontSans: '黑體字型',
  setSlidesFontSerif: '明體字型',
  slidesFontGroupSuggested: '建議字型',
  slidesFontGroupPc: '本機已安裝的字型',
  slidesFontPortableHint:
    '在未安裝此字型的電腦上，PowerPoint 會以其他字型顯示。匯出為 PDF 則保持原樣。',
} satisfies Record<keyof typeof zh, string>
