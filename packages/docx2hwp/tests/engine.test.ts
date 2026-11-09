import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { openDocumentCount } from '../src/engine'
import { HwpEngine, docxToHwp, type HwpFormat } from '../src/index'
import { FIXTURES } from './helpers/paths'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const sources = readdirSync(SRC).map((name) => ({
  name,
  text: readFileSync(`${SRC}/${name}`, 'utf8'),
}))

describe('package boundaries', () => {
  it('loads the engine in one module only', () => {
    const loading = sources.filter(
      ({ text }) =>
        /^import\s+(?!type\b)[^'"]*\sfrom\s+'@rhwp\/core'/m.test(text) ||
        /import\(\s*'@rhwp\/core'\s*\)/.test(text),
    )
    expect(loading.map((s) => s.name)).toEqual(['engine.ts'])
  })

  it('makes engine units in one module only', () => {
    const casting = sources.filter(({ text }) => /\bas (HwpUnit|ParaUnit|Rgb)\b/.test(text))
    expect(casting.map((s) => s.name)).toEqual(['units.ts'])
  })
})

describe('every engine document is freed', () => {
  let engine: HwpEngine
  let core: typeof import('@rhwp/core')
  const notice = () => new Uint8Array(readFileSync(`${FIXTURES}/notice.docx`))

  beforeAll(async () => {
    engine = await HwpEngine.start(
      readFileSync(createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')),
    )
    core = await import('@rhwp/core')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function frees(
    run: () => Promise<unknown>,
  ): Promise<{ freed: number; made: number; error: unknown }> {
    const free = vi.spyOn(core.HwpDocument.prototype, 'free')
    const made = vi.spyOn(core.HwpDocument, 'createEmpty')
    let error: unknown = null
    await run().catch((err) => (error = err))
    return { freed: free.mock.calls.length, made: made.mock.calls.length, error }
  }

  it.each(['hwpx', 'hwp'] as HwpFormat[])(
    'after a %s conversion: the new and the reopened document',
    async (format) => {
      const result = await frees(() => docxToHwp(notice(), format, engine))
      expect(result).toEqual({ freed: 2, made: 1, error: null })
      expect(openDocumentCount()).toBe(0)
    },
  )

  it('when the bytes are not a docx: no document was made', async () => {
    const result = await frees(() => docxToHwp(new Uint8Array([1, 2, 3]), 'hwpx', engine))
    expect(result).toMatchObject({ freed: 0, made: 0, error: { code: 'not-docx' } })
  })

  it('when the engine fails half way through writing', async () => {
    vi.spyOn(core.HwpDocument.prototype, 'insertText').mockImplementationOnce(() => {
      throw '렌더링 오류: forced'
    })
    const result = await frees(() => docxToHwp(notice(), 'hwpx', engine))
    expect(result).toMatchObject({ freed: 1, made: 1, error: { code: 'failed' } })
    expect(openDocumentCount()).toBe(0)
  })

  it('when the .hwp reads back with another page count', async () => {
    vi.spyOn(core.HwpDocument.prototype, 'exportHwpVerify').mockReturnValue(
      JSON.stringify({ bytesLen: 1, pageCountBefore: 2, pageCountAfter: 3, recovered: true }),
    )
    const result = await frees(() => docxToHwp(notice(), 'hwp', engine))
    expect(result).toMatchObject({ freed: 1, made: 1, error: { code: 'hwp-readback' } })
  })

  it('when the written file does not open again', async () => {
    vi.spyOn(core.HwpDocument.prototype, 'pageCount').mockReturnValue(0)
    const result = await frees(() => docxToHwp(notice(), 'hwpx', engine))
    expect(result).toMatchObject({ freed: 2, made: 1, error: { code: 'failed' } })
    expect(openDocumentCount()).toBe(0)
  })
})
