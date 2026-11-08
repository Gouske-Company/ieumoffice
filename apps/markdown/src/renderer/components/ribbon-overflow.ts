import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** Widths in CSS px, read from the laid-out ribbon. */
export interface FoldInput {
  /** the band's content width with every item inline, every label shown and no More button */
  readonly fullWidth: number
  /** foldable items in row order; the trailing ones fold first */
  readonly itemWidths: readonly number[]
  readonly moreWidth: number
  /** flex gap between items in the foldable row */
  readonly gap: number
  /** what each labelled entry gives back as its icon alone, in row order; once every item is folded the trailing ones go first */
  readonly labelSavings: readonly number[]
  readonly available: number
}

/**
 * The fewest steps that let the band fit: first trailing items move behind one
 * More button, then trailing entries drop their labels.
 */
export function foldCount({
  fullWidth,
  itemWidths,
  moreWidth,
  gap,
  labelSavings,
  available,
}: FoldInput): number {
  if (fullWidth <= available) return 0
  const savings = [
    ...itemWidths.map((w) => w + gap).reverse(),
    ...labelSavings.map((s) => Math.max(0, s)).reverse(),
  ]
  let need = fullWidth + moreWidth + gap
  let k = 0
  while (k < savings.length && need > available) {
    need -= savings[k]!
    k++
  }
  return k
}

/** Unfolding asks for this much spare room, so a borderline width cannot flip back and forth. */
const UNFOLD_SLACK = 8
/** first-fold estimate for the More button (an icon button); measured once it shows */
const MORE_WIDTH_GUESS = 32
/** first estimate for a big button shown as its icon alone; measured once one shows */
const COMPACT_WIDTH_GUESS = 42

export interface RibbonFold {
  /** trailing items of the row that sit behind the More button */
  readonly folded: number
  /** trailing `compactKeys` drawn as their icon alone */
  readonly compacted: number
}

/**
 * How far the ribbon steps down to fit its band, as a pure function of the
 * current width (the slides ribbon's responsive collapse, folding items instead
 * of whole groups). First the trailing items of `rowRef` move behind the More
 * button: `rowRef` holds the inline items in order, then the More button
 * (`.rb-more-wrap`) while anything is folded, then any controls that never
 * fold. With all of them folded, the elements tagged `data-fold-key` with
 * `compactKeys` lose their labels, the trailing ones first. Widths are
 * measured as laid out, so `resetKey` (the locale) starts over unfolded.
 */
export function useRibbonFold(
  bodyRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
  keys: readonly string[],
  compactKeys: readonly string[],
  resetKey: string,
): RibbonFold {
  const [level, setLevel] = useState(0)
  const widths = useRef(new Map<string, number>())
  const labelled = useRef(new Map<string, number>())
  const compact = useRef(new Map<string, number>())
  const moreWidth = useRef(MORE_WIDTH_GUESS)
  const measuredFor = useRef(resetKey)
  const keyList = keys.join('|')
  const compactList = compactKeys.join('|')
  const folded = Math.min(level, keys.length)
  const compacted = Math.min(Math.max(0, level - keys.length), compactKeys.length)

  useLayoutEffect(() => {
    const body = bodyRef.current
    const row = rowRef.current
    if (!body || !row) return
    if (measuredFor.current !== resetKey) {
      measuredFor.current = resetKey
      widths.current.clear()
      labelled.current.clear()
      compact.current.clear()
      if (level) {
        setLevel(0)
        return
      }
    }
    const itemKeys = keyList ? keyList.split('|') : []
    const labelKeys = compactList ? compactList.split('|') : []
    const inlineCount = itemKeys.length - folded
    const firstCompact = labelKeys.length - compacted
    const evaluate = () => {
      // a collapsed ribbon reads 0 everywhere and would poison the width cache
      if (!body.clientWidth) return
      const kids = Array.from(row.children) as HTMLElement[]
      for (let i = 0; i < inlineCount; i++) {
        const el = kids[i]
        if (el) widths.current.set(itemKeys[i]!, el.offsetWidth)
      }
      labelKeys.forEach((k, i) => {
        const el = body.querySelector<HTMLElement>(`[data-fold-key="${k}"]`)
        if (el) (i < firstCompact ? labelled : compact).current.set(k, el.offsetWidth)
      })
      const more = row.querySelector<HTMLElement>(':scope > .rb-more-wrap')
      if (more) moreWidth.current = more.offsetWidth
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0
      const spacer = body.querySelector<HTMLElement>(':scope > .rb-spacer')
      const itemWidths = itemKeys.map((k) => widths.current.get(k) ?? 0)
      const labelSavings = labelKeys.map(
        (k) => (labelled.current.get(k) ?? 0) - (compact.current.get(k) ?? COMPACT_WIDTH_GUESS),
      )
      // the spacer soaks up the slack, so without it scrollWidth is the content
      let fullWidth = body.scrollWidth - (spacer?.offsetWidth ?? 0)
      if (more) fullWidth -= moreWidth.current + gap
      for (let i = inlineCount; i < itemKeys.length; i++) fullWidth += itemWidths[i]! + gap
      for (let i = firstCompact; i < labelKeys.length; i++) fullWidth += labelSavings[i]!
      const fit = (available: number) =>
        foldCount({
          fullWidth,
          itemWidths,
          moreWidth: moreWidth.current,
          gap,
          labelSavings,
          available,
        })
      const must = fit(body.clientWidth)
      const next =
        must >= level ? must : Math.min(Math.max(fit(body.clientWidth - UNFOLD_SLACK), must), level)
      if (next !== level) setLevel(next)
    }
    evaluate()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(evaluate)
    ro.observe(body)
    // groups change width without the band resizing (a disabled state)
    body.querySelectorAll<HTMLElement>(':scope > .ribbon-group').forEach((g) => ro.observe(g))
    return () => ro.disconnect()
  }, [bodyRef, rowRef, keyList, compactList, resetKey, level, folded, compacted])

  return { folded, compacted }
}
