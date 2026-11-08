import { describe, expect, it } from 'vitest'
import { isGanttSource, withGanttWidth } from '../src/renderer/editor/mermaid'

const gantt = 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  Task :a1, 2026-01-01, 10d'

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

  it('tells a gantt from other diagrams, after front matter or directives too', () => {
    expect(isGanttSource(gantt)).toBe(true)
    expect(isGanttSource(`---\nconfig:\n  theme: forest\n---\n  gantt\n`)).toBe(true)
    expect(isGanttSource('flowchart LR\n  A --> B')).toBe(false)
    expect(isGanttSource('flowchart LR\n  ganttish --> B')).toBe(false)
  })
})
