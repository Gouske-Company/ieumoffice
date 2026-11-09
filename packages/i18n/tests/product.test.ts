import { describe, expect, it } from 'vitest'
import {
  brandText,
  createI18n,
  DEV_USER_DATA_DIR_NAME,
  LANGS,
  PRODUCT_NAME,
  PRODUCT_REPO_NAME,
  PRODUCT_REPO_OWNER,
  PRODUCT_REPO_SLUG,
  productName,
  UPSTREAM_NAME_LITERAL,
  UPSTREAM_PRODUCT_NAME,
  USER_DATA_DIR_NAME,
  type LangDicts,
} from '../src/index'

describe('productName', () => {
  it('is the Korean name in the Korean UI and the Latin name everywhere else', () => {
    expect(productName('ko')).toBe('이음오피스')
    for (const lang of LANGS) {
      if (lang !== 'ko') expect(productName(lang), lang).toBe('IeumOffice')
    }
  })

  it('accepts raw locale tags and falls back to the Latin name', () => {
    expect(productName('ko-KR')).toBe('이음오피스')
    expect(productName('KO_kr')).toBe('이음오피스')
    expect(productName('en-US')).toBe('IeumOffice')
    expect(productName('')).toBe('IeumOffice')
    expect(productName(undefined)).toBe('IeumOffice')
    expect(productName(null)).toBe('IeumOffice')
  })

  it('keeps the Latin name as the one PRODUCT_NAME definition', () => {
    expect(PRODUCT_NAME).toBe('IeumOffice')
    expect(productName('en')).toBe(PRODUCT_NAME)
  })
})

describe('brandText', () => {
  it('swaps the upstream name for the product name of the language', () => {
    expect(brandText('Welcome to GenOffice', 'en')).toBe('Welcome to IeumOffice')
    expect(brandText('GenOffice에 오신 것을 환영합니다', 'ko')).toBe(
      '이음오피스에 오신 것을 환영합니다',
    )
    expect(brandText('GenOffice のインストール', 'ja')).toBe('IeumOffice のインストール')
    expect(brandText('关于 GenOffice', 'zh')).toBe('关于 IeumOffice')
  })

  it('replaces every occurrence, including sub-app names and compounds', () => {
    expect(brandText('GenOffice Docs and GenOffice Sheets', 'en')).toBe(
      'IeumOffice Docs and IeumOffice Sheets',
    )
    expect(brandText('GenOffice Markdown', 'ko')).toBe('이음오피스 Markdown')
    expect(brandText('das GenOffice-Fenster', 'de')).toBe('das IeumOffice-Fenster')
    expect(brandText("GenOffice's window", 'en')).toBe("IeumOffice's window")
  })

  it('returns strings without the name untouched', () => {
    const plain = 'Save the file with ⌘S'
    expect(brandText(plain, 'ko')).toBe(plain)
    expect(brandText('', 'ko')).toBe('')
    // the command line and package names are lowercase and are not the display name
    expect(brandText('run `genoffice open` (@genoffice/cli, GENOFFICE_USER_DATA)', 'ko')).toBe(
      'run `genoffice open` (@genoffice/cli, GENOFFICE_USER_DATA)',
    )
  })

  it('prints the literal upstream name where the text escapes it', () => {
    expect(UPSTREAM_PRODUCT_NAME).toBe('GenOffice')
    expect(UPSTREAM_NAME_LITERAL).toBe('{{GenOffice}}')
    expect(brandText('Based on {{GenOffice}}', 'en')).toBe('Based on GenOffice')
    expect(brandText('{{GenOffice}}를 바탕으로 만들었습니다', 'ko')).toBe(
      'GenOffice를 바탕으로 만들었습니다',
    )
    expect(brandText('GenOffice is based on {{GenOffice}}.', 'en')).toBe(
      'IeumOffice is based on GenOffice.',
    )
    expect(brandText('GenOffice는 {{GenOffice}}를 바탕으로 합니다.', 'ko')).toBe(
      '이음오피스는 GenOffice를 바탕으로 합니다.',
    )
  })

  it('uses the Latin name inside file and folder names in every language', () => {
    expect(brandText('chmod +x GenOffice-<version>.AppImage', 'ko')).toBe(
      'chmod +x IeumOffice-<version>.AppImage',
    )
    expect(brandText('문서/GenOffice 폴더', 'ko')).toBe('문서/IeumOffice 폴더')
    expect(brandText('%APPDATA%\\GenOffice', 'ko')).toBe('%APPDATA%\\IeumOffice')
    expect(brandText('GenOffice.exe를 실행합니다', 'ko')).toBe('IeumOffice.exe를 실행합니다')
    // a sentence-ending period is not a file extension
    expect(brandText('이것은 GenOffice. 다음 문장', 'ko')).toBe('이것은 이음오피스. 다음 문장')
    expect(brandText('GenOffice.', 'ko')).toBe('이음오피스.')
  })

  it('leaves identifiers that merely contain the name alone', () => {
    expect(brandText('GenOfficeFormField', 'en')).toBe('GenOfficeFormField')
    expect(brandText('_GenOfficeCoverPage', 'en')).toBe('_GenOfficeCoverPage')
    expect(brandText('MyGenOffice', 'en')).toBe('MyGenOffice')
  })
})

describe('createI18n product name', () => {
  const dicts = {
    zh: { about: '关于 GenOffice', ack: '基于 {{GenOffice}}', open: '用 GenOffice 打开 {name}' },
    en: {
      about: 'About GenOffice',
      ack: 'Based on {{GenOffice}}',
      open: 'Open {name} in GenOffice',
    },
    ko: {
      about: 'GenOffice 정보',
      ack: '{{GenOffice}} 기반',
      open: 'GenOffice에서 {name} 열기',
    },
  } as unknown as LangDicts<{ about: string; ack: string; open: string }>
  const t = createI18n(dicts)

  it('renders the product name of the requested language', () => {
    expect(t('en', 'about')).toBe('About IeumOffice')
    expect(t('zh', 'about')).toBe('关于 IeumOffice')
    expect(t('ko', 'about')).toBe('이음오피스 정보')
  })

  it('keeps the upstream name in the acknowledgement', () => {
    expect(t('en', 'ack')).toBe('Based on GenOffice')
    expect(t('zh', 'ack')).toBe('基于 GenOffice')
    expect(t('ko', 'ack')).toBe('GenOffice 기반')
  })

  it('never rewrites interpolated values (a file may be called GenOffice)', () => {
    expect(t('en', 'open', { name: 'GenOffice notes.docx' })).toBe(
      'Open GenOffice notes.docx in IeumOffice',
    )
    expect(t('ko', 'open', { name: 'GenOffice.docx' })).toBe('이음오피스에서 GenOffice.docx 열기')
  })

  it('brands the fallback text of a language without its own entry', () => {
    expect(t('fr', 'about')).toBe('About IeumOffice')
  })
})

describe('registered names derived from the product name', () => {
  it('names the userData folders after the Latin product name', () => {
    expect(USER_DATA_DIR_NAME).toBe('IeumOffice')
    expect(DEV_USER_DATA_DIR_NAME).toBe('IeumOffice-Dev')
    expect(USER_DATA_DIR_NAME).not.toBe(UPSTREAM_PRODUCT_NAME)
  })

  it('names the public repository once', () => {
    expect(PRODUCT_REPO_OWNER).toBe('pblsketch')
    expect(PRODUCT_REPO_NAME).toBe('ieumoffice')
    expect(PRODUCT_REPO_SLUG).toBe('pblsketch/ieumoffice')
  })
})
