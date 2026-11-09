import type { zh } from './zh'

export const ru = {
  diskChanged: 'Этот файл был изменён. Загрузить заново?',
  diskChangedUnsaved:
    'Этот файл был изменён. При повторной загрузке несохранённые правки будут потеряны.',
  diskMissing: 'Этот файл удалён или переименован. Содержимое на экране остаётся без изменений.',
  diskReload: 'Загрузить заново',
  diskIgnore: 'Пропустить',
  diskDismiss: 'ОК',
  diskReloadFailed: 'Не удалось загрузить файл заново: {detail}',
} satisfies Record<keyof typeof zh, string>
