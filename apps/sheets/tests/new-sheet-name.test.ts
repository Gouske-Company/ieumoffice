// @vitest-environment jsdom
/**
 * Issue #389: in a Korean UI a new workbook starts with `Sheet1`, but the
 * sheet-bar `+` added `시트1` (Univer's locale label plus its own counter).
 * These run the real insert-sheet command under the Korean pack.
 */
import {
  ICommandService,
  IUniverInstanceService,
  LocaleType,
  LogLevel,
  Univer,
} from '@univerjs/core'
import { UniverSheetsPlugin } from '@univerjs/sheets'
import sheetsKo from '@univerjs/sheets/locale/ko-KR'
import '@univerjs/sheets/facade'
import { FUniver } from '@univerjs/core/lib/facade'
import { describe, expect, it } from 'vitest'

import {
  installNewSheetNaming,
  nameUnnamedInsert,
  nextSheetName,
} from '../src/renderer/new-sheet-name'
import type { UniverRuntime } from '../src/renderer/univer-state'

const INSERT = 'sheet.command.insert-sheet'

function boot(install = true) {
  const univer = new Univer({
    logLevel: LogLevel.SILENT,
    locale: LocaleType.KO_KR,
    locales: { [LocaleType.KO_KR]: sheetsKo },
  })
  univer.registerPlugin(UniverSheetsPlugin)
  const univerAPI = FUniver.newAPI(univer)
  univerAPI.createWorkbook({
    id: 'wb',
    name: 'new',
    sheetOrder: ['s1'],
    sheets: { s1: { id: 's1', name: 'Sheet1', rowCount: 20, columnCount: 10 } },
  })
  const injector = univer.__getInjector()
  injector.get(IUniverInstanceService).focusUnit('wb')
  if (install) installNewSheetNaming({ univer, univerAPI } as unknown as UniverRuntime)
  const commands = injector.get(ICommandService)
  const names = () =>
    univerAPI
      .getActiveWorkbook()!
      .getSheets()
      .map((sheet) => sheet.getSheetName())
  // what the sheet bar's + sends (sheets-ui `addSheet`)
  const plus = () => commands.executeCommand(INSERT, { sheet: { rowCount: 1000, columnCount: 20 } })
  return { univerAPI, commands, names, plus }
}

describe('nextSheetName', () => {
  it('takes the lowest free SheetN, ignoring case', () => {
    expect(nextSheetName([])).toBe('Sheet1')
    expect(nextSheetName(['Sheet1'])).toBe('Sheet2')
    expect(nextSheetName(['Sheet1', 'SHEET2', '시트1'])).toBe('Sheet3')
  })
})

describe('nameUnnamedInsert', () => {
  const taken = () => ['Sheet1']

  it('names an unnamed insert in place and keeps the other sheet fields', () => {
    const params = { index: 1, sheet: { rowCount: 5 } }
    expect(nameUnnamedInsert({ id: INSERT, params }, taken)).toBe('Sheet2')
    expect(params.sheet).toEqual({ rowCount: 5, name: 'Sheet2' })
  })

  it('leaves named inserts, other commands and param-less calls alone', () => {
    const named = { sheet: { name: 'Data' } }
    expect(nameUnnamedInsert({ id: INSERT, params: named }, taken)).toBeNull()
    expect(named.sheet.name).toBe('Data')
    expect(nameUnnamedInsert({ id: 'sheet.command.copy-sheet', params: {} }, taken)).toBeNull()
    expect(nameUnnamedInsert({ id: INSERT }, taken)).toBeNull()
  })
})

describe('inserting sheets in a Korean UI', () => {
  it('reproduces the report without the hook', async () => {
    const { names, plus } = boot(false)
    await plus()
    expect(names()).toEqual(['Sheet1', '시트1'])
  })

  it('continues Sheet1 from the + button, the tab menu and the facade', async () => {
    const { univerAPI, commands, names, plus } = boot()
    await plus()
    // the tab menu's Insert (sheet-tab-actions `insertBefore`)
    await commands.executeCommand(INSERT, { unitId: 'wb', index: 0 })
    // the ribbon's Insert Sheet outside file sessions
    univerAPI.getActiveWorkbook()!.insertSheet()
    expect(names()).toEqual(['Sheet3', 'Sheet1', 'Sheet2', 'Sheet4'])
  })

  it('never collides and reuses a freed number', async () => {
    const { univerAPI, names, plus } = boot()
    const workbook = univerAPI.getActiveWorkbook()!
    workbook.insertSheet('sheet2')
    await plus()
    expect(names()).toEqual(['Sheet1', 'sheet2', 'Sheet3'])
    workbook.deleteSheet(workbook.getSheetByName('sheet2')!)
    await plus()
    expect(names()).toEqual(['Sheet1', 'Sheet3', 'Sheet2'])
  })

  it('keeps names the caller chose', async () => {
    const { univerAPI, commands, names } = boot()
    await commands.executeCommand(INSERT, { unitId: 'wb', sheet: { name: '요약' } })
    univerAPI.getActiveWorkbook()!.insertSheet('Data')
    expect(names()).toEqual(['Sheet1', '요약', 'Data'])
  })
})
