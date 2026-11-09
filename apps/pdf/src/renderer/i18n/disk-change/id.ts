import type { zh } from './zh'

export const id = {
  diskChanged: 'File ini telah diubah. Muat ulang?',
  diskChangedUnsaved:
    'File ini telah diubah. Memuat ulang akan membuang editan yang belum disimpan.',
  diskMissing:
    'File ini telah dihapus atau diganti namanya. Isi di layar tetap seperti apa adanya.',
  diskReload: 'Muat ulang',
  diskIgnore: 'Abaikan',
  diskDismiss: 'OK',
  diskReloadFailed: 'Tidak dapat memuat ulang file: {detail}',
} satisfies Record<keyof typeof zh, string>
