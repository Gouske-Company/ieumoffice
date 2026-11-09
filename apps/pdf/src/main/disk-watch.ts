/**
 * Notice when another program changes or removes the PDF a view shows
 * (issue #405). The watcher looks at the file's folder rather than the file:
 * most writers replace a file by renaming a temp file over it, which ends a
 * watch on the file itself, and a folder watch also sees deletes and renames.
 *
 * Writes arrive as bursts of events, so nothing is judged until the events
 * stop for `settleMs`, the size and time read the same twice in a row and the
 * bytes end like a whole PDF (`%%EOF`). Only then is the content compared with
 * the bytes the view shows (`baseline`); a change is reported once per new
 * content. The app's own writes are excluded twice over: the main process
 * holds the path as "being written" for the whole write (checks wait), then
 * moves the baseline to what it wrote (`rebase`).
 */

/** What the view shows: the disk state when it last read or wrote the file */
export interface DiskBaseline {
  mtimeMs: number
  size: number
  hash: string
}

/** `unchanged` only follows an earlier report: the file is back to what the view shows */
export type DiskChangeKind = 'changed' | 'missing' | 'unchanged'

export interface DiskWatchDeps {
  /** watch the folder; `null` filename = the platform did not say which entry moved */
  watchDir(dir: string, onEvent: (filename: string | null) => void): { close(): void } | null
  /** null when the file is not there */
  stat(path: string): Promise<{ mtimeMs: number; size: number } | null>
  /** null when the file cannot be read now (locked by its writer, gone again) */
  read(path: string): Promise<Uint8Array | null>
  hash(bytes: Uint8Array): string
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  /** true while this app itself writes `path` */
  ownWriteInFlight(path: string): boolean
  settleMs: number
  /** case-insensitive file names (Windows, macOS) */
  caseInsensitive: boolean
}

export interface DiskWatch {
  readonly path: string
  /** the view now shows `baseline` (it reloaded, or the app wrote the file) */
  rebase(baseline: DiskBaseline | null): void
  close(): void
}

/**
 * Checks of a file that keeps changing, cannot be read or does not end like
 * a PDF wait for the writer; after this many in a row the change is reported
 * as it is, so a file that stays broken still gets its notice (the reload
 * then shows why it cannot open).
 */
export const DISK_WATCH_MAX_WAITS = 20
/** A replace may delete the file a moment before the new one lands */
export const DISK_WATCH_MISSING_CONFIRMATIONS = 2

const EOF_WINDOW = 1024
const EOF_MARK = [0x25, 0x25, 0x45, 0x4f, 0x46] // %%EOF

/** True when the last 1 KiB holds `%%EOF`, as every complete PDF ends */
export function endsLikeWholePdf(bytes: Uint8Array): boolean {
  const from = Math.max(0, bytes.length - EOF_WINDOW)
  outer: for (let i = bytes.length - EOF_MARK.length; i >= from; i--) {
    for (let k = 0; k < EOF_MARK.length; k++) {
      if (bytes[i + k] !== EOF_MARK[k]) continue outer
    }
    return true
  }
  return false
}

function splitPath(path: string): { dir: string; name: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut < 0
    ? { dir: '.', name: path }
    : { dir: path.slice(0, cut) || '/', name: path.slice(cut + 1) }
}

export function watchDiskFile(
  path: string,
  baseline: DiskBaseline | null,
  onChange: (kind: DiskChangeKind) => void,
  deps: DiskWatchDeps,
): DiskWatch {
  const { dir, name } = splitPath(path)
  const sameName = (filename: string) =>
    deps.caseInsensitive ? filename.toLowerCase() === name.toLowerCase() : filename === name
  let shown = baseline
  let closed = false
  let timer: unknown = null
  let checking = false
  let again = false
  /** size and time seen by the previous check; equal twice = the writer stopped */
  let lastSeen: { mtimeMs: number; size: number } | null = null
  let waits = 0
  let missingSeen = 0
  /** what the view was last told: nothing yet, a hash it was offered, or missing */
  let reported: { kind: 'changed'; hash: string } | { kind: 'missing' } | null = null

  const schedule = () => {
    if (closed) return
    if (timer !== null) deps.clearTimer(timer)
    timer = deps.setTimer(() => {
      timer = null
      void check()
    }, deps.settleMs)
  }

  const report = (kind: DiskChangeKind) => {
    if (!closed) onChange(kind)
  }

  /** the file is what the view shows: clear an earlier notice */
  const settledSame = () => {
    if (reported) report('unchanged')
    reported = null
  }

  async function check(): Promise<void> {
    if (closed) return
    if (checking) {
      again = true
      return
    }
    checking = true
    try {
      await evaluate()
    } finally {
      checking = false
      if (again && !closed) {
        again = false
        schedule()
      }
    }
  }

  async function evaluate(): Promise<void> {
    if (deps.ownWriteInFlight(path)) {
      // the app writes this file now; its write ends with a rebase
      schedule()
      return
    }
    const current = await deps.stat(path)
    if (closed) return
    if (!current) {
      lastSeen = null
      missingSeen += 1
      if (missingSeen < DISK_WATCH_MISSING_CONFIRMATIONS) {
        schedule()
        return
      }
      if (reported?.kind !== 'missing') {
        reported = { kind: 'missing' }
        report('missing')
      }
      return
    }
    missingSeen = 0
    if (shown && current.mtimeMs === shown.mtimeMs && current.size === shown.size) {
      lastSeen = null
      waits = 0
      settledSame()
      return
    }
    const steady =
      lastSeen !== null && lastSeen.mtimeMs === current.mtimeMs && lastSeen.size === current.size
    lastSeen = current
    if (!steady && waits < DISK_WATCH_MAX_WAITS) {
      waits += 1
      schedule()
      return
    }
    const bytes = await deps.read(path)
    if (closed) return
    if ((!bytes || !endsLikeWholePdf(bytes)) && waits < DISK_WATCH_MAX_WAITS) {
      waits += 1
      lastSeen = null
      schedule()
      return
    }
    lastSeen = null
    waits = 0
    if (!bytes) {
      // unreadable for good: say so once, the reload explains the rest
      if (reported?.kind !== 'changed') {
        reported = { kind: 'changed', hash: '' }
        report('changed')
      }
      return
    }
    const hash = deps.hash(bytes)
    if (shown && hash === shown.hash) {
      // touched or rewritten with the same bytes: nothing to offer
      shown = { mtimeMs: current.mtimeMs, size: current.size, hash }
      settledSame()
      return
    }
    if (reported?.kind === 'changed' && reported.hash === hash) return
    reported = { kind: 'changed', hash }
    report('changed')
  }

  const handle = deps.watchDir(dir, (filename) => {
    if (closed) return
    if (filename !== null && !sameName(filename)) return
    schedule()
  })

  return {
    path,
    rebase(next) {
      shown = next
      reported = null
      lastSeen = null
      waits = 0
      missingSeen = 0
    },
    close() {
      closed = true
      if (timer !== null) deps.clearTimer(timer)
      timer = null
      handle?.close()
    },
  }
}
