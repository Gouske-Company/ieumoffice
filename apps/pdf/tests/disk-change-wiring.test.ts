// @vitest-environment node
/**
 * Issue #405 through the real main-process handlers and a real folder watch:
 * another program's write reaches the view as `changed`, a deletion as
 * `missing`, and the view's own save in place never does.
 */
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

type IpcHandler = (event: { sender: unknown }, ...args: unknown[]) => unknown
const handlers = new Map<string, IpcHandler>()

interface FakeWebContents {
  id: number
  sent: { channel: string; payload: unknown }[]
  destroyed: boolean
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  send: (channel: string, payload: unknown) => void
  isDestroyed: () => boolean
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  listeners: Map<string, () => void>
}

let nextWcId = 1

function makeFakeWebContents(): FakeWebContents {
  const listeners = new Map<string, () => void>()
  const wc: FakeWebContents = {
    id: nextWcId++,
    sent: [],
    destroyed: false,
    listeners,
    once: vi.fn((event: string, handler: () => void) => {
      listeners.set(event, handler)
    }),
    on: vi.fn((event: string, handler: () => void) => {
      listeners.set(event, handler)
    }),
    send: (channel, payload) => {
      wc.sent.push({ channel, payload })
    },
    isDestroyed: () => wc.destroyed,
    setWindowOpenHandler: vi.fn(),
    loadURL: vi.fn(),
  }
  return wc
}

vi.mock('electron', () => ({
  app: { on: vi.fn(), whenReady: vi.fn(() => new Promise(() => {})) },
  dialog: { showMessageBox: vi.fn() },
  shell: {},
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
  },
  WebContentsView: class {
    webContents = makeFakeWebContents()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: IpcHandler) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn(),
  },
}))

import { createPdfView } from '../src/main/pdf-main'
import { PDF_CHANNELS } from '../src/shared/ipc'
import type { SavePdfResult } from '../src/shared/ipc'

const tempDirs = new Set<string>()
const views: FakeWebContents[] = []

async function pdfBytes(label: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  doc.setTitle(label)
  return Buffer.from(await doc.save())
}

afterEach(() => {
  // the destroyed handler closes the folder watch before its folder goes
  for (const wc of views) wc.listeners.get('destroyed')?.()
  views.length = 0
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  tempDirs.clear()
})

/** a view that read its file and asked to watch it, as the renderer does after loading */
async function watchedView(): Promise<{ wc: FakeWebContents; path: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-disk-change-'))
  tempDirs.add(dir)
  const path = join(dir, 'document.pdf')
  writeFileSync(path, await pdfBytes('original'))
  const wc = createPdfView(path).webContents as unknown as FakeWebContents
  views.push(wc)
  await handlers.get(PDF_CHANNELS.readFile)!({ sender: wc }, path)
  expect(await handlers.get(PDF_CHANNELS.watchDiskFile)!({ sender: wc }, path)).toBe(true)
  return { wc, path }
}

const changes = (wc: FakeWebContents) =>
  wc.sent.filter((s) => s.channel === PDF_CHANNELS.diskFileChanged).map((s) => s.payload)

async function waitFor(check: () => boolean, ms = 8000): Promise<void> {
  const until = Date.now() + ms
  while (!check() && Date.now() < until) await new Promise((r) => setTimeout(r, 50))
}

describe('the open PDF changed on disk (issue #405)', () => {
  it('tells the view once another program has written the file', async () => {
    const { wc, path } = await watchedView()
    writeFileSync(path, await pdfBytes('changed elsewhere'))
    await waitFor(() => changes(wc).length > 0)
    expect(changes(wc)).toEqual([{ path, kind: 'changed' }])
  })

  it('tells the view when the file is deleted', async () => {
    const { wc, path } = await watchedView()
    unlinkSync(path)
    await waitFor(() => changes(wc).length > 0)
    expect(changes(wc)).toEqual([{ path, kind: 'missing' }])
  })

  it('says nothing about the view’s own save in place', async () => {
    const { wc, path } = await watchedView()
    const saved = (await handlers.get(PDF_CHANNELS.save)!(
      { sender: wc },
      { path, markups: [], drawings: [], formValues: [], stamps: [] },
    )) as SavePdfResult
    expect(saved).toMatchObject({ ok: true })
    // longer than the settle time twice over and the stability check
    await new Promise((r) => setTimeout(r, 2000))
    expect(changes(wc)).toEqual([])
  })

  it('refuses a path that was not granted to the view', async () => {
    const { wc } = await watchedView()
    expect(
      await handlers.get(PDF_CHANNELS.watchDiskFile)!({ sender: wc }, join(tmpdir(), 'other.pdf')),
    ).toBe(false)
  })
})
