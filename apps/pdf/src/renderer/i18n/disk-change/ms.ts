import type { zh } from './zh'

export const ms = {
  diskChanged: 'Fail ini telah diubah. Muat semula?',
  diskChangedUnsaved:
    'Fail ini telah diubah. Memuat semula akan membuang suntingan yang belum disimpan.',
  diskMissing:
    'Fail ini telah dipadam atau dinamakan semula. Kandungan pada skrin kekal seperti sedia ada.',
  diskReload: 'Muat semula',
  diskIgnore: 'Abaikan',
  diskDismiss: 'OK',
  diskReloadFailed: 'Tidak dapat memuat semula fail: {detail}',
} satisfies Record<keyof typeof zh, string>
