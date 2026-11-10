/// Exporting the open workbook as an ODS copy: the sidecar writes a complete
/// new ODS package from the session's saved .xlsx state, the dropped-feature
/// warning is asked once, and only then is the finished file moved onto the
/// chosen target. The written file is opened again through the sidecar's ODS
/// reader before the export counts as done. The open session stays an .xlsx
/// session throughout — nothing here renames or re-targets it.

import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { promoteFileAtomically } from '@genoffice/xlsx-gateway/gateway/xlsx-package-io'

import type { OdsConversionResult, OdsDroppedCounts } from './xlsx-sidecar-client'

/** The sidecar calls this module needs; the real client and a test double both fit. */
export interface OdsExportSidecar {
  convertToOds(input: { path: string; targetPath: string }): Promise<OdsConversionResult>
  convertWorkbook(input: {
    path: string
    targetPath: string
  }): Promise<{ sheets: number; cells: number }>
}

export type OdsLossKind =
  'formulas' | 'charts' | 'images' | 'conditionalFormats' | 'validations' | 'pivots' | 'comments'

export interface OdsLoss {
  readonly kind: OdsLossKind
  readonly count: number
}

const DROPPED_KINDS = [
  'charts',
  'images',
  'conditionalFormats',
  'validations',
  'pivots',
  'comments',
] as const satisfies readonly (keyof OdsDroppedCounts)[]

/** The non-zero losses of one conversion, in the order the warning lists them. */
export function odsLosses(result: OdsConversionResult): OdsLoss[] {
  const losses: OdsLoss[] = []
  if (result.formulasDropped > 0) losses.push({ kind: 'formulas', count: result.formulasDropped })
  for (const kind of DROPPED_KINDS) {
    const count = result.dropped[kind]
    if (count > 0) losses.push({ kind, count })
  }
  return losses
}

export type OdsExportOutcome =
  | { readonly status: 'exported'; readonly path: string; readonly result: OdsConversionResult }
  /// the person declined the dropped-feature warning; nothing was written
  | { readonly status: 'canceled' }
  /// the placed file could not be opened again; it was removed
  | { readonly status: 'unreadable' }
  | { readonly status: 'failed'; readonly message: string }

/**
 * Writes `sourcePath` (the session's saved .xlsx state) as a new ODS package at
 * `targetPath`. The conversion lands in a private temp folder first, so a
 * conversion that fails or a warning the person cancels leaves the target
 * exactly as it was. `confirmLoss` runs before anything reaches the target.
 */
export async function exportWorkbookAsOds(input: {
  sidecar: OdsExportSidecar
  sourcePath: string
  targetPath: string
  confirmLoss: (losses: readonly OdsLoss[]) => Promise<boolean>
}): Promise<OdsExportOutcome> {
  const workDir = await mkdtemp(join(tmpdir(), 'genoffice-ods-export-'))
  const tempOds = join(workDir, `${basename(input.targetPath).replace(/\.ods$/i, '')}.ods`)
  const verifyXlsx = join(workDir, 'verify.xlsx')
  try {
    let result: OdsConversionResult
    try {
      result = await input.sidecar.convertToOds({ path: input.sourcePath, targetPath: tempOds })
    } catch (error) {
      return { status: 'failed', message: errorMessage(error) }
    }
    const losses = odsLosses(result)
    if (losses.length > 0 && !(await input.confirmLoss(losses))) return { status: 'canceled' }
    // Verify the private package before it replaces the target: a bad write
    // must never destroy an ODS the person already had at that path.
    try {
      // The same ODS reader the import path uses opens the finished package.
      // A blank workbook is a valid ODS package: sheets but no cell values.
      const reopened = await input.sidecar.convertWorkbook({
        path: tempOds,
        targetPath: verifyXlsx,
      })
      if (reopened.sheets <= 0) return { status: 'unreadable' }
    } catch {
      return { status: 'unreadable' }
    }
    try {
      await placeFile(tempOds, input.targetPath)
    } catch (error) {
      return { status: 'failed', message: errorMessage(error) }
    }
    return { status: 'exported', path: input.targetPath, result }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/** Copy beside the target, then promote: the app's staged-save write order. */
async function placeFile(sourcePath: string, targetPath: string): Promise<void> {
  const besideTarget = join(dirname(targetPath), `.${randomUUID()}.tmp.ods`)
  try {
    await copyFile(sourcePath, besideTarget)
    await promoteFileAtomically(besideTarget, targetPath)
  } catch (error) {
    await rm(besideTarget, { force: true }).catch(() => undefined)
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
