/**
 * On/off states. The settings file keeps only what the person changed; the
 * rest is the initial state of the skill's source. Every AI window follows the
 * same result. Project skills of the agent window are always on.
 */
import { skillEditorScope, skillEditorsChoiceOf } from '@genoffice/agent-core/skill-editors'
import { USER_SKILL_PRIORITY } from './constants'
import { parseUserSkillId } from './names'
import type {
  ResolvedUserSkill,
  UserSkill,
  UserSkillInvoke,
  UserSkillSettings,
  UserSkillSource,
  UserSkillStateSetting,
} from './types'

/** Builtin, the app's own and project skills start on; other programs' skills start off */
export function initialUserSkillState(source: UserSkillSource): {
  enabled: boolean
  invoke: UserSkillInvoke
} {
  return {
    enabled: source === 'builtin' || source === 'app' || source === 'project',
    invoke: 'auto',
  }
}

function isInvoke(value: unknown): value is UserSkillInvoke {
  return value === 'auto' || value === 'manual'
}

/**
 * Read the `skills` value of the settings file. Values of the wrong kind are
 * dropped, so the skill falls back to its initial state; project identifiers
 * are never kept.
 */
export function normalizeUserSkillSettings(raw: unknown): UserSkillSettings {
  const settings: UserSkillSettings = { states: {}, hiddenBuiltins: [] }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return settings
  const { states, hiddenBuiltins } = raw as Record<string, unknown>
  if (states && typeof states === 'object' && !Array.isArray(states)) {
    for (const [id, value] of Object.entries(states as Record<string, unknown>)) {
      const parsed = parseUserSkillId(id)
      if (!parsed || parsed.source === 'project') continue
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const { enabled, invoke, editors } = value as Record<string, unknown>
      const state: UserSkillStateSetting = {}
      if (typeof enabled === 'boolean') state.enabled = enabled
      if (isInvoke(invoke)) state.invoke = invoke
      const choice = skillEditorsChoiceOf(editors)
      if (choice) state.editors = choice
      settings.states[id] = state
    }
  }
  if (Array.isArray(hiddenBuiltins)) {
    const names = hiddenBuiltins.filter(
      (name): name is string => typeof name === 'string' && !!name,
    )
    settings.hiddenBuiltins = [...new Set(names)]
  }
  return settings
}

/**
 * Each skill with its state: the saved value over the initial one. A hidden
 * builtin and a skill that cannot be read are off. Project skills are always
 * on and used whenever the AI sees fit.
 */
export function resolveUserSkillStates(
  skills: UserSkill[],
  rawSettings: unknown,
): ResolvedUserSkill[] {
  const settings = normalizeUserSkillSettings(rawSettings)
  const hidden = new Set(settings.hiddenBuiltins.map((name) => name.toLowerCase()))
  return skills.map((skill) => {
    const initial = initialUserSkillState(skill.source)
    if (skill.source === 'project') {
      return {
        ...skill,
        enabled: skill.unreadable === undefined,
        invoke: 'auto',
        hidden: false,
        editors: skill.fileEditors,
      }
    }
    const saved = settings.states[skill.id] ?? {}
    const isHidden = skill.source === 'builtin' && hidden.has(skill.name.toLowerCase())
    return {
      ...skill,
      enabled: !isHidden && skill.unreadable === undefined && (saved.enabled ?? initial.enabled),
      invoke: saved.invoke ?? initial.invoke,
      hidden: isHidden,
      editors: skillEditorScope(saved.editors, skill.fileEditors),
    }
  })
}

function rank(skill: UserSkill): number {
  return USER_SKILL_PRIORITY.indexOf(skill.source)
}

/** Whether `a` wins over `b` on a shared name */
function wins(a: UserSkill, b: UserSkill): boolean {
  if (rank(a) !== rank(b)) return rank(a) < rank(b)
  if (a.source === 'plugin') {
    const pa = (a.plugin ?? '').toLowerCase()
    const pb = (b.plugin ?? '').toLowerCase()
    if (pa !== pb) return pa < pb
  }
  return false
}

export interface PickedUserSkills {
  /** one enabled skill per name (compared without case), in list order */
  chosen: ResolvedUserSkill[]
  /** enabled skills that lost on a shared name, with the identifier of the winner */
  shadowed: Array<{ skill: ResolvedUserSkill; by: string }>
}

/**
 * Among enabled skills only, the one per name the AI picks on its own and the
 * agent window gets under that name: project, app, builtin, Claude, Codex,
 * then plugins (by plugin name). A disabled skill never pushes another back.
 * The person may still call a pushed-back skill by choosing it.
 */
export function pickEnabledUserSkills(skills: ResolvedUserSkill[]): PickedUserSkills {
  const best = new Map<string, ResolvedUserSkill>()
  for (const skill of skills) {
    if (!skill.enabled) continue
    const key = skill.name.toLowerCase()
    const current = best.get(key)
    if (!current || wins(skill, current)) best.set(key, skill)
  }
  const chosen: ResolvedUserSkill[] = []
  const shadowed: PickedUserSkills['shadowed'] = []
  for (const skill of skills) {
    if (!skill.enabled) continue
    const winner = best.get(skill.name.toLowerCase())!
    if (winner === skill) chosen.push(skill)
    else shadowed.push({ skill, by: winner.id })
  }
  return { chosen, shadowed }
}
