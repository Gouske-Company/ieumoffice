/**
 * The person's skills in the agent window (spec 6.2 to 6.5), on the main
 * process side: which skills-management calls the agent window may make, the
 * session's skills as the window's `/` list needs them, the skill card a
 * session's `propose_skill` asks for, its template candidates, and whether a
 * candidate can be saved as it is.
 *
 * No Electron here: the window module injects the windows and the services.
 * Nothing in this module writes a file; the card's Save does, through the
 * skills service, after the person's click.
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import JSZip from 'jszip'
import type { SkillProposal } from '@genoffice/agent-core'
import { REDACT_NS } from '@genoffice/agent-core/redact-range'
import { skillEditorsOf } from '@genoffice/agent-core/skill-editors'
import {
  IEUM_TEMPLATE_KEY,
  MAX_USER_SKILL_BYTES,
  USER_SKILL_PRIORITY,
  isInsideCodexHome,
  isReservedUserSkillName,
  normalizeSkillTemplatePath,
  parseSkillMd,
} from '@genoffice/ai-provider'
import {
  AGENT_SKILL_PLUGIN_NAME,
  comparablePath,
  isInsidePath,
  type AgentSkillEntry,
} from '@genoffice/ai-provider/agent-session'
import { handoffEditorForFile } from '@genoffice/electron-utils/generate-handoff'
import { USER_SKILLS_CHANNELS } from '@genoffice/electron-utils/user-skills-channels'
import type {
  AgentSessionSkill,
  AgentTemplateCandidateView,
  AgentTemplateRedaction,
} from '../../shared/agent-api'
import type { AgentSkillProposalInput } from './agent-mcp'

// ---- the management gate ----------------------------------------------

/**
 * The skills-management calls the agent window may make: the GitHub preview
 * of an install the session proposed, and its Install and Cancel (spec 6.4).
 * Every other management call stays with the settings screen.
 */
export const AGENT_WINDOW_MANAGE_CHANNELS: ReadonlySet<string> = new Set([
  USER_SKILLS_CHANNELS.importGitHub,
  USER_SKILLS_CHANNELS.cancelImport,
  USER_SKILLS_CHANNELS.install,
])

/** The `canManage` gate of the skills channels: the main window, and the agent window for three */
export function userSkillsManageGate<S>(windows: {
  isMainWindow(sender: S): boolean
  isAgentWindow(sender: S): boolean
}): (sender: S, channel: string) => boolean {
  return (sender, channel) =>
    windows.isMainWindow(sender) ||
    (windows.isAgentWindow(sender) && AGENT_WINDOW_MANAGE_CHANNELS.has(channel))
}

// ---- the session's skills -----------------------------------------------

/** A template path as a skill names it: under `assets/`, the same rule as the skill list */
function templateRelOf(value: string | undefined): string[] | undefined {
  return normalizeSkillTemplatePath(value)?.split('/')
}

/**
 * The session's skills for the window: each bundle entry with the absolute
 * path of its copied template, when its SKILL.md names one that is there.
 */
export async function agentSessionSkillsOf(
  entries: readonly AgentSkillEntry[],
): Promise<AgentSessionSkill[]> {
  const out: AgentSessionSkill[] = []
  for (const entry of entries) {
    let template: string | undefined
    try {
      const parsed = parseSkillMd(await readFile(entry.skillMd, 'utf8'))
      const rel = templateRelOf(parsed?.metadata[IEUM_TEMPLATE_KEY])
      if (rel) {
        const path = join(dirname(entry.skillMd), ...rel)
        if ((await stat(path)).isFile()) template = path
      }
    } catch {
      // no template, or one that is not there
    }
    out.push({
      id: entry.id,
      name: entry.name,
      source: entry.source,
      plugin: entry.plugin,
      title: entry.title,
      description: entry.description,
      invoke: entry.invoke,
      skillMd: entry.skillMd,
      template,
    })
  }
  return out
}

// ---- the skill card ------------------------------------------------------

/** One skill of the list as the card's target needs it */
export interface AgentSkillListEntry {
  id: string
  source: string
  name: string
  title: string
  owned: boolean
  unreadable?: unknown
  /** where the skill is used (the list's value); absent: every editor */
  editors?: unknown
}

export type AgentSkillProposalResult =
  { ok: true; proposal: SkillProposal } | { ok: false; message: string }

/** A skill of the session's copy as a change's target needs it: its identifier and name there */
export type AgentSessionSkillName = Pick<AgentSkillEntry, 'id' | 'name'>

function priorityOf(entry: AgentSkillListEntry): number {
  const at = USER_SKILL_PRIORITY.indexOf(entry.source as (typeof USER_SKILL_PRIORITY)[number])
  return at === -1 ? USER_SKILL_PRIORITY.length : at
}

/**
 * The skill a change names. The model knows a skill by its name in the
 * session's copy (Claude may prefix the plugin's name, `ieum-skills:`), a
 * renamed duplicate (`<name>--<source>`, `<name>--plugin-<plugin>`) included;
 * Codex is also told the identifier. Either is taken. A plain name shared by
 * several skills is the one that won the name in the copy; one not in the copy
 * (turned off) goes by the same priority.
 */
function targetEntryOf(
  targetId: string,
  list: readonly AgentSkillListEntry[],
  sessionSkills: readonly AgentSessionSkillName[],
): AgentSkillListEntry | undefined {
  const shown = list.filter((skill) => !isReservedUserSkillName(skill.name))
  const byId = shown.find((skill) => skill.id === targetId)
  if (byId) return byId
  const prefix = `${AGENT_SKILL_PLUGIN_NAME}:`
  const bare = targetId.toLowerCase().startsWith(prefix) ? targetId.slice(prefix.length) : targetId
  const wanted = bare.toLowerCase()
  const inSession = sessionSkills.find((skill) => skill.name.toLowerCase() === wanted)
  if (inSession) return shown.find((skill) => skill.id === inSession.id)
  if (bare !== targetId) return shown.find((skill) => skill.id === bare)
  return shown
    .filter((skill) => skill.name.toLowerCase() === wanted)
    .sort((a, b) => priorityOf(a) - priorityOf(b))[0]
}

/**
 * The card a `propose_skill` call asks for, or why not (words for the model).
 * A change names a skill of the list, by its identifier or its name in the
 * session; the project folder's skills are the project's files and are not
 * changed here.
 */
export function agentSkillProposalOf(
  input: AgentSkillProposalInput,
  list: readonly AgentSkillListEntry[],
  key: string,
  sessionSkills: readonly AgentSessionSkillName[] = [],
): AgentSkillProposalResult {
  let target: SkillProposal['target']
  if (input.targetId) {
    const entry = targetEntryOf(input.targetId, list, sessionSkills)
    if (!entry) {
      return {
        ok: false,
        message: `No skill named ${input.targetId}. Give the skill's name as listed in this session, or its id, or leave targetId out to propose a new skill.`,
      }
    }
    if (entry.source === 'project') {
      return {
        ok: false,
        message: `${input.targetId} is a skill of the project folder; change its files there instead.`,
      }
    }
    if (entry.unreadable)
      return { ok: false, message: `The skill ${input.targetId} cannot be read.` }
    target = {
      id: entry.id,
      name: entry.name,
      title: entry.title || entry.name,
      owned: entry.owned,
      source: entry.source,
      editors: skillEditorsOf(entry.editors),
    }
  }
  return {
    ok: true,
    proposal: {
      key,
      title: input.title,
      name: input.name,
      description: input.description,
      body: input.body,
      wantsTemplate: input.wantsTemplate,
      target,
    },
  }
}

// ---- template candidates -----------------------------------------------

/** A template candidate with its path, kept in the main process */
export interface AgentTemplateCandidate extends AgentTemplateCandidateView {
  path: string
}

/** A document open in a tab, as the candidates need it */
export interface AgentOpenTab {
  title: string
  filePath?: string | undefined
  dirty: boolean
}

/** Project files offered at most (tunable) */
export const MAX_PROJECT_TEMPLATE_FILES = 100
/** Folder levels under the project folder that are looked through (tunable) */
export const MAX_PROJECT_TEMPLATE_DEPTH = 4
/** Folder entries looked at in all (tunable): a huge folder does not hold the card up */
const MAX_PROJECT_ENTRIES_SEEN = 5_000

/** A file the app's editors open as a document (spec 5.7), not a lock or temporary file */
function isTemplateFile(name: string): boolean {
  return !!handoffEditorForFile(name) && !name.startsWith('~$') && !name.startsWith('.')
}

/** Project files the editors open, nearest first; hidden folders and links are not entered */
export async function projectTemplateFiles(
  projectRoot: string,
  limits: { files?: number; depth?: number } = {},
): Promise<string[]> {
  const maxFiles = limits.files ?? MAX_PROJECT_TEMPLATE_FILES
  const maxDepth = limits.depth ?? MAX_PROJECT_TEMPLATE_DEPTH
  const found: string[] = []
  let seen = 0
  let level = [projectRoot]
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth++) {
    const next: string[] = []
    for (const dir of level) {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        if (++seen > MAX_PROJECT_ENTRIES_SEEN || found.length >= maxFiles) return found
        if (entry.isSymbolicLink()) continue
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            next.push(join(dir, entry.name))
          }
        } else if (entry.isFile() && isTemplateFile(entry.name)) {
          found.push(join(dir, entry.name))
        }
      }
    }
    level = next
  }
  return found
}

function titleOfFile(path: string): string {
  const name = basename(path)
  return name.slice(0, name.length - extname(name).length) || name
}

/**
 * The documents a card offers as the template (spec 6.3): those open in tabs,
 * then the project folder's files the editors open, each once; and the one the
 * model suggested, when it names a candidate or a document file of the
 * project folder.
 */
export async function agentTemplateCandidates(options: {
  projectRoot: string
  tabs: readonly AgentOpenTab[]
  suggested: string
  platform?: NodeJS.Platform | undefined
  projectFiles?: readonly string[] | undefined
}): Promise<{ candidates: AgentTemplateCandidate[]; selected: string | undefined }> {
  const platform = options.platform ?? process.platform
  const key = (path: string) => comparablePath(path, path, platform)
  const candidates: AgentTemplateCandidate[] = []
  const known = new Map<string, AgentTemplateCandidate>()
  const add = (path: string, from: 'tab' | 'project', unsaved: boolean, title?: string) => {
    const k = key(path)
    if (known.has(k)) return
    const candidate: AgentTemplateCandidate = {
      id: `c${candidates.length}`,
      path,
      title: title || titleOfFile(path),
      fileName: basename(path),
      from,
      unsaved,
    }
    known.set(k, candidate)
    candidates.push(candidate)
  }
  for (const tab of options.tabs) {
    if (tab.filePath && isAbsolute(tab.filePath) && isTemplateFile(basename(tab.filePath))) {
      add(tab.filePath, 'tab', tab.dirty, titleOfFile(tab.filePath))
    }
  }
  const files = options.projectFiles ?? (await projectTemplateFiles(options.projectRoot))
  for (const path of files) add(path, 'project', false)

  let selected: string | undefined
  const suggested = options.suggested
  if (suggested) {
    const full = isAbsolute(suggested) ? suggested : resolve(options.projectRoot, suggested)
    const match = known.get(key(full))
    if (match) selected = match.id
    else {
      const root = key(options.projectRoot)
      // inside the project folder as written and where it really is: a link leading out is refused
      const realRoot = await realpath(options.projectRoot).catch(() => undefined)
      const real = await realpath(full).catch(() => undefined)
      const inside =
        isInsidePath(key(full), root, platform) &&
        !!realRoot &&
        !!real &&
        isInsidePath(key(real), key(realRoot), platform)
      const isFile = inside
        ? await stat(full).then(
            (s) => s.isFile(),
            () => false,
          )
        : false
      if (inside && isFile && isTemplateFile(basename(full))) {
        add(full, 'project', false)
        selected = known.get(key(full))?.id
      }
    }
  }
  return { candidates, selected }
}

/** What the window sees of a candidate: no path */
export function candidateView(candidate: AgentTemplateCandidate): AgentTemplateCandidateView {
  return {
    id: candidate.id,
    title: candidate.title,
    fileName: candidate.fileName,
    from: candidate.from,
    unsaved: candidate.unsaved,
  }
}

// ---- redaction marks ---------------------------------------------------

/** The extension URI of the deck engine's redaction mark (file-parse's PPTX_REDACT_EXT_URI) */
const PPTX_REDACT_EXT_URI = '{9F1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D}'

/**
 * Whether a document file holds redaction marks, with the recognizers the
 * editors use (docs/security.md "document content"):
 * - Markdown and text: the markdown editor's withheld span (`data-redaction`);
 * - HTML: the HTML editor's mark (`data-gx-redact`, `gx:redact:`);
 * - PowerPoint: the deck engine's mark in any XML part of the deck;
 * - PDF: its marks are pending redactions held by an open editor, which this
 *   cannot see: a PDF open in a tab is not known, one that is not has none;
 * - Word, Excel, Hangul and mind maps: their editors recognize no mark.
 * A deck that cannot be read is not known. Unknown is never saved as it is.
 */
export async function templateRedactionOf(
  fileName: string,
  bytes: Uint8Array,
  openInTab: boolean,
): Promise<AgentTemplateRedaction> {
  const extension = extname(fileName).slice(1).toLowerCase()
  const asText = () => new TextDecoder('utf-8').decode(bytes)
  switch (extension) {
    case 'md':
    case 'markdown':
    case 'txt':
    case 'json':
      return /data-redaction/i.test(asText()) ? 'redacted' : 'none'
    case 'html':
    case 'htm':
      return /data-gx-redact|gx:redact:/i.test(asText()) ? 'redacted' : 'none'
    case 'pptx':
      try {
        const zip = await JSZip.loadAsync(bytes)
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || !/\.xml$/i.test(entry.name)) continue
          const xml = await entry.async('string')
          if (xml.includes(REDACT_NS) || xml.includes(PPTX_REDACT_EXT_URI)) return 'redacted'
        }
        return 'none'
      } catch {
        return 'unknown'
      }
    case 'pdf':
      return openInTab ? 'unknown' : 'none'
    default:
      return 'none'
  }
}

/** Folders a candidate is never read from: the sessions' protected folders */
export interface TemplateReadGuard {
  homeDir: string
  /** sign-in stores, the original app's folder, this app's folders (agentProtectedPaths) */
  protectedPaths: readonly string[]
}

/** Whether a path, as written or where it really is, is in a protected folder or the Codex home */
async function isProtectedPath(path: string, guard: TemplateReadGuard): Promise<boolean> {
  const real = await realpath(path).catch(() => undefined)
  if (!real) return true
  for (const at of [path, real]) {
    if (await isInsideCodexHome(at, guard.homeDir)) return true
    for (const dir of guard.protectedPaths) {
      if (!dir) continue
      const root = await realpath(dir).catch(() => dir)
      for (const base of new Set([dir, root])) {
        if (isInsidePath(comparablePath(at, at), comparablePath(base, base))) return true
      }
    }
  }
  return false
}

/**
 * A candidate's file, read whole in the main process; refused when it is gone,
 * larger than a skill may be, or (as written or where it really is) inside a
 * protected folder: `~/.claude`, `~/.codex`, `~/.genoffice`, `~/.ieumoffice`,
 * the app's data.
 */
export async function readTemplateCandidate(
  path: string,
  guard: TemplateReadGuard,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: 'unreadable' | 'too-large' }> {
  try {
    if (await isProtectedPath(path, guard)) return { ok: false, reason: 'unreadable' }
    const info = await stat(path)
    if (!info.isFile()) return { ok: false, reason: 'unreadable' }
    if (info.size > MAX_USER_SKILL_BYTES) return { ok: false, reason: 'too-large' }
    return { ok: true, bytes: new Uint8Array(await readFile(path)) }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}
