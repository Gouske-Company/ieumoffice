import { describe, expect, it } from 'vitest'
import { cardSaveInputOf, saveInputOf, statePatchOf } from '../src/user-skills-channels'

describe('where-used values crossing to the main process', () => {
  it('takes a where-used choice as a state change', () => {
    expect(statePatchOf({ editors: ['slides'] })).toEqual({ editors: ['slides'] })
    expect(statePatchOf({ editors: 'all' })).toEqual({ editors: 'all' })
  })

  it('drops a malformed where-used choice', () => {
    expect(statePatchOf({ editors: 'slides' })).toBeUndefined()
    expect(statePatchOf({ editors: [1] })).toBeUndefined()
    expect(statePatchOf({ editors: Array(33).fill('docs') })).toBeUndefined()
  })

  it('carries the editors of a save, and refuses a save with malformed ones', () => {
    const save = { title: '', description: 'd', body: 'b' }
    expect(saveInputOf({ ...save, editors: ['hwp'] })).toMatchObject({ editors: ['hwp'] })
    expect(saveInputOf({ ...save, editors: 'hwp' })).toBeUndefined()
    const card = { ...save, name: 'n', invoke: 'auto' }
    expect(cardSaveInputOf({ ...card, editors: 'all' })).toMatchObject({ editors: 'all' })
    expect(cardSaveInputOf(card)).not.toHaveProperty('editors')
  })
})
