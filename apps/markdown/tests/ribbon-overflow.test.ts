import { describe, expect, it } from 'vitest'
import { foldCount } from '../src/renderer/components/ribbon-overflow'

const base = { moreWidth: 32, gap: 2, labelSavings: [] }

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

describe('ribbon labels', () => {
  // two view tools (32 each with the gap), then AI entries that give back 40, 90 and 60
  const ribbon = { ...base, itemWidths: [30, 30], labelSavings: [40, 90, 60] }

  it('keeps every label while folding the view tools makes room', () => {
    // 1050 + More (34) - 64 = 1020
    expect(foldCount({ ...ribbon, fullWidth: 1050, available: 1020 })).toBe(2)
  })

  it('drops labels only after every view tool is folded, the trailing entry first', () => {
    // 1020 after the view tools, the last entry's 60 brings it to 960
    expect(foldCount({ ...ribbon, fullWidth: 1050, available: 1000 })).toBe(3)
    expect(foldCount({ ...ribbon, fullWidth: 1050, available: 960 })).toBe(3)
    // then the 90 one: 870
    expect(foldCount({ ...ribbon, fullWidth: 1050, available: 900 })).toBe(4)
  })

  it('compacts every entry when nothing less fits', () => {
    expect(foldCount({ ...ribbon, fullWidth: 1050, available: 500 })).toBe(5)
  })
})
