import type { zh } from './zh'

export const id = {
  setSlidesFonts: 'Font slide AI',
  setSlidesFontsDesc:
    'Font yang dipakai AI untuk presentasi baru saat permintaan Anda tidak menyebut font. Templat desain yang dipilih memakai fontnya sendiri.',
  slidesFontModeAuto: 'Otomatis',
  slidesFontModeAutoDesc: 'Dipilih AI',
  slidesFontModeSans: 'Sans serif',
  slidesFontModeSerif: 'Serif',
  slidesFontModeSerifTitle: 'Judul serif',
  slidesFontSampleTitle: 'Judul Aa',
  slidesFontSampleBody: 'Teks Aa',
  setSlidesFontSans: 'Font sans serif',
  setSlidesFontSerif: 'Font serif',
  slidesFontGroupSuggested: 'Font yang disarankan',
  slidesFontGroupPc: 'Font di PC ini',
  slidesFontPortableHint:
    'Di PC tanpa font ini, PowerPoint menampilkan font lain. PDF yang diekspor tetap memakainya.',
} satisfies Record<keyof typeof zh, string>
