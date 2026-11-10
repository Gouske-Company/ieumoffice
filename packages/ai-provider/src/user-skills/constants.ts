/**
 * Fixed values of the person's skills. The name rule for reading and the size
 * limits are the same as the agent session's skill copy
 * (`agent-session/skills.ts`), so a skill the list accepts is one the agent
 * window can take too.
 */
import type { UserSkillSource } from './types'

/** Every source value; these are stored in the settings file and never change */
export const USER_SKILL_SOURCES: readonly UserSkillSource[] = [
  'builtin',
  'app',
  'user',
  'plugin',
  'codex',
  'project',
]

/** Names read from any source (same as the agent session's copy) */
export const USER_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** The longest name the app gives a new skill */
export const NEW_USER_SKILL_NAME_MAX = 64

/** Folder size limits (same as the agent session's copy) */
export const MAX_USER_SKILL_BYTES = 64 * 1024 * 1024
export const MAX_USER_SKILL_FILES = 5_000

/**
 * Names never read from any source, compared without case: the upstream
 * program's skill and this app's own command-line skill. Defined once in
 * agent-core (which this package builds on) for the windows' lists too.
 */
export { RESERVED_USER_SKILL_NAMES } from '@genoffice/agent-core/user-skill-names'

/** A file with one of these extensions makes a skill "with scripts" */
export const SKILL_SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.py',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.exe',
])

/** A folder with this name anywhere in a skill makes it "with scripts" */
export const SKILL_SCRIPTS_FOLDER = 'scripts'

/** Text files the app reads from a skill folder (web address search, the AI's file reads) */
export const SKILL_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.txt',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.xml',
  '.html',
  '.css',
])

/** The GitHub source record kept in an installed skill's folder; left out of the content hash */
export const IEUM_SOURCE_FILE = '.ieum-source.json'

/** The list of builtin skills next to their folders */
export const BUILTIN_SKILLS_MANIFEST = 'builtin-skills.json'

/** The only folder a template may sit under, relative to the skill folder */
export const SKILL_TEMPLATE_FOLDER = 'assets'

/** Front matter keys of this app, under `metadata` */
export const IEUM_TITLE_KEY = 'ieum-title'
export const IEUM_TEMPLATE_KEY = 'ieum-template'
/** the editors the skill is for, ids separated by spaces; absent: every editor (decision 0122) */
export const IEUM_EDITORS_KEY = 'ieum-editors'

/**
 * Which enabled skill wins when two share a name, first wins. Plugins among
 * themselves go by plugin name.
 */
export const USER_SKILL_PRIORITY: readonly UserSkillSource[] = [
  'project',
  'app',
  'builtin',
  'user',
  'codex',
  'plugin',
]
