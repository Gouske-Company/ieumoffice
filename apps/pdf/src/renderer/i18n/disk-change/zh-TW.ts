import type { zh } from './zh'

export const zhTW = {
  diskChanged: '此檔案已被變更。要重新載入嗎？',
  diskChangedUnsaved: '此檔案已被變更。重新載入會捨棄尚未儲存的編輯。',
  diskMissing: '此檔案已被刪除或重新命名。畫面上的內容仍會保留。',
  diskReload: '重新載入',
  diskIgnore: '忽略',
  diskDismiss: '確定',
  diskReloadFailed: '無法重新載入檔案：{detail}',
} satisfies Record<keyof typeof zh, string>
