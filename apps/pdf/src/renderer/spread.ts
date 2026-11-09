/** Render rows for the page list: one page per row in single mode; pairs
    1+2, 3+4, … in two-page mode (mainstream default — WPS/Acrobat/Word pair
    from the first page; a separate-cover option can layer on later) */
export function spreadRows(visList: number[], spread: 1 | 2): number[][] {
  if (spread === 1) return visList.map((i) => [i])
  const out: number[][] = []
  for (let i = 0; i < visList.length; i += 2) out.push(visList.slice(i, i + 2))
  return out
}

/** Visible position → row index */
export function rowOfVisIdx(visIdx: number, spread: 1 | 2): number {
  return spread === 1 ? visIdx : Math.floor(visIdx / 2)
}

/** Arrow/thumbnail page stepping moves one whole row (a pair in two-page mode —
    stepping a single page inside a pair would not scroll and reads as a dead key).
    `page` is the 1-based visible page number; returns the row-first page to land on. */
export function stepPage(visList: number[], spread: 1 | 2, page: number, dir: 1 | -1): number {
  const rows = spreadRows(visList, spread)
  if (rows.length === 0) return page
  const cur = rowOfVisIdx(page - 1, spread)
  const target = Math.min(Math.max(0, cur + dir), rows.length - 1)
  return visList.indexOf(rows[target]![0]!) + 1
}

/** The reading spot carried across a single ↔ two-page switch (issue #404). The
    switch re-pairs the rows, so the same scrollTop lands about twice as far on
    (or half as far back); the spot is kept as a page instead of pixels.
    `visIdx` is the visible page at the viewport top, `frac` how far into its row
    the top sits, and `lead` the px of gap between the top and that row (a page
    jump parks the row half a gap below the top). */
export type SpreadAnchor = { visIdx: number; frac: number; lead: number }

/** Spot at `scrollTop` in the current layout. `rowHeights` are on-screen px and
    rows stack with a leading and inter-row `gap`. A top inside the gap belongs to
    the row below it, so a page parked by a jump is not read as the bottom of the
    page before. In two-page view the spot is the pair's first page. */
export function captureSpreadAnchor(args: {
  scrollTop: number
  rowHeights: number[]
  gap: number
  spread: 1 | 2
  pageCount: number
}): SpreadAnchor | null {
  const { scrollTop, rowHeights, gap, spread, pageCount } = args
  if (rowHeights.length === 0 || pageCount === 0) return null
  let top = gap
  let rowIdx = rowHeights.length - 1
  let frac = 1
  let lead = 0
  for (let i = 0; i < rowHeights.length; i++) {
    const height = rowHeights[i]!
    if (scrollTop < top) {
      rowIdx = i
      frac = 0
      lead = top - scrollTop
      break
    }
    if (scrollTop < top + height) {
      rowIdx = i
      frac = height > 0 ? (scrollTop - top) / height : 0
      break
    }
    top += height + gap
  }
  return { visIdx: Math.min(rowIdx * spread, pageCount - 1), frac, lead }
}

/** Where the previous switch left the view */
export type SpreadSwitch = { anchor: SpreadAnchor; spread: 1 | 2; scrollTop: number }

/** Spot to carry into the next switch. Switching straight back (the view has not
    moved since the last switch) reuses that switch's spot, so page 100 → pair
    99 + 100 → page 100 rather than 99, and a spot the document end clamped is not
    re-read from the clamped scroll. Otherwise the spot is read from the view. */
export function spreadSwitchAnchor(args: {
  last: SpreadSwitch | null
  scrollTop: number
  rowHeights: number[]
  gap: number
  spread: 1 | 2
  pageCount: number
}): SpreadAnchor | null {
  const { last, ...view } = args
  if (
    last &&
    last.spread === view.spread &&
    Math.abs(last.scrollTop - view.scrollTop) < 1 &&
    last.anchor.visIdx < view.pageCount
  ) {
    return last.anchor
  }
  return captureSpreadAnchor(view)
}

/** scrollTop that puts a captured spot back at the viewport top once the rows are
    laid out for `spread` (`rowHeights` on-screen px of that layout). */
export function spreadAnchorScrollTop(
  anchor: SpreadAnchor,
  rowHeights: number[],
  gap: number,
  spread: 1 | 2,
): number {
  if (rowHeights.length === 0) return 0
  const rowIdx = Math.min(rowOfVisIdx(anchor.visIdx, spread), rowHeights.length - 1)
  let top = gap
  for (let i = 0; i < rowIdx; i++) top += rowHeights[i]! + gap
  return Math.max(0, top + anchor.frac * rowHeights[rowIdx]! - anchor.lead)
}
