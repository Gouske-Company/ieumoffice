/// The person's skills as every window's preload exposes them (one name,
/// `aiOfficeUserSkills`). The main process does all reading and writing and
/// checks every request again; answers cross contextBridge as plain data. A
/// window with no shell behind it gets empty lists and failures, not errors.
import { ipcRenderer } from 'electron'
import type { HandoffEditor, SkillHandoff } from './generate-handoff'
import {
  USER_SKILLS_CHANNELS as C,
  previewEndedOf,
  skillViewsOf,
  skillsResultOf,
  type UserSkillAiRead,
  type UserSkillCardSaveInput,
  type UserSkillCollisionChoice,
  type UserSkillContent,
  type UserSkillImportPreview,
  type UserSkillNameProblem,
  type UserSkillPreviewEnded,
  type UserSkillPreviewInput,
  type UserSkillPreviewOutcome,
  type UserSkillSaveInput,
  type UserSkillStatePatch,
  type UserSkillTemplateOpenInput,
  type UserSkillUpdateCheck,
  type UserSkillView,
  type UserSkillsResult,
} from './user-skills-channels'

export interface UserSkillsBridge {
  /** every skill of every source with its state (re-read on each call) */
  list(): Promise<UserSkillView[]>
  /** a skill's text for the read-only view and the editor */
  read(id: string): Promise<UserSkillsResult<{ skill: UserSkillContent }>>
  /** on/off, when it is used, and where (for skills the person cannot edit) */
  setState(id: string, patch: UserSkillStatePatch): Promise<UserSkillsResult>
  /** hide a builtin (it goes off) */
  hideBuiltin(id: string): Promise<UserSkillsResult>
  /** show hidden builtins again in their initial state; all of them without names */
  unhideBuiltins(names?: string[]): Promise<UserSkillsResult>
  /** an own skill to the OS trash */
  remove(id: string): Promise<UserSkillsResult>
  /** copy a builtin or another program's skill into the app's folder and turn the original off */
  copyToMine(id: string, overwrite?: boolean): Promise<UserSkillsResult<{ id: string }>>
  /** a free name for a new skill made from its title */
  suggestName(title: string): Promise<string>
  /** the strict rule for a new name; `forId` is the own skill being renamed */
  checkName(
    name: string,
    forId?: string,
  ): Promise<{ ok: true } | { ok: false; problem: UserSkillNameProblem | 'taken' }>
  /** the settings editor's save (new skill, or an edit of an own skill) */
  save(input: UserSkillSaveInput): Promise<UserSkillsResult<{ id: string }>>
  /** a skill card's save (spec 5.6) */
  saveFromCard(input: UserSkillCardSaveInput): Promise<UserSkillsResult<{ id: string }>>
  importFolder(): Promise<UserSkillsResult<{ preview: UserSkillImportPreview }>>
  importZip(): Promise<UserSkillsResult<{ preview: UserSkillImportPreview }>>
  importGitHub(address: string): Promise<UserSkillsResult<{ preview: UserSkillImportPreview }>>
  /** pasted SKILL.md text, previewed as one skill */
  importText(text: string): Promise<UserSkillsResult<{ preview: UserSkillImportPreview }>>
  /** the next skill file dropped on a window, previewed; `null` when none waits */
  takeDropped(): Promise<UserSkillsResult<{ preview: UserSkillImportPreview | null }>>
  /** drop a previewed import, or stop the one running when no token is given */
  cancelImport(token?: string): Promise<void>
  install(
    token: string,
    selected: string[],
    onCollision?: Record<string, UserSkillCollisionChoice>,
  ): Promise<UserSkillsResult<{ installed: Array<{ key: string; id: string }>; skipped: string[] }>>
  checkUpdate(id: string): Promise<UserSkillUpdateCheck>
  applyUpdate(token: string): Promise<UserSkillsResult<{ id: string }>>
  cancelUpdate(token: string): Promise<void>
  /** before the save dialog: the zip name and whether a template goes in */
  exportInfo(id: string): Promise<UserSkillsResult<{ fileName: string; includesTemplate: boolean }>>
  /** asks where to save, then writes the zip */
  exportZip(id: string): Promise<UserSkillsResult<{ path: string }>>
  /** asks where to save, then writes one zip with a folder per skill */
  exportBundle(ids: string[]): Promise<UserSkillsResult<{ path: string }>>
  openFolder(id: string): Promise<UserSkillsResult>
  /** `use_skill`: an enabled skill's body and text files */
  aiRead(id: string): Promise<UserSkillsResult<{ skill: UserSkillAiRead }>>
  /** `read_skill_file`: one text file of an enabled skill */
  aiReadFile(id: string, rel: string): Promise<UserSkillsResult<{ text: string }>>
  /** open the settings window on the skills page */
  openSettings(): Promise<void>
  /** the agent window's one-time notice is due (spec 6.5) */
  agentNotice(): Promise<boolean>
  markAgentNoticeSeen(): Promise<void>
  /** a template skill's copy in a new tab, with the request handed over (spec 5.7) */
  openTemplate(
    input: UserSkillTemplateOpenInput,
  ): Promise<UserSkillsResult<{ tabId: string; attached: boolean }>>
  /** the current document's copy in a template preview tab (spec 5.6) */
  openPreview(
    input: UserSkillPreviewInput,
  ): Promise<UserSkillsResult<{ tabId: string; previewId: string }>>
  /** the preview tab: the original document as it was handed over */
  previewOriginal(
    previewId: string,
  ): Promise<UserSkillsResult<{ bytes: Uint8Array; fileName: string }>>
  /** the preview tab: its card was saved (with the skill) or left unsaved */
  finishPreview(
    previewId: string,
    outcome: UserSkillPreviewOutcome,
    saved?: { skillId: string; title: string },
  ): Promise<UserSkillsResult>
  /** this tab's skill hand-off, once; null when none waits */
  takeHandoff(target: HandoffEditor): Promise<SkillHandoff | null>
  /** bring a tab this flow opened to the front */
  focusTab(tabId: string): Promise<UserSkillsResult>
  /** a template preview this tab opened ended */
  onPreviewEnded(listener: (ended: UserSkillPreviewEnded) => void): () => void
  /** the list or a state changed somewhere */
  onChanged(listener: () => void): () => void
  /** a skill file was dropped on a window and waits for `takeDropped` */
  onDropped(listener: () => void): () => void
}

const unavailable = { ok: false as const, reason: 'failed' as const }

async function result<T extends object>(
  channel: string,
  ...args: unknown[]
): Promise<UserSkillsResult<T>> {
  try {
    return skillsResultOf<T>(await ipcRenderer.invoke(channel, ...args))
  } catch {
    return unavailable
  }
}

export function userSkillsBridge(): UserSkillsBridge {
  return {
    list: async () => skillViewsOf(await ipcRenderer.invoke(C.list).catch(() => [])),
    read: (id) => result(C.read, String(id)),
    setState: (id, patch) => result(C.setState, String(id), patch),
    hideBuiltin: (id) => result(C.hideBuiltin, String(id)),
    unhideBuiltins: (names) => result(C.unhideBuiltins, names),
    remove: (id) => result(C.remove, String(id)),
    copyToMine: (id, overwrite) => result(C.copyToMine, String(id), overwrite === true),
    suggestName: async (title) => {
      const name: unknown = await ipcRenderer.invoke(C.suggestName, String(title)).catch(() => '')
      return typeof name === 'string' ? name : ''
    },
    checkName: async (name, forId) => {
      const answer: unknown = await ipcRenderer
        .invoke(C.checkName, String(name), forId)
        .catch(() => undefined)
      const value = (answer && typeof answer === 'object' ? answer : {}) as {
        ok?: unknown
        problem?: unknown
      }
      if (value.ok === true) return { ok: true }
      return {
        ok: false,
        problem: typeof value.problem === 'string' ? (value.problem as 'taken') : 'empty',
      }
    },
    save: (input) => result(C.save, input),
    saveFromCard: (input) => result(C.saveFromCard, input),
    importFolder: () => result(C.importFolder),
    importZip: () => result(C.importZip),
    importGitHub: (address) => result(C.importGitHub, String(address)),
    importText: (text) => result(C.importText, String(text)),
    takeDropped: () => result(C.takeDropped),
    cancelImport: async (token) => {
      await ipcRenderer.invoke(C.cancelImport, token).catch(() => undefined)
    },
    install: (token, selected, onCollision) =>
      result(C.install, { token, selected, onCollision: onCollision ?? {} }),
    checkUpdate: async (id) => {
      try {
        const answer: unknown = await ipcRenderer.invoke(C.checkUpdate, String(id))
        return skillsResultOf(answer) as UserSkillUpdateCheck
      } catch {
        return unavailable
      }
    },
    applyUpdate: (token) => result(C.applyUpdate, String(token)),
    cancelUpdate: async (token) => {
      await ipcRenderer.invoke(C.cancelUpdate, String(token)).catch(() => undefined)
    },
    exportInfo: (id) => result(C.exportInfo, String(id)),
    exportZip: (id) => result(C.exportZip, String(id)),
    exportBundle: (ids) => result(C.exportBundle, ids.map(String)),
    openFolder: (id) => result(C.openFolder, String(id)),
    aiRead: (id) => result(C.aiRead, String(id)),
    aiReadFile: (id, rel) => result(C.aiReadFile, String(id), String(rel)),
    openSettings: async () => {
      await ipcRenderer.invoke(C.openSettings).catch(() => undefined)
    },
    agentNotice: async () => (await ipcRenderer.invoke(C.agentNotice).catch(() => false)) === true,
    markAgentNoticeSeen: async () => {
      await ipcRenderer.invoke(C.agentNoticeSeen).catch(() => undefined)
    },
    openTemplate: (input) => result(C.openTemplate, input),
    openPreview: (input) => result(C.openPreview, input),
    previewOriginal: (previewId) => result(C.previewOriginal, String(previewId)),
    finishPreview: (previewId, outcome, saved) =>
      result(C.finishPreview, {
        previewId: String(previewId),
        outcome,
        ...(saved ? { skillId: saved.skillId, title: saved.title } : {}),
      }),
    takeHandoff: async (target) => {
      const answer: unknown = await ipcRenderer
        .invoke(C.takeHandoff, String(target))
        .catch(() => null)
      return answer && typeof answer === 'object' ? (answer as SkillHandoff) : null
    },
    focusTab: (tabId) => result(C.focusTab, String(tabId)),
    onPreviewEnded(listener) {
      const handler = (_event: unknown, raw: unknown) => {
        const ended = previewEndedOf(raw)
        if (ended) listener(ended)
      }
      ipcRenderer.on(C.previewEnded, handler)
      return () => {
        ipcRenderer.removeListener(C.previewEnded, handler)
      }
    },
    onChanged(listener) {
      const handler = () => listener()
      ipcRenderer.on(C.changed, handler)
      return () => {
        ipcRenderer.removeListener(C.changed, handler)
      }
    },
    onDropped(listener) {
      const handler = () => listener()
      ipcRenderer.on(C.dropped, handler)
      return () => {
        ipcRenderer.removeListener(C.dropped, handler)
      }
    },
  }
}
