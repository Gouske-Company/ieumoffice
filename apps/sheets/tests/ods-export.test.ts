/**
 * ODS export (decision 0119, stage 2). The workbook is copied — the tab keeps
 * its .xlsx session — and the main process converts a private temp package
 * first, warns about what ODS cannot hold, and only then writes the target.
 * The original .ods a converted session came from is never a legal target, and
 * a password workbook is refused instead of exporting its plaintext copy.
 * The spreadsheet engine, the dialogs and the encryption layer are stubs; the
 * files on disk are real.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setUiLang } from '@genoffice/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import { workbookSaveResultSchema } from '../src/shared/desktop-api'

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
let nextContentsId = 3100

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

/** what the stub ODS writer was asked to convert */
const convertOdsCalls: { path: string; targetPath: string }[] = []
const dropped = {
  charts: { value: 0 },
  images: { value: 0 },
  conditionalFormats: { value: 0 },
  validations: { value: 0 },
  pivots: { value: 0 },
  comments: { value: 0 },
}
const formulasDropped = { value: 0 }
const verify = { sheets: 1, cells: 3, fails: false }

/** queued Save As answers, and the options each dialog was shown */
const saveDialogAnswers: string[] = []
const saveDialogs: {
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}[] = []
/** queued message-box answers, and the options each was shown */
const messageAnswers: number[] = []
const messageBoxes: {
  type?: string
  message?: string
  detail?: string
  buttons?: string[]
}[] = []
const userDataDirRef = { value: '' }

const ODS_BYTES = 'ods-export-bytes'
const CONVERTED_BYTES = 'converted-xlsx-bytes'
const CFB_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])

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
    showMessageBox: async (...args: unknown[]) => {
      messageBoxes.push(args.at(-1) as (typeof messageBoxes)[number])
      return { response: messageAnswers.shift() ?? 0 }
    },
    showSaveDialog: async (...args: unknown[]) => {
      saveDialogs.push(args.at(-1) as (typeof saveDialogs)[number])
      const filePath = saveDialogAnswers.shift()
      return filePath === undefined ? { canceled: true } : { canceled: false, filePath }
    },
  },
  net: {},
  screen: {},
  session: {},
  shell: { showItemInFolder: () => {} },
  systemPreferences: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))

vi.mock('../src/main/pdf-export', () => ({
  exportPdf: async () => ({ canceled: true }),
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
        sessionId: `00000000-0000-4000-b000-${String(++openCount).padStart(12, '0')}`,
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
      await writeFile(input.targetPath, Buffer.from(CONVERTED_BYTES))
      if (basename(input.targetPath) === 'verify.xlsx') {
        if (verify.fails) throw new Error('cannot read the exported package')
        return { sheets: verify.sheets, cells: verify.cells }
      }
      return { sheets: 1, cells: 3 }
    }
    async convertToOds(input: { path: string; targetPath: string }): Promise<unknown> {
      convertOdsCalls.push(input)
      await writeFile(input.targetPath, Buffer.from(ODS_BYTES))
      return {
        sheets: 2,
        cells: 12,
        formulasDropped: formulasDropped.value,
        dropped: {
          charts: dropped.charts.value,
          images: dropped.images.value,
          conditionalFormats: dropped.conditionalFormats.value,
          validations: dropped.validations.value,
          pivots: dropped.pivots.value,
          comments: dropped.comments.value,
        },
      }
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

vi.mock('@genoffice/electron-utils/office-encryption', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isEncryptedOfficeFile: () => true,
  unlockOfficeFile: async () => ({
    bytes: Buffer.from('decrypted-xlsx'),
    password: 'secret',
    asked: true,
  }),
}))

vi.mock('@genoffice/ai-provider/subscription', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genoffice/ai-provider/subscription')>()),
  ensureSubscriptionIpc: () => ({}),
  sharedSubscriptionStatuses: () => ({}),
}))

import {
  createSheetsView,
  markSheetsUnsavedNew,
  queueWorkbookForView,
  resetSheetsShuttingDown,
} from '../src/main/sheets-main'

let dir: string

function newTab(): FakeContents {
  return createSheetsView({ includeAiHandlers: false }).webContents as unknown as FakeContents
}

function call(contents: FakeContents, channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({ sender: contents }, ...args))
}

function writeWorkbook(name: string, bytes = 'original-bytes'): string {
  const path = join(dir, name)
  writeFileSync(path, Buffer.from(bytes))
  return path
}

async function openWorkbook(
  contents: FakeContents,
  path: string,
): Promise<{ sessionId: string; path: string }> {
  return (await call(contents, IPC_CHANNELS.reopenWorkbook, path)) as {
    sessionId: string
    path: string
  }
}

function saveRequest(sessionId: string, mode: 'save' | 'save-as'): unknown {
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

function exportOdsRequest(sessionId: string, targetPath?: string): unknown {
  return { sessionId, ...(targetPath === undefined ? {} : { targetPath }) }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'genoffice-sheets-ods-export-'))
  userDataDirRef.value = mkdtempSync(join(tmpdir(), 'genoffice-sheets-ods-export-user-'))
  convertOdsCalls.length = 0
  saveDialogAnswers.length = 0
  saveDialogs.length = 0
  messageAnswers.length = 0
  messageBoxes.length = 0
  formulasDropped.value = 0
  for (const count of Object.values(dropped)) count.value = 0
  verify.sheets = 1
  verify.cells = 3
  verify.fails = false
  setUiLang('en')
  resetSheetsShuttingDown()
})

afterEach(() => {
  resetSheetsShuttingDown()
  rmSync(dir, { recursive: true, force: true })
  rmSync(userDataDirRef.value, { recursive: true, force: true })
})

describe('ODS export', () => {
  it('Save As picks ODS as a copy and the workbook keeps its path', async () => {
    const path = writeWorkbook('Budget.xlsx')
    const tab = newTab()
    const opened = await openWorkbook(tab, path)
    const target = join(dir, 'Budget.ods')
    saveDialogAnswers.push(target)

    const picked = await call(
      tab,
      IPC_CHANNELS.saveWorkbook,
      saveRequest(opened.sessionId, 'save-as'),
    )
    expect(picked).toEqual({ canceled: true, odsSaveAsPath: target })
    expect(existsSync(target)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('original-bytes')

    const result = await call(
      tab,
      IPC_CHANNELS.exportOds,
      exportOdsRequest(opened.sessionId, target),
    )
    expect(result).toEqual({
      canceled: false,
      path: target,
      sheets: 2,
      cells: 12,
      formulasDropped: 0,
      dropped: {
        charts: 0,
        images: 0,
        conditionalFormats: 0,
        validations: 0,
        pivots: 0,
        comments: 0,
      },
    })
    expect(readFileSync(target, 'utf8')).toBe(ODS_BYTES)
    // the conversion read the session's saved state, not the ODS target
    expect(convertOdsCalls).toHaveLength(1)
    expect(convertOdsCalls[0]!.path).not.toBe(target)
    // no warning was needed
    expect(messageBoxes).toHaveLength(0)

    // the tab is still the .xlsx session: its next Save writes the workbook
    const saved = (await call(
      tab,
      IPC_CHANNELS.saveWorkbook,
      saveRequest(opened.sessionId, 'save'),
    )) as { canceled: boolean; file?: { path: string } }
    expect(saved.canceled).toBe(false)
    expect(saved.file?.path).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe('original-bytes-saved')
    expect(readFileSync(target, 'utf8')).toBe(ODS_BYTES)
  })

  it('refuses a Save As ODS target no dialog returned for this tab', async () => {
    const path = writeWorkbook('Budget.xlsx')
    const tab = newTab()
    const other = newTab()
    const opened = await openWorkbook(tab, path)
    const otherOpened = await openWorkbook(other, writeWorkbook('Other.xlsx'))
    const target = join(dir, 'Budget.ods')
    saveDialogAnswers.push(target)
    await call(tab, IPC_CHANNELS.saveWorkbook, saveRequest(opened.sessionId, 'save-as'))

    await expect(
      call(other, IPC_CHANNELS.exportOds, exportOdsRequest(otherOpened.sessionId, target)),
    ).rejects.toThrow('export target was not authorized')
    expect(convertOdsCalls).toHaveLength(0)
    expect(existsSync(target)).toBe(false)
  })

  it('defaults the menu export to the workbook name and folder', async () => {
    const path = writeWorkbook('Budget.xlsx')
    const tab = newTab()
    const opened = await openWorkbook(tab, path)
    const target = join(dir, 'Budget.ods')
    saveDialogAnswers.push(target)

    await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

    expect(saveDialogs.at(-1)?.defaultPath).toBe(target)
    expect(saveDialogs.at(-1)?.filters?.map((filter) => filter.extensions)).toEqual([['ods']])
    expect(existsSync(target)).toBe(true)
  })

  it('defaults an untitled workbook to the untitled name', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'genoffice-sheets-ods-untitled-'))
    try {
      const backing = join(tempDir, 'New Spreadsheet.xlsx')
      writeFileSync(backing, 'blank')
      const suggested = join(dir, 'New Spreadsheet.xlsx')
      markSheetsUnsavedNew(backing, suggested, tempDir)
      const tab = newTab()
      queueWorkbookForView(tab as never, backing)
      const opened = (await call(tab, IPC_CHANNELS.selectWorkbook)) as { sessionId: string }
      const target = join(dir, 'New Spreadsheet.ods')
      saveDialogAnswers.push(target)

      await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

      expect(saveDialogs.at(-1)?.defaultPath).toBe(target)
      expect(existsSync(target)).toBe(true)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('warns only about the features this workbook loses, and cancel writes nothing', async () => {
    const path = writeWorkbook('Budget.xlsx')
    const tab = newTab()
    const opened = await openWorkbook(tab, path)
    const target = join(dir, 'Budget.ods')
    dropped.charts.value = 1
    dropped.comments.value = 2
    formulasDropped.value = 4
    saveDialogAnswers.push(target)
    messageAnswers.push(1)

    const canceled = await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

    expect(canceled).toEqual({ canceled: true, reason: 'canceled' })
    expect(existsSync(target)).toBe(false)
    const warning = messageBoxes.at(-1)
    expect(warning?.detail).toContain('Formulas kept as values only: 4')
    expect(warning?.detail).toContain('Charts: 1')
    expect(warning?.detail).toContain('Comments: 2')
    expect(warning?.detail).not.toContain('Images')
    expect(warning?.detail).not.toContain('Pivot tables')
    expect(warning?.buttons).toEqual(['Continue', 'Cancel'])

    // continuing writes the same target and asks nothing else
    saveDialogAnswers.push(target)
    messageAnswers.push(0)
    const exported = await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))
    expect((exported as { canceled: boolean }).canceled).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe(ODS_BYTES)
  })

  it('writes without a warning when nothing is dropped', async () => {
    const path = writeWorkbook('Budget.xlsx')
    const tab = newTab()
    const opened = await openWorkbook(tab, path)
    saveDialogAnswers.push(join(dir, 'Budget.ods'))

    await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

    expect(messageBoxes).toHaveLength(0)
  })

  it('never writes over the original .ods of a converted session', async () => {
    const original = join(dir, '보고서.ods')
    writeFileSync(original, Buffer.from('ods-original-bytes'))
    const tab = newTab()
    queueWorkbookForView(tab as never, original)
    const opened = (await call(tab, IPC_CHANNELS.selectWorkbook)) as { sessionId: string }

    // the first pick is the protected original in different case; the dialog comes back
    saveDialogAnswers.push(join(dir, '보고서.ODS'), join(dir, '보고서-copy.ods'))
    messageAnswers.push(0)

    const result = await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

    expect(saveDialogs).toHaveLength(2)
    expect(messageBoxes.at(-1)?.message).toMatch(/original ODS file/i)
    expect(readFileSync(original, 'utf8')).toBe('ods-original-bytes')
    expect((result as { canceled: boolean }).canceled).toBe(false)
    expect(readFileSync(join(dir, '보고서-copy.ods'), 'utf8')).toBe(ODS_BYTES)
    // the offered default avoided the original instead of pointing at it
    expect(basename(saveDialogs[0]!.defaultPath!)).toBe('보고서-2.ods')
  })

  it('refuses a password-protected workbook instead of writing plaintext', async () => {
    const secret = join(dir, 'Secret.xlsx')
    writeFileSync(secret, CFB_HEADER)
    const tab = newTab()
    const opened = await openWorkbook(tab, secret)

    const result = await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

    expect(result).toEqual({ canceled: true, reason: 'encrypted' })
    expect(messageBoxes.at(-1)?.message).toMatch(/password-protected/i)
    expect(convertOdsCalls).toHaveLength(0)
    expect(saveDialogs).toHaveLength(0)
    expect(readdirSync(dir)).toEqual(['Secret.xlsx'])
  })

  it('removes the target when the written ODS cannot be opened again', async () => {
    const path = writeWorkbook('Budget.xlsx')
    const tab = newTab()
    const opened = await openWorkbook(tab, path)
    const target = join(dir, 'Budget.ods')
    verify.fails = true
    saveDialogAnswers.push(target)

    const result = await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

    expect(result).toEqual({ canceled: true, reason: 'unreadable' })
    expect(existsSync(target)).toBe(false)
    expect(messageBoxes.at(-1)?.message).toMatch(/could not be opened again/i)
  })

  it('treats a read-back with no sheets as a broken export', async () => {
    const path = writeWorkbook('Budget.xlsx')
    const tab = newTab()
    const opened = await openWorkbook(tab, path)
    const target = join(dir, 'Budget.ods')
    verify.sheets = 0
    verify.cells = 0
    saveDialogAnswers.push(target)

    const result = await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

    expect(result).toEqual({ canceled: true, reason: 'unreadable' })
    expect(existsSync(target)).toBe(false)
  })

  it('exports a blank workbook: sheets with no cell values are valid', async () => {
    const path = writeWorkbook('Budget.xlsx')
    const tab = newTab()
    const opened = await openWorkbook(tab, path)
    const target = join(dir, 'Budget.ods')
    verify.sheets = 1
    verify.cells = 0
    saveDialogAnswers.push(target)

    const result = await call(tab, IPC_CHANNELS.exportOds, exportOdsRequest(opened.sessionId))

    expect(result).toMatchObject({ canceled: false, path: target })
    expect(existsSync(target)).toBe(true)
  })

  it('round-trips the ODS save pick through the save result schema', () => {
    expect(
      workbookSaveResultSchema.parse({ canceled: true, odsSaveAsPath: '/tmp/book.ods' }),
    ).toEqual({ canceled: true, odsSaveAsPath: '/tmp/book.ods' })
  })
})
