import type { zh } from './zh'

export const th = {
  diskChanged: 'ไฟล์นี้ถูกเปลี่ยนแปลง ต้องการโหลดใหม่หรือไม่',
  diskChangedUnsaved: 'ไฟล์นี้ถูกเปลี่ยนแปลง การโหลดใหม่จะทิ้งการแก้ไขที่ยังไม่ได้บันทึก',
  diskMissing: 'ไฟล์นี้ถูกลบหรือเปลี่ยนชื่อ เนื้อหาบนหน้าจอยังคงอยู่เหมือนเดิม',
  diskReload: 'โหลดใหม่',
  diskIgnore: 'ไม่สนใจ',
  diskDismiss: 'ตกลง',
  diskReloadFailed: 'โหลดไฟล์ใหม่ไม่ได้: {detail}',
} satisfies Record<keyof typeof zh, string>
