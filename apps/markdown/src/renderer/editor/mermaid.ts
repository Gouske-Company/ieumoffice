import type { Mermaid } from 'mermaid'
import type { DiagramResult } from './diagrams'

export const MERMAID_LANGUAGE = 'mermaid'

export const MERMAID_TEMPLATE = [
  '```mermaid',
  'flowchart LR',
  '    A[Start] --> B{Decision}',
  '    B -->|Yes| C[Done]',
  '    B -->|No| A',
  '```',
].join('\n')

let loading: Promise<Mermaid> | null = null

/** Loaded on first use so documents without diagrams never pay for the bundle */
export function loadMermaid(): Promise<Mermaid> {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // diagrams are document content: one fixed theme in both UI themes
      theme: 'default',
      // SVG text labels instead of <foreignObject> so the diagram can be drawn
      // onto a canvas (docx export) without tainting it
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      suppressErrorRendering: true,
    })
    return mermaid
  })
  return loading
}

const ROOT_TAG_RE = /<svg\b[^>]*>/
const MAX_WIDTH_RE = /max-width:\s*([\d.]+)px;?\s*/
const VIEWBOX_SIZE_RE = /\sviewBox="\s*[^\s,"]+[\s,]+[^\s,"]+[\s,]+([^\s,"]+)[\s,]+([^\s,"]+)\s*"/

/**
 * Mermaid sizes its SVG as width="100%" capped by an inline max-width, so a
 * diagram wider than the column shrinks its text to fit. Pin that natural size
 * instead: the editor preview scrolls a wide diagram, and the print CSS still
 * scales it down to the page.
 */
export function pinMermaidNaturalSize(svg: string): string {
  return svg.replace(ROOT_TAG_RE, (tag) => {
    const maxWidth = MAX_WIDTH_RE.exec(tag)
    const box = VIEWBOX_SIZE_RE.exec(tag)
    if (!/\swidth="100%"/.test(tag) || !maxWidth || !box) return tag
    const width = Number(maxWidth[1])
    const height = (width * Number(box[2])) / Number(box[1])
    if (!(width > 0) || !(height > 0) || !Number.isFinite(height)) return tag
    return tag
      .replace(/\sheight="[^"]*"/, '')
      .replace(/\swidth="100%"/, ` width="${width}" height="${height}"`)
      .replace(maxWidth[0], '')
      .replace(/\sstyle="\s*"/, '')
  })
}

// mermaid's own type detection (`detectType`): strip front matter, directives
// and comments, then the diagram's keyword must open what is left
const FRONT_MATTER_RE = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s
const DIRECTIVE_RE =
  /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi
const COMMENT_RE = /\s*%%.*\n/gm

/** Whether mermaid draws the source as a gantt chart (a mindmap node named "gantt" is not one) */
export function isGanttSource(source: string): boolean {
  const body = source
    .replace(FRONT_MATTER_RE, '')
    .replace(DIRECTIVE_RE, '')
    .replace(COMMENT_RE, '\n')
  return /^\s*gantt/.test(body)
}

/**
 * A gantt chart takes its width from mermaid's temporary render container,
 * which hangs off <body> and so spans the window: in a narrower text column the
 * chart came out wider than the column, its title off to the right. Give it the
 * width it is shown at; other diagram kinds, and a gantt that sets its own
 * width, are left as written. The directive goes last because front matter
 * must open the source.
 */
export function withGanttWidth(source: string, width?: number): string {
  if (!width || !(width > 0) || !isGanttSource(source) || /useWidth/.test(source)) return source
  return `${source}\n%%{init: {"gantt": {"useWidth": ${Math.round(width)}}}}%%`
}

/** room beside the widest date label, so neighbouring labels never touch */
const TICK_LABEL_GAP_PX = 8

/**
 * The narrowest width at which a drawn gantt's widest date label plus a gap fits
 * between its closest two ticks, or the width to draw it at to find that out
 */
type GanttFit = { readable: number } | { measureAt: number }

/**
 * Mermaid picks a gantt's date ticks from the time range alone, so a chart drawn
 * as narrow as the column can stack its axis labels on top of each other. Tick
 * spacing grows with the axis while the ticks stay, but the axis is the width
 * less mermaid's side paddings, and in a box little wider than those it is a few
 * pixels or none: ticks rounded to whole pixels pile up and their spacing says
 * nothing. Such a drawing asks for one wide enough to set the labels side by side.
 * Null when there are no two ticks to keep apart.
 */
function ganttFit(svgMarkup: string): GanttFit | null {
  const host = scratchHost()
  host.innerHTML = svgMarkup
  try {
    const svg = host.querySelector('svg')
    const grid = svg?.querySelector<SVGGElement>(':scope > g.grid')
    const width = svg?.viewBox?.baseVal?.width ?? 0
    if (!svg || !grid || !(width > 0) || typeof grid.getBBox !== 'function') return null
    const ticks = Array.from(grid.querySelectorAll<SVGGElement>(':scope > g.tick'))
    const xs = ticks.map((t) => t.transform.baseVal.consolidate()?.matrix.e ?? NaN)
    xs.sort((a, b) => a - b)
    let spacing = Infinity
    for (let i = 1; i < xs.length; i++) spacing = Math.min(spacing, xs[i]! - xs[i - 1]!)
    if (Number.isNaN(spacing) || spacing === Infinity) return null
    const label = Math.max(0, ...ticks.map((t) => t.querySelector('text')?.getBBox().width ?? 0))
    const need = label + TICK_LABEL_GAP_PX
    // the axis spans the width less mermaid's side paddings (left = grid offset, right alike)
    const pad = grid.transform.baseVal.consolidate()?.matrix.e ?? 0
    const axis = width - 2 * pad
    // trust the spacing while a whole-pixel error in it costs at most half the gap at the result
    if (!(axis > 0) || need > (spacing * TICK_LABEL_GAP_PX) / 2) {
      return { measureAt: Math.ceil(2 * pad + ticks.length * need) }
    }
    return { readable: Math.ceil(2 * pad + (axis * need) / spacing) }
  } finally {
    host.remove()
  }
}

/**
 * Mermaid draws in a scratch element that it would otherwise append to <body>,
 * in flow below the app: while it drew, the page grew a window scrollbar and the
 * text column narrowed, so a gantt sized to that column redrew without end.
 * A fixed host spans the window like <body> but takes no room in the page.
 */
function scratchHost(): HTMLElement {
  const host = document.createElement('div')
  host.style.cssText =
    'position: fixed; left: 0; top: 0; width: 100%; visibility: hidden; pointer-events: none;'
  document.body.appendChild(host)
  return host
}

let renderSeq = 0

export async function renderMermaid(source: string, width?: number): Promise<DiagramResult> {
  const mermaid = await loadMermaid()
  const draw = async (code: string) => {
    const host = scratchHost()
    try {
      return (await mermaid.render(`md-mermaid-${++renderSeq}`, code, host)).svg
    } finally {
      host.remove()
    }
  }
  try {
    const sized = withGanttWidth(source, width)
    let svg = await draw(sized)
    if (sized !== source) {
      let fit = ganttFit(svg)
      if (fit && 'measureAt' in fit)
        fit = ganttFit(await draw(withGanttWidth(source, fit.measureAt)))
      if (fit && 'readable' in fit && fit.readable > width!) {
        svg = await draw(withGanttWidth(source, fit.readable))
      }
    }
    return { ok: true, svg: pinMermaidNaturalSize(svg) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
