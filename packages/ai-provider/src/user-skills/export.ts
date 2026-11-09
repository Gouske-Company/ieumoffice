/**
 * Exporting the app's skills as a zip: each skill folder as it is, under a
 * top folder named after the skill (the layout skill uploads expect, and one
 * the zip import reads back), without the GitHub source record. One skill
 * gives `<name>.zip`; several give a bundle, `skills.zip`, with one top
 * folder per skill. The caller warns before the save dialog when a template
 * document goes in.
 */
import { randomBytes } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import { IEUM_SOURCE_FILE, MAX_USER_SKILL_BYTES, MAX_USER_SKILL_FILES } from './constants'
import { SkillImportError } from './errors'
import { listSkillFolderFiles, readUserSkillFolder, type SkillFolderLimits } from './folder'

export interface SkillExportInfo {
  /** the skill's name, also the top folder inside the zip */
  name: string
  /** `<name>.zip`, the save dialog's suggestion */
  fileName: string
  /** a template document is in the folder and goes into the zip */
  includesTemplate: boolean
  /** files that go into the zip */
  files: number
  bytes: number
}

const DEFAULT_LIMITS: SkillFolderLimits = {
  files: MAX_USER_SKILL_FILES,
  bytes: MAX_USER_SKILL_BYTES,
}

async function readForExport(skillDir: string, limits: SkillFolderLimits) {
  const skill = await readUserSkillFolder(skillDir, { source: 'app' })
  if (!skill) throw new SkillImportError('not-installable', 'This skill cannot be exported')
  const listed = await listSkillFolderFiles(skillDir, limits)
  if (!listed) throw new SkillImportError('failed', `Cannot read ${skillDir}`)
  if (listed.tooLarge) throw new SkillImportError('too-large', 'The skill folder is too large')
  const files = listed.files.filter((file) => file.rel !== IEUM_SOURCE_FILE)
  const info: SkillExportInfo = {
    name: skill.name,
    fileName: `${skill.name}.zip`,
    includesTemplate: skill.template !== undefined && skill.templateExists,
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file.size, 0),
  }
  return { info, files }
}

/** What an export of this skill would hold, for the warning and the save dialog */
export async function skillExportInfo(
  skillDir: string,
  limits: SkillFolderLimits = DEFAULT_LIMITS,
): Promise<SkillExportInfo> {
  return (await readForExport(skillDir, limits)).info
}

/** The file name a bundle export suggests */
export const SKILL_BUNDLE_FILE_NAME = 'skills.zip'

/**
 * The zip bytes of a bundle: every skill under a top folder of its name.
 * Two skills of one name (without case) cannot go in one zip.
 */
export async function buildSkillBundleZip(
  skillDirs: readonly string[],
  limits: SkillFolderLimits = DEFAULT_LIMITS,
): Promise<{ bytes: Uint8Array; infos: SkillExportInfo[] }> {
  if (skillDirs.length === 0) throw new SkillImportError('not-installable', 'No skill to export')
  const zip = new JSZip()
  const infos: SkillExportInfo[] = []
  const names = new Set<string>()
  for (const dir of skillDirs) {
    const { info, files } = await readForExport(dir, limits)
    const key = info.name.toLowerCase()
    if (names.has(key)) {
      throw new SkillImportError('not-installable', `Two skills are named ${info.name}`)
    }
    names.add(key)
    for (const file of files) {
      zip.file(`${info.name}/${file.rel}`, await readFile(file.path))
    }
    infos.push(info)
  }
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return { bytes, infos }
}

/** The zip bytes of a skill export */
export async function buildSkillExportZip(
  skillDir: string,
  limits: SkillFolderLimits = DEFAULT_LIMITS,
): Promise<{ bytes: Uint8Array; info: SkillExportInfo }> {
  const { bytes, infos } = await buildSkillBundleZip([skillDir], limits)
  return { bytes, info: infos[0]! }
}

/**
 * Write zip bytes to `outPath` (the place the person chose): next to it under
 * a temporary name first, then renamed, so a failed export leaves no broken
 * file.
 */
async function writeExport(outPath: string, bytes: Uint8Array): Promise<void> {
  const partial = join(
    dirname(outPath),
    `.${basename(outPath)}.${randomBytes(4).toString('hex')}.part`,
  )
  try {
    await writeFile(partial, bytes, { flag: 'wx' })
    await rename(partial, outPath)
  } catch {
    await rm(partial, { force: true }).catch(() => undefined)
    throw new SkillImportError('failed', `Could not write ${outPath}`)
  }
}

/** Write a skill export to `outPath` */
export async function exportSkillZip(
  skillDir: string,
  outPath: string,
  limits: SkillFolderLimits = DEFAULT_LIMITS,
): Promise<SkillExportInfo> {
  const { bytes, info } = await buildSkillExportZip(skillDir, limits)
  await writeExport(outPath, bytes)
  return info
}

/** Write a bundle of skills to `outPath` */
export async function exportSkillBundleZip(
  skillDirs: readonly string[],
  outPath: string,
  limits: SkillFolderLimits = DEFAULT_LIMITS,
): Promise<SkillExportInfo[]> {
  const { bytes, infos } = await buildSkillBundleZip(skillDirs, limits)
  await writeExport(outPath, bytes)
  return infos
}
