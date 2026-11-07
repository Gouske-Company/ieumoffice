import type { zh } from './zh'

export const ja = {
  setSlidesFonts: 'AI スライドのフォント',
  setSlidesFontsDesc:
    'リクエストでフォントを指定しないとき、AI が新しいプレゼンテーションに使うフォントです。デザインテンプレートを選ぶと、そのテンプレートのフォントを使います。',
  slidesFontModeAuto: '自動',
  slidesFontModeAutoDesc: 'AI が選択',
  slidesFontModeSans: 'ゴシック',
  slidesFontModeSerif: '明朝',
  slidesFontModeSerifTitle: '見出しのみ明朝',
  slidesFontSampleTitle: '見出し Aa',
  slidesFontSampleBody: '本文 Aa',
  setSlidesFontSans: 'ゴシック体フォント',
  setSlidesFontSerif: '明朝体フォント',
  slidesFontGroupSuggested: 'おすすめのフォント',
  slidesFontGroupPc: 'この PC のフォント',
  slidesFontPortableHint:
    'このフォントがない PC の PowerPoint では別のフォントで表示されます。PDF に書き出すとそのまま表示されます。',
} satisfies Record<keyof typeof zh, string>
