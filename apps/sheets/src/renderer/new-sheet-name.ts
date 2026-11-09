/**
 * Default names for inserted sheets. A new workbook's first sheet is `Sheet1`
 * in every UI language (the renderer's initial snapshot, the blank archives
 * the main process writes, the CLI), and Excel continues that base: Sheet2,
 * Sheet3, ... Korean Excel does the same. Univer's insert-sheet command
 * instead names an unnamed sheet after its locale pack's "sheet" label plus
 * its own counter, so the sheet-bar `+`, the tab menu's Insert and the
 * ribbon's Insert Sheet added `시트1` beside `Sheet1` in a Korean UI
 * (issue #389). The hook below hands every unnamed insert the lowest free
 * SheetN before the command runs, the same rule the file-session ribbon path
 * and `add_sheet` already use.
 */
import { ICommandService, IUniverInstanceService } from '@univerjs/core'
import { getSheetCommandTargetWorkbook } from '@univerjs/sheets'

import type { UniverRuntime } from './univer-state'

const INSERT_SHEET_COMMAND = 'sheet.command.insert-sheet'

/** Excel-style default name for an inserted sheet: the lowest free SheetN. */
export function nextSheetName(taken: readonly string[]): string {
  // Excel compares sheet names case-insensitively; so does Univer.
  const lower = new Set(taken.map((name) => name.toLowerCase()))
  for (let n = 1; ; n += 1) {
    const candidate = `Sheet${n}`
    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

interface InsertSheetParams {
  unitId?: string
  sheet?: { name?: string } & Record<string, unknown>
}

/// Names an unnamed insert in place. Univer hands the listeners the very
/// params object its handler then reads; a caller that sent no params at all
/// keeps Univer's own name (no stock path does that).
export function nameUnnamedInsert(
  command: { id: string; params?: unknown },
  takenNames: (unitId: string | undefined) => readonly string[] | null,
): string | null {
  if (command.id !== INSERT_SHEET_COMMAND) return null
  const params = command.params as InsertSheetParams | undefined
  if (!params || typeof params !== 'object') return null
  if (typeof params.sheet?.name === 'string' && params.sheet.name.length > 0) return null
  const taken = takenNames(params.unitId)
  if (!taken) return null
  const name = nextSheetName(taken)
  params.sheet = { ...(params.sheet ?? {}), name }
  return name
}

export function installNewSheetNaming(runtime: UniverRuntime): void {
  const injector = runtime.univer.__getInjector()
  const commandService = injector.get(ICommandService)
  const instances = injector.get(IUniverInstanceService)
  commandService.beforeCommandExecuted((command) => {
    nameUnnamedInsert(command, (unitId) => {
      const target = getSheetCommandTargetWorkbook(instances, unitId ? { unitId } : {})
      return target ? target.workbook.getSheetsName() : null
    })
  })
}
