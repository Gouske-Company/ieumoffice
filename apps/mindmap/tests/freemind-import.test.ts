/**
 * FreeMind and Freeplane maps (`.mm`) read into a new, unsaved map: the
 * structure, notes, links, folding and sides come over; what the file holds
 * besides is left behind; a file that is not such a map opens nothing. The
 * map saves as an `.xmind` that opens like any other.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_TOPIC_DEPTH,
  openXmind,
  sheetToView,
  type ViewSheet,
  type ViewTopic,
} from '@genoffice/xmind-engine'
import { parseFreeMind } from '../src/renderer/document/freemind'
import { importedMap } from '../src/renderer/document/open'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)))
const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
const PICTURE = '(그림)'

/** A topic as the editor shows it: title, note, link, folded, and the same of its children. */
interface Shown {
  title: string
  note?: string
  link?: string
  folded?: true
  children?: Shown[]
}

function shown(topic: ViewTopic): Shown {
  const out: Shown = { title: topic.title }
  if (topic.note !== null) out.note = topic.note
  if (topic.link !== null) out.link = topic.link
  if (topic.folded) out.folded = true
  if (topic.children.length > 0) out.children = topic.children.map(shown)
  return out
}

/** Imports the bytes, saves the map, and opens the saved `.xmind` with the engine. */
async function importAndReopen(file: Uint8Array, title: string): Promise<ViewSheet[]> {
  const opened = await importedMap(file, title, PICTURE)
  if (opened.status !== 'ok') throw new Error(`not imported: ${opened.status}`)
  expect(opened.notices.imported).toBe(true)
  expect(opened.session.dirty).toBe(true)
  const saved = await opened.session.produceBytes()
  const reopened = await openXmind(saved)
  if (reopened.status !== 'ok') throw new Error(`the saved map does not open: ${reopened.status}`)
  return reopened.document.sheets.map(sheetToView)
}

describe('a FreeMind 1.0 map', () => {
  it('comes over with its structure, notes, links, folding and sides, and saves as an .xmind that opens', async () => {
    const [sheet, ...more] = await importAndReopen(fixture('freemind-1.0.mm'), 'Project plan')
    expect(more).toEqual([])
    expect(sheet!.title).toBe('Project plan')
    expect(sheet!.layout).toBe('both')
    expect(shown(sheet!.root)).toEqual({
      title: '프로젝트 계획',
      children: [
        // the right-hand branches first, each side in the file's order
        {
          title: 'Goals',
          children: [
            { title: 'Read the plan', link: 'https://example.org/plan' },
            { title: 'Ship by June', note: 'First line of the note\nSecond & last line' },
          ],
        },
        { title: 'Rich title\non two lines' },
        {
          title: 'Risks',
          folded: true,
          // a link to another node of the map is left behind
          children: [{ title: 'Budget' }, { title: 'See the plan' }],
        },
        { title: 'Notes\nand ideas' },
      ],
    })
  })

  it('leaves icons, fonts, colours, edges, clouds, arrow links and attributes behind', async () => {
    const opened = await importedMap(fixture('freemind-1.0.mm'), 'Project plan', PICTURE)
    if (opened.status !== 'ok') throw new Error(opened.status)
    const content = JSON.stringify(opened.session.document.sheets)
    for (const dropped of [
      'flag',
      'SansSerif',
      '#ff0000',
      '#f0f0f0',
      'Arrow_ID_1',
      'owner',
      'ID_1002',
    ]) {
      expect(content).not.toContain(dropped)
    }
    expect(opened.session.document.sheets[0]!.relationships).toBeUndefined()
  })
})

describe('a Freeplane 1.x map', () => {
  it('comes over with Korean text, both note forms and a folded branch; its built-in root name gives way to the file name', async () => {
    const [sheet] = await importAndReopen(fixture('freeplane-1.x.mm'), '아이디어')
    // every main branch on the right (Freeplane's newer side names included): drawn to the right
    expect(sheet!.layout).toBe('right')
    expect(shown(sheet!.root)).toEqual({
      title: '아이디어',
      children: [
        {
          title: '한글 가지',
          children: [
            { title: '잎 하나', note: '메모 첫 줄' },
            // the details text is left behind; the plain note keeps its lines
            { title: 'Details here', note: 'Plain note\nsecond line' },
          ],
        },
        {
          title: 'Folded branch',
          link: 'mailto:someone@example.org',
          folded: true,
          children: [{ title: 'Hidden child' }],
        },
      ],
    })
  })
})

describe('sides', () => {
  const map = (positions: string[]): Uint8Array =>
    bytes(
      `<map version="1.0.1"><node TEXT="Root">${positions
        .map((position, at) => `<node TEXT="N${at}" POSITION="${position}"/>`)
        .join('')}</node></map>`,
    )

  it('all on the left draws to the left', async () => {
    const [sheet] = await importAndReopen(map(['left', 'top_or_left']), 'Left')
    expect(sheet!.layout).toBe('left')
    expect(sheet!.root.children.map((child) => child.title)).toEqual(['N0', 'N1'])
  })

  it('a side name it does not know counts as no side', () => {
    const read = parseFreeMind(map(['constructor', 'right']))
    expect(read.ok && read.root.children.map((child) => child.side)).toEqual([undefined, 'right'])
  })
})

describe('a file that is not a readable map', () => {
  it.each([
    ['broken XML', bytes('<map version="1.0.1"><node TEXT="Root">')],
    ['another XML document', bytes('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>')],
    ['a map without a node', bytes('<map version="1.0.1"></map>')],
    [
      'a document type with entities',
      bytes('<!DOCTYPE map [<!ENTITY a "aaaaaaaaaa">]><map><node TEXT="&a;"/></map>'),
    ],
    ['bytes that are not text', new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x00, 0xdc, 0x41])],
  ])('%s opens as unreadable', async (_name, file) => {
    expect(await importedMap(file, 'x', PICTURE)).toEqual({ status: 'unreadable' })
  })

  it('nested deeper than the engine accepts opens as unreadable; at the limit it opens', async () => {
    const nested = (levels: number): Uint8Array =>
      bytes(
        `<map><node TEXT="Root">${'<node TEXT="n">'.repeat(levels)}${'</node>'.repeat(levels)}</node></map>`,
      )
    expect(parseFreeMind(nested(MAX_TOPIC_DEPTH + 1))).toEqual({ ok: false, problem: 'too-deep' })
    expect(await importedMap(nested(MAX_TOPIC_DEPTH + 1), 'deep', PICTURE)).toEqual({
      status: 'unreadable',
    })
    const [sheet] = await importAndReopen(nested(MAX_TOPIC_DEPTH), 'deep')
    let depth = 0
    for (let topic = sheet!.root; topic.children[0]; topic = topic.children[0]) depth++
    expect(depth).toBe(MAX_TOPIC_DEPTH)
  })
})

describe('the encoding', () => {
  it('reads a file in the encoding its XML declaration names', () => {
    // "Café" in Latin-1: not UTF-8
    const latin1 = new Uint8Array([
      ...bytes('<?xml version="1.0" encoding="ISO-8859-1"?><map><node TEXT="Caf'),
      0xe9,
      ...bytes('"/></map>'),
    ])
    const read = parseFreeMind(latin1)
    expect(read.ok && read.root.text).toBe('Café')
  })
})

describe('a FreeMind 0.8 map', () => {
  it('shows HTML kept in a node text as that text, and brings notes kept in the old note hook', async () => {
    const [sheet] = await importAndReopen(fixture('freemind-0.8.mm'), 'Field notes')
    expect(shown(sheet!.root)).toEqual({
      title: 'Field notes\n- a FreeMind 0.8 map -',
      children: [
        {
          title: 'To write, use mailto:someone@example.org.',
          note: 'A note kept the old way\non two lines',
        },
        {
          // only text that starts with <html is HTML, as both programs read it
          title: 'Plain text that mentions <html> in passing',
          note: 'An HTML note\nin two paragraphs',
        },
      ],
    })
  })
})

/** A map whose central topic has one child per text, each kept as FreeMind 0.8 does: HTML in `TEXT`. */
const htmlMap = (texts: string[]): Uint8Array =>
  bytes(
    `<map version="0.8.0"><node TEXT="Root">${texts
      .map(
        (text) =>
          `<node TEXT="${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}"/>`,
      )
      .join('')}</node></map>`,
  )

describe('pictures', () => {
  it('are not brought; a topic that is only a picture is titled with its alt text, its title or its file name', async () => {
    const richPicture = (img: string): string =>
      `<node><richcontent TYPE="NODE"><html><head/><body><p>${img}</p></body></html></richcontent></node>`
    const file = bytes(
      `<map version="1.0.1"><node TEXT="Root">` +
        `<node TEXT="${'<html><body><img src="file:/C:/Program Files/Office/Styles/BLENDS.GIF"></body></html>'.replace(/</g, '&lt;').replace(/"/g, '&quot;')}"/>` +
        richPicture('<img src="Images/doc/two%20words.png?size=2" />') +
        richPicture('<img src="sketch.png" alt=" Sketch of the plan " />') +
        richPicture('<img src="sketch.png" title="Plan, drawn" />') +
        richPicture('<img src="data:image/png;base64,iVBORw0KGgo=" />') +
        richPicture('<img />') +
        richPicture('Caption beside <img src="beside.png" />') +
        // Freeplane's picture on a node: a hook, with the text left empty
        `<node TEXT=""><hook URI="Images/doc/Menus.png" SIZE="0.5" NAME="ExternalObject"/><node TEXT="Below"/></node>` +
        `</node></map>`,
    )
    const [sheet] = await importAndReopen(file, 'Pictures')
    expect(sheet!.root.children.map((child) => child.title)).toEqual([
      'BLENDS.GIF',
      'two words.png',
      'Sketch of the plan',
      'Plan, drawn',
      // nothing names these pictures: the placeholder the editor hands in
      PICTURE,
      PICTURE,
      // a picture beside text is left out of the title
      'Caption beside',
      'Menus.png',
    ])
    const opened = await importedMap(file, 'Pictures', PICTURE)
    if (opened.status !== 'ok') throw new Error(opened.status)
    expect(JSON.stringify(opened.session.document.sheets)).not.toContain('iVBORw0KGgo')
  })

  it('give a topic the first name any of its pictures has', async () => {
    const richPicture = (html: string, after = ''): string =>
      `<node><richcontent TYPE="NODE"><html><head/><body><p>${html}</p></body></html></richcontent>${after}</node>`
    const file = bytes(
      `<map version="1.0.1"><node TEXT="Root">` +
        richPicture(
          '<img src="data:image/png;base64,AAAA" />',
          '<hook URI="Images/scan.png" NAME="ExternalObject"/>',
        ) +
        richPicture('<img src="data:image/png;base64,AAAA" /><img src="second.png" />') +
        `<node TEXT=""><hook URI="data:image/png;base64,AAAA" NAME="ExternalObject"/></node>` +
        `</node></map>`,
    )
    const [sheet] = await importAndReopen(file, 'Pictures')
    expect(sheet!.root.children.map((child) => child.title)).toEqual([
      'scan.png',
      'second.png',
      PICTURE,
    ])
  })

  it('never put control characters in a title; a line break or tab in a name becomes a space', async () => {
    const richPicture = (src: string): string =>
      `<node><richcontent TYPE="NODE"><html><head/><body><p><img src="${src}" /></p></body></html></richcontent></node>`
    const htmlText = (html: string): string =>
      `<node TEXT="${`<html><body>${html}</body></html>`.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')}"/>`
    const file = bytes(
      `<map version="1.0.1"><node TEXT="Root">` +
        richPicture('Images/a%00b%1B.png') +
        richPicture('Images/line%0A%0Abreak%09tab.png') +
        richPicture('Images/%C2%85next%C2%9F.png') +
        `<node TEXT=""><hook URI="Images/hook%0D%0Aname%7F.png" NAME="ExternalObject"/></node>` +
        htmlText('<img alt="Bell&#7; ring">') +
        htmlText('<p>Escape&#27;d text</p>') +
        `</node></map>`,
    )
    const [sheet] = await importAndReopen(file, 'Pictures')
    expect(sheet!.root.children.map((child) => child.title)).toEqual([
      'ab.png',
      'line break tab.png',
      'next.png',
      'hook name.png',
      'Bell ring',
      'Escaped text',
    ])
  })
})

describe('characters that change how text reads', () => {
  const richPicture = (img: string): string =>
    `<node><richcontent TYPE="NODE"><html><head/><body><p>${img}</p></body></html></richcontent></node>`

  it('leave out direction overrides, embeddings and isolates in titles and notes, and control characters in plain text', async () => {
    const file = bytes(
      `<map version="1.0.1"><node TEXT="Root">` +
        richPicture('<img src="Images/photo%E2%80%AEgnp.exe" />') +
        richPicture('<img src="x.png" alt="&#x2067;Plan&#x2069; &#x202D;A" />') +
        `<node TEXT=""><hook URI="Images/scan%E2%81%A6cod.exe" NAME="ExternalObject"/></node>` +
        `<node TEXT="report&#x202E;fdp.exe"/>` +
        `<node TEXT="a&#x85;b&#x9F;c&#x7F;"/>` +
        `<node TEXT="line one&#10;line&#x202C; two"/>` +
        `<node><richcontent TYPE="NODE">plain&#x202B; rich&#10;&#x80;second</richcontent></node>` +
        `<node TEXT="Notes">` +
        `<richcontent TYPE="NOTE">first&#x202A; line&#10;second&#x85; line</richcontent></node>` +
        `<node TEXT="HTML note"><richcontent TYPE="NOTE"><html><body><p>to&#x2068;do</p><p>done&#x202E;!</p></body></html></richcontent></node>` +
        `</node></map>`,
    )
    const [sheet] = await importAndReopen(file, 'Bidi')
    expect(sheet!.root.children.map(shown)).toEqual([
      { title: 'photognp.exe' },
      { title: 'Plan A' },
      { title: 'scancod.exe' },
      { title: 'reportfdp.exe' },
      { title: 'abc' },
      { title: 'line one\nline two' },
      { title: 'plain rich\nsecond' },
      { title: 'Notes', note: 'first line\nsecond line' },
      { title: 'HTML note', note: 'todo\ndone!' },
    ])
  })

  it('keep the marks right-to-left text needs and the joiners emoji and scripts need', async () => {
    const kept = [
      'مرحبا\u200F 2024',
      'שלום\u200F!',
      'abc\u200E def',
      '👩\u200D💻 개발',
      'می\u200Cخواهم',
      'long\u200Bword',
    ]
    const file = bytes(
      `<map version="1.0.1"><node TEXT="Root">` +
        kept.map((text) => `<node TEXT="${text}"/>`).join('') +
        richPicture(`<img src="x.png" alt="${kept[0]}" />`) +
        `<node TEXT="Note"><richcontent TYPE="NOTE">${kept[1]}&#10;${kept[3]}</richcontent></node>` +
        `</node></map>`,
    )
    const [sheet] = await importAndReopen(file, 'Kept')
    expect(sheet!.root.children.map(shown)).toEqual([
      ...kept.map((title) => ({ title })),
      { title: kept[0] },
      { title: 'Note', note: `${kept[1]}\n${kept[3]}` },
    ])
  })
})

describe('rich text layout', () => {
  it('puts each table row on one line with its cells set apart, even with no space between them', () => {
    const read = parseFreeMind(
      htmlMap([
        '<html><body><table><tr><th>Name</th><th>Age</th></tr><tr><td>a1</td><td>a2</td></tr></table></body></html>',
        '<html><body>Before<table>\n<tr>\n<td><p>b1</p></td>\n<td><p>b2</p><p>more</p></td>\n<td></td>\n</tr>\n</table>After</body></html>',
      ]),
    )
    expect(read.ok && read.root.children.map((child) => child.text)).toEqual([
      'Name | Age\na1 | a2',
      'Before\nb1 | b2 more\nAfter',
    ])
  })

  it('keeps one line per list item, paragraph and line break', () => {
    const read = parseFreeMind(
      htmlMap([
        '<html><body><p>Intro</p><ul><li>one</li><li>two <b>bold</b></li></ul>line<br>break</body></html>',
      ]),
    )
    expect(read.ok && read.root.children[0]!.text).toBe('Intro\none\ntwo bold\nline\nbreak')
  })
})
