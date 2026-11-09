import type { zh } from './zh'

export const ja = {
  diskChanged: 'このファイルは変更されました。再読み込みしますか？',
  diskChangedUnsaved:
    'このファイルは変更されました。再読み込みすると、保存していない編集は失われます。',
  diskMissing: 'このファイルは削除されたか、名前が変更されました。画面の内容はそのまま残ります。',
  diskReload: '再読み込み',
  diskIgnore: '無視',
  diskDismiss: 'OK',
  diskReloadFailed: 'ファイルを再読み込みできませんでした：{detail}',
} satisfies Record<keyof typeof zh, string>
