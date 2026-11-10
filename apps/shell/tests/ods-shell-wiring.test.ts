import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOME_KINDS } from '../src/shared/home-kinds'
import { EXT_FAMILY } from '../src/main/recent-files'
import { isSupportedTreeFile } from '../src/main/folder-tree'

/**
 * `.ods` opens as an `.xlsx` copy in the spreadsheet tab (decision 0119), so
 * every shell list that offers or filters documents has to name it in the same
 * family as `.xlsx`. The main entry (src/main/index.ts) and Home.tsx cannot be
 * imported in a node test, so their lists are read out of the source, the same
 * way odt-shell-wiring.test.ts and main-locale-tables.test.ts do.
 */
const main = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
const home = readFileSync(join(__dirname, '../src/renderer/src/Home.tsx'), 'utf8')

/** the declaration `const NAME …` up to the blank line that ends it */
function literal(source: string, name: string): string {
  const start = source.indexOf(`const ${name}`)
  if (start < 0) throw new Error(`no ${name}`)
  const end = source.indexOf('\n\n', start)
  return source.slice(start, end < 0 ? undefined : end)
}

describe('.ods in the shell lists', () => {
  it('counts .ods as a spreadsheet in every xlsx family list', () => {
    expect(EXT_FAMILY.xlsx).toContain('ods')
    expect(literal(main, 'SEARCH_EXT_FAMILY')).toMatch(
      /xlsx: \['xlsx', 'xlsm', 'xls', 'csv', 'tsv', 'ods'\]/,
    )
    expect(literal(home, 'FILTER_FAMILY')).toMatch(
      /xlsx: \['xlsx', 'xlsm', 'xls', 'csv', 'tsv', 'ods'\]/,
    )
  })

  it('shows .ods in the folder tree, the open dialog and the open card', () => {
    expect(isSupportedTreeFile('Budget.ODS')).toBe(true)
    expect(literal(main, 'OPEN_DIALOG_EXTENSIONS')).toContain("'ods'")
    expect(literal(home, 'OPEN_LOCAL_EXTENSIONS')).toContain('.ods')
    // the spreadsheet tile, since the spreadsheet tab opens it
    expect(literal(home, 'FILE_ICONS')).toContain('ods: iconXlsx')
  })

  it('offers .ods in the home open dialog Excel filter', () => {
    expect(main).toContain(
      "{ name: tm('filterExcel'), extensions: ['xlsx', 'xlsm', 'xls', 'csv', 'tsv', 'ods'] },",
    )
  })

  it('leaves the PDF save-as-Excel target xlsx-only: .ods is an open format, not a save one', () => {
    // the PDF app converts to .xlsx; the shell picks that path, and an .ods
    // name there would promise a format the converter does not write
    expect(main).toContain("{ name: tm('filterExcel'), extensions: ['xlsx'] }]")
  })

  it('does not add .ods as a new-document kind', () => {
    expect(HOME_KINDS as readonly string[]).not.toContain('ods')
  })
})
