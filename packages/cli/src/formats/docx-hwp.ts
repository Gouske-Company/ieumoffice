import { readFileSync } from 'node:fs'
import {
  Docx2HwpError,
  HwpEngine,
  docxToHwp,
  type HwpFormat,
  type Loss,
  type LossFeature,
} from '@genoffice/docx2hwp'
import type { CommandContext } from '../registry'
import { rhwpWasmPath } from '../resources'
import { CliError, EXIT } from '../result'

/**
 * Word (.docx) to Hangul (.hwp / .hwpx) through @genoffice/docx2hwp, the
 * converter the Word editor's "Export as HWP Document" runs. The app runs it in
 * a worker so its windows stay responsive; a command is its own process, so it
 * runs here.
 */

/**
 * A name for every loss the package reports, worded as the Word editor's
 * English confirmation names them: a new feature fails the typecheck here.
 */
export const FEATURE_LABEL: Record<LossFeature, string> = {
  comment: 'Comments',
  revision: 'Tracked changes',
  equation: 'Equations',
  chart: 'Charts',
  shape: 'Shapes',
  textbox: 'Text boxes',
  object: 'Other objects',
  ink: 'Ink',
  watermark: 'Watermark',
  hidden_text: 'Hidden text',
  picture: 'Pictures that could not be read',
  table: 'Tables that could not be carried over',
  note: 'Footnotes and endnotes in tables or headers',
  page_border: 'Page borders',
  para_border: 'Paragraph borders and shading',
  line_numbers: 'Line numbers',
  protection: 'Editing restrictions and read-only recommendation',
  hyperlink: 'Hyperlinks (kept as plain text)',
  section: 'Section breaks (one section)',
  columns: 'Columns',
  header_variant: 'First-page and even-page headers and footers',
  header_content: 'Pictures and tables in headers and footers',
  floating_picture: 'Picture position and effects (placed in line)',
  nested_table: 'Tables inside tables (as paragraphs)',
  table_layout: 'Table position and border styles',
  numbering: 'Numbering styles',
  tab_stop: 'Tab stops',
  toc: 'Table of contents',
  field: 'Fields (kept as their result text)',
  text_effect: 'Text effects',
  note_format: 'Character formatting in footnotes and endnotes',
  text_direction: 'Vertical text',
  plain_paragraph: 'Paragraphs kept as plain text',
}

let engine: Promise<HwpEngine> | null = null

/** one engine per process; a failed start is retried by the next command */
function startEngine(): Promise<HwpEngine> {
  if (!engine) {
    // a packaged CLI has no node_modules: the wasm is read from where resources.ts finds it
    const starting = HwpEngine.start(readFileSync(rhwpWasmPath()))
    engine = starting
    starting.catch(() => {
      if (engine === starting) engine = null
    })
  }
  return engine
}

/**
 * The Hangul bytes and the loss report. Each loss is also a warning
 * (`hwp_dropped` / `hwp_changed`), the way an ODT conversion reports its own.
 */
export async function docxToHangul(
  docx: Uint8Array,
  format: HwpFormat,
  ctx: Pick<CommandContext, 'warn'>,
): Promise<{ bytes: Uint8Array; hwp_report: Loss[] }> {
  let conversion
  try {
    conversion = await docxToHwp(docx, format, await startEngine())
  } catch (err) {
    throw refusal(err) ?? err
  }
  for (const { feature, kind, count } of conversion.losses) {
    const what = `${FEATURE_LABEL[feature]} (${feature}, ${count})`
    ctx.warn(
      kind === 'dropped'
        ? { code: 'hwp_dropped', message: `left out of the .${format} file: ${what}` }
        : { code: 'hwp_changed', message: `changed in the .${format} file: ${what}` },
    )
  }
  return { bytes: conversion.bytes, hwp_report: conversion.losses }
}

/**
 * The package's refusals a caller can act on. Everything else, an engine that
 * could not get its WebAssembly memory included, goes on to runCli, which
 * answers it once for every command (src/wasm.ts).
 */
function refusal(err: unknown): CliError | null {
  if (!(err instanceof Docx2HwpError)) return null
  if (err.code === 'hwp-readback') {
    return new CliError(
      EXIT.conversion,
      err.message,
      { reason: err.code },
      {
        suggestion: 'convert with --to hwpx instead',
      },
    )
  }
  if (err.code === 'not-docx') {
    return new CliError(
      EXIT.conversion,
      `not a Word document the engine can read: ${err.message}`,
      { reason: err.code },
      {
        suggestion:
          'open the file in Word, save it as .docx without a password, and convert that copy',
      },
    )
  }
  return null
}
