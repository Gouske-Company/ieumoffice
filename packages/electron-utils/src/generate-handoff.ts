/**
 * The generate hand-off (8.5): "make" leaves the request for the new tab, and
 * the editor in that tab takes it — once.
 *
 * - A request is queued for one webContents (the new tab's) and can be taken
 *   only by that webContents and only for the kind it was made for. The first
 *   take empties the slot; a second take, a reload, another tab or another
 *   kind gets null. Nothing here starts a run: the taking editor starts it
 *   through its own send gate, with the provider chosen as usual.
 * - A tab that closes before taking drops its request.
 * - The editor reports "a run started in this tab with at least one handed-over
 *   material attached"; the event is kept in memory (tab, sources, mode) for
 *   a later reader. Nothing is written to disk.
 * - A conversion without AI (8.6) involves no hand-off: the shell opens the
 *   new tab with the result and records "converted into this tab, from these
 *   sources" here (`recordGenerateConverted`, read with
 *   `generateConvertedEvents`), for the same reader.
 *
 * - The skill hand-off (spec 5.6, 5.7) uses the same one-take slot rules for
 *   any of the eight editors: a template copy opened in a new tab takes the
 *   person's request with its skill chips (and, for the template preview, the
 *   pending skill proposal) and runs it through that tab's own send gate. It
 *   sits beside the generate hand-off: each kind is taken only by its own take.
 *
 * No Electron import: the shell queues through it and the editor mains
 * (bundled into the shell) import it to register their own
 * `<editor>:handoff-take` channel; the tests run it as is. The store sits on a `Symbol.for` key so every bundled
 * copy of this module shares one (the same reason as unsaved-files.ts).
 */
import { resolve } from 'node:path'
import type { HandoffEditor } from './handoff-editors'

export {
  HANDOFF_EDITORS,
  handoffEditorTakesAttachments,
  isHandoffEditor,
  type HandoffEditor,
} from './handoff-editors'

/** the editor of each document extension a template may have (spec 5.7) */
const EDITOR_BY_EXTENSION: Readonly<Record<string, HandoffEditor>> = {
  docx: 'docs',
  odt: 'docs',
  xlsx: 'sheets',
  xlsm: 'sheets',
  xls: 'sheets',
  csv: 'sheets',
  tsv: 'sheets',
  pptx: 'slides',
  pdf: 'pdf',
  md: 'markdown',
  markdown: 'markdown',
  txt: 'markdown',
  html: 'html',
  htm: 'html',
  xmind: 'mindmap',
  hwp: 'hwp',
  hwpx: 'hwp',
}

/** the editor that opens a file of this name (a path is fine), or undefined */
export function handoffEditorForFile(fileName: string): HandoffEditor | undefined {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return undefined
  return EDITOR_BY_EXTENSION[base.slice(dot + 1).toLowerCase()]
}

/** the editors the generate window's "make" opens */
export type GenerateHandoffTarget = 'slides' | 'html' | 'mindmap'

/**
 * What a new tab takes, once (8.5). The receiving editor attaches the
 * materials to its AI panel, puts `text` in the composer and starts the run
 * through its normal send gate — a missing connection blocks it there and
 * leaves the text and the attachments in place.
 */
export interface GenerateHandoff {
  /** unique per press of "make" */
  id: string
  mode: 'ai'
  target: GenerateHandoffTarget
  /** the readable materials, in the order the window listed them */
  materials: Array<{ path: string; name: string }>
  /** the user's words, or the kind's default request when they wrote none */
  text: string
  /** true when `text` is the default request (the box was left empty) */
  defaultText: boolean
  /** when "make" was pressed, ms since epoch */
  createdAt: number
}

/** one "a run started with handed-over material" record */
export interface GenerateRunStarted {
  /** the shell tab id of the tab, when the shell could tell it */
  tabId?: string
  webContentsId: number
  target: GenerateHandoffTarget
  mode: 'ai'
  /** the handed-over material paths that were attached to the run */
  sources: string[]
  /** every material the hand-off carried, attached or not: what a provenance record lists (9) */
  handedOver: string[]
  /** the hand-off this run came from */
  handoffId: string
  /** ms since epoch */
  at: number
}

/** the conversions without AI (8.6): one source of a fixed type to one new document */
export type GenerateConvertKind =
  'mindmap-to-markdown' | 'mindmap-to-slides' | 'markdown-to-mindmap'

/** the editor a conversion's result opens in, as a new unsaved tab */
export type GenerateConvertTarget = 'markdown' | 'slides' | 'mindmap'

/**
 * One "a conversion without AI opened this new tab" record (8.6, spec 9): the
 * conversion is done by the time the tab opens with its content queued. Kept
 * beside the run-started records for the same later reader; nothing is written
 * to disk.
 */
export interface GenerateConverted {
  /** the shell tab id of the new tab, when the shell could tell it */
  tabId?: string
  webContentsId: number
  target: GenerateConvertTarget
  kind: GenerateConvertKind
  mode: 'convert'
  /** the handed-over material paths (a conversion reads exactly one) */
  sources: string[]
  /** unique per press of "make" */
  conversionId: string
  /** ms since epoch */
  at: number
}

/** a skill chip as it travels with a hand-off */
export interface HandoffSkillChip {
  id: string
  source: string
  title: string
}

/**
 * The template preview a hand-off opens (spec 5.6 "make a blank template"):
 * the skill card that waits for the run to end, and what its buttons need.
 */
export interface SkillHandoffPreview {
  /** names this preview between the two tabs and the shell */
  previewId: string
  /** the document's title as the original tab showed it */
  title: string
  /** the file name the template is saved under, with its extension */
  fileName: string
  /** the original document had redaction marks: its as-is save stays blocked */
  originalRedacted: boolean
  /** the pending skill proposal as the card had it (plain data; the panel checks it) */
  proposal: unknown
  /** the card's fields as the person left them (plain data; the panel checks it) */
  draft?: unknown
}

/**
 * What a new tab's AI panel takes, once (spec 5.6, 5.7): the request, the
 * skill chips it runs with, and for a template preview the pending proposal.
 * The panel reads the chips' skills and sends through its normal send gate.
 */
export interface SkillHandoff {
  /** unique per hand-off */
  id: string
  mode: 'skill'
  target: HandoffEditor
  /** the person's words, or the app's request (the template preview's clearing request) */
  text: string
  chips: HandoffSkillChip[]
  preview?: SkillHandoffPreview | undefined
  /**
   * The asking tab's saved document (its path), attached by the receiving
   * panel through its own attachment route before it sends. Only a saved
   * document without unsaved changes is ever put here.
   */
  attach?: string[] | undefined
  /** ms since epoch */
  createdAt: number
}

interface HandoffStore {
  queued: Map<number, GenerateHandoff>
  /** skill hand-offs waiting to be taken (absent in a store an older copy made) */
  skillQueued?: Map<number, SkillHandoff>
  /** taken but not yet reported as run: what a run-started report is checked against */
  taken: Map<number, GenerateHandoff>
  runs: GenerateRunStarted[]
  /** conversions without AI, oldest first */
  converted?: GenerateConverted[]
  tabIdOf: ((webContentsId: number) => string | undefined) | null
}

const STORE = Symbol.for('genoffice.generate-handoff')
/** keep the in-memory event list bounded across a long session */
const MAX_RUN_EVENTS = 200

function store(): HandoffStore {
  const holder = globalThis as unknown as Record<symbol, HandoffStore | undefined>
  holder[STORE] ??= { queued: new Map(), taken: new Map(), runs: [], tabIdOf: null }
  return holder[STORE]!
}

function pathKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** queue a request for a webContents; replaces anything still queued there */
export function queueGenerateHandoff(webContentsId: number, handoff: GenerateHandoff): void {
  const s = store()
  s.taken.delete(webContentsId)
  s.queued.set(webContentsId, handoff)
}

/** the part of a webContents this module needs (Electron's satisfies it) */
export interface HandoffWebContents {
  readonly id: number
  isDestroyed(): boolean
  once(event: 'destroyed', listener: () => void): unknown
}

/** queue for a live webContents, and drop the request when it goes away first */
export function queueGenerateHandoffFor(
  contents: HandoffWebContents,
  handoff: GenerateHandoff,
): void {
  if (contents.isDestroyed()) return
  const id = contents.id
  queueGenerateHandoff(id, handoff)
  contents.once('destroyed', () => dropGenerateHandoff(id))
}

/**
 * The receiving editor's one take. Returns the request queued for this
 * webContents when it was made for `target`, and empties the slot; null for
 * anything else (nothing queued, already taken, another kind).
 */
export function takeGenerateHandoff(
  target: GenerateHandoffTarget,
  webContentsId: number,
): GenerateHandoff | null {
  const s = store()
  const handoff = s.queued.get(webContentsId)
  if (!handoff || handoff.target !== target) return null
  s.queued.delete(webContentsId)
  s.taken.set(webContentsId, handoff)
  return handoff
}

/** the tab closed (or its webContents went away): its request, taken or not, is gone */
export function dropGenerateHandoff(webContentsId: number): void {
  const s = store()
  s.queued.delete(webContentsId)
  s.taken.delete(webContentsId)
  s.skillQueued?.delete(webContentsId)
}

function skillSlots(): Map<number, SkillHandoff> {
  const s = store()
  s.skillQueued ??= new Map()
  return s.skillQueued
}

/** queue a skill hand-off for a webContents; replaces one still queued there */
export function queueSkillHandoff(webContentsId: number, handoff: SkillHandoff): void {
  skillSlots().set(webContentsId, handoff)
}

/** queue for a live webContents, and drop the request when it goes away first */
export function queueSkillHandoffFor(contents: HandoffWebContents, handoff: SkillHandoff): void {
  if (contents.isDestroyed()) return
  const id = contents.id
  queueSkillHandoff(id, handoff)
  contents.once('destroyed', () => dropGenerateHandoff(id))
}

/**
 * The receiving editor's one take of a skill hand-off: the request queued for
 * this webContents when it was made for `target`, and the slot is emptied;
 * null for anything else. A generate hand-off is never handed out here.
 */
export function takeSkillHandoff(
  target: HandoffEditor,
  webContentsId: number,
): SkillHandoff | null {
  const slots = skillSlots()
  const handoff = slots.get(webContentsId)
  if (!handoff || handoff.target !== target) return null
  slots.delete(webContentsId)
  return handoff
}

/** the skill hand-offs waiting to be taken, for diagnostics and tests; no request text */
export function queuedSkillHandoffs(): Array<{
  webContentsId: number
  target: HandoffEditor
  id: string
}> {
  return [...skillSlots()].map(([webContentsId, h]) => ({
    webContentsId,
    target: h.target,
    id: h.id,
  }))
}

/** what is waiting to be taken, for diagnostics and tests; no request text */
export function queuedGenerateHandoffs(): Array<{
  webContentsId: number
  target: GenerateHandoffTarget
  id: string
}> {
  return [...store().queued].map(([webContentsId, h]) => ({
    webContentsId,
    target: h.target,
    id: h.id,
  }))
}

/** the shell tells this module how to name a tab from its webContents id */
export function setGenerateTabIdResolver(
  resolver: ((webContentsId: number) => string | undefined) | null,
): void {
  store().tabIdOf = resolver
}

/**
 * The receiving editor reports that a run started in this tab with the given
 * attachments. Recorded only when the tab took a hand-off for `target` and at
 * least one of the attached paths is a handed-over material; each hand-off is
 * recorded once (its first run). Returns the record, or null when nothing
 * was recorded.
 */
export function reportGenerateRunStarted(
  target: GenerateHandoffTarget,
  webContentsId: number,
  attachedPaths: readonly string[],
): GenerateRunStarted | null {
  const s = store()
  const handoff = s.taken.get(webContentsId)
  if (!handoff || handoff.target !== target) return null
  const attached = new Set(attachedPaths.filter((p) => typeof p === 'string').map(pathKey))
  const sources = handoff.materials.map((m) => m.path).filter((path) => attached.has(pathKey(path)))
  if (sources.length === 0) return null
  s.taken.delete(webContentsId)
  const tabId = s.tabIdOf?.(webContentsId)
  const event: GenerateRunStarted = {
    ...(tabId ? { tabId } : {}),
    webContentsId,
    target,
    mode: handoff.mode,
    sources,
    handedOver: handoff.materials.map((m) => m.path),
    handoffId: handoff.id,
    at: Date.now(),
  }
  s.runs.push(event)
  if (s.runs.length > MAX_RUN_EVENTS) s.runs.splice(0, s.runs.length - MAX_RUN_EVENTS)
  return event
}

/** the recorded run-started events, oldest first (a copy) */
export function generateRunStartedEvents(): GenerateRunStarted[] {
  return store().runs.map((e) => ({ ...e, sources: [...e.sources], handedOver: [...e.handedOver] }))
}

/**
 * The shell opened a new tab with the result of a conversion without AI (8.6)
 * queued for it. Recorded at once: the conversion itself is done by then.
 */
export function recordGenerateConverted(input: {
  webContentsId: number
  target: GenerateConvertTarget
  kind: GenerateConvertKind
  sources: readonly string[]
  conversionId: string
}): GenerateConverted {
  const s = store()
  const tabId = s.tabIdOf?.(input.webContentsId)
  const event: GenerateConverted = {
    ...(tabId ? { tabId } : {}),
    webContentsId: input.webContentsId,
    target: input.target,
    kind: input.kind,
    mode: 'convert',
    sources: input.sources.filter((p) => typeof p === 'string' && p !== ''),
    conversionId: input.conversionId,
    at: Date.now(),
  }
  s.converted ??= []
  s.converted.push(event)
  if (s.converted.length > MAX_RUN_EVENTS)
    s.converted.splice(0, s.converted.length - MAX_RUN_EVENTS)
  return event
}

/** the recorded conversions, oldest first (a copy) */
export function generateConvertedEvents(): GenerateConverted[] {
  return (store().converted ?? []).map((e) => ({ ...e, sources: [...e.sources] }))
}

/** tests only: forget everything */
export function resetGenerateHandoffsForTest(): void {
  const s = store()
  s.queued.clear()
  s.taken.clear()
  s.skillQueued?.clear()
  s.runs.length = 0
  s.converted = []
  s.tabIdOf = null
}
