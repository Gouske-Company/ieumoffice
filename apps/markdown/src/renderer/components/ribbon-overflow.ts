import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * How the band steps down, in order; inside a rung the trailing entries go first.
 * `fold`: view tools move behind the More button. `label`: AI entries show their
 * icon alone. `tight`: groups close up their padding. `style`: the block style
 * box narrows. `aiFold`: AI presets move behind More.
 */
const RUNGS = ['fold', 'label', 'tight', 'style', 'aiFold'] as const
export type Rung = (typeof RUNGS)[number]

/** per rung, what each entry gives back in CSS px, in row order */
export type RungSavings = Readonly<Record<Rung, readonly number[]>>

/** per rung, how many entries are stepped down */
export type RibbonFold = Readonly<Record<Rung, number>>

export interface FoldInput {
  /** the band's content width with nothing stepped down and no More button */
  readonly fullWidth: number
  /** the More button with its gap, which comes in with the first step */
  readonly moreCost: number
  readonly savings: RungSavings
  readonly available: number
}

/** The fewest steps down the rungs that let the band fit. */
export function foldCount({ fullWidth, moreCost, savings, available }: FoldInput): number {
  if (fullWidth <= available) return 0
  const ladder = RUNGS.flatMap((r) => [...savings[r]].reverse().map((s) => Math.max(0, s)))
  let need = fullWidth + moreCost
  let k = 0
  while (k < ladder.length && need > available) {
    need -= ladder[k]!
    k++
  }
  return k
}

/** Which entries of each rung `level` steps down. */
export function foldAt(level: number, sizes: RibbonFold): RibbonFold {
  let rest = level
  const fold = {} as Record<Rung, number>
  for (const r of RUNGS) {
    fold[r] = Math.min(rest, sizes[r])
    rest -= fold[r]
  }
  return fold
}

/** Unfolding asks for this much spare room, so a borderline width cannot flip back and forth. */
const UNFOLD_SLACK = 8
/** first-fold estimate for the More button (an icon button); measured once it shows */
const MORE_WIDTH_GUESS = 32
/** first estimates for a stepped-down entry's width; measured once it shows */
const SHRUNK_GUESS: Record<'label' | 'style' | 'tight', (before: number) => number> = {
  label: () => 42,
  style: () => 72,
  tight: (before) => before / 2,
}

/** the horizontal padding and margins of the band and its direct children */
function bandSpacing(body: HTMLElement): number {
  const sides = (el: Element, a: 'padding' | 'margin') => {
    const s = getComputedStyle(el)
    return (parseFloat(s[`${a}Left`]) || 0) + (parseFloat(s[`${a}Right`]) || 0)
  }
  let total = sides(body, 'padding')
  for (const el of Array.from(body.children)) total += sides(el, 'padding') + sides(el, 'margin')
  return total
}

export interface FoldKeys {
  /** view tools in row order, the inline ones being the first children of `rowRef` */
  readonly fold: readonly string[]
  /** elements tagged `data-fold-key` that can drop their labels */
  readonly label: readonly string[]
  /** the element tagged `data-fold-key` whose box can narrow, if shown */
  readonly style: readonly string[]
  /** elements tagged `data-fold-key` that can move behind More */
  readonly aiFold: readonly string[]
}

/**
 * How far the ribbon steps down to fit its band, as a pure function of the
 * current width (the slides ribbon's responsive collapse, stepping down entries
 * instead of whole groups). `rowRef` holds the inline view tools in order, then
 * the More button (`.rb-more-wrap`) while anything is folded, then any controls
 * that never fold. Each entry's width is measured as laid out in both of its
 * states, so `resetKey` (the locale) starts over at the top.
 */
export function useRibbonFold(
  bodyRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
  keys: FoldKeys,
  resetKey: string,
): RibbonFold {
  const [level, setLevel] = useState(0)
  /** width per `rung:key`, as laid out before and after the step */
  const before = useRef(new Map<string, number>())
  const after = useRef(new Map<string, number>())
  const moreWidth = useRef(MORE_WIDTH_GUESS)
  const measuredFor = useRef(resetKey)
  const rungKeys: Record<Rung, readonly string[]> = { ...keys, tight: ['band'] }
  const keyList = RUNGS.map((r) => rungKeys[r].join(',')).join('|')
  const sizes = Object.fromEntries(RUNGS.map((r) => [r, rungKeys[r].length])) as RibbonFold
  const fold = foldAt(level, sizes)

  useLayoutEffect(() => {
    const body = bodyRef.current
    const row = rowRef.current
    if (!body || !row) return
    if (measuredFor.current !== resetKey) {
      measuredFor.current = resetKey
      before.current.clear()
      after.current.clear()
      if (level) {
        setLevel(0)
        return
      }
    }
    /** whether entry `i` of rung `r` is stepped down, the trailing ones first */
    const down = (r: Rung, i: number) => i >= sizes[r] - fold[r]
    const tagged = (k: string) => body.querySelector<HTMLElement>(`[data-fold-key="${k}"]`)
    const gapOf = (el: HTMLElement | null) =>
      el?.parentElement ? parseFloat(getComputedStyle(el.parentElement).columnGap) || 0 : 0
    const record = (id: string, isDown: boolean, width: number) =>
      (isDown ? after : before).current.set(id, width)

    const evaluate = () => {
      // a collapsed ribbon reads 0 everywhere and would poison the width cache
      if (!body.clientWidth) return
      const kids = Array.from(row.children) as HTMLElement[]
      rungKeys.fold.forEach((k, i) => {
        if (!down('fold', i) && kids[i])
          record(`fold:${k}`, false, kids[i]!.offsetWidth + gapOf(kids[i]!))
      })
      rungKeys.aiFold.forEach((k, i) => {
        const el = tagged(k)
        if (!down('aiFold', i) && el) record(`aiFold:${k}`, false, el.offsetWidth + gapOf(el))
      })
      // an entry behind More is not laid out in the band
      const inBand = (k: string) => !rungKeys.aiFold.some((a, i) => a === k && down('aiFold', i))
      for (const r of ['label', 'style'] as const) {
        rungKeys[r].forEach((k, i) => {
          const el = tagged(k)
          if (el && inBand(k)) record(`${r}:${k}`, down(r, i), el.offsetWidth)
        })
      }
      record('tight:band', down('tight', 0), bandSpacing(body))
      const more = row.querySelector<HTMLElement>(':scope > .rb-more-wrap')
      if (more) moreWidth.current = more.offsetWidth
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0

      const saving = (r: Rung, k: string) => {
        const was = before.current.get(`${r}:${k}`) ?? 0
        if (r === 'fold' || r === 'aiFold') return was
        return was - (after.current.get(`${r}:${k}`) ?? SHRUNK_GUESS[r](was))
      }
      const savings = Object.fromEntries(
        RUNGS.map((r) => [r, rungKeys[r].map((k) => saving(r, k))]),
      ) as Record<Rung, number[]>
      const moreCost = moreWidth.current + gap
      // the spacer soaks up the slack, so without it scrollWidth is the content
      const spacer = body.querySelector<HTMLElement>(':scope > .rb-spacer')
      let fullWidth = body.scrollWidth - (spacer?.offsetWidth ?? 0)
      if (more) fullWidth -= moreCost
      for (const r of RUNGS) {
        savings[r].forEach((s, i) => {
          if (down(r, i)) fullWidth += Math.max(0, s)
        })
      }
      const fit = (available: number) => foldCount({ fullWidth, moreCost, savings, available })
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
  }, [bodyRef, rowRef, keyList, resetKey, level])

  return fold
}
