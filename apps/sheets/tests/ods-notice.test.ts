/**
 * The footer line an .ods import keeps for the life of the document: the copy
 * is .xlsx, plus how many formulas were kept as values. It is a separate value
 * from the transient status message, so a command's result never clears it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { strings } from '../src/renderer/i18n/strings'
import { odsConversionNoticeOf, odsConversionNoticeText } from '../src/renderer/ods-import'

type Lang = keyof typeof strings

/// the renderer translator's shape for the two keys this line uses
function translator(lang: Lang) {
  return (
    key: 'appOdsImportNotice' | 'appOdsFormulasDropped',
    params?: { count: number },
  ): string => strings[lang][key].replace('{count}', String(params?.count ?? ''))
}

describe('the .ods conversion notice', () => {
  it('only exists for a document opened from .ods', () => {
    expect(odsConversionNoticeOf({})).toBeNull()
    expect(odsConversionNoticeOf({ odsConverted: false })).toBeNull()
    expect(odsConversionNoticeOf({ odsConverted: true })).toEqual({ formulasDropped: 0 })
    expect(odsConversionNoticeOf({ odsConverted: true, formulasDropped: 4 })).toEqual({
      formulasDropped: 4,
    })
  })

  it('says saving writes an .xlsx, and names the formulas kept as values', () => {
    expect(odsConversionNoticeText({ formulasDropped: 0 }, translator('en'))).toBe(
      'Opened the ODS as an xlsx copy. Saving writes an xlsx file.',
    )
    expect(odsConversionNoticeText({ formulasDropped: 2 }, translator('en'))).toBe(
      'Opened the ODS as an xlsx copy. Saving writes an xlsx file. 2 formulas were kept as values only.',
    )
    expect(odsConversionNoticeText({ formulasDropped: 0 }, translator('ko'))).toBe(
      'ODS를 xlsx 사본으로 열었습니다. 저장하면 xlsx로 저장됩니다.',
    )
    expect(odsConversionNoticeText({ formulasDropped: 3 }, translator('ko'))).toBe(
      'ODS를 xlsx 사본으로 열었습니다. 저장하면 xlsx로 저장됩니다. 수식 3개는 값만 남겼습니다.',
    )
  })
})

describe('the .ods notice strings', () => {
  const languages = Object.keys(strings) as Lang[]

  it('cover all 21 languages', () => {
    expect(languages).toHaveLength(21)
  })

  it('every language defines both keys with the count placeholder', () => {
    for (const lang of languages) {
      const values: Record<string, string> = strings[lang]
      expect(values.appOdsImportNotice, `${lang}.appOdsImportNotice`).toBeTruthy()
      expect(values.appOdsFormulasDropped, `${lang}.appOdsFormulasDropped`).toContain('{count}')
    }
  })

  it('translates the line instead of copying the English one', () => {
    for (const lang of languages) {
      if (lang === 'en') continue
      const values: Record<string, string> = strings[lang]
      expect(values.appOdsImportNotice, `${lang}.appOdsImportNotice`).not.toBe(
        strings.en.appOdsImportNotice,
      )
      expect(values.appOdsFormulasDropped, `${lang}.appOdsFormulasDropped`).not.toBe(
        strings.en.appOdsFormulasDropped,
      )
    }
  })
})

describe('sheets wiring for the .ods notice', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
  const shell = readFileSync(resolve(process.cwd(), 'src/renderer/ExcelShell.tsx'), 'utf8')

  it('keeps the notice in its own state, set only when a document opens', () => {
    expect(app).toContain(
      'const [odsNotice, setOdsNotice] = useState<OdsConversionNotice | null>(null)',
    )
    // opening a different document replaces it; a save re-open never touches it
    expect(app).toContain('setOdsNotice(odsConversionNoticeOf(selected))')
    expect(app.match(/setOdsNotice\(/g)).toHaveLength(1)
    expect(app).toContain('odsNotice={odsNotice}')
  })

  it('renders the notice once, in the footer status bar', () => {
    const footer = shell.slice(shell.indexOf('<footer className="status-bar"'))
    expect(footer).toContain('odsNoticeText')
    // the ribbon row's own status echo stays the transient message only
    const ribbonStatus = shell.slice(
      shell.indexOf('<span className="workbook-status"'),
      shell.indexOf('</span>', shell.indexOf('<span className="workbook-status"')),
    )
    expect(ribbonStatus).not.toContain('odsNotice')
  })
})
