import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { droppedSkillSourceOf } from '@genoffice/ai-provider'
import { handleDroppedFiles } from '../src/main/dropped-files'
import type { DroppedFilesDeps } from '../src/main/dropped-files'
import type { DroppedSkillSource } from '../src/main/user-skills'

function fakeDeps(overrides: Partial<DroppedFilesDeps> = {}): DroppedFilesDeps & {
  opened: string[]
  revealed: ReturnType<typeof vi.fn>
  warned: string[]
  skills: DroppedSkillSource[]
} {
  const opened: string[] = []
  const revealed = vi.fn()
  const warned: string[] = []
  const skills: DroppedSkillSource[] = []
  return {
    opened,
    revealed,
    warned,
    skills,
    // the core's real judge: a zip is read for its layout
    skillSourceOf: droppedSkillSourceOf,
    importSkills: (source) => {
      skills.push(source)
    },
    openDocumentPath: vi.fn((path: string) => {
      opened.push(path)
      return true
    }),
    revealShellWindow: revealed,
    showWarning: vi.fn((message: string) => {
      warned.push(message)
    }),
    unsupportedMessage: (exts) => `unsupported: ${exts.join(', ')}`,
    ...overrides,
  }
}

describe('handleDroppedFiles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens every supported path and reveals the shell', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/a.docx', '/tmp/b.xlsx'], deps)
    expect(deps.opened).toEqual(['/tmp/a.docx', '/tmp/b.xlsx'])
    expect(deps.revealed).toHaveBeenCalledOnce()
    expect(deps.warned).toEqual([])
  })

  it('still reveals the shell when a path is already open in a tab', async () => {
    const deps = fakeDeps({
      // routeDocumentPath activates the existing tab and returns true either way
      openDocumentPath: vi.fn(() => true),
    })
    await handleDroppedFiles(['/tmp/a.docx'], deps)
    expect(deps.revealed).toHaveBeenCalledOnce()
  })

  it('warns once with the combined extensions for known-unsupported drops', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/old.doc', '/tmp/deck.pages', '/tmp/note.rtf'], deps)
    expect(deps.opened).toEqual([])
    expect(deps.revealed).not.toHaveBeenCalled()
    expect(deps.warned).toEqual(['unsupported: doc, pages, rtf'])
  })

  it('opens the supported files and warns about the rest in a mixed drop', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/new.docx', '/tmp/old.doc'], deps)
    expect(deps.opened).toEqual(['/tmp/new.docx'])
    expect(deps.revealed).toHaveBeenCalledOnce()
    expect(deps.warned).toEqual(['unsupported: doc'])
  })

  it('ignores junk payloads and unrecognized file types entirely', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(null, deps)
    await handleDroppedFiles(['/tmp/photo.png', 42, ''], deps)
    expect(deps.opened).toEqual([])
    expect(deps.revealed).not.toHaveBeenCalled()
    expect(deps.warned).toEqual([])
  })
})

describe('handleDroppedFiles with skill files', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function zipAt(name: string, files: Record<string, string>): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), 'dropped-skills-'))
    dirs.push(dir)
    const zip = new JSZip()
    for (const [entry, text] of Object.entries(files)) zip.file(entry, text)
    const path = join(dir, name)
    writeFileSync(path, await zip.generateAsync({ type: 'uint8array' }))
    return path
  }

  const skillMd = '---\nname: report\ndescription: d\n---\nbody\n'

  it('hands a skill zip to the import while a document beside it still opens', async () => {
    const pack = await zipAt('pack.zip', { 'report/SKILL.md': skillMd })
    const deps = fakeDeps()
    await handleDroppedFiles(['/tmp/a.docx', pack], deps)
    expect(deps.opened).toEqual(['/tmp/a.docx'])
    expect(deps.revealed).toHaveBeenCalledOnce()
    expect(deps.skills).toEqual([{ kind: 'zip', file: pack }])
    expect(deps.warned).toEqual([])
  })

  it('hands a SKILL.md to the import instead of the markdown editor', async () => {
    const deps = fakeDeps()
    await handleDroppedFiles(['/dl/SKILL.md', '/dl/notes.md'], deps)
    expect(deps.skills).toEqual([{ kind: 'skill-file', file: '/dl/SKILL.md' }])
    expect(deps.opened).toEqual(['/dl/notes.md'])
  })

  it('leaves a zip that holds no skill alone, as before', async () => {
    const photos = await zipAt('photos.zip', { 'trip/1.png': 'png', 'report/SKILL.md': skillMd })
    const deps = fakeDeps()
    await handleDroppedFiles([photos], deps)
    expect(deps.skills).toEqual([])
    expect(deps.opened).toEqual([])
    expect(deps.revealed).not.toHaveBeenCalled()
    expect(deps.warned).toEqual([])
  })
})
