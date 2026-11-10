import React, { useId } from 'react'
import type { Lang } from '@genoffice/i18n'
import { SKILL_EDITORS, type SkillEditorId } from '@genoffice/agent-core'
import { skillEditorsText } from './strings-skill-editors'
import './skill-editors.css'

/**
 * Where a skill is used, as a chooser holds it: every editor, or the checked
 * editors. An empty list is the one state a save refuses (nothing checked yet).
 */
export type SkillEditorsDraft = 'all' | SkillEditorId[]

/** An editor's name in the UI language */
export function skillEditorName(lang: Lang, editor: SkillEditorId): string {
  return skillEditorsText(lang, `editor_${editor}`)
}

/** The short line a list shows for a skill not used everywhere ("Used in: Slides"); '' otherwise */
export function skillEditorsSummary(
  lang: Lang,
  editors: readonly SkillEditorId[] | undefined,
): string {
  if (!editors || editors.length === 0) return ''
  return skillEditorsText(lang, 'summary', {
    editors: editors.map((editor) => skillEditorName(lang, editor)).join(', '),
  })
}

/** The draft with one editor checked or unchecked, in screen order */
export function withSkillEditor(
  draft: SkillEditorsDraft,
  editor: SkillEditorId,
  checked: boolean,
): SkillEditorsDraft {
  const now = draft === 'all' ? [] : draft
  return SKILL_EDITORS.filter((id) => (id === editor ? checked : now.includes(id)))
}

/**
 * The "where it is used" chooser of the skill card and the settings editor:
 * every editor, or only the checked ones.
 */
export function SkillEditorsChooser({
  lang,
  value,
  onChange,
  disabled = false,
  note,
}: {
  lang: Lang
  value: SkillEditorsDraft
  onChange: (value: SkillEditorsDraft) => void
  disabled?: boolean | undefined
  /** a line under the chooser (where the choice is kept) */
  note?: string | undefined
}): React.JSX.Element {
  const t = (key: Parameters<typeof skillEditorsText>[1]) => skillEditorsText(lang, key)
  const group = useId()
  const some = value !== 'all'
  return (
    <fieldset
      className="ai-skill-editors"
      disabled={disabled}
      data-skill-editors={some ? value.join(' ') : 'all'}
    >
      <legend>{t('label')}</legend>
      <div className="ai-skill-editors-modes">
        <label>
          <input type="radio" name={group} checked={!some} onChange={() => onChange('all')} />
          {t('all')}
        </label>
        <label>
          <input
            type="radio"
            name={group}
            checked={some}
            onChange={() => onChange(some ? value : [])}
          />
          {t('some')}
        </label>
      </div>
      {some && (
        <div className="ai-skill-editors-list">
          {SKILL_EDITORS.map((editor) => (
            <label key={editor}>
              <input
                type="checkbox"
                value={editor}
                checked={value.includes(editor)}
                onChange={(e) => onChange(withSkillEditor(value, editor, e.target.checked))}
              />
              {skillEditorName(lang, editor)}
            </label>
          ))}
        </div>
      )}
      {some && (
        <p className={`ai-skill-editors-hint${value.length === 0 ? ' is-error' : ''}`}>
          {t(value.length === 0 ? 'none' : 'hintSome')}
        </p>
      )}
      {note && <p className="ai-skill-editors-hint">{note}</p>}
    </fieldset>
  )
}
