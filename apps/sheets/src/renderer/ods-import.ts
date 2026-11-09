/**
 * The footer line for a document opened from an .ods file. The session runs on
 * a converted .xlsx copy (decision 0119), so the line says where saving will
 * write and, when the conversion had to drop formulas, how many cells kept
 * their value only. It lives for the life of the open document and is kept
 * apart from the transient status message.
 */

/// What the footer must say about the open document.
export interface OdsConversionNotice {
  /// formulas the conversion could not translate; those cells kept their value
  readonly formulasDropped: number
}

/// The document's ODS state, or null for a file that was not opened from .ods.
export function odsConversionNoticeOf(file: {
  readonly odsConverted?: boolean | undefined
  readonly formulasDropped?: number | undefined
}): OdsConversionNotice | null {
  if (file.odsConverted !== true) return null
  return { formulasDropped: file.formulasDropped ?? 0 }
}

/// The two keys this line uses; the renderer's wider translator fits.
type NoticeTranslate = (
  key: 'appOdsImportNotice' | 'appOdsFormulasDropped',
  params?: { count: number },
) => string

/// One line: the copy is .xlsx, plus the formulas kept as values.
export function odsConversionNoticeText(
  notice: OdsConversionNotice,
  translate: NoticeTranslate,
): string {
  const base = translate('appOdsImportNotice')
  return notice.formulasDropped > 0
    ? `${base} ${translate('appOdsFormulasDropped', { count: notice.formulasDropped })}`
    : base
}
