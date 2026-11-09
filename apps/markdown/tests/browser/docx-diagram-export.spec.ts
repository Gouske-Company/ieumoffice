import { expect, test, type Page } from '@playwright/test'
import JSZip from 'jszip'
import { parseDocx } from '@genoffice/docx-engine'
import { docxToOdt } from '@genoffice/odt-engine'
import { openSource } from './helpers'

// a journey draws its labels as <foreignObject> by default, and a state diagram's
// viewBox carries an exponent-form origin (9.5367431640625e-7)
const DIAGRAMS = [
  '```mermaid',
  'journey',
  '  title My working day',
  '  section Go to work',
  '    Make tea: 5: Me',
  '    Go upstairs: 3: Me',
  '```',
  '',
  '```mermaid',
  'stateDiagram-v2',
  '  [*] --> Still',
  '  Still --> [*]',
  '  Still --> Moving',
  '  Moving --> Still',
  '  Moving --> Crash',
  '  Crash --> [*]',
  '```',
  '',
].join('\n')

async function exportBytes(page: Page, format: 'docx' | 'odt'): Promise<Uint8Array> {
  await openSource(page, false, false, `# Diagrams\n\n${DIAGRAMS}`)
  await page.evaluate((format) => {
    const keep = async (request: { base64: string }) => {
      document.body.dataset.exported = request.base64
      return { ok: true as const, path: `/export/diagrams.${format}` }
    }
    window.markdownApi.exportDocx = keep
    window.markdownApi.exportOdt = keep
    window.dispatchEvent(new CustomEvent('test:export', { detail: format }))
  }, format)
  await expect(page.locator('body')).toHaveAttribute('data-exported', /.+/, { timeout: 20_000 })
  const base64 = await page.locator('body').getAttribute('data-exported')
  return new Uint8Array(Buffer.from(base64!, 'base64'))
}

test('journey and state diagrams land in the docx as pictures', async ({ page }) => {
  const parsed = await parseDocx(await exportBytes(page, 'docx'))
  const images = parsed.blocks.filter((b) => b.type === 'image')
  expect(images.map((b) => b.imageDataUrl?.slice(0, 22))).toEqual([
    'data:image/png;base64,',
    'data:image/png;base64,',
  ])
  for (const image of images) {
    expect(image.imageWidthPx).toBeGreaterThan(50)
    expect(image.imageHeightPx).toBeGreaterThan(50)
  }
  const text = parsed.blocks.map((b) => (b.runs ?? []).map((r) => r.text).join('')).join('\n')
  expect(text).not.toContain('journey')
  expect(text).not.toContain('stateDiagram-v2')
})

test('journey and state diagrams land in the odt as pictures', async ({ page }) => {
  // the main process turns the same Word bytes into the ODT
  const { odtBytes } = await docxToOdt(await exportBytes(page, 'odt'))
  const zip = await JSZip.loadAsync(odtBytes)
  const pictures = Object.keys(zip.files).filter((name) => /^Pictures\/.+/.test(name))
  expect(pictures).toHaveLength(2)
  const content = await zip.file('content.xml')!.async('string')
  expect(content.match(/<draw:image\b/g)).toHaveLength(2)
  expect(content).not.toContain('stateDiagram-v2')
})

test('journey labels are drawn as dark SVG text, not on white or the box fill', async ({
  page,
}) => {
  await openSource(page, false, false, `# Diagrams\n\n${DIAGRAMS}`)
  const journey = page.locator('.md-diagram-preview svg[aria-roledescription="journey"]')
  await expect(journey).toHaveCount(1)
  const labels = await journey.evaluate((svg) => ({
    foreignObjects: svg.querySelectorAll('foreignObject').length,
    fills: [...svg.querySelectorAll('text.task, text.journey-section')].map(
      (text) => `${text.textContent}:${getComputedStyle(text).fill}`,
    ),
  }))
  expect(labels).toEqual({
    foreignObjects: 0,
    fills: [
      'Go to work:rgb(51, 51, 51)',
      'Make tea:rgb(51, 51, 51)',
      'Go upstairs:rgb(51, 51, 51)',
    ],
  })
})
