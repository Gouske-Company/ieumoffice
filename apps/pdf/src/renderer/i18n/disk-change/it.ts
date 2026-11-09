import type { zh } from './zh'

export const it = {
  diskChanged: 'Questo file è stato modificato. Ricaricarlo?',
  diskChangedUnsaved:
    'Questo file è stato modificato. Ricaricandolo, le modifiche non salvate andranno perse.',
  diskMissing:
    'Questo file è stato eliminato o rinominato. Il contenuto sullo schermo resta invariato.',
  diskReload: 'Ricarica',
  diskIgnore: 'Ignora',
  diskDismiss: 'OK',
  diskReloadFailed: 'Impossibile ricaricare il file: {detail}',
} satisfies Record<keyof typeof zh, string>
