/**
 * The main-process side of the Settings › General slide fonts: reading the stored
 * choice, and filling the runs a generated page leaves without a font.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PageSpec } from '@genoffice/pipelines/slides'
import {
  TITLE_ROLE_MIN_PT,
  fillMissingRunFonts,
  parseFontRoles,
  readSlidesAiFonts,
} from '../src/main/ai-default-fonts'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function userData(settings?: unknown): { getPath: () => string } {
  const dir = mkdtempSync(join(tmpdir(), 'slides-ai-fonts-'))
  dirs.push(dir)
  mkdirSync(dir, { recursive: true })
  if (settings !== undefined)
    writeFileSync(
      join(dir, 'app-settings.json'),
      typeof settings === 'string' ? settings : JSON.stringify(settings),
    )
  return { getPath: () => dir }
}

describe('readSlidesAiFonts', () => {
  it('reads the stored choice', () => {
    const app = userData({
      language: 'ko',
      slidesAiFonts: { mode: 'serifTitle', sans: 'Malgun Gothic', serif: 'Batang' },
    })
    expect(readSlidesAiFonts(app, 'ko')).toEqual({
      mode: 'serifTitle',
      sans: 'Malgun Gothic',
      serif: 'Batang',
    })
  })

  it('without a file or a choice, the UI language picks the default', () => {
    expect(readSlidesAiFonts(userData(), 'ko').mode).toBe('sans')
    expect(readSlidesAiFonts(userData({ language: 'ja' }), 'ja').mode).toBe('auto')
    expect(readSlidesAiFonts(userData('{not json'), 'en')).toEqual({
      mode: 'sans',
      sans: 'Pretendard',
      serif: 'Noto Serif KR',
    })
  })
})

const spec = (runs: Array<{ text: string; sizePt?: number; font?: string }>): PageSpec => ({
  elements: [
    { type: 'text', x: 0, y: 0, w: 100, h: 20, paragraphs: [{ runs }] },
    { type: 'image', x: 0, y: 0, w: 10, h: 10, url: 'https://example.com/a.png' },
    { type: 'shape', shape: 'rect', x: 0, y: 0, w: 10, h: 10 },
  ],
})

describe('fillMissingRunFonts', () => {
  const roles = { title: 'Noto Serif KR', body: 'Pretendard' }

  it('titles take the title family, other runs the body family', () => {
    const out = fillMissingRunFonts(
      spec([
        { text: 'Big', sizePt: TITLE_ROLE_MIN_PT },
        { text: 'Small', sizePt: TITLE_ROLE_MIN_PT - 1 },
        { text: 'No size' },
      ]),
      roles,
    )
    const runs = out.elements[0]!.type === 'text' ? out.elements[0]!.paragraphs[0]!.runs : []
    expect(runs.map((r) => r.font)).toEqual(['Noto Serif KR', 'Pretendard', 'Pretendard'])
  })

  it('a run that names a font keeps it, and an untouched spec is returned as is', () => {
    const named = spec([{ text: 'Asked for', sizePt: 40, font: 'Gungsuh' }])
    expect(fillMissingRunFonts(named, roles)).toBe(named)
  })

  it('shape labels are filled too; images and label-less shapes are left alone', () => {
    const s: PageSpec = {
      elements: [
        {
          type: 'shape',
          shape: 'roundRect',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          paragraphs: [{ runs: [{ text: 'Label', sizePt: 14 }] }],
        },
      ],
    }
    const out = fillMissingRunFonts(s, roles)
    const el = out.elements[0]!
    expect(el.type === 'shape' ? el.paragraphs?.[0]?.runs[0]?.font : undefined).toBe('Pretendard')
  })
})

describe('parseFontRoles', () => {
  it('accepts two family names and rejects anything else', () => {
    expect(parseFontRoles({ title: ' A ', body: 'B' })).toEqual({ title: 'A', body: 'B' })
    expect(parseFontRoles({ title: 'A' })).toBeNull()
    expect(parseFontRoles({ title: '', body: 'B' })).toBeNull()
    expect(parseFontRoles({ title: 'x'.repeat(81), body: 'B' })).toBeNull()
    expect(parseFontRoles('Pretendard')).toBeNull()
    expect(parseFontRoles(null)).toBeNull()
  })
})
