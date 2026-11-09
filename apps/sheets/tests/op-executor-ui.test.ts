import { describe, expect, it, vi } from 'vitest'

import { planFromOps, prefetchOpImages } from '../src/renderer/op-executor'
import { nextSheetName } from '../src/renderer/new-sheet-name'

const workbook = {
  getSheetBySheetId: (id: string) => (id === 'sh1' ? { getSheetName: () => 'Data' } : undefined),
} as unknown as Parameters<typeof planFromOps>[1]

describe('nextSheetName', () => {
  it('picks the lowest free SheetN, case-insensitively', () => {
    expect(nextSheetName([])).toBe('Sheet1')
    expect(nextSheetName(['Sheet1', 'sheet2', 'Data'])).toBe('Sheet3')
    expect(nextSheetName(['Sheet2'])).toBe('Sheet1')
  })
})

describe('planFromOps', () => {
  it('wraps ribbon-built ops into the plan shape the executor applies', () => {
    const plan = planFromOps(
      [
        { op: 'insert_rows', sheetId: 'sh1', row: 3, count: 1 },
        { op: 'set_freeze', sheetId: 'sh1', rows: 1, columns: 0 },
        { op: 'merge_cells', sheetId: 'sh1', range: 'A1:C1' },
        {
          op: 'format_range',
          sheetId: 'sh1',
          range: 'A1:C1',
          format: { horizontalAlign: 'center' },
        },
      ],
      workbook,
      'ribbon',
    )
    expect(plan.structuralChanges.map((change) => change.op.op)).toEqual([
      'insert_rows',
      'set_freeze',
      'merge_cells',
    ])
    expect(plan.formatChanges).toHaveLength(1)
    expect(plan.cellChanges).toHaveLength(0)
    expect(plan.transactionId).toMatch(/^ui-/)
  })
})

describe('prefetchOpImages', () => {
  it('reads a chat attachment through the attachment channel, not the local-file channel', async () => {
    const readAttachmentImage = vi.fn(async () => ({
      ok: true,
      base64: 'iVBORw0KGgoAAAAA',
      mime: 'image/png',
    }))
    const readLocalImage = vi.fn()
    vi.stubGlobal('window', { desktopApi: { readAttachmentImage, readLocalImage } })
    const savedImage = globalThis.Image
    class FakeImage {
      naturalWidth = 40
      naturalHeight = 20
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image
    try {
      const data = await prefetchOpImages([
        {
          op: 'add_image',
          sheetId: 's',
          path: 'C:/Users/me/Pictures/chart.png',
          attachment: 'chart.png',
          anchorCell: 'B2',
        },
      ])
      expect(readAttachmentImage).toHaveBeenCalledWith('C:/Users/me/Pictures/chart.png')
      expect(readLocalImage).not.toHaveBeenCalled()
      expect(data.get('C:/Users/me/Pictures/chart.png')).toMatchObject({
        mediaType: 'image/png',
        width: 40,
        height: 20,
      })
    } finally {
      globalThis.Image = savedImage
      vi.unstubAllGlobals()
    }
  })
})
