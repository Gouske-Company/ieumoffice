import { describe, expect, it } from 'vitest'
import { foldCount } from '../src/renderer/components/ribbon-overflow'

const base = { moreWidth: 32, gap: 2 }

describe('ribbon fold count', () => {
  it('folds nothing while the band fits', () => {
    expect(foldCount({ ...base, fullWidth: 1000, itemWidths: [30, 30, 30], available: 1000 })).toBe(
      0,
    )
  })

  it('folds the fewest trailing items that make room, More button included', () => {
    // 1100 + More (34) must come down to 1050: the last two (32 + 32) are not
    // enough, the 112px font box third from the end is
    const itemWidths = [30, 30, 112, 30, 30]
    expect(foldCount({ ...base, fullWidth: 1100, itemWidths, available: 1050 })).toBe(3)
    expect(foldCount({ ...base, fullWidth: 1100, itemWidths, available: 1070 })).toBe(2)
  })

  it('counts the More button it adds, so one narrow item is not traded for a wider button', () => {
    // one pixel over: folding the 10px item alone leaves the 32px button overflowing
    expect(foldCount({ ...base, fullWidth: 1001, itemWidths: [40, 10], available: 1000 })).toBe(2)
  })

  it('folds every item and lets the band scroll when even that is too wide', () => {
    expect(foldCount({ ...base, fullWidth: 2000, itemWidths: [30, 30], available: 1000 })).toBe(2)
  })
})
