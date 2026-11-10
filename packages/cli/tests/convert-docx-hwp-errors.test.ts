import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Docx2HwpError } from '@genoffice/docx2hwp'
import { run, tempDir } from './helpers'

/** The package's two answers this file cannot produce from a real document. */
const engine = vi.hoisted(() => ({ start: vi.fn(), convert: vi.fn() }))
vi.mock('@genoffice/docx2hwp', async (importOriginal) => {
  const real = await importOriginal<typeof import('@genoffice/docx2hwp')>()
  return { ...real, HwpEngine: { start: engine.start }, docxToHwp: engine.convert }
})

const NOTICE = fileURLToPath(new URL('../../docx2hwp/tests/fixtures/notice.docx', import.meta.url))

function notice(): { dir: string; input: string } {
  const dir = tempDir()
  const input = join(dir, 'notice.docx')
  copyFileSync(NOTICE, input)
  return { dir, input }
}

beforeEach(() => {
  engine.start.mockReset()
  engine.convert.mockReset()
})

describe('convert a Word document to Hangul when the engine refuses', () => {
  it('answers resource_limit when the engine cannot get its WebAssembly memory', async () => {
    engine.start.mockRejectedValue(
      new RangeError(
        'WebAssembly.instantiate(): Out of memory: Cannot allocate Wasm memory for new instance',
      ),
    )
    const { dir, input } = notice()
    const r = await run(['convert', input, '--to', 'hwpx', '--json'])
    expect(r.code).toBe(3)
    expect(r.json()).toMatchObject({
      error: 'resource_limit',
      detail: { reason: 'virtual_memory' },
    })
    expect(r.json().suggestion).toContain('ulimit -v')
    expect(existsSync(join(dir, 'notice.hwpx'))).toBe(false)
  })

  it('points a .hwp the engine cannot read back to --to hwpx', async () => {
    engine.start.mockResolvedValue({})
    engine.convert.mockRejectedValue(
      new Docx2HwpError('hwp-readback', 'the .hwp reads back with 3 pages instead of 2'),
    )
    const { dir, input } = notice()
    const r = await run(['convert', input, '--to', 'hwp', '--json'])
    expect(r.code).toBe(3)
    expect(r.json()).toMatchObject({
      error: 'conversion_failed',
      detail: { reason: 'hwp-readback' },
    })
    expect(r.json().message).toContain('3 pages instead of 2')
    expect(r.json().suggestion).toContain('--to hwpx')
    expect(existsSync(join(dir, 'notice.hwp'))).toBe(false)
  })
})
