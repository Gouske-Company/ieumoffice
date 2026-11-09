/**
 * The rhwp engine, and the only module that loads it. A document lives only
 * inside withNewDocument / withOpenedDocument and is freed when the callback
 * returns or throws: the engine's WebAssembly memory is never released on its
 * own.
 */
import type { HwpDocument } from '@rhwp/core'

type EngineModule = typeof import('@rhwp/core')

const modules = new WeakMap<HwpEngine, EngineModule>()
let liveDocuments = 0

/** An initialized engine in this JavaScript realm. */
export class HwpEngine {
  private constructor() {}

  static async start(wasm: Uint8Array): Promise<HwpEngine> {
    const mod = await import('@rhwp/core')
    // the bytes are handed over: left to itself the engine fetches its wasm by URL
    await mod.default({ module_or_path: wasm })
    const engine = new HwpEngine()
    modules.set(engine, mod)
    return engine
  }
}

function moduleOf(engine: HwpEngine): EngineModule {
  const mod = modules.get(engine)
  if (!mod) throw new Error('HwpEngine.start was not called')
  return mod
}

function owned<R>(make: () => HwpDocument, use: (doc: HwpDocument) => R): R {
  const doc = make()
  liveDocuments++
  try {
    return use(doc)
  } finally {
    doc.free()
    liveDocuments--
  }
}

/** a blank Hangul document from the engine's own template */
export function withNewDocument<R>(engine: HwpEngine, use: (doc: HwpDocument) => R): R {
  const mod = moduleOf(engine)
  return owned(() => {
    const doc = mod.HwpDocument.createEmpty()
    try {
      doc.createBlankDocument()
    } catch (err) {
      doc.free()
      throw engineError('blank document', err)
    }
    return doc
  }, use)
}

export function withOpenedDocument<R>(
  engine: HwpEngine,
  bytes: Uint8Array,
  use: (doc: HwpDocument) => R,
): R {
  const mod = moduleOf(engine)
  return owned(() => {
    try {
      return new mod.HwpDocument(bytes)
    } catch (err) {
      throw engineError('open', err)
    }
  }, use)
}

/** documents created and not yet freed: zero between conversions */
export const openDocumentCount = (): number => liveDocuments

/** the engine's bytes for the document, and how many items its writer reported lost */
export function exportDocument(
  doc: HwpDocument,
  format: 'hwp' | 'hwpx',
): { bytes: Uint8Array; contentLoss: number } {
  const out = format === 'hwp' ? doc.exportHwpWithReport() : doc.exportHwpxWithReport()
  try {
    const report = JSON.parse(out.contentLoss()) as { count?: number }
    return { bytes: out.takeBytes(), contentLoss: report.count ?? 0 }
  } finally {
    out.free()
  }
}

/** An engine call that answered { ok: false } or threw. */
export class EngineCallError extends Error {
  constructor(
    readonly what: string,
    detail: string,
  ) {
    super(`${what}: ${detail}`)
    this.name = 'EngineCallError'
  }
}

function engineError(what: string, thrown: unknown): EngineCallError {
  return new EngineCallError(what, thrown instanceof Error ? thrown.message : String(thrown))
}

/** runs an engine call that answers JSON; a refusal becomes an EngineCallError */
export function call<T = Record<string, unknown>>(what: string, run: () => string): T {
  let answer: string
  try {
    answer = run()
  } catch (err) {
    throw engineError(what, err)
  }
  const parsed = JSON.parse(answer) as T & { ok?: boolean; error?: string }
  if (parsed && typeof parsed === 'object' && parsed.ok === false) {
    throw new EngineCallError(what, parsed.error ?? answer)
  }
  return parsed
}

/** runs an engine call that answers a number */
export function callNumber(what: string, run: () => number): number {
  try {
    return run()
  } catch (err) {
    throw engineError(what, err)
  }
}
