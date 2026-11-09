import type { zh } from './zh'

export const es = {
  diskChanged: 'Este archivo ha cambiado. ¿Volver a cargarlo?',
  diskChangedUnsaved:
    'Este archivo ha cambiado. Al volver a cargarlo se descartan los cambios sin guardar.',
  diskMissing:
    'Este archivo se eliminó o se le cambió el nombre. Lo que ve en pantalla se mantiene.',
  diskReload: 'Volver a cargar',
  diskIgnore: 'Ignorar',
  diskDismiss: 'Aceptar',
  diskReloadFailed: 'No se pudo volver a cargar el archivo: {detail}',
} satisfies Record<keyof typeof zh, string>
