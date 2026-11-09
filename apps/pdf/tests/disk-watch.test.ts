import { describe, expect, it } from 'vitest'
import {
  DISK_WATCH_MAX_WAITS,
  endsLikeWholePdf,
  watchDiskFile,
  type DiskBaseline,
  type DiskChangeKind,
  type DiskWatchDeps,
} from '../src/main/disk-watch'

const enc = new TextEncoder()
const pdf = (body: string) => enc.encode(`%PDF-1.7\n${body}\n%%EOF\n`)
const hashOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** A fake folder with one file, manual timers and a write lock the test sets */
function harness(initial: Uint8Array | null, options: { caseInsensitive?: boolean } = {}) {
  let file: { bytes: Uint8Array; mtimeMs: number } | null = initial
    ? { bytes: initial, mtimeMs: 1 }
    : null
  let clock = 1
  let listener: ((filename: string | null) => void) | null = null
  let watchedDir = ''
  let closed = false
  let timer: { fn: () => void } | null = null
  let ownWrite = false
  let locked = false
  const reports: DiskChangeKind[] = []
  const deps: DiskWatchDeps = {
    watchDir(dir, onEvent) {
      watchedDir = dir
      listener = onEvent
      return { close: () => (closed = true) }
    },
    stat: async () => (file ? { mtimeMs: file.mtimeMs, size: file.bytes.length } : null),
    read: async () => (file && !locked ? file.bytes : null),
    hash: hashOf,
    setTimer: (fn) => (timer = { fn }),
    clearTimer: (handle) => {
      if (timer === handle) timer = null
    },
    ownWriteInFlight: () => ownWrite,
    settleMs: 400,
    caseInsensitive: options.caseInsensitive ?? false,
  }
  const baseline = (): DiskBaseline | null =>
    file ? { mtimeMs: file.mtimeMs, size: file.bytes.length, hash: hashOf(file.bytes) } : null
  return {
    deps,
    reports,
    baseline,
    get watchedDir() {
      return watchedDir
    },
    get closed() {
      return closed
    },
    get pending() {
      return timer !== null
    },
    setOwnWrite: (on: boolean) => (ownWrite = on),
    setLocked: (on: boolean) => (locked = on),
    /** another program writes; fires one folder event per call */
    write(bytes: Uint8Array, name: string | null = 'doc.pdf') {
      clock += 1
      file = { bytes, mtimeMs: clock }
      listener?.(name)
    },
    remove(name: string | null = 'doc.pdf') {
      file = null
      listener?.(name)
    },
    event(name: string | null) {
      listener?.(name)
    },
    /** run one pending settle timer and let its async check finish */
    async step() {
      if (!timer) return
      const { fn } = timer
      timer = null
      fn()
      for (let k = 0; k < 10; k++) await Promise.resolve()
    },
    /** let the settle timers run until nothing is scheduled (bounded) */
    async settle() {
      for (let i = 0; i < 100 && timer; i++) await this.step()
    },
  }
}

describe('endsLikeWholePdf', () => {
  it('accepts a file ending in %%EOF (with trailing whitespace)', () => {
    expect(endsLikeWholePdf(pdf('1 0 obj'))).toBe(true)
  })
  it('rejects a file cut off before its end marker', () => {
    expect(endsLikeWholePdf(enc.encode('%PDF-1.7\n1 0 obj <<'))).toBe(false)
    expect(endsLikeWholePdf(new Uint8Array())).toBe(false)
  })
  it('looks only at the last kilobyte', () => {
    const early = enc.encode(`%PDF-1.7\n%%EOF\n${'x'.repeat(2000)}`)
    expect(endsLikeWholePdf(early)).toBe(false)
  })
})

describe('watchDiskFile', () => {
  it('watches the folder and reports one change after a burst of writes settles', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('C:/docs/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    expect(h.watchedDir).toBe('C:/docs')
    h.write(pdf('b1'))
    h.write(pdf('b2'))
    h.write(pdf('b3'))
    expect(h.reports).toEqual([])
    await h.settle()
    expect(h.reports).toEqual(['changed'])
  })

  it('ignores other files in the folder, including the temp file of a replace', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.event('.doc.pdf.1a2b3c.tmp')
    h.event('other.pdf')
    expect(h.pending).toBe(false)
  })

  it('matches the name without case where the file system does', async () => {
    const h = harness(pdf('a'), { caseInsensitive: true })
    watchDiskFile('C:\\docs\\Doc.PDF', h.baseline(), (k) => h.reports.push(k), h.deps)
    expect(h.watchedDir).toBe('C:\\docs')
    h.write(pdf('b'), 'doc.pdf')
    await h.settle()
    expect(h.reports).toEqual(['changed'])
  })

  it('treats an event without a file name as possibly this file', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.write(pdf('b'), null)
    await h.settle()
    expect(h.reports).toEqual(['changed'])
  })

  it('says nothing when the bytes are the same (touched or rewritten identically)', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.write(pdf('a'))
    await h.settle()
    expect(h.reports).toEqual([])
  })

  it('reports the same new content only once, and again for newer content', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.write(pdf('b'))
    await h.settle()
    h.event('doc.pdf')
    await h.settle()
    expect(h.reports).toEqual(['changed'])
    h.write(pdf('c'))
    await h.settle()
    expect(h.reports).toEqual(['changed', 'changed'])
  })

  it('waits for a half-written file to end like a PDF', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.write(enc.encode('%PDF-1.7\n1 0 obj <<'))
    // run a few checks: the partial file is steady but incomplete, nothing is said
    for (let i = 0; i < 4; i++) {
      expect(h.pending).toBe(true)
      await stepOnce(h)
    }
    expect(h.reports).toEqual([])
    h.write(pdf('done'))
    await h.settle()
    expect(h.reports).toEqual(['changed'])
  })

  it('waits while the writer holds the file locked', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.setLocked(true)
    h.write(pdf('b'))
    for (let i = 0; i < 4; i++) await stepOnce(h)
    expect(h.reports).toEqual([])
    h.setLocked(false)
    await h.settle()
    expect(h.reports).toEqual(['changed'])
  })

  it('still reports a file that stays broken, after the waits run out', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.write(enc.encode('not a pdf at all'))
    await h.settle()
    expect(h.reports).toEqual(['changed'])
    expect(DISK_WATCH_MAX_WAITS).toBeGreaterThan(1)
  })

  it('never reports the app’s own write: checks wait for it, then the baseline moves', async () => {
    const h = harness(pdf('a'))
    const watch = watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.setOwnWrite(true)
    h.write(pdf('saved'))
    for (let i = 0; i < 5; i++) await stepOnce(h)
    expect(h.reports).toEqual([])
    expect(h.pending).toBe(true)
    watch.rebase(h.baseline())
    h.setOwnWrite(false)
    await h.settle()
    expect(h.reports).toEqual([])
  })

  it('reports a deleted file only after it stays gone, and once', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.remove()
    await h.settle()
    h.event('doc.pdf')
    await h.settle()
    expect(h.reports).toEqual(['missing'])
  })

  it('does not call a replace that briefly removes the file a deletion', async () => {
    const h = harness(pdf('a'))
    watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.remove()
    await stepOnce(h)
    h.write(pdf('b'))
    await h.settle()
    expect(h.reports).toEqual(['changed'])
  })

  it('clears an earlier notice when the file comes back as the view shows it', async () => {
    const h = harness(pdf('a'))
    const start = h.baseline()
    watchDiskFile('/d/doc.pdf', start, (k) => h.reports.push(k), h.deps)
    h.remove()
    await h.settle()
    h.write(pdf('a'))
    await h.settle()
    expect(h.reports).toEqual(['missing', 'unchanged'])
  })

  it('a rebase (the view reloaded) starts over: the same content can be offered again later', async () => {
    const h = harness(pdf('a'))
    const watch = watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.write(pdf('b'))
    await h.settle()
    watch.rebase(h.baseline())
    h.write(pdf('a'))
    await h.settle()
    expect(h.reports).toEqual(['changed', 'changed'])
  })

  it('stops after close: no timers, no reports, folder watch closed', async () => {
    const h = harness(pdf('a'))
    const watch = watchDiskFile('/d/doc.pdf', h.baseline(), (k) => h.reports.push(k), h.deps)
    h.write(pdf('b'))
    watch.close()
    expect(h.closed).toBe(true)
    expect(h.pending).toBe(false)
    h.write(pdf('c'))
    await h.settle()
    expect(h.reports).toEqual([])
  })
})

/** run exactly one pending settle timer */
const stepOnce = (h: ReturnType<typeof harness>) => h.step()
