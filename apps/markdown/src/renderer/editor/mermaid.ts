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

const GANTT_RE = /^\s*gantt\b/m

/** Whether the source draws a gantt chart (its keyword opens a line; front matter and directives may precede it) */
export function isGanttSource(source: string): boolean {
  return GANTT_RE.test(source)
}

/**
 * A gantt chart takes its width from mermaid's temporary render container,
 * which hangs off <body> and so spans the window: in a narrower text column the
 * chart came out wider than the column, its title off to the right. Give it the
 * width it is shown at (other diagram kinds ignore `gantt.useWidth`); a width
 * the source sets itself wins. The directive goes last because front matter
 * must open the source.
 */
export function withGanttWidth(source: string, width?: number): string {
  if (!width || !(width > 0) || /useWidth/.test(source)) return source
  return `${source}\n%%{init: {"gantt": {"useWidth": ${Math.round(width)}}}}%%`
}

/** room beside the widest date label, so neighbouring labels never touch */
const TICK_LABEL_GAP_PX = 8

/**
 * Mermaid picks a gantt's date ticks from the time range alone, so a chart drawn
 * as narrow as the column can stack its axis labels on top of each other. The
 * width at which the widest label plus a gap fits between the closest two ticks,
 * measured off-screen; 0 when the labels already fit or nothing can be measured.
 */
export function ganttReadableWidth(svgMarkup: string): number {
  const host = document.createElement('div')
  host.style.cssText = 'position: fixed; left: -100000px; top: 0; visibility: hidden;'
  host.innerHTML = svgMarkup
  document.body.appendChild(host)
  try {
    const svg = host.querySelector('svg')
    const grid = svg?.querySelector<SVGGElement>(':scope > g.grid')
    const width = svg?.viewBox?.baseVal?.width ?? 0
    if (!svg || !grid || !(width > 0) || typeof grid.getBBox !== 'function') return 0
    const ticks = Array.from(grid.querySelectorAll<SVGGElement>(':scope > g.tick'))
    const xs = ticks.map((t) => t.transform.baseVal.consolidate()?.matrix.e ?? NaN)
    xs.sort((a, b) => a - b)
    let spacing = Infinity
    for (let i = 1; i < xs.length; i++) spacing = Math.min(spacing, xs[i]! - xs[i - 1]!)
    const label = Math.max(0, ...ticks.map((t) => t.querySelector('text')?.getBBox().width ?? 0))
    const need = label + TICK_LABEL_GAP_PX
    if (!(spacing > 0) || !Number.isFinite(spacing) || need <= spacing) return 0
    // the axis spans the width less mermaid's side paddings (left = grid offset, right alike)
    const pad = grid.transform.baseVal.consolidate()?.matrix.e ?? 0
    const axis = width - 2 * pad
    if (!(axis > 0)) return 0
    return Math.ceil(width - axis + (axis * need) / spacing)
  } finally {
    host.remove()
  }
}

let renderSeq = 0

export async function renderMermaid(source: string, width?: number): Promise<DiagramResult> {
  const mermaid = await loadMermaid()
  const draw = async (code: string) => (await mermaid.render(`md-mermaid-${++renderSeq}`, code)).svg
  try {
    const sized = withGanttWidth(source, width)
    let svg = await draw(sized)
    if (sized !== source) {
      // tick spacing grows with the width while the tick count stays, so one redraw settles it
      const readable = ganttReadableWidth(svg)
      if (readable > width!) svg = await draw(withGanttWidth(source, readable))
    }
    return { ok: true, svg: pinMermaidNaturalSize(svg) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
