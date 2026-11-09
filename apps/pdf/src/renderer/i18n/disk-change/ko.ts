import type { zh } from './zh'

export const ko = {
  diskChanged: '이 파일이 바뀌었습니다. 다시 불러올까요?',
  diskChangedUnsaved: '이 파일이 바뀌었습니다. 다시 불러오면 저장하지 않은 편집이 사라집니다.',
  diskMissing: '이 파일이 지워졌거나 이름이 바뀌었습니다. 화면의 내용은 그대로 남아 있습니다.',
  diskReload: '다시 불러오기',
  diskIgnore: '무시',
  diskDismiss: '확인',
  diskReloadFailed: '파일을 다시 불러오지 못했습니다: {detail}',
} satisfies Record<keyof typeof zh, string>
