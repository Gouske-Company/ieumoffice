/**
 * "Export as HWP Document": the Word editor's own docx becomes a .hwp or
 * .hwpx copy through @genoffice/docx2hwp. The conversion is thousands of
 * engine calls, so it runs in a worker thread made for this one job and
 * terminated after it: the windows stay responsive, the engine's memory goes
 * back to the system, and a crashed engine leaves nothing behind.
 *
 * When the copy loses something the user confirms before anything is
 * written; cancel writes nothing (the ODT export asks the same way). The
 * steps are injected so the flow is tested without Electron.
 */
import type {
  Docx2HwpErrorCode,
  HwpConversion,
  HwpFormat,
  Loss,
  LossFeature,
} from '@genoffice/docx2hwp'
import { createI18n, type Lang } from '@genoffice/i18n'
import type { MessageBoxOptions } from 'electron'
import { HWP_EXPORT_STRINGS } from './hwp-export-strings'

export interface HwpExportJob {
  docx: Uint8Array
  format: HwpFormat
  wasmPath: string
}

export type HwpExportReply =
  | { ok: true; bytes: Uint8Array; losses: Loss[] }
  | { ok: false; code: Docx2HwpErrorCode; error: string }

/** the part of node:worker_threads' Worker used here */
export interface WorkerLike {
  on(event: 'message', listener: (reply: HwpExportReply) => void): unknown
  on(event: 'error', listener: (err: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  postMessage(job: HwpExportJob, transfer: ArrayBuffer[]): void
  terminate(): Promise<number>
}

/** a conversion the package refused, with the package's reason */
export class HwpExportFailure extends Error {
  constructor(
    readonly code: Docx2HwpErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'HwpExportFailure'
  }
}

/** One conversion in one worker, terminated on every path: answered, refused or crashed. */
export async function convertInWorker(
  job: HwpExportJob,
  spawn: () => WorkerLike,
): Promise<HwpConversion> {
  const worker = spawn()
  try {
    const reply = await new Promise<HwpExportReply>((resolve, reject) => {
      worker.on('message', resolve)
      worker.on('error', reject)
      worker.on('exit', (code) => reject(new Error(`the conversion stopped (exit code ${code})`)))
      // a Buffer can be a view into Node's shared pool: hand over a copy this side owns
      const docx = new Uint8Array(job.docx)
      worker.postMessage({ ...job, docx }, [docx.buffer])
    })
    if (!reply.ok) throw new HwpExportFailure(reply.code, reply.error)
    return { bytes: reply.bytes, losses: reply.losses }
  } finally {
    void worker.terminate()
  }
}

export type HwpExportOutcome =
  | { ok: true; path: string }
  | { ok: false; canceled: true }
  | { ok: false; code: Docx2HwpErrorCode | 'unauthorized'; error: string; path?: string }

export interface HwpExportSteps {
  /** a path sent by the renderer is written only if this tab was allowed to write it */
  authorized(path: string): boolean
  /** the export's own save dialog; null = canceled */
  pickPath(): Promise<{ path: string; format: HwpFormat } | null>
  /** puts lazily served pictures back into the docx */
  materialize(docx: Uint8Array): Promise<Uint8Array>
  convert(docx: Uint8Array, format: HwpFormat): Promise<HwpConversion>
  /** asked only when something is lost; false = canceled */
  confirm(losses: readonly Loss[], passwordDropped: boolean): Promise<boolean>
  /** false once the tab is gone: a closed tab's export writes nothing */
  stillOpen(): boolean
  write(path: string, bytes: Uint8Array): Promise<void>
  open(path: string): void
}

export interface HwpExportRequest {
  docx: Uint8Array
  /** the Save As pick, already authorized; absent = the export's own dialog */
  outPath?: string
  /** the document carries an open password: the copy does not */
  passwordSet: boolean
}

/** path → dialog → docx → Hangul → confirm (when something is lost) → write → open */
export async function exportHwp(
  steps: HwpExportSteps,
  request: HwpExportRequest,
): Promise<HwpExportOutcome> {
  let target: { path: string; format: HwpFormat } | null
  if (request.outPath !== undefined) {
    if (!steps.authorized(request.outPath)) {
      return { ok: false, code: 'unauthorized', error: 'export target is not an authorized path' }
    }
    target = { path: request.outPath, format: /\.hwpx$/i.test(request.outPath) ? 'hwpx' : 'hwp' }
  } else {
    target = await steps.pickPath()
    if (!target) return { ok: false, canceled: true }
  }
  try {
    const whole = await steps.materialize(request.docx)
    const { bytes, losses } = await steps.convert(whole, target.format)
    if (!steps.stillOpen()) return { ok: false, canceled: true }
    if (losses.length > 0 || request.passwordSet) {
      const save = await steps.confirm(losses, request.passwordSet)
      if (!save || !steps.stillOpen()) return { ok: false, canceled: true }
    }
    await steps.write(target.path, bytes)
    steps.open(target.path)
    return { ok: true, path: target.path }
  } catch (err) {
    return {
      ok: false,
      path: target.path,
      code: err instanceof HwpExportFailure ? err.code : 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const tHwp = createI18n(HWP_EXPORT_STRINGS)
type HwpKey = keyof (typeof HWP_EXPORT_STRINGS)['zh']

/** a name for every loss the package reports: a new feature fails the typecheck here */
const FEATURE_KEY = {
  comment: 'featComment',
  revision: 'featRevision',
  equation: 'featEquation',
  chart: 'featChart',
  shape: 'featShape',
  textbox: 'featTextbox',
  object: 'featObject',
  ink: 'featInk',
  watermark: 'featWatermark',
  hidden_text: 'featHiddenText',
  picture: 'featPicture',
  table: 'featTable',
  note: 'featNote',
  page_border: 'featPageBorder',
  para_border: 'featParaBorder',
  line_numbers: 'featLineNumbers',
  protection: 'featProtection',
  hyperlink: 'featHyperlink',
  section: 'featSection',
  columns: 'featColumns',
  header_variant: 'featHeaderVariant',
  header_content: 'featHeaderContent',
  floating_picture: 'featFloatingPicture',
  nested_table: 'featNestedTable',
  table_layout: 'featTableLayout',
  numbering: 'featNumbering',
  tab_stop: 'featTabStop',
  toc: 'featToc',
  field: 'featField',
  text_effect: 'featTextEffect',
  note_format: 'featNoteFormat',
  text_direction: 'featTextDirection',
  plain_paragraph: 'featPlainParagraph',
} as const satisfies Record<LossFeature, HwpKey>

/** The confirmation: what changes and what is left out, by feature. */
export function hwpLossMessageBox(
  losses: readonly Loss[],
  passwordDropped: boolean,
  lang: Lang,
): MessageBoxOptions {
  const t = (key: HwpKey) => tHwp(lang, key)
  const line = (name: string, count: number) => `• ${count > 1 ? `${name} (${count})` : name}`
  const of = (kind: Loss['kind']) =>
    losses.filter((l) => l.kind === kind).map((l) => line(t(FEATURE_KEY[l.feature]), l.count))
  const section = (heading: HwpKey, lines: string[]) =>
    lines.length > 0 ? [t(heading), ...lines].join('\n') : null
  const dropped = [...of('dropped'), ...(passwordDropped ? [line(t('featPassword'), 1)] : [])]
  return {
    type: 'warning',
    title: t('hwpExportTitle'),
    message: t('hwpConfirmMessage'),
    detail: [section('hwpChanges', of('changed')), section('hwpLeftOut', dropped)]
      .filter((part): part is string => part !== null)
      .join('\n\n'),
    buttons: [t('hwpSave'), t('hwpCancel')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
}
