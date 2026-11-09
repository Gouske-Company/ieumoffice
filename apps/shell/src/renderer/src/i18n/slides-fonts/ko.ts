import type { zh } from './zh'

export const ko = {
  setSlidesFonts: 'AI 슬라이드 글꼴',
  setSlidesFontsDesc:
    'AI에게 글꼴을 따로 말하지 않을 때 새 발표 자료에 쓰는 글꼴입니다. 디자인 템플릿을 고르면 템플릿의 글꼴을 씁니다.',
  slidesFontModeAuto: '자동',
  slidesFontModeAutoDesc: 'AI가 고름',
  slidesFontModeSans: '고딕',
  slidesFontModeSerif: '명조',
  slidesFontModeSerifTitle: '제목만 명조',
  slidesFontSampleTitle: '제목 가나다',
  slidesFontSampleBody: '본문 가나다',
  setSlidesFontSans: '고딕 글꼴',
  setSlidesFontSerif: '명조 글꼴',
  slidesFontGroupSuggested: '추천 글꼴',
  slidesFontGroupPc: 'PC에 설치된 글꼴',
  slidesFontPortableHint:
    '이 글꼴이 없는 PC의 PowerPoint에서는 다른 글꼴로 보입니다. PDF로 내보내면 그대로 보입니다.',
} satisfies Record<keyof typeof zh, string>
