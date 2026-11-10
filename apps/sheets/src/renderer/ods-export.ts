/// ODS export of the whole workbook. The main process converts a private temp
/// copy from the session's saved .xlsx state, warns once about the features ODS
/// cannot hold, and only then writes the target. The open workbook keeps its
/// path and stays an .xlsx session — this is a copy, like Export CSV/PDF.

import { t } from './i18n/locale'
import { showToast } from './toast-bus'
import type { LazyWorkbookState } from './univer-state'

/** The App refs/state the ODS export needs; built fresh per call. */
export interface OdsExportContext {
  lazyWorkbookRef: { readonly current: LazyWorkbookState | null }
  setMessage: (message: string) => void
  /// Save the open workbook first so the sidecar converts the current edits,
  /// not the last saved snapshot. False when the save was canceled or failed.
  saveFirst: () => Promise<boolean>
}

/// True when a file was written. `targetPath` is the Save As pick the main
/// process authorized for this one export.
export async function handleExportOds(
  ctx: OdsExportContext,
  targetPath?: string,
): Promise<boolean> {
  if (!ctx.lazyWorkbookRef.current) return false
  try {
    // The sidecar reads a real .xlsx package, so the open workbook is saved
    // first; the export must not silently omit edits made since the last save.
    if (!(await ctx.saveFirst())) return false
    // A real save swaps the sidecar session; read the id after the save.
    const state = ctx.lazyWorkbookRef.current
    if (!state) return false
    const result = await window.desktopApi.exportOds({
      sessionId: state.file.sessionId,
      ...(targetPath === undefined ? {} : { targetPath }),
    })
    if (result.canceled) {
      // The main process already showed the dialog for a refusal or a failed
      // write; the status line just records that nothing was exported.
      ctx.setMessage(
        result.reason === 'failed' || result.reason === 'unreadable'
          ? t('appOdsExportFailed')
          : t('appOdsExportCanceled'),
      )
      return false
    }
    const exported = t('appOdsExported', { path: result.path })
    ctx.setMessage(exported)
    showToast(exported)
    return true
  } catch (error: unknown) {
    const failed = error instanceof Error ? error.message : t('appOdsExportFailed')
    ctx.setMessage(failed)
    showToast(failed, 'error')
    return false
  }
}
