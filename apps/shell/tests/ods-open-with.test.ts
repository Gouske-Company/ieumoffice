import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { OFFICE_TYPES } from '../src/main/default-app'

/**
 * .ods is offered in Explorer's "Open with" and never made the default: the
 * NSIS script registers a product-own ProgId and one value under
 * .ods\OpenWithProgids, and the uninstaller removes exactly those two. An ODS
 * file opens as a converted .xlsx copy that saves as .xlsx (decision 0118), so
 * taking over the user's ODS program would hide that. The installer itself can
 * only be checked by installing it, so this pins the script text and the
 * packaging config that keep ODS off the default path.
 */
const require = createRequire(import.meta.url)
const SHELL = resolve(import.meta.dirname, '..')
const nsh = readFileSync(join(SHELL, 'build/installer.nsh'), 'utf8')

function loadBuilderConfig(platform: string) {
  const configModule = { exports: {} as ReturnType<typeof require> }
  runInNewContext(readFileSync(join(SHELL, 'electron-builder.cjs'), 'utf8'), {
    module: configModule,
    __dirname: SHELL,
    process: { platform, arch: 'x64', env: {} },
    require: (id: string) =>
      id === 'node:fs' ? { ...require(id), existsSync: () => true } : require(id),
  })
  return configModule.exports
}

/** body of one `!macro NAME` … `!macroend` block */
function macroBody(name: string): string {
  const match = nsh.match(new RegExp(`!macro ${name}\\b[^\\n]*\\n([\\s\\S]*?)\\n!macroend`))
  if (!match) throw new Error(`no ${name} macro in installer.nsh`)
  return match[1]
}

/** the instructions of a macro, comments dropped */
function instructions(name: string): string[] {
  return macroBody(name)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith(';'))
}

const PROGID = 'IeumOffice.OpenDocumentSpreadsheet'

describe('the ODS "Open with" registration', () => {
  it('uses a ProgId of this product that the upstream app never registers', () => {
    expect(nsh).toContain(`!define GENOFFICE_ODS_PROGID "${PROGID}"`)
    expect(PROGID).toMatch(/^IeumOffice\.[A-Za-z][A-Za-z0-9]*$/)
    // Windows limits a ProgId to 39 characters
    expect(PROGID.length).toBeLessThanOrEqual(39)
    expect(PROGID.toLowerCase()).not.toContain('genoffice')
  })

  it('spells the ProgId electron-builder would derive from the same type name', () => {
    // the Windows list derives `<product>.<name without punctuation>`; the
    // Open-With ProgId written by hand must match, or Windows Settings would
    // record a ProgId that no registration backs
    const mac = loadBuilderConfig('darwin')
    const entry = mac.mac.fileAssociations.find(
      (association: { ext: string }) => association.ext === 'ods',
    ) as { name: string } | undefined
    expect(entry, 'mac / Linux do not offer the app for .ods').toBeTruthy()
    expect(`IeumOffice.${entry!.name.replace(/[^A-Za-z0-9]/g, '')}`).toBe(PROGID)
  })

  it('writes the ProgId with an open command and the xlsx icon, and offers it for .ods', () => {
    const body = instructions('GenOfficeRegisterOpenWithOds')
    const progKey = 'Software\\Classes\\${GENOFFICE_ODS_PROGID}'
    expect(body).toContain(
      `WriteRegStr SHELL_CONTEXT "${progKey}\\shell\\open\\command" "" '"$appExe" "%1"'`,
    )
    expect(body).toContain(
      `WriteRegStr SHELL_CONTEXT "${progKey}\\DefaultIcon" "" "$INSTDIR\\resources\\xlsx.ico"`,
    )
    expect(body).toContain(
      'WriteRegNone SHELL_CONTEXT "Software\\Classes\\.ods\\OpenWithProgids" "${GENOFFICE_ODS_PROGID}"',
    )
    // the icon the ProgId borrows is the one the .xlsx association installs
    const win = loadBuilderConfig('win32')
    const xlsx = win.win.fileAssociations.find(
      (association: { ext: string }) => association.ext === 'xlsx',
    )
    expect(xlsx?.icon).toBe('xlsx')
    expect(existsSync(join(SHELL, 'build/xlsx.ico'))).toBe(true)
  })

  it('never writes the default value of .ods or any other .ods key', () => {
    const odsWrites = instructions('GenOfficeRegisterOpenWithOds').filter((line) =>
      line.includes('\\.ods'),
    )
    // the OpenWithProgids value is the only thing written under .ods
    expect(odsWrites).toEqual([
      'WriteRegNone SHELL_CONTEXT "Software\\Classes\\.ods\\OpenWithProgids" "${GENOFFICE_ODS_PROGID}"',
    ])
    expect(nsh).not.toMatch(/"Software\\Classes\\\.ods" ""/)
    expect(nsh).not.toMatch(/\.ods\\ShellNew/)
  })

  it('removes only its own value and its own ProgId on uninstall', () => {
    expect(instructions('GenOfficeUnregisterOpenWithOds')).toEqual([
      'DeleteRegValue SHELL_CONTEXT "Software\\Classes\\.ods\\OpenWithProgids" "${GENOFFICE_ODS_PROGID}"',
      'DeleteRegKey SHELL_CONTEXT "Software\\Classes\\${GENOFFICE_ODS_PROGID}"',
    ])
    // the .ods key and its OpenWithProgids list belong to other programs too
    expect(nsh).not.toMatch(/DeleteRegKey[^\n]*\\\.ods/)
  })

  it('runs the registration on install and the removal on uninstall', () => {
    expect(macroBody('customInstall')).toContain('!insertmacro GenOfficeRegisterOpenWithOds')
    expect(macroBody('customUnInstall')).toContain('!insertmacro GenOfficeUnregisterOpenWithOds')
  })
})

describe('ODS stays off the default-program path', () => {
  it('is not a Windows file association on any platform', () => {
    // a win.fileAssociations entry makes NSIS write .ods's default value (the
    // ProgId becomes the default opener)
    for (const platform of ['win32', 'darwin', 'linux']) {
      const config = loadBuilderConfig(platform)
      expect(config.fileAssociations).toBeUndefined()
      const exts = config.win.fileAssociations.map((entry: { ext: string }) => entry.ext)
      expect(exts, platform).not.toContain('ods')
    }
  })

  it('is only an alternate handler on macOS and Linux', () => {
    const config = loadBuilderConfig('darwin')
    const entry = config.mac.fileAssociations.find(
      (association: { ext: string }) => association.ext === 'ods',
    )
    expect(entry).toMatchObject({
      name: 'OpenDocument Spreadsheet',
      description: 'OpenDocument Spreadsheet',
      role: 'Editor',
      rank: 'Alternate',
      icon: 'xlsx',
      mimeType: 'application/vnd.oasis.opendocument.spreadsheet',
    })
  })

  it('is not one of the types the app offers to become the default for', () => {
    expect(OFFICE_TYPES.map((type) => type.ext)).not.toContain('ods')
  })
})
