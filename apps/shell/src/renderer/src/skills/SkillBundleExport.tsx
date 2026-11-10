import { useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { UserSkillsBridge } from '@genoffice/electron-utils/user-skills-bridge'
import type { UserSkillView } from '@genoffice/electron-utils/user-skills-channels'
import { skillsText, type SkillsStringKey } from '../i18n/strings-skills'
import { SkillDialog } from './SkillDialog'
import type { SkillsNotice } from './SkillImport'
import { failureKey, skillDisplayTitle } from './skills-model'

type Text = (key: SkillsStringKey, params?: Record<string, string | number>) => string

/**
 * Several own skills into one zip, a folder per skill: tick them, read the
 * template note when a ticked one carries a document, then choose where it
 * goes. Nothing is ticked at first.
 */
export function SkillBundleExportDialog({
  api,
  views,
  lang,
  onDone,
  onClose,
}: {
  api: Pick<UserSkillsBridge, 'exportBundle'>
  /** the skills that may be exported */
  views: UserSkillView[]
  lang: Lang
  onDone: (notice: SkillsNotice) => void
  onClose: () => void
}) {
  const s: Text = (key, params) => skillsText(lang, key, params)
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const chosen = views.filter((v) => checked.has(v.id))
  const withTemplate = chosen.some((v) => v.template && v.templateExists)

  const toggle = (id: string) => {
    setChecked((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const run = async () => {
    if (busy || chosen.length === 0) return
    setBusy(true)
    const answer = await api.exportBundle(chosen.map((v) => v.id))
    setBusy(false)
    if (answer.ok) {
      onDone({ tone: 'ok', text: s('exported', { path: answer.path }) })
      return
    }
    // a cancelled save dialog leaves the choice open
    const key = failureKey(answer.reason)
    if (key) onDone({ tone: 'error', text: s(key) })
  }

  return (
    <SkillDialog
      label={s('bundleTitle')}
      onCancel={onClose}
      footer={
        <>
          <button type="button" className="set-btn" onClick={onClose}>
            {s('cancel')}
          </button>
          <button
            type="button"
            className="set-btn primary"
            disabled={busy || chosen.length === 0}
            onClick={() => void run()}
          >
            {s('bundleExport', { n: chosen.length })}
          </button>
        </>
      }
    >
      <p className="set-field-desc">{s('bundleIntro')}</p>
      <ul className="skl-candidates">
        {views.map((v) => {
          const title = skillDisplayTitle(v)
          return (
            <li key={v.id} className="skl-candidate" data-skill-id={v.id}>
              <input
                type="checkbox"
                className="skl-check"
                checked={checked.has(v.id)}
                disabled={busy}
                aria-label={s('bundleSelectLabel', { title })}
                onChange={() => toggle(v.id)}
              />
              <div className="skl-candidate-main">
                <div className="skl-row-head">
                  <span className="skl-row-title">{title}</span>
                  <code className="skl-name">{v.name}</code>
                </div>
                {v.template && v.templateExists && (
                  <div className="skl-badges">
                    <span className="skl-badge">{s('badgeTemplate')}</span>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {withTemplate && (
        <p className="skl-warning" role="note">
          {s('exportNotice')}
        </p>
      )}
    </SkillDialog>
  )
}
