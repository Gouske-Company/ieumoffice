import type { zh } from './zh'

export const vi = {
  setSlidesFonts: 'Phông chữ trang chiếu AI',
  setSlidesFontsDesc:
    'Phông chữ AI dùng cho bản trình bày mới khi yêu cầu của bạn không nêu phông nào. Mẫu thiết kế bạn chọn dùng phông riêng của nó.',
  slidesFontModeAuto: 'Tự động',
  slidesFontModeAutoDesc: 'AI chọn',
  slidesFontModeSans: 'Không chân',
  slidesFontModeSerif: 'Có chân',
  slidesFontModeSerifTitle: 'Tiêu đề có chân',
  slidesFontSampleTitle: 'Tiêu đề Aa',
  slidesFontSampleBody: 'Nội dung Aa',
  setSlidesFontSans: 'Phông không chân',
  setSlidesFontSerif: 'Phông có chân',
  slidesFontGroupSuggested: 'Phông đề xuất',
  slidesFontGroupPc: 'Phông trên máy này',
  slidesFontPortableHint:
    'Trên máy không có phông này, PowerPoint sẽ hiển thị phông khác. PDF đã xuất vẫn giữ nguyên.',
} satisfies Record<keyof typeof zh, string>
