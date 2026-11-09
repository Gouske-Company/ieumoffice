/**
 * A row added to a page-filling table saves as .hwp and opens again as edited (rhwp patch 0042).
 *
 * Before the patch the edited document kept the lines after the table on its page, drawn below
 * the bottom, while the file it was about to write opened with them on the next page. The HWP
 * save check compared the two page counts and refused the save with "저장될 내용을 다시 읽어
 * 보니 화면의 문서와 달랐습니다" (a school newsletter, 0.12.12, 2026-11-09).
 *
 * The fixture is made by the engine: a 45×2 treat-as-char table and four closing lines that
 * just fit on one page, saved as .hwp.
 */
import { test, expect } from '@playwright/test'
import type { ElectronApplication, Frame, Page } from '@playwright/test'
import { copyFile, mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

const FULL_PAGE = join(__dirname, 'assets', 'hwp-full-page-table.hwp')
const STUDIO_IFRAME = '.hwp-editor-host iframe'

interface TabsApiOnWindow {
  aiOfficeTabs: {
    list(): Promise<{ id: string; kind: string }[]>
    close(id: string): Promise<void>
  }
  aiOffice: { openPath(path: string): Promise<unknown> }
}

interface StudioLike {
  plugins: {
    load(id: string): Promise<unknown>
    invoke(id: string, method: string, args: unknown[]): unknown
  }
  automation: {
    execute(id: string): unknown
    registerCommand(def: {
      id: string
      label: string
      execute(services: { wasm: { pageCount: number } }): void
    }): void
  }
}

async function shellPage(app: ElectronApplication): Promise<Page> {
  for (const candidate of app.windows()) {
    const has = await candidate
      .evaluate(() => typeof (window as { aiOfficeTabs?: unknown }).aiOfficeTabs === 'object')
      .catch(() => false)
    if (has) return candidate
  }
  throw new Error('no shell page')
}

async function hwpPage(app: ElectronApplication): Promise<Page> {
  const page = await waitForPageWithUrl(app, '://hwp/')
  await page.waitForSelector('.hwp-app[data-phase="ready"]', { timeout: 90_000 })
  await expect(page.frameLocator(STUDIO_IFRAME).locator('[data-cmd="ext:ieum-save"]')).toHaveCount(
    1,
  )
  return page
}

async function studioFrame(page: Page): Promise<Frame> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const frame = page.frames().find((f) => f.url().includes('/studio/'))
    if (frame) return frame
    if (Date.now() > deadline) throw new Error('studio frame never loaded')
    await page.waitForTimeout(100)
  }
}

/** The AI's table call (the panel's "표 3 · 행 1개 추가"), without an AI request. */
async function addRowAboveLast(frame: Frame, rows: number): Promise<unknown> {
  return frame.evaluate(async (at) => {
    const studio = (window as unknown as { rhwpStudio: StudioLike }).rhwpStudio
    await studio.plugins.load('ieum-agent')
    return studio.plugins.invoke('ieum-agent', 'addTableLines', [1, 'rows', at, 'before', 1])
  }, rows)
}

async function tableRows(frame: Frame): Promise<number> {
  return frame.evaluate(async () => {
    const studio = (window as unknown as { rhwpStudio: StudioLike }).rhwpStudio
    await studio.plugins.load('ieum-agent')
    const list = (await studio.plugins.invoke('ieum-agent', 'listTables', [])) as {
      tables: { rows: number }[]
    }
    return list.tables[0].rows
  })
}

async function pageCount(frame: Frame): Promise<number> {
  return frame.evaluate(() => {
    const studio = (window as unknown as { rhwpStudio: StudioLike }).rhwpStudio
    let count = -1
    studio.automation.registerCommand({
      id: 'ext:e2e-page-count',
      label: 'E2E page count',
      execute(services) {
        count = services.wasm.pageCount
      },
    })
    studio.automation.execute('ext:e2e-page-count')
    return count
  })
}

/** File > Save, as the editor's own menu sends it. */
async function save(page: Page): Promise<void> {
  await page.evaluate(() => {
    const frame = document.querySelector('.hwp-editor-host iframe') as HTMLIFrameElement | null
    frame?.contentWindow?.dispatchEvent(new CustomEvent('ieum:file-command', { detail: 'save' }))
  })
}

async function reopen(app: ElectronApplication, file: string): Promise<Page> {
  const shell = await shellPage(app)
  await shell.evaluate(async () => {
    const api = (window as unknown as TabsApiOnWindow).aiOfficeTabs
    const tab = (await api.list()).find((t) => t.kind === 'hwp')
    if (tab) await api.close(tab.id)
  })
  await expect
    .poll(
      () =>
        shell.evaluate(async () =>
          (await (window as unknown as TabsApiOnWindow).aiOfficeTabs.list()).some(
            (t) => t.kind === 'hwp',
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(false)
  await shell.evaluate(
    (path) => (window as unknown as TabsApiOnWindow).aiOffice.openPath(path),
    file,
  )
  return hwpPage(app)
}

test('a row added to a page-filling table saves as .hwp and opens again with the same pages', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'genoffice-hwp-row-insert-')), 'full-page.hwp')
  await copyFile(FULL_PAGE, file)
  const launched = await launchShell({
    onboardingSeen: true,
    lang: 'ko',
    openFile: file,
    videoDir: 'hwp-row-insert-save',
    recordVideo: false,
  })
  try {
    const page = await hwpPage(launched.app)
    const frame = await studioFrame(page)
    expect(await pageCount(frame)).toBe(1)

    expect(await addRowAboveLast(frame, 45)).toMatchObject({ ok: true, rows: 46 })
    // the last closing line goes to the next page in the editor
    await expect.poll(() => pageCount(frame)).toBe(2)

    const before = await readFile(file)
    const written = (await stat(file)).mtimeMs
    await save(page)
    await expect.poll(async () => (await stat(file)).mtimeMs, { timeout: 20_000 }).not.toBe(written)
    await expect(page.locator('.hwp-notice-error')).toHaveCount(0)
    expect(Buffer.compare(before, await readFile(file))).not.toBe(0)

    const reopened = await reopen(launched.app, file)
    const again = await studioFrame(reopened)
    expect(await tableRows(again)).toBe(46)
    expect(await pageCount(again)).toBe(2)
  } finally {
    await closeAndSaveVideo(launched, 'hwp-row-insert-save')
  }
})
