import { parseDocx } from '@genoffice/docx-engine'
import type { HwpDocument } from '@rhwp/core'
import { call, exportDocument, withNewDocument, withOpenedDocument, type HwpEngine } from './engine'
import { lowerDocument } from './lower'
import { LossLedger, type Loss } from './losses'
import { writePlan } from './write'

export type HwpFormat = 'hwp' | 'hwpx'

export interface HwpConversion {
  /** a file the engine has opened again */
  readonly bytes: Uint8Array
  /** what the copy does not carry, in a fixed order; empty when nothing was lost */
  readonly losses: Loss[]
}

export type Docx2HwpErrorCode =
  /** the bytes are not a Word document docx-engine reads */
  | 'not-docx'
  /** .hwp only: the engine reading its own .hwp back lays it out differently */
  | 'hwp-readback'
  | 'failed'

export class Docx2HwpError extends Error {
  constructor(
    readonly code: Docx2HwpErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'Docx2HwpError'
  }
}

/** Word document bytes (lazily served pictures already put back) to a Hangul document. */
export function docxToHwp(
  docx: Uint8Array,
  format: HwpFormat,
  engine: HwpEngine,
): Promise<HwpConversion> {
  return convert(docx, format, engine, { batch: true })
}

/** docxToHwp with the writing strategy chosen: tests and measurements compare them */
export async function convert(
  docx: Uint8Array,
  format: HwpFormat,
  engine: HwpEngine,
  options: { batch: boolean; sectionChunk?: number },
): Promise<HwpConversion> {
  let parsed: Awaited<ReturnType<typeof parseDocx>>
  try {
    parsed = await parseDocx(docx)
  } catch (err) {
    throw new Docx2HwpError('not-docx', messageOf(err), { cause: err })
  }
  const ledger = new LossLedger()
  const plan = lowerDocument(parsed, ledger)
  try {
    const bytes = withNewDocument(engine, (doc) => {
      const write = () => writePlan(doc, plan, ledger, options.sectionChunk)
      if (options.batch) inBatch(doc, write)
      else write()
      if (format === 'hwp') assertHwpReadsBack(doc)
      const out = exportDocument(doc, format)
      for (let i = 0; i < out.contentLoss; i++) ledger.note('object', `engine${i}`)
      return out.bytes
    })
    withOpenedDocument(engine, bytes, (back) => {
      if (back.pageCount() < 1) throw new Docx2HwpError('failed', 'the written file has no pages')
    })
    return { bytes, losses: ledger.list() }
  } catch (err) {
    if (err instanceof Docx2HwpError) throw err
    throw new Docx2HwpError('failed', messageOf(err), { cause: err })
  }
}

/** the engine lays the document out once at the end instead of after every call */
function inBatch(doc: HwpDocument, write: () => void): void {
  call('batch', () => doc.beginBatch())
  try {
    write()
  } finally {
    call('batch', () => doc.endBatch())
  }
}

/**
 * The Hangul editor's .hwp save rule: the engine writes the .hwp, reads it
 * back and must find the same page count.
 */
function assertHwpReadsBack(doc: HwpDocument): void {
  const verify = call<{ recovered?: boolean; pageCountBefore?: number; pageCountAfter?: number }>(
    'hwp verify',
    () => doc.exportHwpVerify(),
  )
  if (!verify.recovered || verify.pageCountBefore !== verify.pageCountAfter) {
    throw new Docx2HwpError(
      'hwp-readback',
      `the .hwp reads back with ${verify.pageCountAfter} pages instead of ${verify.pageCountBefore}`,
    )
  }
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))
