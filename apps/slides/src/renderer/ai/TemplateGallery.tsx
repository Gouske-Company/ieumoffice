/**
 * The template gallery of the AI panel: the built-in design templates (cover
 * preview, name, one-line description, brightness), the user's saved styles
 * when there are any (name and saved date), and the template fonts notice with
 * the button that opens their folder.
 *
 * Clicking a card selects it for the document through the selection state.
 * Nothing here calls the AI or the network, and nothing is written into the
 * document: the covers are drawn from render trees the main process builds
 * from the catalog, the way the slide navigator draws its thumbnails.
 *
 * Template names are shown as they are; descriptions and brightness labels
 * come from the strings. The cover is document content: it keeps its own
 * colors in both UI themes.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
  listSlideTemplates,
  type SlideTemplate,
  type SlideTemplateScheme,
} from '@genoffice/pipelines/slides/templates'
import type { RenderSlide } from '@genoffice/pptx-render'
import type { TemplateCoverLang, TemplateSelectionKind } from '../../shared/ipc'
import { SlideThumb } from '../SlideThumb'
import { syncPrivateFonts } from '../doc-fonts'
import { useI18n, type StringKey } from '../i18n/locale'
import { strings } from '../i18n/strings'
import { loadTemplateCover, templateCoverLang } from './template-cover'
import { slidesAiFontRoles, type SlidesAiFontRoles } from '@genoffice/ui/slides-ai-fonts'
import {
  templateSelectionState,
  useTemplateSelection,
  type TemplateSelectionState,
} from './template-selection-state'

/** Element id of the gallery on the empty deck's start screen, which the selection display moves to */
export const TEMPLATE_START_GALLERY_ID = 'ai-tpl-start-gallery'

const SCHEME_KEYS: Record<SlideTemplateScheme, StringKey> = {
  light: 'aiTplSchemeLight',
  dark: 'aiTplSchemeDark',
  mixed: 'aiTplSchemeMixed',
}

/** Covers have no pictures, so the thumbnail's image cache stays empty */
const NO_IMAGES = new Map<string, HTMLImageElement>()

interface SavedStyleEntry {
  name: string
  createdAt: string
}

/** The string key of a template's translated description, or null when the strings lack one */
function descriptionKey(id: string): StringKey | null {
  const key = `aiTplDesc_${id.replace(/-/g, '_')}`
  return Object.prototype.hasOwnProperty.call(strings.zh, key) ? (key as StringKey) : null
}

/** The user's saved styles, read whenever a gallery mounts; none when the call fails */
function useSavedStyles(): SavedStyleEntry[] {
  const [saved, setSaved] = useState<SavedStyleEntry[]>([])
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const list = await window.slidesApi.listStyleTemplates()
        if (!live || !Array.isArray(list)) return
        setSaved(
          list
            .filter((s) => s && typeof s.name === 'string' && s.name)
            .map((s) => ({ name: s.name, createdAt: String(s.createdAt ?? '') })),
        )
      } catch {
        /* a stale preload or an unreadable folder: no saved group */
      }
    })()
    return () => {
      live = false
    }
  }, [])
  return saved
}

/** The rendered width of an element, followed as the panel is resized */
function useBoxWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function TemplateCoverPreview({
  id,
  coverLang,
  label,
}: {
  id: string
  coverLang: TemplateCoverLang
  label: string
}) {
  const [slide, setSlide] = useState<RenderSlide | null>(null)
  const boxRef = useRef<HTMLSpanElement>(null)
  const width = useBoxWidth(boxRef)
  useEffect(() => {
    let live = true
    setSlide(null)
    void loadTemplateCover(id, coverLang).then((cover) => {
      if (!live) return
      setSlide(cover)
      // The cover names template fonts; the layout registered them as private faces
      if (cover) void syncPrivateFonts()
    })
    return () => {
      live = false
    }
  }, [id, coverLang])
  return (
    <span ref={boxRef} className="ai-tpl-cover" role="img" aria-label={label}>
      {slide && width > 0 && <SlideThumb slide={slide} images={NO_IMAGES} width={width} />}
    </span>
  )
}

function BuiltinCard({
  template,
  selected,
  coverLang,
  onPick,
}: {
  template: SlideTemplate
  selected: boolean
  coverLang: TemplateCoverLang
  onPick: () => void
}) {
  const { t } = useI18n()
  const uid = useId()
  const descKey = descriptionKey(template.id)
  return (
    <button
      type="button"
      className="ai-tpl-card"
      data-template-id={template.id}
      aria-pressed={selected}
      aria-labelledby={`${uid}-name`}
      aria-describedby={`${uid}-desc ${uid}-scheme`}
      onClick={onPick}
    >
      <TemplateCoverPreview
        id={template.id}
        coverLang={coverLang}
        label={t('aiTplPreviewAlt', { name: template.name })}
      />
      <span className="ai-tpl-card-name" id={`${uid}-name`}>
        {template.name}
      </span>
      <span className="ai-tpl-card-desc" id={`${uid}-desc`}>
        {descKey ? t(descKey) : template.description}
      </span>
      <span className="ai-tpl-card-scheme" id={`${uid}-scheme`}>
        {t(SCHEME_KEYS[template.scheme])}
      </span>
    </button>
  )
}

function SavedCard({
  entry,
  selected,
  onPick,
}: {
  entry: SavedStyleEntry
  selected: boolean
  onPick: () => void
}) {
  const { t, dateLocale } = useI18n()
  const uid = useId()
  const at = new Date(entry.createdAt)
  const date =
    entry.createdAt && !Number.isNaN(at.getTime()) ? at.toLocaleDateString(dateLocale) : ''
  return (
    <button
      type="button"
      className="ai-tpl-card ai-tpl-card-saved"
      aria-pressed={selected}
      aria-labelledby={`${uid}-name`}
      {...(date ? { 'aria-describedby': `${uid}-date` } : {})}
      onClick={onPick}
    >
      <span className="ai-tpl-card-name" id={`${uid}-name`}>
        {entry.name}
      </span>
      {date && (
        <span className="ai-tpl-card-date" id={`${uid}-date`}>
          {t('aiTplSavedOn', { date })}
        </span>
      )}
    </button>
  )
}

/**
 * The fonts a deck generated without a template gets (Settings › General, decision
 * 0115), read when the gallery shows and again when the window comes back, since the
 * setting is changed on the Home tab. Null until read, or where the main process does
 * not answer (a standalone app without the handler).
 */
function useDefaultFonts(lang: string): SlidesAiFontRoles | null | undefined {
  const [roles, setRoles] = useState<SlidesAiFontRoles | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    const read = () => {
      void Promise.resolve(window.slidesApi.getAiDefaultFonts?.(lang))
        .then((fonts) => {
          if (alive) setRoles(fonts ? slidesAiFontRoles(fonts) : undefined)
        })
        .catch(() => undefined)
    }
    read()
    const onVisible = () => {
      if (document.visibilityState === 'visible') read()
    }
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [lang])
  return roles
}

/** One line under the cards: which fonts the next deck gets, and a way to change them. */
function DefaultFontsRow({ templateChosen }: { templateChosen: boolean }) {
  const { t, lang } = useI18n()
  const roles = useDefaultFonts(lang)
  if (roles === undefined) return null
  const line = templateChosen
    ? t('aiTplFontsTemplate')
    : roles === null
      ? t('aiTplFontsAuto')
      : roles.title === roles.body
        ? t('aiTplFontsOne', { font: roles.body })
        : t('aiTplFontsTwo', { title: roles.title, body: roles.body })
  const canChange = typeof window.slidesApi.openFontSettings === 'function'
  return (
    <div className="ai-tpl-fonts-row" data-testid="ai-tpl-default-fonts">
      <span className="ai-tpl-fonts-text">{line}</span>
      {canChange && (
        <button
          type="button"
          className="ai-tpl-foot-btn"
          onClick={() => void window.slidesApi.openFontSettings?.().catch(() => undefined)}
        >
          {t('aiTplFontsChange')}
        </button>
      )}
    </div>
  )
}

export interface TemplateGalleryProps {
  state?: TemplateSelectionState
  /** After a pick; `changed` is false when the card was already the selection */
  onPicked?: (changed: boolean) => void
  id?: string
  className?: string
}

export function TemplateGallery({
  state = templateSelectionState,
  onPicked,
  id,
  className,
}: TemplateGalleryProps) {
  const { t, lang } = useI18n()
  const uid = useId()
  const selection = useTemplateSelection(state)
  const saved = useSavedStyles()
  const coverLang = templateCoverLang(lang)

  const pick = async (kind: TemplateSelectionKind, key: string): Promise<void> => {
    const before = state.current()
    const already = before !== null && before.kind === kind && before.key === key
    const after = await state.select(kind, key)
    onPicked?.(!already && after !== null && after.kind === kind && after.key === key)
  }
  const isSelected = (kind: TemplateSelectionKind, key: string): boolean =>
    selection !== null && selection.kind === kind && selection.key === key

  const openFontsFolder = (): void => {
    void (async () => {
      try {
        await window.slidesApi.openTemplateFontsFolder()
      } catch {
        /* a stale preload: nothing to open */
      }
    })()
  }

  return (
    <section
      id={id}
      className={className ? `ai-tpl-gallery ${className}` : 'ai-tpl-gallery'}
      aria-labelledby={`${uid}-title`}
    >
      <div className="ai-tpl-gallery-title" id={`${uid}-title`}>
        {t('aiTplGalleryTitle')}
      </div>
      <div
        className="ai-tpl-group ai-tpl-group-builtin"
        role="group"
        aria-labelledby={`${uid}-builtin`}
      >
        <div className="ai-tpl-group-title" id={`${uid}-builtin`}>
          {t('aiTplSectionBuiltin')}
        </div>
        <div className="ai-tpl-grid">
          {listSlideTemplates().map((template) => (
            <BuiltinCard
              key={template.id}
              template={template}
              selected={isSelected('builtin', template.id)}
              coverLang={coverLang}
              onPick={() => void pick('builtin', template.id)}
            />
          ))}
        </div>
      </div>
      {saved.length > 0 && (
        <div
          className="ai-tpl-group ai-tpl-group-saved"
          role="group"
          aria-labelledby={`${uid}-saved`}
        >
          <div className="ai-tpl-group-title" id={`${uid}-saved`}>
            {t('aiTplSectionSaved')}
          </div>
          <div className="ai-tpl-saved-list">
            {saved.map((entry) => (
              <SavedCard
                key={entry.name}
                entry={entry}
                selected={isSelected('saved', entry.name)}
                onPick={() => void pick('saved', entry.name)}
              />
            ))}
          </div>
        </div>
      )}
      <DefaultFontsRow templateChosen={selection !== null} />
      <div className="ai-tpl-foot">
        <p className="ai-tpl-foot-note">{t('aiTplFontsNotice')}</p>
        <button type="button" className="ai-tpl-foot-btn" onClick={openFontsFolder}>
          {t('aiTplOpenFonts')}
        </button>
      </div>
    </section>
  )
}

/** The gallery as the empty deck's start screen shows it: always expanded */
export function TemplateStartGallery({ state }: { state?: TemplateSelectionState }) {
  return (
    <TemplateGallery
      state={state}
      id={TEMPLATE_START_GALLERY_ID}
      className="ai-tpl-gallery-start"
    />
  )
}
