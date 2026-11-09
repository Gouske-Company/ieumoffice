/**
 * The Hangul export's main-process flow without Electron: one worker per
 * conversion, terminated on every path; the path gate; the confirmation when
 * the copy loses something; nothing written on cancel or for a closed tab.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Loss } from '@genoffice/docx2hwp'
import {
  convertInWorker,
  exportHwp,
  hwpLossMessageBox,
  HwpExportFailure,
  type HwpExportJob,
  type HwpExportReply,
  type HwpExportSteps,
  type WorkerLike,
} from '../src/main/hwp-export'

type Event = 'message' | 'error' | 'exit'

/** a worker that does what the test says when the job arrives */
function fakeWorker(answer: (emit: (event: Event, value: unknown) => void) => void) {
  const listeners = new Map<Event, (value: unknown) => void>()
  const posted: Array<{ job: HwpExportJob; transfer: ArrayBuffer[] }> = []
  const worker = {
    on: (event: Event, listener: (value: never) => void) => {
      listeners.set(event, listener as (value: unknown) => void)
      return worker
    },
    postMessage: (job: HwpExportJob, transfer: ArrayBuffer[]) => {
      posted.push({ job, transfer })
      answer((event, value) => listeners.get(event)?.(value))
    },
    terminate: vi.fn(async () => 1),
  }
  return { worker: worker as unknown as WorkerLike & typeof worker, posted }
}

const job = (): HwpExportJob => ({
  docx: Buffer.from('docx bytes'),
  format: 'hwpx',
  wasmPath: '/w',
})
const reply = (r: HwpExportReply) => r

describe('one worker per conversion', () => {
  it('answers the converted bytes and losses, then the worker is ended', async () => {
    const losses: Loss[] = [{ feature: 'comment', kind: 'dropped', count: 2 }]
    const { worker, posted } = fakeWorker((emit) =>
      emit('message', reply({ ok: true, bytes: new Uint8Array([1, 2]), losses })),
    )
    const input = job()
    await expect(convertInWorker(input, () => worker)).resolves.toEqual({
      bytes: new Uint8Array([1, 2]),
      losses,
    })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    // the worker got a copy: the caller's buffer (maybe Node's shared pool) is still whole
    expect(posted[0].transfer[0]).toBe(posted[0].job.docx.buffer)
    expect(posted[0].transfer[0]).not.toBe(input.docx.buffer)
    expect(Buffer.from(input.docx).toString()).toBe('docx bytes')
  })

  it.each([
    [
      'refuses',
      (emit: (e: Event, v: unknown) => void) =>
        emit('message', reply({ ok: false, code: 'hwp-readback', error: 'pages' })),
    ],
    ['crashes', (emit: (e: Event, v: unknown) => void) => emit('error', new Error('wasm trap'))],
    ['exits without an answer', (emit: (e: Event, v: unknown) => void) => emit('exit', 1)],
  ])('ends the worker when it %s', async (_, answer) => {
    const { worker } = fakeWorker(answer)
    await expect(convertInWorker(job(), () => worker)).rejects.toThrow()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it("keeps the package's reason for a refusal", async () => {
    const { worker } = fakeWorker((emit) =>
      emit('message', reply({ ok: false, code: 'hwp-readback', error: 'pages' })),
    )
    const refused = await convertInWorker(job(), () => worker).catch((err) => err)
    expect(refused).toBeInstanceOf(HwpExportFailure)
    expect(refused.code).toBe('hwp-readback')
  })
})

describe('the export flow', () => {
  const hwp = new Uint8Array([9, 9])
  function steps(over: Partial<HwpExportSteps> = {}, losses: Loss[] = []) {
    const s = {
      authorized: vi.fn((path: string) => path.startsWith('/allowed/')),
      pickPath: vi.fn(async () => ({ path: '/picked/report.hwp', format: 'hwp' as const })),
      materialize: vi.fn(async (docx: Uint8Array) => docx),
      convert: vi.fn(async () => ({ bytes: hwp, losses })),
      confirm: vi.fn(async () => true),
      stillOpen: vi.fn(() => true),
      write: vi.fn(async () => {}),
      open: vi.fn(),
      ...over,
    }
    return s
  }
  const docx = new Uint8Array([1])

  it('writes and opens a copy that loses nothing without asking', async () => {
    const s = steps()
    expect(await exportHwp(s, { docx, outPath: '/allowed/a.hwpx', passwordSet: false })).toEqual({
      ok: true,
      path: '/allowed/a.hwpx',
    })
    expect(s.convert).toHaveBeenCalledWith(docx, 'hwpx')
    expect(s.confirm).not.toHaveBeenCalled()
    expect(s.write).toHaveBeenCalledWith('/allowed/a.hwpx', hwp)
    expect(s.open).toHaveBeenCalledWith('/allowed/a.hwpx')
  })

  it('refuses a path this tab was not allowed to write, before converting', async () => {
    const s = steps()
    expect(
      await exportHwp(s, { docx, outPath: '/elsewhere/a.hwp', passwordSet: false }),
    ).toMatchObject({
      ok: false,
      code: 'unauthorized',
    })
    expect(s.convert).not.toHaveBeenCalled()
    expect(s.pickPath).not.toHaveBeenCalled()
    expect(s.write).not.toHaveBeenCalled()
  })

  it('asks its own dialog without a path, and a cancel writes nothing', async () => {
    const s = steps()
    expect(await exportHwp(s, { docx, passwordSet: false })).toEqual({
      ok: true,
      path: '/picked/report.hwp',
    })
    expect(s.convert).toHaveBeenCalledWith(docx, 'hwp')
    const canceled = steps({ pickPath: vi.fn(async () => null) })
    expect(await exportHwp(canceled, { docx, passwordSet: false })).toEqual({
      ok: false,
      canceled: true,
    })
    expect(canceled.convert).not.toHaveBeenCalled()
  })

  it('asks before writing a copy that loses something; cancel writes nothing', async () => {
    const losses: Loss[] = [{ feature: 'hyperlink', kind: 'changed', count: 1 }]
    const s = steps({ confirm: vi.fn(async () => false) }, losses)
    expect(await exportHwp(s, { docx, outPath: '/allowed/a.hwp', passwordSet: false })).toEqual({
      ok: false,
      canceled: true,
    })
    expect(s.confirm).toHaveBeenCalledWith(losses, false)
    expect(s.write).not.toHaveBeenCalled()
    expect(s.open).not.toHaveBeenCalled()
  })

  it('asks about the open password the copy does not keep', async () => {
    const s = steps()
    expect(
      await exportHwp(s, { docx, outPath: '/allowed/a.hwp', passwordSet: true }),
    ).toMatchObject({ ok: true })
    expect(s.confirm).toHaveBeenCalledWith([], true)
  })

  it('writes nothing for a tab closed while it converted', async () => {
    const s = steps({ stillOpen: vi.fn(() => false) })
    expect(await exportHwp(s, { docx, outPath: '/allowed/a.hwp', passwordSet: false })).toEqual({
      ok: false,
      canceled: true,
    })
    expect(s.write).not.toHaveBeenCalled()
  })

  it('reports a .hwp that would not read back, so the user can choose .hwpx', async () => {
    const s = steps({
      convert: vi.fn(async () => {
        throw new HwpExportFailure('hwp-readback', 'pages differ')
      }),
    })
    expect(await exportHwp(s, { docx, outPath: '/allowed/a.hwp', passwordSet: false })).toEqual({
      ok: false,
      path: '/allowed/a.hwp',
      code: 'hwp-readback',
      error: 'pages differ',
    })
    expect(s.write).not.toHaveBeenCalled()
  })
})

describe('the confirmation box', () => {
  it('lists what changes and what is left out, with counts, and the password', () => {
    const box = hwpLossMessageBox(
      [
        { feature: 'comment', kind: 'dropped', count: 3 },
        { feature: 'hyperlink', kind: 'changed', count: 1 },
      ],
      true,
      'ko',
    )
    expect(box).toMatchObject({ buttons: ['저장', '취소'], defaultId: 0, cancelId: 1 })
    expect(box.detail).toBe(
      ['바뀌는 것', '• 하이퍼링크(글로만 남음)', '', '빠지는 것', '• 메모 (3)', '• 암호'].join(
        '\n',
      ),
    )
  })
})
