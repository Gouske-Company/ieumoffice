/**
 * Every AI panel offers the person's skills as app-run tools (spec 5.8) and
 * shows the cards `propose_skill` brings: these guards read the panels'
 * sources and keep the wiring the same everywhere.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))
const source = (path: string): string => readFileSync(join(REPO, path), 'utf8')

/** where a panel composes its tools, and where it renders its chat */
const PANELS: Record<string, { loop: string; view: string; stores: boolean }> = {
  docs: {
    loop: 'apps/docs/src/renderer/ai/AiPanel.tsx',
    view: 'apps/docs/src/renderer/ai/AiPanel.tsx',
    stores: true,
  },
  sheets: {
    loop: 'apps/sheets/src/renderer/App.tsx',
    view: 'apps/sheets/src/renderer/ai/AiChatPanel.tsx',
    stores: true,
  },
  slides: {
    loop: 'apps/slides/src/renderer/ai/AiPanel.tsx',
    view: 'apps/slides/src/renderer/ai/AiPanel.tsx',
    stores: true,
  },
  pdf: {
    loop: 'apps/pdf/src/renderer/ai/AiPanel.tsx',
    view: 'apps/pdf/src/renderer/ai/AiPanel.tsx',
    stores: true,
  },
  markdown: {
    loop: 'apps/markdown/src/renderer/ai/AiPanel.tsx',
    view: 'apps/markdown/src/renderer/ai/AiPanel.tsx',
    stores: true,
  },
  html: {
    loop: 'apps/html/src/renderer/ai/AiPanel.tsx',
    view: 'apps/html/src/renderer/ai/AiPanel.tsx',
    stores: true,
  },
  mindmap: {
    loop: 'apps/mindmap/src/renderer/ai/AiPanel.tsx',
    view: 'apps/mindmap/src/renderer/ai/AiPanel.tsx',
    stores: true,
  },
  hwp: {
    loop: 'apps/hwp/src/renderer/ai/AiPanel.tsx',
    view: 'apps/hwp/src/renderer/ai/AiPanel.tsx',
    stores: true,
  },
  'home ask': {
    loop: 'apps/shell/src/renderer/src/KbAskPanel.tsx',
    view: 'apps/shell/src/renderer/src/KbAskPanel.tsx',
    stores: false,
  },
}

describe.each(Object.entries(PANELS))('%s AI panel', (_name, panel) => {
  const loop = source(panel.loop)
  const view = source(panel.view)

  it('composes the skill tools with the panel’s own and shows their cards', () => {
    expect(loop).toContain('...panelUserSkills({')
    expect(loop).toMatch(/useSkillProposals\(\{/)
    expect(loop).toMatch(/onProposal: \(proposal\) => \{\s*skillCardsRef\.current\.add\(proposal\)/)
    expect(view).toMatch(/skillProposals\?\.map\(\(key\) => /)
  })

  it('offers the template box through the panel’s document; the home panel never', () => {
    const options = loop.match(/useSkillProposals\(\{[\s\S]*?\}\)/)?.[0] ?? ''
    expect(options).not.toContain('canBeTemplate')
    if (panel.loop.includes('KbAskPanel')) expect(options).not.toContain('templateDocument')
    else expect(options).toContain('templateDocument')
  })

  it('runs the template flow: chips with a template, the model’s template, the hand-off', () => {
    expect(loop).toMatch(/useSkillTemplates\(\{/)
    expect(loop).toContain('onTemplateSkill')
    expect(loop).toMatch(/onUsed: \(skill\) => skillTemplatesRef\.current\.onUsed\(skill\)/)
    expect(loop).toMatch(/skillTemplatesRef\.current\.noteRequest\(/)
    const templates = loop.match(/useSkillTemplates\(\{[\s\S]*?\}\)/)?.[0] ?? ''
    if (panel.loop.includes('KbAskPanel')) {
      // no document: nothing is ever handed to the home panel
      expect(templates).toContain('editor: null')
    } else {
      expect(templates).toMatch(/editor: '(docs|sheets|slides|pdf|markdown|html|mindmap|hwp)'/)
      expect(templates).toMatch(/send: /)
      expect(templates).toMatch(/busy/)
      // a template skill in a document with content asks where to run
      expect(templates).toMatch(/hasContent: /)
      // a template copy can bring the asking document along where the panel takes attachments
      const takesAttachments = !/apps\/(markdown|pdf)\//.test(panel.loop)
      if (takesAttachments) expect(templates).toMatch(/attach: async \(paths\) => \{/)
      else expect(templates).not.toMatch(/attach: /)
    }
    // the template lines sit after the chat's messages (sheets hands them to its chat view)
    expect(view).toContain(
      panel.view.includes('AiChatPanel') ? '{skillNotes}' : '{skillTemplates.notes}',
    )
  })

  it.runIf(panel.stores)('stores a saved card and reads stored cards back closed', () => {
    expect(loop).toContain('persistSaved: (record) =>')
    expect(loop).toMatch(/skillCardsRef\.current\.restore\(stored\)/)
  })

  // the home ask panel lists its tool notes itself, the skill note among them
  it.runIf(!panel.view.includes('KbAskPanel'))(
    'shows "<title> skill used" outside the folded tool rows',
    () => {
      expect(view).toContain('<SkillUsedNotes tools={entry.tools} />')
    },
  )
})
