import { describe, expect, it } from 'vitest'
import { LossLedger } from '../src/losses'
import {
  fillOf,
  highlightOf,
  hwpFromHalfPoints,
  hwpFromPx,
  hwpFromTwips,
  paraFromTwips,
  percentFromAutoLine,
  ratioPercent,
  rgbOf,
  spacingPercent,
} from '../src/units'

describe('units', () => {
  it('converts one point of each Word unit to the engine units', () => {
    expect(hwpFromTwips(20)).toBe(100)
    expect(paraFromTwips(20)).toBe(200)
    expect(hwpFromHalfPoints(2)).toBe(100)
    // 96 px are one inch, 7200 HWPUNIT
    expect(hwpFromPx(96)).toBe(7200)
    // A4 width, 11906 twips
    expect(hwpFromTwips(11906)).toBe(59530)
  })

  it('draws Word single spacing as Hangul 160 percent', () => {
    expect(percentFromAutoLine(240)).toBe(160)
    expect(percentFromAutoLine(360)).toBe(240)
  })

  it('turns character spacing into a percent of the size, inside Hangul range', () => {
    // 1 pt of spacing on 10 pt text
    expect(spacingPercent(20, 20)).toBe(10)
    expect(spacingPercent(-400, 20)).toBe(-50)
    expect(spacingPercent(0, 20)).toBe(0)
    expect(ratioPercent(undefined)).toBe(100)
    expect(ratioPercent(300)).toBe(200)
  })

  it('reads Word colours, with auto and junk falling back', () => {
    expect(rgbOf('C00000', '#000000')).toBe('#c00000')
    expect(rgbOf('auto', '#000000')).toBe('#000000')
    expect(rgbOf(undefined, '#ffffff')).toBe('#ffffff')
    expect(fillOf('D9E2F3')).toBe('#d9e2f3')
    expect(fillOf('auto')).toBeNull()
    expect(highlightOf('yellow')).toBe('#ffff00')
    expect(highlightOf('none')).toBeNull()
  })
})

describe('LossLedger', () => {
  it('counts each object once, in table order, leaving out what never happened', () => {
    const ledger = new LossLedger()
    ledger.note('hyperlink', 'b3')
    ledger.note('comment', 'c1')
    ledger.note('hyperlink', 'b3')
    ledger.note('hyperlink', 'b7')
    ledger.note('comment', 'c2')
    expect(ledger.list()).toEqual([
      { feature: 'comment', kind: 'dropped', count: 2 },
      { feature: 'hyperlink', kind: 'changed', count: 2 },
    ])
  })

  it('is empty for a conversion that lost nothing', () => {
    expect(new LossLedger().list()).toEqual([])
  })
})
