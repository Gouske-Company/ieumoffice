/**
 * One Hangul export in a worker thread of its own (see hwp-export.ts): it
 * answers once and is terminated by the main process.
 */
import { readFileSync } from 'node:fs'
import { parentPort } from 'node:worker_threads'
import { Docx2HwpError, HwpEngine, docxToHwp } from '@genoffice/docx2hwp'
import type { HwpExportJob, HwpExportReply } from './hwp-export'

parentPort?.once('message', async (job: HwpExportJob) => {
  let reply: HwpExportReply
  try {
    const engine = await HwpEngine.start(readFileSync(job.wasmPath))
    const { bytes, losses } = await docxToHwp(job.docx, job.format, engine)
    reply = { ok: true, bytes, losses }
  } catch (err) {
    reply = {
      ok: false,
      code: err instanceof Docx2HwpError ? err.code : 'failed',
      error: err instanceof Error ? err.message : String(err),
    }
  }
  parentPort?.postMessage(reply, reply.ok ? [reply.bytes.buffer as ArrayBuffer] : [])
})
