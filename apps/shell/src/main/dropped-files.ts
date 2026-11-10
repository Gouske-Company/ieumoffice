/// Payload handling for OS file drops (installDropOpenBridge in preloads).
/// Kept in its own module so the decision logic is unit-testable without
/// booting the whole shell main process.
import { partitionDropPayload } from '@genoffice/electron-utils'
import type { DroppedSkillSource } from './user-skills'

export interface DroppedFilesDeps {
  /** the normal File > Open pipeline; false = the path didn't open */
  openDocumentPath: (path: string) => boolean
  /** bring the shell window forward (the drop may land in a detached editor) */
  revealShellWindow: () => void
  /** the shared warning box; receives a localized message */
  showWarning: (message: string) => void
  /** localized template for one-or-more unsupported extensions */
  unsupportedMessage: (exts: string[]) => string
  /** what a `SKILL.md` or zip file holds as skills; undefined = not a skill file */
  skillSourceOf: (path: string) => Promise<DroppedSkillSource | undefined>
  /** hand a skill file to the settings' import preview (opens the settings on Skills) */
  importSkills: (source: DroppedSkillSource) => void
}

/**
 * Open each openable path (last drop wins activation), reveal the shell if
 * anything opened, and surface one combined warning for known-but-unsupported
 * formats instead of letting them disappear silently. A skill file goes to
 * the skills import preview; a zip that holds no skill is left alone as
 * before.
 */
export async function handleDroppedFiles(raw: unknown, deps: DroppedFilesDeps): Promise<void> {
  const { supported, skillFiles, unsupportedExts } = partitionDropPayload(raw)
  let opened = false
  for (const path of supported) opened = deps.openDocumentPath(path) || opened
  if (opened) deps.revealShellWindow()
  if (unsupportedExts.length > 0) deps.showWarning(deps.unsupportedMessage(unsupportedExts))
  for (const path of skillFiles) {
    const source = await deps.skillSourceOf(path).catch(() => undefined)
    if (source) deps.importSkills(source)
  }
}
