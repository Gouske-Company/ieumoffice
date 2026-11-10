/**
 * Every editor's AI panel names its editor to the skill list and the skill
 * tools, so a skill set for other editors is neither listed nor used there
 * (decision 0122). Home ask names none: it uses every skill.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SKILL_EDITORS, type SkillEditorId } from '@genoffice/agent-core'

const REPO = fileURLToPath(new URL('../../..', import.meta.url))
const source = (path: string): string => readFileSync(join(REPO, path), 'utf8')

/** where a panel calls useComposerSkills, and where it composes panelUserSkills */
const PANELS: Record<SkillEditorId, { list: string; tools: string }> = {
  docs: {
    list: 'apps/docs/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/docs/src/renderer/ai/AiPanel.tsx',
  },
  sheets: {
    list: 'apps/sheets/src/renderer/ai/AiChatPanel.tsx',
    tools: 'apps/sheets/src/renderer/App.tsx',
  },
  slides: {
    list: 'apps/slides/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/slides/src/renderer/ai/AiPanel.tsx',
  },
  hwp: {
    list: 'apps/hwp/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/hwp/src/renderer/ai/AiPanel.tsx',
  },
  pdf: {
    list: 'apps/pdf/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/pdf/src/renderer/ai/AiPanel.tsx',
  },
  markdown: {
    list: 'apps/markdown/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/markdown/src/renderer/ai/AiPanel.tsx',
  },
  html: {
    list: 'apps/html/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/html/src/renderer/ai/AiPanel.tsx',
  },
  mindmap: {
    list: 'apps/mindmap/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/mindmap/src/renderer/ai/AiPanel.tsx',
  },
  epub: {
    list: 'apps/epub/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/epub/src/renderer/ai/AiPanel.tsx',
  },
  diagram: {
    list: 'apps/diagram/src/renderer/ai/AiPanel.tsx',
    tools: 'apps/diagram/src/renderer/ai/AiPanel.tsx',
  },
}

const callOptions = (text: string, call: string): string => {
  const at = text.indexOf(`${call}({`)
  return at === -1 ? '' : text.slice(at, text.indexOf('})', at))
}

describe('every editor names itself to its skills', () => {
  it('covers every editor a skill can be set for', () => {
    expect(Object.keys(PANELS).sort()).toEqual([...SKILL_EDITORS].sort())
  })

  it.each(Object.entries(PANELS))('%s', (editor, panel) => {
    expect(callOptions(source(panel.list), 'useComposerSkills')).toContain(`editor: '${editor}'`)
    expect(callOptions(source(panel.tools), '...panelUserSkills')).toContain(`editor: '${editor}'`)
  })
})

describe('home ask', () => {
  it('names no editor, so it lists and uses every skill', () => {
    const panel = source('apps/shell/src/renderer/src/KbAskPanel.tsx')
    expect(callOptions(panel, 'useComposerSkills')).not.toContain('editor:')
    expect(callOptions(panel, '...panelUserSkills')).not.toContain('editor:')
  })
})
