/**
 * `convert <xlsx|xlsm> --to ods` calls the sidecar's `convert_to_ods` and
 * reports the dropped-feature counts. The sidecar is a stub; the input and
 * output files are real. The legacy `ods → xlsx` route must keep working.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import { run, tempDir } from './helpers'

const fake = vi.hoisted(() => ({
  ods: [] as { path: string; targetPath: string }[],
  converted: [] as { path: string; targetPath: string }[],
  fail: false,
  result: {
    sheets: 2,
    cells: 12,
    formulasDropped: 0,
    dropped: {
      charts: 0,
      images: 0,
      conditionalFormats: 0,
      validations: 0,
      pivots: 0,
      comments: 0,
    },
  },
}))

vi.mock('../src/resources', async (original) => ({
  ...(await original<object>()),
  xlsxSidecarPath: () => 'fake-sidecar',
}))

vi.mock('../../../apps/sheets/src/main/xlsx-sidecar-client', () => ({
  XlsxSidecarClient: class {
    async convertToOds(input: { path: string; targetPath: string }) {
      fake.ods.push(input)
      if (fake.fail) throw new Error('writer failed')
      writeFileSync(input.targetPath, 'ods-bytes')
      return fake.result
    }
    async convertWorkbook(input: { path: string; targetPath: string }) {
      fake.converted.push(input)
      writeFileSync(input.targetPath, 'converted-xlsx')
      return { sheets: 2, cells: 10 }
    }
    stop() {}
  },
}))

const env = { ...process.env, GENOFFICE_AUDIT_LOG: 'off' }

beforeEach(() => {
  fake.ods.length = 0
  fake.converted.length = 0
  fake.fail = false
  fake.result = {
    sheets: 2,
    cells: 12,
    formulasDropped: 0,
    dropped: {
      charts: 0,
      images: 0,
      conditionalFormats: 0,
      validations: 0,
      pivots: 0,
      comments: 0,
    },
  }
})

for (const ext of ['xlsx', 'xlsm']) {
  it(`converts .${ext} to ods through the sidecar and reports the counts`, async () => {
    const input = join(tempDir(), `보고서.${ext}`)
    writeFileSync(input, 'workbook-bytes')
    const output = join(dirname(input), '보고서.ods')

    const r = await run(['convert', input, '--to', 'ods', '--json'], { env })

    expect(r.code, r.stdout).toBe(0)
    expect(r.json().output_path).toBe(output)
    expect(fake.ods).toEqual([{ path: input, targetPath: output }])
    expect(r.json().detail).toEqual({
      sheets: 2,
      cells: 12,
      formulas_dropped: 0,
      dropped: {
        charts: 0,
        images: 0,
        conditionalFormats: 0,
        validations: 0,
        pivots: 0,
        comments: 0,
      },
    })
    expect(r.json().warnings).toBeUndefined()
    expect(readFileSync(output, 'utf8')).toBe('ods-bytes')
    expect(readFileSync(input, 'utf8')).toBe('workbook-bytes')
  })
}

it('warns about the features the ODS copy leaves out', async () => {
  fake.result = {
    sheets: 1,
    cells: 4,
    formulasDropped: 3,
    dropped: {
      charts: 1,
      images: 0,
      conditionalFormats: 2,
      validations: 0,
      pivots: 0,
      comments: 5,
    },
  }
  const input = join(tempDir(), 'book.xlsx')
  writeFileSync(input, 'workbook-bytes')

  const r = await run(['convert', input, '--to', 'ods', '--out', join(dirname(input), 'out.ods')], {
    env,
  })

  expect(r.code, r.stdout).toBe(0)
  expect(r.stdout).toContain('warning: the ODS copy leaves out')
  expect(r.stdout).toContain('3 formula(s) kept as values')
  expect(r.stdout).toContain('1 charts')
  expect(r.stdout).toContain('2 conditional formatting rule(s)')
  expect(r.stdout).toContain('5 comments')
})

it('keeps the legacy .ods → .xlsx route', async () => {
  const input = join(tempDir(), 'legacy.ods')
  writeFileSync(input, 'ods-fixture')
  const output = join(dirname(input), 'legacy.xlsx')

  const r = await run(['convert', input, '--to', 'xlsx', '--json'], { env })

  expect(r.code, r.stdout).toBe(0)
  expect(fake.converted).toEqual([{ path: input, targetPath: output }])
  expect(fake.ods).toHaveLength(0)
  expect(r.json().detail).toEqual({ sheets: 2, cells: 10 })
  expect(readFileSync(output, 'utf8')).toBe('converted-xlsx')
})

it('leaves no output behind when the writer fails', async () => {
  fake.fail = true
  const input = join(tempDir(), 'book.xlsx')
  writeFileSync(input, 'workbook-bytes')
  const output = join(dirname(input), 'out.ods')

  const r = await run(['convert', input, '--to', 'ods', '--out', output, '--json'], { env })

  expect(r.code).toBe(3)
  expect(r.json().error).toBe('conversion_failed')
  expect(existsSync(output)).toBe(false)
})
