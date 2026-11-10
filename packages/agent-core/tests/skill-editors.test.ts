import { describe, expect, it } from 'vitest'
import {
  SKILL_EDITORS,
  skillEditorScope,
  skillEditorsChoiceOf,
  skillEditorsOf,
  skillUsedIn,
} from '../src/skill-editors'

describe('skillEditorsOf (the written value)', () => {
  it('reads the ids separated by spaces, once each, in screen order', () => {
    expect(skillEditorsOf('slides  docs slides')).toEqual(['docs', 'slides'])
  })

  it('means every editor when the value is absent or empty', () => {
    expect(skillEditorsOf(undefined)).toBeUndefined()
    expect(skillEditorsOf('')).toBeUndefined()
  })

  it('leaves out ids this app does not know', () => {
    expect(skillEditorsOf('hwp future-editor')).toEqual(['hwp'])
  })

  it('means every editor when no id is known, so a newer app’s skill is not hidden', () => {
    expect(skillEditorsOf('future-editor')).toBeUndefined()
  })

  it('means every editor when it names them all', () => {
    expect(skillEditorsOf(SKILL_EDITORS.join(' '))).toBeUndefined()
  })
})

describe('skillEditorScope', () => {
  it('is every editor with nothing written and no choice', () => {
    expect(skillEditorScope(undefined, undefined)).toBeUndefined()
  })

  it('follows the skill file when the person chose nothing', () => {
    expect(skillEditorScope(undefined, ['slides'])).toEqual(['slides'])
  })

  it('takes the person’s choice over the skill file', () => {
    expect(skillEditorScope(['sheets', 'docs'], ['slides'])).toEqual(['docs', 'sheets'])
    expect(skillEditorScope('all', ['slides'])).toBeUndefined()
  })

  it('reads a stored choice of only unknown ids as every editor', () => {
    expect(skillEditorsChoiceOf(['future-editor'])).toBe('all')
    expect(skillEditorScope(skillEditorsChoiceOf(['future-editor']), ['slides'])).toBeUndefined()
  })

  it('drops a stored choice of the wrong kind', () => {
    expect(skillEditorsChoiceOf('slides')).toBeUndefined()
    expect(skillEditorsChoiceOf({ slides: true })).toBeUndefined()
  })
})

describe('skillUsedIn', () => {
  it('uses a skill in the editors of its scope only', () => {
    expect(skillUsedIn(['slides'], 'slides')).toBe(true)
    expect(skillUsedIn(['slides'], 'sheets')).toBe(false)
  })

  it('uses every skill where no editor asks (home ask, agent window)', () => {
    expect(skillUsedIn(['slides'], undefined)).toBe(true)
  })

  it('uses a skill with no scope everywhere', () => {
    expect(skillUsedIn(undefined, 'sheets')).toBe(true)
  })
})
