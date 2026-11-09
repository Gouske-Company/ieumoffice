/**
 * Issue #404: switching between single and two-page view kept scrollTop, so the
 * re-paired rows put the viewport about twice as far on (page 100 → ~200) and,
 * going back, half as far (→ ~50). The spot is now carried as a page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  captureSpreadAnchor,
  rowOfVisIdx,
  spreadAnchorScrollTop,
  spreadRows,
  spreadSwitchAnchor,
} from '../src/renderer/spread'
import type { SpreadSwitch } from '../src/renderer/spread'

const GAP = 16
const PAGE_H = 1000
const PAGES = 300

/** on-screen row heights and row tops for equal pages, as App.tsx lays them out */
function layout(spread: 1 | 2, pageCount = PAGES) {
  const visList = Array.from({ length: pageCount }, (_, i) => i)
  const heights = spreadRows(visList, spread).map(() => PAGE_H)
  const rowTop = (r: number) => GAP + r * (PAGE_H + GAP)
  return { heights, rowTop }
}

/** scrollTop that scrollToPage gives a 1-based page */
const jumpTo = (page: number, spread: 1 | 2) =>
  layout(spread).rowTop(rowOfVisIdx(page - 1, spread)) - GAP / 2

/** visible 1-based page of the row at the viewport top, as the page counter reads it */
function pageAtTop(scrollTop: number, spread: 1 | 2): number {
  const { heights, rowTop } = layout(spread)
  let row = 0
  for (let r = 0; r < heights.length; r++) if (rowTop(r) - GAP <= scrollTop) row = r
  return row * spread + 1
}

/** one button press as App.tsx does it; `maxScrollTop` stands in for the browser clamp */
function switchView(
  scrollTop: number,
  from: 1 | 2,
  to: 1 | 2,
  last: SpreadSwitch | null = null,
  maxScrollTop = Infinity,
) {
  const anchor = spreadSwitchAnchor({
    last,
    scrollTop,
    rowHeights: layout(from).heights,
    gap: GAP,
    spread: from,
    pageCount: PAGES,
  })
  expect(anchor).not.toBeNull()
  const landed = Math.min(spreadAnchorScrollTop(anchor!, layout(to).heights, GAP, to), maxScrollTop)
  return {
    anchor: anchor!,
    scrollTop: landed,
    last: { anchor: anchor!, spread: to, scrollTop: landed },
  }
}

describe('single ↔ two-page switch keeps the page (issue #404)', () => {
  it('lands on the pair holding page 100, not page ~200', () => {
    const { scrollTop } = switchView(jumpTo(100, 1), 1, 2)
    expect(pageAtTop(scrollTop, 2)).toBe(99) // the pair 99 + 100
    // and exactly where a page jump to that pair would have put it
    expect(scrollTop).toBe(jumpTo(100, 2))
  })

  it('the old behaviour (same scrollTop) is what went wrong', () => {
    expect(pageAtTop(jumpTo(100, 1), 2)).toBeGreaterThan(190)
    expect(pageAtTop(jumpTo(99, 2), 1)).toBeLessThan(60)
  })

  it('goes back to page 100 rather than page ~50', () => {
    const there = switchView(jumpTo(100, 1), 1, 2)
    const back = switchView(there.scrollTop, 2, 1, there.last)
    expect(pageAtTop(back.scrollTop, 1)).toBe(100)
    expect(back.scrollTop).toBe(jumpTo(100, 1))
  })

  it('after scrolling in two-page view, single view starts at the top pair’s first page', () => {
    const there = switchView(jumpTo(100, 1), 1, 2)
    const { scrollTop } = switchView(jumpTo(151, 2), 2, 1, there.last)
    expect(pageAtTop(scrollTop, 1)).toBe(151)
  })

  it('returns to the last page even when the document end clamped the two-page view', () => {
    const { heights, rowTop } = layout(2)
    // a viewport taller than a pair, so the last pair cannot reach the top
    const end = rowTop(heights.length - 1) + PAGE_H + GAP - 1500
    const there = switchView(jumpTo(299, 1), 1, 2, null, end)
    expect(there.scrollTop).toBe(end)
    // read from the clamped view, the spot would be the pair before (297 + 298)
    expect(pageAtTop(end, 2)).toBe(297)
    const back = switchView(there.scrollTop, 2, 1, there.last)
    expect(pageAtTop(back.scrollTop, 1)).toBe(299)
  })

  it('keeps the position inside the page', () => {
    const { heights, rowTop } = layout(1)
    const inside = rowTop(99) + 0.25 * heights[99]!
    const { anchor, scrollTop } = switchView(inside, 1, 2)
    expect(anchor).toEqual({ visIdx: 99, frac: 0.25, lead: 0 })
    expect(scrollTop).toBe(layout(2).rowTop(49) + 0.25 * PAGE_H)
  })

  it('handles the top, the end and an odd trailing page', () => {
    expect(switchView(0, 1, 2).scrollTop).toBe(0)
    const last = switchView(jumpTo(PAGES, 1), 1, 2)
    expect(pageAtTop(last.scrollTop, 2)).toBe(PAGES - 1)
    const odd = captureSpreadAnchor({
      scrollTop: 1e9,
      rowHeights: layout(2, 5).heights,
      gap: GAP,
      spread: 2,
      pageCount: 5,
    })
    expect(odd?.visIdx).toBe(4)
    expect(
      captureSpreadAnchor({ scrollTop: 0, rowHeights: [], gap: GAP, spread: 1, pageCount: 0 }),
    ).toBeNull()
  })
})

describe('App.tsx wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

  it('changes the page layout only through applyViewMode', () => {
    // the two-page and side-by-side buttons both re-pair the rows
    expect(src.match(/\bsetSpread\(/g)).toHaveLength(1)
    expect(src).toMatch(/applyViewMode\(toggleSpread\(/)
    expect(src).toMatch(/applyViewMode\(toggleBilingual\(/)
  })
})
