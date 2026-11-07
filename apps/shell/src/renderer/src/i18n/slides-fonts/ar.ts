import type { zh } from './zh'

export const ar = {
  setSlidesFonts: 'خطوط شرائح الذكاء الاصطناعي',
  setSlidesFontsDesc:
    'الخطوط التي يستخدمها الذكاء الاصطناعي في عرض تقديمي جديد عندما لا يحدد طلبك خطًا. يستخدم قالب التصميم الذي تختاره خطوطه الخاصة.',
  slidesFontModeAuto: 'تلقائي',
  slidesFontModeAutoDesc: 'يختار الذكاء الاصطناعي',
  slidesFontModeSans: 'بدون زوائد',
  slidesFontModeSerif: 'بزوائد',
  slidesFontModeSerifTitle: 'عناوين بزوائد',
  slidesFontSampleTitle: 'عنوان Aa',
  slidesFontSampleBody: 'نص Aa',
  setSlidesFontSans: 'خط بدون زوائد',
  setSlidesFontSerif: 'خط بزوائد',
  slidesFontGroupSuggested: 'خطوط مقترحة',
  slidesFontGroupPc: 'الخطوط على هذا الكمبيوتر',
  slidesFontPortableHint:
    'على كمبيوتر لا يحتوي على هذا الخط يعرض PowerPoint خطًا آخر بدلًا منه. تحتفظ ملفات PDF المصدّرة به.',
} satisfies Record<keyof typeof zh, string>
