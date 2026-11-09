/**
 * PDF Converter › PDF to HWP (decision 0116): the PDF opens in a new, untitled Hangul tab,
 * whose editor imports it with its own PDF import dialog. The PDF file is left alone.
 */
import { test, expect } from '@playwright/test'
import type { Frame, Page } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { closeAndSaveVideo, launchShell, waitForPageWithUrl } from './helpers'

async function studioFrame(hwp: Page): Promise<Frame> {
  const deadline = Date.now() + 60_000
  for (;;) {
    const frame = hwp.frames().find((f) => f.url().includes('/studio/'))
    if (frame) return frame
    if (Date.now() > deadline) throw new Error('studio frame did not load')
    await hwp.waitForTimeout(200)
  }
}

test('PDF to HWP imports the PDF into a new untitled Hangul tab', async () => {
  test.setTimeout(240_000)
  const dir = await mkdtemp(join(tmpdir(), 'genoffice-hwp-pdf-import-'))
  const pdfPath = join(dir, 'Field notes.pdf')
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([595, 842]).drawText('Imported from a PDF page', { x: 72, y: 760, size: 14, font })
  await writeFile(pdfPath, await doc.save({ useObjectStreams: false }))
  const original = await readFile(pdfPath)

  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'hwp-pdf-import',
    openFile: pdfPath,
  })
  try {
    const pdf = await waitForPageWithUrl(launched.app, '://pdf/')
    await expect(pdf.locator('.pdf-thumb')).toHaveCount(1)
    await pdf.getByRole('button', { name: 'PDF Converter' }).click()
    await pdf.getByRole('menuitem', { name: 'PDF to HWP', exact: true }).click()

    const hwp = await waitForPageWithUrl(launched.app, '://hwp/')
    const studio = await studioFrame(hwp)
    // the editor's own import dialog asks first
    const importButton = studio.locator('.dialog-btn-primary', { hasText: '가져오기' })
    await expect(importButton).toBeVisible({ timeout: 90_000 })
    await importButton.click()

    await expect
      .poll(
        async () =>
          JSON.stringify(
            await studio
              .evaluate(async () => {
                const host = window as unknown as {
                  rhwpStudio: {
                    plugins: { invoke(id: string, name: string, args: unknown[]): unknown }
                  }
                }
                return host.rhwpStudio.plugins.invoke('ieum-agent', 'readText', [])
              })
              .catch(() => null),
          ),
        { timeout: 120_000 },
      )
      .toContain('Imported from a PDF page')

    // a new document named after the PDF, with no file until its first save
    const titles = launched.page.locator('.tab-bar .tab-item:not(.tab-home) .tab-title')
    await expect(titles).toHaveText(['Field notes.pdf', 'Field notes'])
    expect(Buffer.compare(await readFile(pdfPath), original)).toBe(0)
  } finally {
    await closeAndSaveVideo(launched, 'hwp-pdf-import')
  }
})
