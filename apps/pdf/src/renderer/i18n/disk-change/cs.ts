import type { zh } from './zh'

export const cs = {
  diskChanged: 'Tento soubor byl změněn. Načíst ho znovu?',
  diskChangedUnsaved: 'Tento soubor byl změněn. Opětovným načtením přijdete o neuložené úpravy.',
  diskMissing:
    'Tento soubor byl odstraněn nebo přejmenován. Obsah na obrazovce zůstává beze změny.',
  diskReload: 'Načíst znovu',
  diskIgnore: 'Ignorovat',
  diskDismiss: 'OK',
  diskReloadFailed: 'Soubor se nepodařilo znovu načíst: {detail}',
} satisfies Record<keyof typeof zh, string>
