import { describe, expect, it } from 'vitest'
import { undoDoubledEscapes, undoDoubledEscapesInList } from '../src/renderer/ai/doubled-escapes'

describe('undoDoubledEscapes', () => {
  it('turns escaped line breaks back into line breaks', () => {
    expect(undoDoubledEscapes(String.raw`가\n나`)).toBe('가\n나')
    expect(undoDoubledEscapes(String.raw`가\r\n나\r다`)).toBe('가\n나\n다')
  })

  it('undoes the quotes and tabs escaped with them, a tab as a space', () => {
    expect(undoDoubledEscapes(String.raw`\"안전\"\t수칙\n둘째`)).toBe('"안전" 수칙\n둘째')
  })

  it('leaves text with no escaped line break as it is', () => {
    expect(undoDoubledEscapes(String.raw`\"인용\"`)).toBe(String.raw`\"인용\"`)
    expect(undoDoubledEscapes('그냥 글')).toBe('그냥 글')
  })

  it('leaves text that holds a real line break as it is', () => {
    const text = '가\n' + String.raw`나\n다`
    expect(undoDoubledEscapes(text)).toBe(text)
  })

  it('leaves text with real backslashes as it is', () => {
    for (const text of [
      String.raw`C:\new`,
      String.raw`(C:\new 폴더)`,
      String.raw`C:\Users\new`,
      String.raw`\\server\new`,
      String.raw`a\\nb`,
      String.raw`끝\n뒤에 \x`,
    ]) {
      expect(undoDoubledEscapes(text)).toBe(text)
    }
  })

  it('undoes each string of a list and passes anything else through', () => {
    expect(undoDoubledEscapesInList([String.raw`가\n나`, 3])).toEqual(['가\n나', 3])
    expect(undoDoubledEscapesInList('not a list')).toBe('not a list')
  })
})
