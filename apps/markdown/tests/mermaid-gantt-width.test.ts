import { describe, expect, it, vi } from 'vitest'

const scratchPositions = vi.hoisted(() => [] as string[])

vi.mock('mermaid', () => ({
  default: {
    initialize: () => {},
    // like mermaid: the scratch element goes into the given container, else onto <body>
    render: async (id: string, _code: string, container?: Element) => {
      const scratch = document.createElement('div')
      scratch.id = `d${id}`
      ;(container ?? document.body).appendChild(scratch)
      let el: Element | null = scratch
      let position = 'static'
      while (el && position !== 'fixed') {
        position = getComputedStyle(el).position
        el = el.parentElement
      }
      scratchPositions.push(position)
      scratch.remove()
      return {
        svg: `<svg id="${id}" width="100%" style="max-width: 100px;" viewBox="0 0 100 50"></svg>`,
      }
    },
  },
}))

import { isGanttSource, renderMermaid, withGanttWidth } from '../src/renderer/editor/mermaid'

const gantt = 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  Task :a1, 2026-01-01, 10d'
const mindmapWithGanttNode =
  'mindmap\n  root((Project tools))\n    Planning\n      gantt\n      kanban'

describe('gantt width', () => {
  it('asks mermaid for the width the chart is shown at', () => {
    expect(withGanttWidth(gantt, 667.4)).toBe(`${gantt}\n%%{init: {"gantt": {"useWidth": 667}}}%%`)
  })

  it('keeps front matter at the top of the source', () => {
    const withFrontMatter = `---\ntitle: Plan\n---\n${gantt}`
    expect(withGanttWidth(withFrontMatter, 600).startsWith('---\ntitle: Plan\n---\n')).toBe(true)
  })

  it('leaves the source alone without a width or when it sets its own', () => {
    expect(withGanttWidth(gantt, undefined)).toBe(gantt)
    expect(withGanttWidth(gantt, 0)).toBe(gantt)
    const own = `%%{init: {"gantt": {"useWidth": 900}}}%%\n${gantt}`
    expect(withGanttWidth(own, 600)).toBe(own)
  })

  it('leaves other diagram kinds alone', () => {
    expect(withGanttWidth(mindmapWithGanttNode, 600)).toBe(mindmapWithGanttNode)
  })

  it('tells a gantt from other diagrams, after front matter or directives too', () => {
    expect(isGanttSource(gantt)).toBe(true)
    expect(isGanttSource(`---\nconfig:\n  theme: forest\n---\n  gantt\n`)).toBe(true)
    expect(isGanttSource(`%%{init: {"theme": "forest"}}%%\n%% plan\ngantt\n`)).toBe(true)
    expect(isGanttSource('flowchart LR\n  A --> B')).toBe(false)
    expect(isGanttSource('flowchart LR\n  ganttish --> B')).toBe(false)
  })

  it('reads the diagram type from its first line, not from a node named gantt', () => {
    expect(isGanttSource(mindmapWithGanttNode)).toBe(false)
    expect(isGanttSource('flowchart TD\ngantt --> kanban')).toBe(false)
  })
})

describe('mermaid scratch element', () => {
  it('takes no room in the page while mermaid draws', async () => {
    scratchPositions.length = 0
    const result = await renderMermaid('flowchart LR\n  A --> B')
    expect(result.ok).toBe(true)
    expect(scratchPositions).toEqual(['fixed'])
  })
})
