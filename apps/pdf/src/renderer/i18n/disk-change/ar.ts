import type { zh } from './zh'

export const ar = {
  diskChanged: 'تم تغيير هذا الملف. هل تريد إعادة تحميله؟',
  diskChangedUnsaved: 'تم تغيير هذا الملف. ستؤدي إعادة التحميل إلى تجاهل التعديلات غير المحفوظة.',
  diskMissing: 'تم حذف هذا الملف أو تغيير اسمه. يبقى ما يظهر على الشاشة كما هو.',
  diskReload: 'إعادة التحميل',
  diskIgnore: 'تجاهل',
  diskDismiss: 'موافق',
  diskReloadFailed: 'تعذّرت إعادة تحميل الملف: {detail}',
} satisfies Record<keyof typeof zh, string>
