/**
 * Where a skill is used: every editor, or only some of them (decision 0122).
 * The skill's author writes `metadata.ieum-editors` (editor ids separated by
 * spaces); the person may set their own choice in the app settings for a
 * skill they cannot edit. Every list that filters by editor reads the scope
 * through `skillEditorScope` and `skillUsedIn` here.
 *
 * A file with no imports, exported as `@genoffice/agent-core/skill-editors`,
 * for the same reason as `user-skill-names.ts`: an editor's main process that
 * leaves the packages unbundled loads this source as it is.
 */

/** The editors' own ids (the shell's document tab kinds), in the order the screens list them */
export const SKILL_EDITORS = [
  'docs',
  'sheets',
  'slides',
  'hwp',
  'pdf',
  'markdown',
  'html',
  'mindmap',
  'epub',
  'diagram',
] as const

export type SkillEditorId = (typeof SKILL_EDITORS)[number]

/**
 * A person's choice for one skill as the settings file keeps it: every
 * editor, or only these (known ids, at least one).
 */
export type SkillEditorsChoice = 'all' | SkillEditorId[]

export function isSkillEditorId(value: unknown): value is SkillEditorId {
  return typeof value === 'string' && (SKILL_EDITORS as readonly string[]).includes(value)
}

/**
 * The known editor ids of a written value (the front matter's text, or a
 * list), once each and in screen order. Ids this app does not know are left
 * out; `undefined` when no known id is left, which means every editor, so a
 * skill written for a newer app's editor is never hidden here.
 */
export function skillEditorsOf(value: unknown): SkillEditorId[] | undefined {
  const parts =
    typeof value === 'string' ? value.split(/[\s,]+/) : Array.isArray(value) ? value : []
  const known = new Set(parts.filter(isSkillEditorId))
  const editors = SKILL_EDITORS.filter((id) => known.has(id))
  return editors.length > 0 && editors.length < SKILL_EDITORS.length ? editors : undefined
}

/** A stored or sent choice: `'all'`, or a list read like the front matter's */
export function skillEditorsChoiceOf(value: unknown): SkillEditorsChoice | undefined {
  if (value === 'all') return 'all'
  if (!Array.isArray(value)) return undefined
  return skillEditorsOf(value) ?? 'all'
}

/**
 * The editors a skill is used in: the person's choice over the skill's own
 * value; `undefined` means every editor.
 */
export function skillEditorScope(
  choice: SkillEditorsChoice | undefined,
  fromFile: readonly SkillEditorId[] | undefined,
): SkillEditorId[] | undefined {
  if (choice === 'all') return undefined
  return skillEditorsOf(choice ?? fromFile)
}

/**
 * Whether a skill with this scope is listed and used in `editor`. No editor
 * (home ask, the agent window) uses every skill.
 */
export function skillUsedIn(
  scope: readonly string[] | undefined,
  editor: SkillEditorId | undefined,
): boolean {
  if (!editor) return true
  const editors = skillEditorsOf(scope)
  return !editors || editors.includes(editor)
}
