/**
 * Lines of a skill the import preview points at: asking the AI to drop
 * earlier instructions, to hide what it does from the person, to take
 * instructions from an outside address, and paths that climb out with `../`.
 * The preview only shows them; nothing is blocked, because a list of patterns
 * misses things and must not read as a safety check.
 */
import { extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { MAX_USER_SKILL_BYTES, MAX_USER_SKILL_FILES, SKILL_TEXT_EXTENSIONS } from './constants'
import { listSkillFolderFiles } from './folder'

function anyOf(...sources: readonly RegExp[]): RegExp {
  return new RegExp(sources.map((source) => source.source).join('|'), 'i')
}

/**
 * The one table of what the preview points at. `messageKey` is the settings
 * screen's string for the rule; each rule is tried on every line on its own.
 */
export const SKILL_WARNING_RULES = [
  {
    id: 'ignore-instructions',
    messageKey: 'warnIgnoreInstructions',
    pattern: anyOf(
      /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+|of\s+)*(?:previous|prior|earlier|above|preceding|original|system|other)\s+(?:instructions?|prompts?|rules|directions|guidelines)\b/,
      /(?:앞|이전|위|기존|원래|시스템)(?:의|에서)?\s*(?:모든\s*)?(?:지시|명령|지침|규칙|프롬프트)\S*\s*(?:모두\s*|전부\s*|다\s*)?무시/,
    ),
  },
  {
    id: 'hide-from-user',
    messageKey: 'warnHideFromUser',
    pattern: anyOf(
      /\b(?:do\s+not|don't|never)\s+(?:tell|inform|notify|alert|show|let|mention\s+(?:this\s+|it\s+)?to|reveal\s+(?:this\s+|it\s+)?to)\s+(?:the\s+)?user\b/,
      /\bwithout\s+(?:telling|informing|notifying|alerting)\s+(?:the\s+)?user\b/,
      /\b(?:hide|conceal|keep)\b[^\n.]{0,40}\bfrom\s+(?:the\s+)?user\b/,
      /사용자(?:에게|한테|가)?\s*(?:알리지|말하지|보여\s*주지|보이지|밝히지|알려\s*주지)\s*(?:마|말)/,
      /사용자\s*몰래|사용자(?:에게|한테)\s*(?:숨기|감추)/,
    ),
  },
  {
    id: 'remote-instructions',
    messageKey: 'warnRemoteInstructions',
    pattern: anyOf(
      /\b(?:fetch|download|load|retrieve|get|read|follow|obtain|pull)\b[^\n]{0,80}?\b(?:instructions?|prompts?|rules|directions|commands)\b[^\n]{0,40}?\bfrom\s+<?https?:\/\//,
      /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^\n|]*\|\s*(?:(?:ba|z)?sh|iex|python3?|node)\b/,
      /https?:\/\/\S+\s*(?:에서|의)\s*(?:\S+\s+){0,2}?(?:지시|지침|명령|프롬프트|규칙)\S*\s*(?:받아|가져|읽어|따르|불러)/,
      /(?:지시|지침|명령|프롬프트|규칙)\S*\s*(?:받아|가져와|읽어|따르|불러)[^\n]{0,40}https?:\/\//,
    ),
  },
  {
    id: 'parent-path',
    messageKey: 'warnParentPath',
    pattern: /(?:^|[\s"'`([=:,\\/])\.\.[\\/]/,
  },
] as const satisfies ReadonlyArray<{ id: string; messageKey: string; pattern: RegExp }>

export type SkillWarningRule = (typeof SKILL_WARNING_RULES)[number]
export type SkillWarningRuleId = SkillWarningRule['id']
export type SkillWarningMessageKey = SkillWarningRule['messageKey']

/** One line the preview points at */
export interface SkillWarning {
  rule: SkillWarningRuleId
  messageKey: SkillWarningMessageKey
  /** the file inside the skill folder, `/` between parts */
  file: string
  /** 1-based */
  line: number
  /** the line, trimmed and cut short */
  excerpt: string
}

/** How many hits a preview lists (the total is given too) */
export const SKILL_PREVIEW_WARNING_COUNT = 20

/** How much of a line a hit shows */
export const SKILL_WARNING_EXCERPT_CHARS = 160

/** Files larger than this are not searched */
export const SKILL_WARNING_SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024

function excerptOf(line: string): string {
  const trimmed = line.trim()
  return trimmed.length > SKILL_WARNING_EXCERPT_CHARS
    ? `${trimmed.slice(0, SKILL_WARNING_EXCERPT_CHARS)}…`
    : trimmed
}

/** The hits in one text, line by line, rules in table order within a line */
export function skillWarningsInText(text: string, file: string): SkillWarning[] {
  const hits: SkillWarning[] = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    for (const rule of SKILL_WARNING_RULES) {
      if (!rule.pattern.test(line)) continue
      hits.push({
        rule: rule.id,
        messageKey: rule.messageKey,
        file,
        line: index + 1,
        excerpt: excerptOf(line),
      })
    }
  }
  return hits
}

/** The hits in a skill folder's text files, `SKILL.md` first, then by path */
export async function findSkillWarnings(
  dir: string,
  maxFileBytes = SKILL_WARNING_SEARCH_MAX_FILE_BYTES,
): Promise<SkillWarning[]> {
  const listed = await listSkillFolderFiles(dir, {
    files: MAX_USER_SKILL_FILES,
    bytes: MAX_USER_SKILL_BYTES,
  })
  const files = (listed?.files ?? []).filter(
    (file) =>
      SKILL_TEXT_EXTENSIONS.has(extname(file.rel).toLowerCase()) && file.size <= maxFileBytes,
  )
  const skillMdFirst = [
    ...files.filter((file) => file.rel === 'SKILL.md'),
    ...files.filter((file) => file.rel !== 'SKILL.md'),
  ]
  const hits: SkillWarning[] = []
  for (const file of skillMdFirst) {
    const text = await readFile(file.path, 'utf8').catch(() => '')
    hits.push(...skillWarningsInText(text, file.rel))
  }
  return hits
}
