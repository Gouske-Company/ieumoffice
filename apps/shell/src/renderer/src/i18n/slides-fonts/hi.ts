import type { zh } from './zh'

export const hi = {
  setSlidesFonts: 'AI स्लाइड फ़ॉन्ट',
  setSlidesFontsDesc:
    'जब आपके अनुरोध में कोई फ़ॉन्ट नहीं बताया जाता, तब AI नई प्रस्तुति में ये फ़ॉन्ट इस्तेमाल करता है। चुना गया डिज़ाइन टेम्पलेट अपने फ़ॉन्ट इस्तेमाल करता है।',
  slidesFontModeAuto: 'स्वचालित',
  slidesFontModeAutoDesc: 'AI चुनता है',
  slidesFontModeSans: 'सैन्स-सेरिफ़',
  slidesFontModeSerif: 'सेरिफ़',
  slidesFontModeSerifTitle: 'सेरिफ़ शीर्षक',
  slidesFontSampleTitle: 'शीर्षक Aa',
  slidesFontSampleBody: 'मुख्य पाठ Aa',
  setSlidesFontSans: 'सैन्स-सेरिफ़ फ़ॉन्ट',
  setSlidesFontSerif: 'सेरिफ़ फ़ॉन्ट',
  slidesFontGroupSuggested: 'सुझाए गए फ़ॉन्ट',
  slidesFontGroupPc: 'इस PC के फ़ॉन्ट',
  slidesFontPortableHint:
    'जिस PC पर यह फ़ॉन्ट नहीं है, वहाँ PowerPoint दूसरा फ़ॉन्ट दिखाता है। निर्यात की गई PDF में यह वैसा ही रहता है।',
} satisfies Record<keyof typeof zh, string>
