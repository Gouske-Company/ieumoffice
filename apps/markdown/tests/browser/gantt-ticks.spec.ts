import { expect, test } from '@playwright/test'
import { openSource } from './helpers'

const GANTT = [
  '```mermaid',
  'gantt',
  '  title Plan',
  '  dateFormat YYYY-MM-DD',
  '  section A',
  '  One :2026-03-01, 8d',
  '  Two :2026-03-09, 8d',
  '```',
  '',
].join('\n')

// boxes whose drawing width (32px of padding less) leaves little or no axis between
// mermaid's two 75px side paddings: a side panel at its widest, or a zoomed-in page
for (const box of [120, 136, 152, 169, 201]) {
  test(`a gantt in a ${box}px box keeps its date labels apart`, async ({ page }) => {
    await page.addInitScript((box) => {
      const style = document.createElement('style')
      // the preview box is the code block less its 1px border
      style.textContent = `.md-codeblock.md-diagram { width: ${box + 2}px; }`
      // in before the editor mounts, so the first drawing is already at the narrow box
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style))
    }, box)
    await openSource(page, false, false, `# Plan\n\n${GANTT}`)
    const svg = page.locator('.md-diagram-preview svg[aria-roledescription="gantt"]')
    await expect(svg).toHaveCount(1)
    const layout = await svg.evaluate((el) => {
      const labels = [...el.querySelectorAll(':scope > g.grid g.tick text')]
        .map((text) => text.getBoundingClientRect())
        .filter((rect) => rect.width > 0)
        .sort((a, b) => a.left - b.left)
      let overlapping = 0
      for (let i = 1; i < labels.length; i++)
        if (labels[i]!.left < labels[i - 1]!.right) overlapping++
      return {
        box: el.closest('.md-diagram-preview')!.clientWidth,
        labels: labels.length,
        overlapping,
        width: Number(el.getAttribute('width')),
      }
    })
    expect(layout.box).toBe(box)
    expect(layout.labels).toBeGreaterThan(1)
    expect(layout.overlapping).toBe(0)
    expect(layout.width).toBeGreaterThanOrEqual(box)
  })
}
