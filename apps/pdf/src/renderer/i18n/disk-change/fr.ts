import type { zh } from './zh'

export const fr = {
  diskChanged: 'Ce fichier a été modifié. Le recharger ?',
  diskChangedUnsaved:
    'Ce fichier a été modifié. Le recharger supprime vos modifications non enregistrées.',
  diskMissing: 'Ce fichier a été supprimé ou renommé. Le contenu affiché reste tel quel.',
  diskReload: 'Recharger',
  diskIgnore: 'Ignorer',
  diskDismiss: 'OK',
  diskReloadFailed: 'Impossible de recharger le fichier : {detail}',
} satisfies Record<keyof typeof zh, string>
