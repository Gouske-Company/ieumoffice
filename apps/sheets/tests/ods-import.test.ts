/**
 * An .ods file opens the way an .xls does: the sidecar converts it to a
 * temporary .xlsx and the session runs on that copy, with the original's .xlsx
 * sibling suggested for the first Save As. The original .ods is only ever read
 * — by manual save, Save As, and the crash-recovery copy. The conversion's
 * dropped-formula count reaches the opened document so the footer can say so.
 * The spreadsheet engine, the archive writer and the dialogs are stubs; the
 * files on disk are real.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

type Handler = (event: { sender: FakeContents }, ...args: unknown[]) => unknown

interface FakeContents {
  id: number
  listeners: Map<string, ((...args: unknown[]) => void)[]>
  destroyed: boolean
  isDestroyed(): boolean
  isCrashed(): boolean
  send(): void
  on(event: string, fn: (...args: unknown[]) => void): void
  once(event: string, fn: (...args: unknown[]) => void): void
  removeListener(): void
  setWindowOpenHandler(): void
  loadURL(): Promise<void>
}

const handlers = new Map<string, Handler>()
let nextContentsId = 2600

function fakeContents(): FakeContents {
  const contents: FakeContents = {
    id: ++nextContentsId,
    listeners: new Map(),
    destroyed: false,
    isDestroyed: () => contents.destroyed,
    isCrashed: () => false,
    send: () => {},
    on(event, fn) {
      contents.listeners.set(event, [...(contents.listeners.get(event) ?? []), fn])
    },
    once(event, fn) {
      contents.on(event, fn)
    },
    removeListener: () => {},
    setWindowOpenHandler: () => {},
    loadURL: () => Promise.resolve(),
  }
  return contents
}

/** what the stub converter was asked to convert */
const convertCalls: { path: string; targetPath: string }[] = []
/** how many formulas the stub conversion reports as kept-only-as-values */
const formulasDropped = { value: 2 }
/** where the fake Save As dialog saves, and the options it was shown */
const saveDialogAnswer = { value: '' }
const saveDialogs: {
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}[] = []
/** the open dialog's options each picker was shown */
const openDialogs: { filters?: { name: string; extensions: string[] }[] }[] = []
const userDataDirRef = { value: '' }

const ODS_BYTES = 'ods-original-bytes'
const CONVERTED_BYTES = 'converted-xlsx-bytes'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? userDataDirRef.value : tmpdir()),
    getName: () => 'sheets-test',
    getVersion: () => '0',
    getAppPath: () => tmpdir(),
    getLocale: () => 'en-US',
    getSystemLocale: () => 'en-US',
    isPackaged: false,
    on: () => {},
    once: () => {},
    quit: () => {},
    whenReady: () => new Promise(() => {}),
  },
  ipcMain: {
    handle: (channel: string, fn: Handler) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {
    static fromWebContents(): null {
      return null
    }
  },
  WebContentsView: class {
    webContents = fakeContents()
  },
  desktopCapturer: {},
  dialog: {
    showMessageBox: async () => ({ response: 0 }),
    showOpenDialog: async (...args: unknown[]) => {
      openDialogs.push(args.at(-1) as (typeof openDialogs)[number])
      return { canceled: true, filePaths: [] }
    },
    showSaveDialog: async (...args: unknown[]) => {
      saveDialogs.push(args.at(-1) as (typeof saveDialogs)[number])
      return { canceled: false, filePath: saveDialogAnswer.value }
    },
  },
  net: {},
  screen: {},
  session: {},
  shell: { showItemInFolder: () => {} },
  systemPreferences: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))

/** the preset path each PDF export was handed (undefined = it would open its own dialog) */
const pdfExports = vi.hoisted(() => [] as (string | undefined)[])

vi.mock('../src/main/pdf-export', () => ({
  exportPdf: async (_event: unknown, _request: unknown, presetPath?: string) => {
    pdfExports.push(presetPath)
    return { canceled: true }
  },
  printWorkbook: async () => ({ ok: false }),
}))

let openCount = 0

vi.mock('../src/main/xlsx-sidecar-client', () => ({
  XlsxSidecarClient: class {
    start(): void {}
    onProcessExit(): void {}
    async close(): Promise<void> {}
    async open(path: string): Promise<unknown> {
      return {
        sessionId: `00000000-0000-4000-a000-${String(++openCount).padStart(12, '0')}`,
        name: basename(path),
        entryCount: 3,
        sheets: [
          {
            id: 'sheet-1',
            name: 'Data',
            rowCount: 20,
            columnCount: 10,
            columnWidths: [],
            defaultRowHeight: 15,
            defaultColumnWidth: 8.43,
            freeze: null,
            hidden: false,
            tabColor: null,
            showGridLines: true,
            tables: [],
            comments: [],
            pivotRanges: [],
          },
        ],
        activeTab: 0,
        styles: [],
        dxfStyles: [],
        visuals: [],
        definedNames: [],
      }
    }
    async convertWorkbook(input: { path: string; targetPath: string }): Promise<unknown> {
      convertCalls.push(input)
      const { writeFile: writeConverted } = await import('node:fs/promises')
      await writeConverted(input.targetPath, Buffer.from(CONVERTED_BYTES))
      return { sheets: 1, cells: 3, formulasDropped: formulasDropped.value }
    }
  },
}))

// the archive writer is stubbed: it lands the bytes it read plus a mark
vi.mock('@genoffice/xlsx-gateway/gateway/xlsx-package-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveWorkbookViaSidecar: async (request: { sourcePath: string; targetPath: string }) => {
    const bytes = await readFile(request.sourcePath)
    await writeFile(request.targetPath, Buffer.concat([bytes, Buffer.from('-saved')]))
    return { touchedEntries: [], removedEntries: [], addedEntries: [] }
  },
}))

vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
}))

import {
  createSheetsView,
  openSheetsUntitledCopy,
  queueWorkbookForView,
} from '../src/main/sheets-main'

interface OpenedWorkbook {
  sessionId: string
  path?: string
  needsSaveAs?: boolean
  odsConverted?: boolean
  formulasDropped?: number
}

let dir: string

function newTab(): FakeContents {
  return createSheetsView({ includeAiHandlers: false }).webContents as unknown as FakeContents
}

function call(contents: FakeContents, channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({ sender: contents }, ...args))
}

function writeOds(name = '보고서.ods', bytes = ODS_BYTES): string {
  const path = join(dir, name)
  writeFileSync(path, Buffer.from(bytes))
  return path
}

async function openOds(contents: FakeContents, path: string): Promise<OpenedWorkbook> {
  queueWorkbookForView(contents as never, path)
  return (await call(contents, IPC_CHANNELS.selectWorkbook)) as OpenedWorkbook
}

function saveRequest(sessionId: string, mode: 'save' | 'save-as' = 'save'): unknown {
  return {
    sessionId,
    mode,
    edits: [{ sheetId: 'sheet-1', row: 0, column: 0, writeValue: true, value: 'edited' }],
    structuralOps: [],
    chartEdits: [],
    visualEdits: [],
    visualAdditions: [],
    tableAdditions: [],
    pivotAdditions: [],
    sheetOps: [],
    sheetOrder: [],
    filterStates: [],
    hyperlinkEdits: [],
    cfStates: [],
    dvStates: [],
    pageSetupStates: [],
    noteStates: [],
    formulaValues: [],
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    sheetProtections: [],
    sparklineAdditions: [],
    definedNamesState: null,
  }
}

interface SaveResult {
  canceled: boolean
  file?: OpenedWorkbook
}

async function saveWorkbook(
  contents: FakeContents,
  sessionId: string,
  mode: 'save' | 'save-as' = 'save',
): Promise<SaveResult> {
  return (await call(
    contents,
    IPC_CHANNELS.saveWorkbook,
    saveRequest(sessionId, mode),
  )) as SaveResult
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-sheets-ods-'))
  userDataDirRef.value = mkdtempSync(join(tmpdir(), 'genoffice-sheets-ods-user-'))
  convertCalls.length = 0
  formulasDropped.value = 2
  saveDialogs.length = 0
  openDialogs.length = 0
  saveDialogAnswer.value = ''
  pdfExports.length = 0
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(userDataDirRef.value, { recursive: true, force: true })
})

describe('an .ods opens as a converted .xlsx session', () => {
  it('converts to a temporary .xlsx and reports the dropped formulas', async () => {
    const contents = newTab()
    const ods = writeOds()

    const file = await openOds(contents, ods)

    expect(file.odsConverted).toBe(true)
    expect(file.formulasDropped).toBe(2)
    // the first save asks where: a .xlsx cannot be written over the .ods
    expect(file.needsSaveAs).toBe(true)
    expect(file.path).toBeDefined()
    expect(file.path).not.toBe(ods)
    expect(basename(file.path!)).toBe('보고서.xlsx')
    expect(convertCalls).toEqual([{ path: ods, targetPath: file.path }])
    // opening reads the original and leaves it alone
    expect(readFileSync(ods).toString()).toBe(ODS_BYTES)
  })

  it('reports no dropped formulas when the conversion kept them all', async () => {
    formulasDropped.value = 0
    const file = await openOds(newTab(), writeOds())

    expect(file.odsConverted).toBe(true)
    expect(file.formulasDropped).toBe(0)
  })

  it('suggests the same folder and stem as .xlsx for the first save', async () => {
    const contents = newTab()
    const ods = writeOds()
    const file = await openOds(contents, ods)
    const target = join(dir, '보고서.xlsx')
    saveDialogAnswer.value = target

    const saved = await saveWorkbook(contents, file.sessionId)

    expect(saveDialogs).toHaveLength(1)
    expect(saveDialogs[0]?.defaultPath).toBe(target)
    expect(saved.canceled).toBe(false)
    expect(saved.file?.path).toBe(target)
    // the .xlsx is the save target; the original never was
    expect(readFileSync(target).toString()).toBe(`${CONVERTED_BYTES}-saved`)
    expect(readFileSync(ods).toString()).toBe(ODS_BYTES)
    expect(readdirSync(dir)).toHaveLength(2)
    expect(readdirSync(dir)).toContain('보고서.ods')
    expect(readdirSync(dir)).toContain('보고서.xlsx')
  })

  it('writes later saves to the chosen .xlsx without asking again', async () => {
    const contents = newTab()
    const ods = writeOds()
    const file = await openOds(contents, ods)
    const target = join(dir, '보고서.xlsx')
    saveDialogAnswer.value = target
    const first = await saveWorkbook(contents, file.sessionId)

    const second = await saveWorkbook(contents, first.file!.sessionId)

    expect(saveDialogs).toHaveLength(1)
    expect(second.canceled).toBe(false)
    expect(readFileSync(target).toString()).toBe(`${CONVERTED_BYTES}-saved-saved`)
    expect(readFileSync(ods).toString()).toBe(ODS_BYTES)
  })

  it('never writes the workbook to an .ods path typed in Save As', async () => {
    const contents = newTab()
    const ods = writeOds()
    const file = await openOds(contents, ods)
    saveDialogAnswer.value = join(dir, 'typed.ods')

    await saveWorkbook(contents, file.sessionId)

    // the pick keeps its name but takes the workbook extension, so the bytes
    // cannot land on the original's path (or any .ods path)
    expect(readdirSync(dir)).toHaveLength(2)
    expect(readdirSync(dir)).toContain('보고서.ods')
    expect(readdirSync(dir)).toContain('typed.ods.xlsx')
    expect(readFileSync(ods).toString()).toBe(ODS_BYTES)
  })

  it('re-opens the converted copy after a sidecar crash', async () => {
    const contents = newTab()
    const file = await openOds(contents, writeOds())

    // the renderer's crash recovery re-opens state.file.path, which for a
    // converted session is the temp .xlsx copy (the original is never touched)
    const reopened = (await call(
      contents,
      IPC_CHANNELS.reopenWorkbook,
      file.path,
    )) as OpenedWorkbook
    expect(reopened.sessionId).toBeTruthy()
    expect(reopened.path).toBe(file.path)
  })

  it('keeps the crash-recovery copy under userData, named from the original', async () => {
    const contents = newTab()
    const ods = writeOds()
    const file = await openOds(contents, ods)

    const result = (await call(
      contents,
      IPC_CHANNELS.writeWorkbookRecovery,
      saveRequest(file.sessionId),
    )) as { ok: boolean }

    expect(result.ok).toBe(true)
    const untitled = join(userDataDirRef.value, 'sheets-autosave', 'untitled')
    const names = readdirSync(untitled)
    expect(names.filter((name) => name.endsWith('.meta.json'))).toHaveLength(1)
    const meta = JSON.parse(
      readFileSync(
        join(
          untitled,
          names.find((name) => name.endsWith('.meta.json'))!,
        ),
        'utf8',
      ),
    ) as Record<string, unknown>
    expect(meta.originalPath).toBe(ods)
    expect(meta.title).toBe('보고서.ods')
    // the footer's count survives the restart with the copy
    expect(meta.formulasDropped).toBe(2)
    // the copy went to the app's own folder, not beside the file the user opened
    expect(readdirSync(dir)).toEqual(['보고서.ods'])
  })

  it('keeps the footer notice when the copy is restored after a crash', async () => {
    const contents = newTab()
    const ods = writeOds()
    const file = await openOds(contents, ods)
    await call(contents, IPC_CHANNELS.writeWorkbookRecovery, saveRequest(file.sessionId))

    // the launch list restores the copy under its untitled identity; the shell
    // passes no save-as hint here, so the path and count come from the metadata
    const untitled = join(userDataDirRef.value, 'sheets-autosave', 'untitled')
    const copyName = readdirSync(untitled).find((name) => name.endsWith('.xlsx'))
    expect(copyName).toBeDefined()
    const copy = {
      kind: 'sheets' as const,
      untitledId: copyName!.replace(/\.xlsx$/, ''),
      ext: '.xlsx' as const,
    }
    await openSheetsUntitledCopy(contents as never, { copy, title: '보고서.ods' })

    const restored = (await call(contents, IPC_CHANNELS.selectWorkbook)) as OpenedWorkbook

    expect(restored.odsConverted).toBe(true)
    expect(restored.formulasDropped).toBe(2)
    expect(restored.needsSaveAs).toBe(true)
    expect(readFileSync(ods).toString()).toBe(ODS_BYTES)
  })
})

describe('the pickers keep .ods where it belongs', () => {
  it('offers .ods in the open dialog', async () => {
    await call(newTab(), IPC_CHANNELS.selectWorkbook)

    expect(openDialogs).toHaveLength(1)
    expect(openDialogs[0]?.filters?.[0]?.extensions).toContain('ods')
  })

  it('never offers .ods as a merge source', async () => {
    const contents = newTab()
    const ods = writeOds()

    await call(contents, IPC_CHANNELS.selectWorkbooksForMerge)
    expect(openDialogs[0]?.filters?.[0]?.extensions).not.toContain('ods')
    await expect(call(contents, IPC_CHANNELS.openWorkbooksForMerge, [ods])).rejects.toThrow(
      'Unsupported merge source: ods',
    )
  })
})
