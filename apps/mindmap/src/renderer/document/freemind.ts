/**
 * FreeMind and Freeplane maps (`.mm`): read once into a new map, never written.
 *
 * The file is XML another program wrote, so it is untrusted. It is parsed with
 * the browser's `DOMParser`, and a document type declaration is refused before
 * parsing: neither program writes one, and without it there is no entity to
 * expand. Topics deeper than the engine accepts make the file unreadable.
 *
 * What comes over: each node's text, its children in order, its note, its web
 * link, whether it is folded, and which side of the central topic its main
 * branches stand on. Rich text and notes become plain text, wherever the two
 * programs keep them: a `richcontent` element, HTML inside the `TEXT`
 * attribute (FreeMind 0.8), and the note hook of FreeMind 0.7 and 0.8. A table
 * row becomes one line, its cells set apart by " | ". Pictures are not
 * brought: a node whose text is only pictures (in its HTML, or Freeplane's
 * picture hook) is titled with the first name one of them has: its alt text,
 * else its title, else its file name. Pictures with none of these get the
 * placeholder the caller hands in. Control characters in text and names are
 * left out, and a line break or tab in a name becomes a space. Icons, fonts,
 * colours, edges, clouds, arrow links, attributes, details and links to other
 * nodes are left behind too.
 */
import {
  MAX_TOPIC_DEPTH,
  createXmindDocumentFromSheets,
  newSheet,
  newTopic,
  structureClassForLayout,
  type XmindDocument,
  type XmindTopic,
} from '@genoffice/xmind-engine'

/** One node of a FreeMind or Freeplane map, as this editor takes it over. */
export interface FreeMindNode {
  text: string
  children: FreeMindNode[]
  note?: string
  link?: string
  folded?: boolean
  /** set on the central topic's own branches only */
  side?: 'left' | 'right'
  /** the text is empty because the node shows only a picture that has no name */
  picture?: true
}

export type FreeMindRead =
  | { ok: true; root: FreeMindNode }
  | { ok: false; problem: 'not-text' | 'not-xml' | 'not-a-map' | 'too-deep' }

/** The file's text: UTF-8, or the encoding its XML declaration names. */
function decode(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
    const label = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/.exec(head)?.[1]
    if (!label) return null
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes)
    } catch {
      return null
    }
  }
}

const BLOCKS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br'])
const CELLS = new Set(['td', 'th'])
const SKIPPED = new Set(['head', 'style', 'script'])

/** Rich text as plain text, and the first name its pictures have ('' when none has one). */
interface RichText {
  text: string
  picture?: string
}

/** Text as a reader sees it: white space as one space, other control characters gone. */
function readable(text: string): string {
  return text.replace(/(?:\s|\p{Cc})+/gu, (run) => (/\s/.test(run) ? ' ' : ''))
}

/** The file name a picture's address ends in, '' when it names no file. */
function fileName(address: string): string {
  if (/^data:/i.test(address)) return ''
  const path = address.replace(/[?#][^]*$/, '')
  const file = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  try {
    return readable(decodeURIComponent(file)).trim()
  } catch {
    return readable(file).trim()
  }
}

/** A picture's alt text, else its title, else the file name its `src` ends in. */
function pictureName(img: Element): string {
  const named = (name: string | null): string => readable(name ?? '').trim()
  return (
    named(img.getAttribute('alt')) ||
    named(img.getAttribute('title')) ||
    fileName(img.getAttribute('src')?.trim() ?? '')
  )
}

/**
 * HTML as a browser shows it: one line per block, white space collapsed. A
 * table row is one line: blocks inside it do not break it, and its cells are
 * set apart by " | ".
 */
function htmlText(content: Node): RichText {
  const lines: string[] = []
  let line = ''
  const breakLine = (): void => {
    lines.push(line.trim())
    line = ''
  }
  // table rows open around the current node; whether the next text begins a cell
  let rows = 0
  let cellStarts = false
  let picture: string | undefined
  const pending: (Node | 'break' | 'row' | 'row-end' | 'cell')[] = [content]
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (next === 'break') {
      if (rows === 0) breakLine()
      else line += ' '
      continue
    }
    if (next === 'row') {
      rows++
      continue
    }
    if (next === 'row-end') {
      if (--rows === 0) line = line.replace(/ {2,}/g, ' ')
      continue
    }
    if (next === 'cell') {
      cellStarts = true
      continue
    }
    if (next.nodeType === Node.TEXT_NODE || next.nodeType === Node.CDATA_SECTION_NODE) {
      const text = readable(next.nodeValue ?? '')
      if (cellStarts && text.trim()) {
        if (line.trim()) line = `${line.trimEnd()} | `
        cellStarts = false
      }
      line += text
      continue
    }
    if (next.nodeType !== Node.ELEMENT_NODE) continue
    const name = (next as Element).localName?.toLowerCase() ?? ''
    if (SKIPPED.has(name)) continue
    if (name === 'img') {
      if (!picture) picture = pictureName(next as Element)
      continue
    }
    if (name === 'tr') pending.push('break', 'row-end')
    else if (BLOCKS.has(name)) pending.push('break')
    const children = Array.from(next.childNodes)
    for (let at = children.length - 1; at >= 0; at--) pending.push(children[at]!)
    if (name === 'tr') pending.push('row', 'break')
    else if (CELLS.has(name)) pending.push('cell')
    else if (BLOCKS.has(name)) pending.push('break')
  }
  breakLine()
  const text = lines
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return picture === undefined ? { text } : { text, picture }
}

/**
 * The text of a `richcontent` element. Content without HTML (Freeplane's plain
 * forms) is taken line by line as it stands.
 */
function richText(content: Element): RichText {
  if (content.getElementsByTagName('html').length > 0) return htmlText(content)
  const text = (content.textContent ?? '')
    .split(/\r\n?|\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n')
  return { text }
}

/**
 * Text kept in an attribute or a plain element. Both programs show it as HTML
 * when it starts with `<html`. A document from `DOMParser` is inert: nothing in
 * it runs or loads.
 */
function markupText(text: string): RichText {
  if (!/^\s*<html/i.test(text)) return { text: text.replace(/\r\n?/g, '\n').trim() }
  return htmlText(new DOMParser().parseFromString(text, 'text/html').documentElement)
}

function elementChildren(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter((child) => child.localName === name)
}

/** FreeMind 0.7 and 0.8 keep a note in a plugin hook rather than in `richcontent`. */
const NOTE_HOOK = 'accessories/plugins/NodeNote.properties'

function hookNote(node: Element): string | undefined {
  const hook = elementChildren(node, 'hook').find(
    (child) => child.getAttribute('NAME') === NOTE_HOOK,
  )
  const text = hook ? elementChildren(hook, 'text')[0]?.textContent : undefined
  return text ? markupText(text).text || undefined : undefined
}

/** Freeplane keeps a picture shown on a node in a hook rather than in its text. */
function hookPicture(node: Element): string | undefined {
  const hook = elementChildren(node, 'hook').find(
    (child) => child.getAttribute('NAME') === 'ExternalObject',
  )
  return hook ? fileName(hook.getAttribute('URI')?.trim() ?? '') : undefined
}

function richContent(node: Element, type: 'NODE' | 'NOTE'): RichText | undefined {
  const content = elementChildren(node, 'richcontent').find(
    (child) => child.getAttribute('TYPE')?.toUpperCase() === type,
  )
  return content ? richText(content) : undefined
}

function nodeOf(element: Element, depth: number): FreeMindNode {
  const attribute = element.getAttribute('TEXT')
  const read = attribute !== null ? markupText(attribute) : richContent(element, 'NODE')
  const pictures = [read?.picture, hookPicture(element)].filter((name) => name !== undefined)
  const picture = pictures.find(Boolean) ?? pictures[0]
  const node: FreeMindNode = { text: read?.text || picture || '', children: [] }
  if (!node.text && picture !== undefined) node.picture = true
  const note = richContent(element, 'NOTE')?.text || hookNote(element)
  if (note) node.note = note
  const link = element.getAttribute('LINK')?.trim()
  // a link to another node of the same map has no counterpart in a web link
  if (link && !link.startsWith('#')) node.link = link
  if (element.getAttribute('FOLDED') === 'true') node.folded = true
  const side = SIDES.get(element.getAttribute('POSITION') ?? '')
  if (depth === 1 && side) node.side = side
  return node
}

/** `POSITION` as FreeMind writes it, and as newer Freeplane versions do. */
const SIDES: ReadonlyMap<string, 'left' | 'right'> = new Map([
  ['left', 'left'],
  ['right', 'right'],
  ['top_or_left', 'left'],
  ['bottom_or_right', 'right'],
])

/** Reads a `.mm` file: the central topic and everything below it, or why it cannot be read. */
export function parseFreeMind(bytes: Uint8Array): FreeMindRead {
  const xml = decode(bytes)
  if (xml === null) return { ok: false, problem: 'not-text' }
  if (/<!DOCTYPE/i.test(xml)) return { ok: false, problem: 'not-xml' }
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    return { ok: false, problem: 'not-xml' }
  }
  const map = document.documentElement
  const top = map.localName === 'map' ? elementChildren(map, 'node')[0] : undefined
  if (!top) return { ok: false, problem: 'not-a-map' }

  const root = nodeOf(top, 0)
  const pending: [Element, FreeMindNode, number][] = [[top, root, 0]]
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [element, node, depth] = next
    const children = elementChildren(element, 'node')
    if (children.length === 0) continue
    if (depth + 1 > MAX_TOPIC_DEPTH) return { ok: false, problem: 'too-deep' }
    for (const child of children) {
      const made = nodeOf(child, depth + 1)
      node.children.push(made)
      pending.push([child, made, depth + 1])
    }
  }
  return { ok: true, root }
}

function dress(topic: XmindTopic, node: FreeMindNode): void {
  if (node.link) topic.href = node.link
  if (node.note) topic.notes = { plain: { content: node.note } }
}

/**
 * A new map file from a read `.mm`: one sheet named `title`, the central
 * topic named after the map's root (or `title` when the root has no text), and
 * `pictureTitle` for a topic that shows only a picture with no name.
 *
 * Sides: main branches all on one side give that one-sided layout. With both
 * sides, the right-hand branches come first, each side in its own order. The
 * map keeps no side per branch and the editor draws the first half of the
 * branches on the right, so a side with more than half of them gives the rest
 * to the other side.
 */
export function freeMindToXmind(
  root: FreeMindNode,
  title: string,
  pictureTitle: string,
): Promise<XmindDocument> {
  const sheet = newSheet({ title, rootTitle: root.text || title })
  dress(sheet.rootTopic, root)
  const sides = new Set(root.children.map((child) => child.side))
  const oneSide = sides.size === 1 ? [...sides][0] : undefined
  if (oneSide) sheet.rootTopic.structureClass = structureClassForLayout(oneSide)
  const mains =
    sides.size > 1
      ? [
          ...root.children.filter((child) => child.side !== 'left'),
          ...root.children.filter((child) => child.side === 'left'),
        ]
      : root.children

  const pending: [XmindTopic, FreeMindNode[]][] = [[sheet.rootTopic, mains]]
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [topic, children] = next
    if (children.length === 0) continue
    topic.children = {
      attached: children.map((child) => {
        const made = newTopic(child.text || (child.picture ? pictureTitle : ''))
        dress(made, child)
        if (child.folded && child.children.length > 0) made.branch = 'folded'
        pending.push([made, child.children])
        return made
      }),
    }
  }
  return createXmindDocumentFromSheets([sheet])
}
