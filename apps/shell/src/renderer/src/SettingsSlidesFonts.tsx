import { useEffect, useRef, useState } from 'react'
import {
  Dropdown,
  createSystemFontSource,
  fontFamilyLabel,
  partitionFontFamilies,
  useSystemFontSource,
  type DropdownOption,
} from '@genoffice/ui'
import {
  SANS_FONT_SUGGESTIONS,
  SERIF_FONT_SUGGESTIONS,
  SLIDES_AI_FONT_MODES,
  defaultSlidesAiFonts,
  isWindowsStandardFont,
  slidesAiFontRoles,
  type SlidesAiFontMode,
  type SlidesAiFonts,
} from '@genoffice/ui/slides-ai-fonts'
import {
  TEMPLATE_FONT_FACE_REGISTRATIONS,
  TEMPLATE_FONT_FAMILY_NAMES,
  templateFontUrl,
} from '@genoffice/ui/template-fonts'
import { slidesFontsText, type SlidesFontsStringKey } from './i18n/strings-slides-fonts'
import { useI18n } from './locale'

/**
 * Settings › General "AI slide fonts": which fonts AI slide generation uses when the
 * request names none (packages/ui/src/slides-ai-fonts.ts). Four cards pick the mode,
 * each drawn in its own fonts; two pickers choose the gothic and the myeongjo family.
 */

const MODE_LABEL: Record<SlidesAiFontMode, SlidesFontsStringKey> = {
  auto: 'slidesFontModeAuto',
  sans: 'slidesFontModeSans',
  serif: 'slidesFontModeSerif',
  serifTitle: 'slidesFontModeSerifTitle',
}

/** A picker header row: shown, never picked (the value cannot be a family name). */
const HEADER_PREFIX = '\u0000'

/** The app-wide handler the docs module registers; absent in tests and older builds. */
const fontSource = createSystemFontSource(async (families) =>
  families.length === 0 || !window.aiOffice.fontFamilyInfo
    ? []
    : window.aiOffice.fontFamilyInfo(families),
)

let bundledFacesRegistered = false

/**
 * The bundled faces the cards and suggestions show, registered once with this page's
 * font set. URL-backed faces load only when text first uses them, so the large serif
 * files load only once the field is drawn.
 */
function registerBundledFaces(): void {
  if (bundledFacesRegistered || typeof document === 'undefined' || typeof FontFace === 'undefined')
    return
  bundledFacesRegistered = true
  const wanted = new Set([...SANS_FONT_SUGGESTIONS, ...SERIF_FONT_SUGGESTIONS])
  for (const spec of TEMPLATE_FONT_FACE_REGISTRATIONS) {
    if (!wanted.has(spec.family)) continue
    try {
      document.fonts.add(
        new FontFace(spec.family, `url("${templateFontUrl(spec.file)}")`, {
          weight: spec.weight,
          style: 'normal',
          display: 'swap',
        }),
      )
    } catch {
      // a face that cannot be registered falls back to the system chain in the preview
    }
  }
}

function cssFamily(family: string): string {
  return `"${family.replace(/"/g, '')}", sans-serif`
}

function useSlidesAiFonts(lang: string): [SlidesAiFonts, (next: SlidesAiFonts) => void] {
  const [fonts, setFonts] = useState<SlidesAiFonts>(() => defaultSlidesAiFonts(lang))
  useEffect(() => {
    let alive = true
    void Promise.resolve(window.aiOffice.getSlidesAiFonts?.())
      .then((stored) => {
        if (alive && stored) setFonts(stored)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  const update = (next: SlidesAiFonts) => {
    setFonts(next)
    void Promise.resolve(window.aiOffice.setSlidesAiFonts?.(next))
      .then((saved) => {
        if (saved) setFonts(saved)
      })
      .catch(() => undefined)
  }
  return [fonts, update]
}

export function SlidesFontsField({ focus = false }: { readonly focus?: boolean }) {
  const { lang } = useI18n()
  const focused = useRef(false)
  // opened from the slides gallery's "Change": bring the field into view once
  const scrollToField = (el: HTMLDivElement | null) => {
    if (!el || !focus || focused.current) return
    focused.current = true
    el.scrollIntoView?.({ block: 'start' })
  }
  const text = (key: SlidesFontsStringKey) => slidesFontsText(lang, key)
  const [fonts, update] = useSlidesAiFonts(lang)
  const system = useSystemFontSource(fontSource)

  useEffect(() => {
    registerBundledFaces()
  }, [])

  const pickerOptions = (
    suggestions: readonly string[],
    current: string,
  ): Array<DropdownOption<string>> => {
    const sections = partitionFontFamilies(suggestions, system.families, TEMPLATE_FONT_FAMILY_NAMES)
    // a stored family the machine lacks stays visible (and selected) at the top
    const listed = sections.builtin.includes(current) || sections.system.includes(current)
    const suggested = listed ? sections.builtin : [current, ...sections.builtin]
    const row = (family: string): DropdownOption<string> => {
      const label = fontFamilyLabel(family, system.info)
      return {
        value: family,
        label,
        render: <span style={{ fontFamily: cssFamily(family) }}>{label}</span>,
      }
    }
    const options: Array<DropdownOption<string>> = [
      {
        value: `${HEADER_PREFIX}suggested`,
        label: text('slidesFontGroupSuggested'),
        disabled: true,
      },
      ...suggested.map(row),
    ]
    if (sections.system.length > 0) {
      options.push({
        value: `${HEADER_PREFIX}pc`,
        label: text('slidesFontGroupPc'),
        disabled: true,
      })
      // plain rows: drawing hundreds of faces would load each one
      for (const family of sections.system)
        options.push({ value: family, label: fontFamilyLabel(family, system.info) })
    }
    return options
  }

  const sansOptions = pickerOptions(SANS_FONT_SUGGESTIONS, fonts.sans)
  const serifOptions = pickerOptions(SERIF_FONT_SUGGESTIONS, fonts.serif)

  const roles = slidesAiFontRoles(fonts)
  const usedFamilies = roles ? [...new Set([roles.title, roles.body])] : []
  const notPortable = usedFamilies.filter((f) => !isWindowsStandardFont(f))

  const pick = (key: 'sans' | 'serif', value: string) => {
    if (value.startsWith(HEADER_PREFIX)) return
    update({ ...fonts, [key]: value })
  }

  return (
    <div className="set-field set-field-top" data-testid="slides-ai-fonts" ref={scrollToField}>
      <div className="set-field-stack set-slides-fonts-body">
        <div className="set-field-stack">
          <div className="set-field-label" id="set-slides-fonts-label">
            {text('setSlidesFonts')}
          </div>
          <div className="set-field-desc">{text('setSlidesFontsDesc')}</div>
        </div>
        <div
          className="set-slides-fonts-modes"
          role="radiogroup"
          aria-labelledby="set-slides-fonts-label"
        >
          {SLIDES_AI_FONT_MODES.map((mode) => {
            const r = slidesAiFontRoles({ ...fonts, mode })
            const selected = fonts.mode === mode
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`set-slides-font-card${selected ? ' selected' : ''}`}
                onClick={() => update({ ...fonts, mode })}
              >
                <span className="set-slides-font-card-name">{text(MODE_LABEL[mode])}</span>
                {r ? (
                  <>
                    <span
                      className="set-slides-font-sample-title"
                      style={{ fontFamily: cssFamily(r.title) }}
                    >
                      {text('slidesFontSampleTitle')}
                    </span>
                    <span
                      className="set-slides-font-sample-body"
                      style={{ fontFamily: cssFamily(r.body) }}
                    >
                      {text('slidesFontSampleBody')}
                    </span>
                  </>
                ) : (
                  <span className="set-slides-font-card-desc">
                    {text('slidesFontModeAutoDesc')}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="set-slides-fonts-pickers">
          <div className="set-slides-fonts-picker">
            <span className="set-slides-fonts-picker-label">{text('setSlidesFontSans')}</span>
            <Dropdown
              className="set-dd"
              value={fonts.sans}
              ariaLabel={text('setSlidesFontSans')}
              options={sansOptions}
              onPick={(v) => pick('sans', v)}
            />
          </div>
          <div className="set-slides-fonts-picker">
            <span className="set-slides-fonts-picker-label">{text('setSlidesFontSerif')}</span>
            <Dropdown
              className="set-dd"
              value={fonts.serif}
              ariaLabel={text('setSlidesFontSerif')}
              options={serifOptions}
              onPick={(v) => pick('serif', v)}
            />
          </div>
        </div>
        {notPortable.length > 0 && (
          <div className="set-field-desc" data-testid="slides-ai-fonts-portable">
            {text('slidesFontPortableHint')}
          </div>
        )}
      </div>
    </div>
  )
}
