import type { zh } from './zh'

export const hi = {
  diskChanged: 'यह फ़ाइल बदल गई है। क्या इसे फिर से लोड करें?',
  diskChangedUnsaved: 'यह फ़ाइल बदल गई है। फिर से लोड करने पर बिना सहेजे गए बदलाव हट जाएँगे।',
  diskMissing:
    'यह फ़ाइल हटा दी गई है या उसका नाम बदल दिया गया है। स्क्रीन पर दिख रही सामग्री वैसी ही रहेगी।',
  diskReload: 'फिर से लोड करें',
  diskIgnore: 'अनदेखा करें',
  diskDismiss: 'ठीक है',
  diskReloadFailed: 'फ़ाइल फिर से लोड नहीं हो सकी: {detail}',
} satisfies Record<keyof typeof zh, string>
