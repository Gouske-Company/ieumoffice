import { describe, expect, it } from 'vitest'
import { foldAt, foldCount, type RungSavings } from '../src/renderer/components/ribbon-overflow'

const none: RungSavings = { fold: [], label: [], tight: [], style: [], aiFold: [] }
const base = { moreCost: 34, savings: none }

/** view tools that give back their width plus the row's 2px gap */
const tools = (...widths: number[]) => widths.map((w) => w + 2)

describe('ribbon fold count', () => {
  it('folds nothing while the band fits', () => {
    const savings = { ...none, fold: tools(30, 30, 30) }
    expect(foldCount({ ...base, savings, fullWidth: 1000, available: 1000 })).toBe(0)
  })

  it('folds the fewest trailing items that make room, More button included', () => {
    // 1100 + More (34) must come down to 1050: the last two (32 + 32) are not
    // enough, the 112px font box third from the end is
    const savings = { ...none, fold: tools(30, 30, 112, 30, 30) }
    expect(foldCount({ ...base, savings, fullWidth: 1100, available: 1050 })).toBe(3)
    expect(foldCount({ ...base, savings, fullWidth: 1100, available: 1070 })).toBe(2)
  })

  it('counts the More button it adds, so one narrow item is not traded for a wider button', () => {
    // one pixel over: folding the 10px item alone leaves the 32px button overflowing
    const savings = { ...none, fold: tools(40, 10) }
    expect(foldCount({ ...base, savings, fullWidth: 1001, available: 1000 })).toBe(2)
  })

  it('takes every step and lets the band scroll when even that is too wide', () => {
    const savings = { ...none, fold: tools(30, 30) }
    expect(foldCount({ ...base, savings, fullWidth: 2000, available: 1000 })).toBe(2)
  })
})

describe('ribbon labels', () => {
  // two view tools (32 each with the gap), then AI entries that give back 40, 90 and 60
  const savings = { ...none, fold: tools(30, 30), label: [40, 90, 60] }

  it('keeps every label while folding the view tools makes room', () => {
    // 1050 + More (34) - 64 = 1020
    expect(foldCount({ ...base, savings, fullWidth: 1050, available: 1020 })).toBe(2)
  })

  it('drops labels only after every view tool is folded, the trailing entry first', () => {
    // 1020 after the view tools, the last entry's 60 brings it to 960
    expect(foldCount({ ...base, savings, fullWidth: 1050, available: 1000 })).toBe(3)
    expect(foldCount({ ...base, savings, fullWidth: 1050, available: 960 })).toBe(3)
    // then the 90 one: 870
    expect(foldCount({ ...base, savings, fullWidth: 1050, available: 900 })).toBe(4)
  })

  it('compacts every entry when nothing less fits', () => {
    expect(foldCount({ ...base, savings, fullWidth: 1050, available: 830 })).toBe(5)
  })
})

describe('ribbon below the labels', () => {
  // measured ko band at 720px before this step: 920 with every view tool folded
  // and every AI label gone; spacing gives back 72, the style box 36, and each
  // AI preset 44 with its gap
  const savings: RungSavings = {
    fold: tools(28, 28, 28, 28, 112, 28, 28, 28, 28),
    label: [60, 30, 30, 30, 50],
    tight: [72],
    style: [36],
    aiFold: [44, 44, 44, 44],
  }
  const folded = savings.fold.reduce((a, b) => a + b, 0) - 34
  const unlabelled = savings.label.reduce((a, b) => a + b, 0)
  const fullWidth = 920 + folded + unlabelled
  const sizes = { fold: 9, label: 5, tight: 1, style: 1, aiFold: 4 }
  const at = (available: number) =>
    foldAt(foldCount({ moreCost: 34, savings, fullWidth, available }), sizes)

  it('closes up the spacing first, then narrows the style box', () => {
    expect(at(900)).toEqual({ fold: 9, label: 5, tight: 1, style: 0, aiFold: 0 })
    expect(at(820)).toEqual({ fold: 9, label: 5, tight: 1, style: 1, aiFold: 0 })
  })

  it('moves the AI presets behind More last, the trailing one first', () => {
    // 812 after spacing and the style box; one preset makes 768, three make 680
    expect(at(800)).toEqual({ fold: 9, label: 5, tight: 1, style: 1, aiFold: 1 })
    expect(at(704)).toEqual({ fold: 9, label: 5, tight: 1, style: 1, aiFold: 3 })
  })

  it('stops at every step taken when even that is too wide', () => {
    expect(at(400)).toEqual(sizes)
  })

  it('reads an unfolded band as no step taken', () => {
    expect(foldAt(0, sizes)).toEqual({ fold: 0, label: 0, tight: 0, style: 0, aiFold: 0 })
  })
})
