import type { zh } from './zh'

export const pl = {
  diskChanged: 'Ten plik został zmieniony. Wczytać go ponownie?',
  diskChangedUnsaved: 'Ten plik został zmieniony. Ponowne wczytanie odrzuci niezapisane zmiany.',
  diskMissing:
    'Ten plik został usunięty lub zmieniono jego nazwę. Zawartość na ekranie pozostaje bez zmian.',
  diskReload: 'Wczytaj ponownie',
  diskIgnore: 'Ignoruj',
  diskDismiss: 'OK',
  diskReloadFailed: 'Nie udało się ponownie wczytać pliku: {detail}',
} satisfies Record<keyof typeof zh, string>
