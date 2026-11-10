/**
 * SKILL.md front matter read and written by the app, the strict rule for new
 * names, name suggestions, the folder content hash, and web addresses in text.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findSkillUrls,
  findUrlsInText,
  isReservedUserSkillName,
  parseSkillMd,
  renderSkillMd,
  skillContentHash,
  suggestUserSkillName,
  validateNewUserSkillName,
} from '../src/user-skills'

const roots: string[] = []
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'user-skills-fm-'))
  roots.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('reading front matter', () => {
  it('reads name, description and the metadata map', () => {
    const parsed = parseSkillMd(
      '---\nname: home-letter\ndescription: Writes a letter.\nmetadata:\n  ieum-title: 가정통신문\n  ieum-template: assets/양식.hwpx\n  author: someone\n---\n# Body\n',
    )
    expect(parsed).toMatchObject({
      name: 'home-letter',
      description: 'Writes a letter.',
      metadata: {
        'ieum-title': '가정통신문',
        'ieum-template': 'assets/양식.hwpx',
        author: 'someone',
      },
      body: '# Body\n',
    })
  })

  it('reads literal and folded multi-line descriptions', () => {
    expect(
      parseSkillMd(
        '---\nname: a\ndescription: |\n  Line one.\n  Line two.\n\n  After a gap.\n---\n',
      )?.description,
    ).toBe('Line one.\nLine two.\n\nAfter a gap.\n')
    expect(parseSkillMd('---\nname: a\ndescription: |-\n  One.\n  Two.\n---\n')?.description).toBe(
      'One.\nTwo.',
    )
    expect(
      parseSkillMd('---\nname: a\ndescription: >\n  One\n  two.\n\n  Three.\n---\n')?.description,
    ).toBe('One two.\nThree.\n')
    expect(parseSkillMd('---\nname: a\ndescription: >-\n  One\n  two.\n---\n')?.description).toBe(
      'One two.',
    )
  })

  it('reads plain values that wrap, quoted values, comments, CRLF and a BOM', () => {
    expect(
      parseSkillMd('---\nname: a\ndescription: Starts here\n  and goes on.\n---\n')?.description,
    ).toBe('Starts here and goes on.')
    expect(
      parseSkillMd('---\nname: "a"\ndescription: "Say \\"hi\\": now\\n"\n---\n'),
    ).toMatchObject({
      name: 'a',
      description: 'Say "hi": now\n',
    })
    expect(parseSkillMd("---\nname: 'a'\ndescription: 'It''s: fine'\n---\n")?.description).toBe(
      "It's: fine",
    )
    expect(parseSkillMd('---\nname: a # the name\ndescription: x\n---\n')?.name).toBe('a')
    expect(
      parseSkillMd('\ufeff---\r\nname: a\r\ndescription: |\r\n  x\r\n  y\r\n---\r\nbody\r\n'),
    ).toMatchObject({
      name: 'a',
      description: 'x\ny\n',
      body: 'body\r\n',
    })
  })

  it('returns nothing without front matter', () => {
    expect(parseSkillMd('# Just a body\n')).toBeUndefined()
    expect(parseSkillMd('---\nname: a\nno end')).toBeUndefined()
    expect(parseSkillMd('')).toBeUndefined()
  })

  it('accepts an empty front matter block', () => {
    expect(parseSkillMd('---\n---\nbody')).toMatchObject({
      name: undefined,
      description: undefined,
      body: 'body',
    })
  })
})

describe('writing front matter', () => {
  it('writes the standard shape with the app values under metadata', () => {
    const text = renderSkillMd({
      name: 'home-letter',
      description: 'Writes a letter home.',
      title: '가정통신문',
      template: 'assets/양식.hwpx',
      body: '# Steps\n',
    })
    expect(text).toBe(
      '---\nname: home-letter\ndescription: Writes a letter home.\nmetadata:\n  ieum-title: 가정통신문\n  ieum-template: assets/양식.hwpx\n---\n# Steps\n',
    )
  })

  it('round-trips a multi-line description and values that need quoting', () => {
    const input = {
      name: 'tricky',
      description: 'First line: with a colon.\n  Indented second line.\n# not a comment\n',
      title: '- starts with a dash: and "quotes"',
      template: undefined,
      body: 'Body\n',
    }
    const parsed = parseSkillMd(renderSkillMd(input))
    expect(parsed).toMatchObject({
      name: 'tricky',
      description: input.description,
      metadata: { 'ieum-title': input.title },
      body: 'Body\n',
    })
    for (const value of [
      'yes',
      'true',
      '123',
      '',
      ' padded ',
      '#hash',
      'a #b',
      "it's",
      '@x',
      '*y',
      '{a}',
      '[b]',
      '"q"',
      'x: y',
    ]) {
      const again = parseSkillMd(renderSkillMd({ name: 'n', description: value, body: '' }))
      expect(again?.description, JSON.stringify(value)).toBe(value)
    }
  })

  it('leaves metadata out when there is no title or template', () => {
    expect(renderSkillMd({ name: 'a', description: 'b', body: 'c' })).toBe(
      '---\nname: a\ndescription: b\n---\nc',
    )
  })

  it('keeps other keys and other metadata of the file it rewrites', () => {
    const base =
      '---\nname: old\nlicense: MIT\ndescription: Old.\nmetadata:\n  author: me\n  ieum-title: Old title\nallowed-tools:\n  - Read\n---\nOld body\n'
    const text = renderSkillMd(
      {
        name: 'new-name',
        description: 'New.',
        title: 'New title',
        template: 'assets/a.docx',
        body: 'New body\n',
      },
      base,
    )
    expect(text).toBe(
      '---\nname: new-name\nlicense: MIT\ndescription: New.\nmetadata:\n  author: me\n  ieum-title: New title\n  ieum-template: assets/a.docx\nallowed-tools:\n  - Read\n---\nNew body\n',
    )
    const parsed = parseSkillMd(text)
    expect(parsed?.metadata).toEqual({
      author: 'me',
      'ieum-title': 'New title',
      'ieum-template': 'assets/a.docx',
    })
  })

  it('writes, keeps and takes out the editors without touching the rest', () => {
    const base =
      '---\nname: deck\nlicense: MIT\ndescription: d\nmetadata:\n  author: me # kept\n  ieum-title: T\n---\nBody\n'
    const input = { name: 'deck', description: 'd', title: 'T', body: 'Body\n' }
    const written = renderSkillMd({ ...input, editors: 'slides docs' }, base)
    expect(written).toBe(
      '---\nname: deck\nlicense: MIT\ndescription: d\nmetadata:\n  author: me # kept\n  ieum-title: T\n  ieum-editors: slides docs\n---\nBody\n',
    )
    expect(renderSkillMd(input, written)).toBe(written)
    expect(renderSkillMd({ ...input, editors: null }, written)).toBe(base)
  })

  it('drops the app values it is told to drop and adds extra keys', () => {
    const base = '---\nname: a\ndescription: b\nmetadata:\n  ieum-title: T\n---\nx'
    expect(renderSkillMd({ name: 'a', description: 'b', body: 'x' }, base)).toBe(
      '---\nname: a\ndescription: b\n---\nx',
    )
    expect(
      renderSkillMd({
        name: 'a',
        description: 'b',
        body: 'x',
        fields: { 'disable-model-invocation': true },
      }),
    ).toBe('---\nname: a\ndescription: b\ndisable-model-invocation: true\n---\nx')
  })

  it('round-trips a parsed file unchanged when nothing changes', () => {
    const original =
      '---\nname: deck\ndescription: |\n  Makes decks.\n  Second line.\nmetadata:\n  ieum-title: 발표\n---\n# Deck\n\nSteps.\n'
    const parsed = parseSkillMd(original)!
    const again = renderSkillMd(
      {
        name: parsed.name!,
        description: parsed.description!,
        title: parsed.metadata['ieum-title'],
        template: parsed.metadata['ieum-template'],
        body: parsed.body,
      },
      original,
    )
    expect(parseSkillMd(again)).toEqual(parsed)
  })
})

describe('new names', () => {
  it('accepts the strict standard shape only', () => {
    expect(validateNewUserSkillName('home-letter')).toBeUndefined()
    expect(validateNewUserSkillName('a')).toBeUndefined()
    expect(validateNewUserSkillName('a1-b2')).toBeUndefined()
    expect(validateNewUserSkillName('x'.repeat(64))).toBeUndefined()
    expect(validateNewUserSkillName('')).toBe('empty')
    expect(validateNewUserSkillName('x'.repeat(65))).toBe('too-long')
    expect(validateNewUserSkillName('Home')).toBe('characters')
    expect(validateNewUserSkillName('a_b')).toBe('characters')
    expect(validateNewUserSkillName('a.b')).toBe('characters')
    expect(validateNewUserSkillName('가정')).toBe('characters')
    expect(validateNewUserSkillName('-a')).toBe('hyphen-edge')
    expect(validateNewUserSkillName('a-')).toBe('hyphen-edge')
    expect(validateNewUserSkillName('a--b')).toBe('double-hyphen')
    expect(validateNewUserSkillName('genoffice')).toBe('reserved')
    expect(validateNewUserSkillName('ieumoffice')).toBe('reserved')
  })

  it('knows the reserved names in any case', () => {
    expect(isReservedUserSkillName('GenOffice')).toBe(true)
    expect(isReservedUserSkillName('IEUMOFFICE')).toBe(true)
    expect(isReservedUserSkillName('genoffice-x')).toBe(false)
  })

  it('suggests an English name from a title, or a short random one', () => {
    expect(suggestUserSkillName('Meeting Minutes!')).toBe('meeting-minutes')
    expect(suggestUserSkillName('  Café  Notes__v2 ')).toBe('cafe-notes-v2')
    expect(suggestUserSkillName('가정통신문', { random: () => 'ab12cd' })).toBe('skill-ab12cd')
    expect(suggestUserSkillName('GenOffice', { random: () => 'zz' })).toBe('skill-zz')
    expect(suggestUserSkillName('x'.repeat(80)).length).toBe(64)
    expect(suggestUserSkillName('a'.repeat(63) + ' b')).toBe('a'.repeat(63))
    expect(suggestUserSkillName('Report', { taken: ['report', 'REPORT-2'] })).toBe('report-3')
    const random = suggestUserSkillName('한글')
    expect(random).toMatch(/^skill-[a-z0-9]{6}$/)
    expect(validateNewUserSkillName(random)).toBeUndefined()
  })
})

describe('content hash', () => {
  function folder(): string {
    const dir = join(temp(), 'skill')
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: s\ndescription: d\n---\nbody\n')
    writeFileSync(join(dir, 'references', 'a.md'), 'alpha')
    return dir
  }

  it('is stable and ignores the GitHub source record', async () => {
    const dir = folder()
    const first = await skillContentHash(dir)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(await skillContentHash(dir)).toBe(first)
    writeFileSync(join(dir, '.ieum-source.json'), '{"kind":"github"}')
    expect(await skillContentHash(dir)).toBe(first)
    const other = folder()
    expect(await skillContentHash(other)).toBe(first)
  })

  it('changes with contents, paths and new files', async () => {
    const dir = folder()
    const first = await skillContentHash(dir)
    writeFileSync(join(dir, 'references', 'a.md'), 'alphb')
    const changed = await skillContentHash(dir)
    expect(changed).not.toBe(first)
    writeFileSync(join(dir, 'references', 'a.md'), 'alpha')
    expect(await skillContentHash(dir)).toBe(first)
    rmSync(join(dir, 'references', 'a.md'))
    writeFileSync(join(dir, 'references', 'b.md'), 'alpha')
    expect(await skillContentHash(dir)).not.toBe(first)
    rmSync(join(dir, 'references', 'b.md'))
    writeFileSync(join(dir, 'references', 'a.md'), 'alpha')
    mkdirSync(join(dir, 'references', 'deeper'))
    writeFileSync(join(dir, 'references', 'deeper', '.ieum-source.json'), 'x')
    expect(await skillContentHash(dir)).not.toBe(first)
  })
})

describe('web addresses', () => {
  it('finds http and https addresses once each, without trailing punctuation', () => {
    expect(
      findUrlsInText(
        'See https://example.com/a?b=1. Also (http://x.org/path), <https://example.com/a?b=1> and ftp://no.\nhttps://y.io/z;',
      ),
    ).toEqual(['https://example.com/a?b=1', 'http://x.org/path', 'https://y.io/z'])
  })

  it('looks in the text files of a skill folder only', async () => {
    const dir = join(temp(), 'skill')
    mkdirSync(join(dir, 'references'), { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: s\ndescription: d\n---\nhttps://a.example/\n')
    writeFileSync(join(dir, 'references', 'b.txt'), 'https://b.example/ https://a.example/')
    writeFileSync(join(dir, 'tool.py'), 'URL = "https://script.example/"')
    writeFileSync(join(dir, 'image.png'), 'https://png.example/')
    expect((await findSkillUrls(dir)).sort()).toEqual(['https://a.example/', 'https://b.example/'])
  })
})
