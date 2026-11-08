import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Widths in CSS px, read from the laid-out ribbon. */
export interface FoldInput {
  /** the band's content width with every foldable item inline and no More button */
  readonly fullWidth: number
  /** foldable items in row order; the trailing ones fold first */
  readonly itemWidths: readonly number[]
  readonly moreWidth: number
  /** flex gap between items in the foldable row */
  readonly gap: number
  readonly available: number
}

/** The fewest trailing items whose move behind one More button lets the band fit. */
export function foldCount({ fullWidth, itemWidths, moreWidth, gap, available }: FoldInput): number {
  if (fullWidth <= available) return 0
  let need = fullWidth + moreWidth + gap
  let k = 0
  while (k < itemWidths.length && need > available) {
    need -= itemWidths[itemWidths.length - 1 - k]! + gap
    k++
  }
  return k
}

/** Unfolding asks for this much spare room, so a borderline width cannot flip back and forth. */
const UNFOLD_SLACK = 8
/** first-fold estimate for the More button (an icon button); measured once it shows */
const MORE_WIDTH_GUESS = 32

/**
 * How many trailing items of `rowRef` sit behind the More button, as a pure
 * function of the current width (the slides ribbon's responsive collapse,
 * folding items instead of whole groups). `rowRef` holds the inline items in
 * order, then the More button (`.rb-more-wrap`) while anything is folded.
 */
export function useRibbonFold(
  bodyRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
  keys: readonly string[],
): number {
  const [folded, setFolded] = useState(0)
  const widths = useRef(new Map<string, number>())
  const moreWidth = useRef(MORE_WIDTH_GUESS)
  const keyList = keys.join('|')
  const inlineCount = Math.max(0, keys.length - folded)

  useLayoutEffect(() => {
    const body = bodyRef.current
    const row = rowRef.current
    if (!body || !row) return
    const itemKeys = keyList ? keyList.split('|') : []
    const evaluate = () => {
      // a collapsed ribbon reads 0 everywhere and would poison the width cache
      if (!body.clientWidth) return
      const kids = Array.from(row.children) as HTMLElement[]
      for (let i = 0; i < inlineCount; i++) {
        const el = kids[i]
        if (el) widths.current.set(itemKeys[i]!, el.offsetWidth)
      }
      const more = row.querySelector<HTMLElement>(':scope > .rb-more-wrap')
      if (more) moreWidth.current = more.offsetWidth
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0
      const spacer = body.querySelector<HTMLElement>(':scope > .rb-spacer')
      // the spacer soaks up the slack, so without it scrollWidth is the content
      let fullWidth = body.scrollWidth - (spacer?.offsetWidth ?? 0)
      const itemWidths = itemKeys.map((k) => widths.current.get(k) ?? 0)
      if (more) fullWidth -= moreWidth.current + gap
      for (let i = inlineCount; i < itemKeys.length; i++) fullWidth += itemWidths[i]! + gap
      const fit = (available: number) =>
        foldCount({ fullWidth, itemWidths, moreWidth: moreWidth.current, gap, available })
      const must = fit(body.clientWidth)
      const next =
        must >= folded
          ? must
          : Math.min(Math.max(fit(body.clientWidth - UNFOLD_SLACK), must), folded)
      if (next !== folded) setFolded(next)
    }
    evaluate()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(evaluate)
    ro.observe(body)
    // groups change width without the band resizing (locale, a disabled state)
    body.querySelectorAll<HTMLElement>(':scope > .ribbon-group').forEach((g) => ro.observe(g))
    return () => ro.disconnect()
  }, [bodyRef, rowRef, keyList, folded, inlineCount])

  return Math.min(folded, keys.length)
}
