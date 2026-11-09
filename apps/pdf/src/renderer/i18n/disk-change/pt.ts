import type { zh } from './zh'

export const pt = {
  diskChanged: 'Este arquivo foi alterado. Recarregar?',
  diskChangedUnsaved: 'Este arquivo foi alterado. Recarregar descarta as edições não salvas.',
  diskMissing: 'Este arquivo foi excluído ou renomeado. O conteúdo na tela permanece como está.',
  diskReload: 'Recarregar',
  diskIgnore: 'Ignorar',
  diskDismiss: 'OK',
  diskReloadFailed: 'Não foi possível recarregar o arquivo: {detail}',
} satisfies Record<keyof typeof zh, string>
