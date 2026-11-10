//! `.xlsx` → `.ods` export: a whole conversion, not a byte-preserving edit
//! (decision 0119).
//!
//! The workbook is opened through `WorkbookSessions`, so the export reuses the
//! model the editor already parsed — cell values and formulas, styles, merges,
//! column widths and row heights, page setup, visuals, conditional rules and
//! validations — instead of reading the package a second time. The writer is
//! new: values, formulas, merges, sizing and cell formatting go into a fresh
//! ODS package, and everything ODF cannot carry is counted so the app can warn
//! before saving.
//!
//! Memory stays bounded: one sheet is read in `read_range` windows and each
//! row is written out as soon as it is built, so a million-row sheet never
//! exists as one string. The package is written to a sibling temp file and
//! renamed into place, so a failure leaves no partial `.ods` behind.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use uuid::Uuid;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::odf_formula;
use crate::ods_styles::{ResolvedStyle, StyleRegistry, ValueKind};
use crate::xlsx_package::escape_xml;
use crate::{
    CellRange, CellRecord, CellStyle, CellValue, MergedRange, PagePrintInfo, RangeResult,
    RowProperty, SheetMetadata, SidecarError, WorkbookMetadata, WorkbookSessions,
};

/// Excel's grid limits, the same ones the reader enforces.
const MAX_ROWS: usize = 1_048_576;
const MAX_COLUMNS: usize = 16_384;
/// Cells `read_range` will hand over in one answer.
const READ_WINDOW_CELLS: usize = 100_000;
/// Above this many cells the box is narrowed to the extent that actually holds
/// values. A sheet whose formatting reaches the last row must not make the
/// export read and write a million empty cells.
const MAX_EXPORT_CELLS: usize = 2_000_000;
/// How long the export waits for the sheet index to finish, so the sheet-wide
/// parts (conditional rules, validations, page setup) are the real ones.
const INDEX_WAIT: Duration = Duration::from_secs(60);

const MIMETYPE: &str = "application/vnd.oasis.opendocument.spreadsheet";

const NAMESPACES: &str = concat!(
    r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" "#,
    r#"xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" "#,
    r#"xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" "#,
    r#"xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" "#,
    r#"xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" "#,
    r#"xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" "#,
    r#"xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" "#,
    r#"xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" "#,
);

/// What the export did, in the shape the protocol returns it. `dropped` counts
/// the features the caller has to warn about before saving.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OdsExportResult {
    pub sheets: usize,
    pub cells: usize,
    #[serde(rename = "formulasDropped")]
    pub formulas_dropped: u32,
    pub dropped: DroppedFeatures,
}

/// Features an ODS package written here does not carry (decision 0119).
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFeatures {
    pub charts: u32,
    pub images: u32,
    pub conditional_formats: u32,
    pub validations: u32,
    pub pivots: u32,
    pub comments: u32,
}

/// Converts the workbook at `source` into a new ODS package at `target`.
pub fn convert_to_ods(source: &Path, target: &Path) -> Result<OdsExportResult, SidecarError> {
    reject_same_target(source, target)?;
    let mut sessions = WorkbookSessions::new();
    let metadata = sessions.open(source)?;
    let session_id = metadata.session_id.clone();
    let result = write_document(&mut sessions, &metadata, target);
    // A close failure only means the temporary index directory survived; the
    // converted file is already in place, so it must not turn into an error.
    let _ = sessions.close(&session_id);
    result
}

fn reject_same_target(source: &Path, target: &Path) -> Result<(), SidecarError> {
    if target.as_os_str().is_empty() {
        return Err(SidecarError::InvalidRequest(
            "The ODS target path is empty.".into(),
        ));
    }
    if let (Ok(source), Ok(target)) = (fs::canonicalize(source), fs::canonicalize(target)) {
        if source == target {
            return Err(SidecarError::InvalidRequest(
                "The ODS target must differ from the source workbook.".into(),
            ));
        }
    }
    Ok(())
}

fn write_document(
    sessions: &mut WorkbookSessions,
    metadata: &WorkbookMetadata,
    target: &Path,
) -> Result<OdsExportResult, SidecarError> {
    let mut staging = StagingFiles::new(target);
    let base = metadata.styles.first().cloned().unwrap_or_default();
    let mut registry = StyleRegistry::new(base.clone());
    let mut pages = PageLayouts::default();
    let mut table_styles: Vec<String> = Vec::new();
    let mut counters = Counters::new(metadata);

    let body_path = staging.path("body");
    {
        let mut body = BufWriter::new(File::create(&body_path)?);
        for (index, sheet) in metadata.sheets.iter().enumerate() {
            let wide = read_sheet_wide(sessions, &metadata.session_id, sheet)?;
            counters.count_sheet(&wide);
            let master = pages.register(wide.page_setup.as_ref());
            let table_style = format!("ta{}", index + 1);
            table_styles.push(table_style_xml(&table_style, sheet.hidden, &master));
            write_table(
                sessions,
                &metadata.session_id,
                sheet,
                &table_style,
                &metadata.styles,
                &base,
                metadata.date1904,
                &mut body,
                &mut registry,
                &mut counters,
            )?;
        }
        body.flush()?;
    }

    let content_path = staging.path("content");
    write_content_xml(
        &content_path,
        &registry,
        &table_styles,
        &body_path,
        metadata,
    )?;
    let styles_path = staging.path("styles");
    fs::write(&styles_path, styles_xml(&registry, &pages))?;
    let meta_path = staging.path("meta");
    fs::write(&meta_path, meta_xml())?;
    let settings_path = staging.path("settings");
    fs::write(&settings_path, settings_xml(metadata))?;

    let archive_path = staging.path("archive");
    write_archive(&archive_path, &content_path, &styles_path, &meta_path, &settings_path)?;
    promote(&archive_path, target)?;
    staging.forget(&archive_path);

    counters.sheets = metadata.sheets.len();
    Ok(counters.finish())
}

/// The `content.xml` header, automatic styles, and the body streamed out of
/// the table-writing pass.
fn write_content_xml(
    path: &Path,
    registry: &StyleRegistry,
    table_styles: &[String],
    body_path: &Path,
    metadata: &WorkbookMetadata,
) -> Result<(), SidecarError> {
    let file = File::create(path)?;
    let mut out = BufWriter::new(file);
    let mut header = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {NAMESPACES}office:version="1.2">"#
    );
    header.push_str("<office:font-face-decls>");
    header.push_str(&registry.font_face_decls());
    header.push_str("</office:font-face-decls><office:automatic-styles>");
    header.push_str(&registry.automatic_styles());
    for style in table_styles {
        header.push_str(style);
    }
    header.push_str("</office:automatic-styles><office:body><office:spreadsheet>");
    if metadata.date1904 {
        // The null date tells a reader how to read every numeric date it will
        // meet; without it the 1904 workbook's serials would land four years
        // and a day off.
        header.push_str(r#"<table:calculation-settings table:null-date="1904-01-01"/>"#);
    }
    out.write_all(header.as_bytes())?;
    let mut body = File::open(body_path)?;
    io::copy(&mut body, &mut out)?;
    out.write_all(b"</office:spreadsheet></office:body></office:document-content>")?;
    out.flush()?;
    Ok(())
}

fn styles_xml(registry: &StyleRegistry, pages: &PageLayouts) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-styles {NAMESPACES}office:version="1.2"><office:font-face-decls>{}</office:font-face-decls><office:styles>{}</office:styles><office:automatic-styles>{}</office:automatic-styles><office:master-styles>{}</office:master-styles></office:document-styles>"#,
        registry.font_face_decls(),
        registry.default_cell_style(),
        pages.layouts,
        pages.masters,
    )
}

fn meta_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2"><office:meta><meta:generator>GenOffice</meta:generator></office:meta></office:document-meta>"#
    )
}

/// `settings.xml` carries what ODF keeps outside the document body: the sheet
/// the reader should show first and each sheet's frozen rows and columns.
fn settings_xml(metadata: &WorkbookMetadata) -> String {
    let mut tables = String::new();
    for sheet in &metadata.sheets {
        let Some(freeze) = sheet.freeze else {
            continue;
        };
        let horizontal = if freeze.frozen_columns > 0 { 2 } else { 0 };
        let vertical = if freeze.frozen_rows > 0 { 2 } else { 0 };
        if horizontal == 0 && vertical == 0 {
            continue;
        }
        tables.push_str(&format!(
            r#"<config:config-item-map-entry config:name="{}"><config:config-item config:name="HorizontalSplitMode" config:type="short">{horizontal}</config:config-item><config:config-item config:name="VerticalSplitMode" config:type="short">{vertical}</config:config-item><config:config-item config:name="HorizontalSplitPosition" config:type="int">{}</config:config-item><config:config-item config:name="VerticalSplitPosition" config:type="int">{}</config:config-item></config:config-item-map-entry>"#,
            escape_xml(&sheet.name),
            freeze.frozen_columns,
            freeze.frozen_rows,
        ));
    }
    let table_map = if tables.is_empty() {
        String::new()
    } else {
        format!(
            r#"<config:config-item-map-named config:name="Tables">{tables}</config:config-item-map-named>"#
        )
    };
    let active = active_sheet_name(metadata);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" office:version="1.2"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item config:name="ViewAreaTop" config:type="long">0</config:config-item><config:config-item config:name="ViewAreaLeft" config:type="long">0</config:config-item><config:config-item config:name="ActiveTable" config:type="string">{}</config:config-item><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry><config:config-item config:name="ViewId" config:type="string">view1</config:config-item><config:config-item config:name="ActiveTable" config:type="string">{}</config:config-item>{table_map}</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings></office:document-settings>"#,
        escape_xml(&active),
        escape_xml(&active),
    )
}

/// The tab the workbook was on, unless that sheet is hidden — hiding is not a
/// reason for a reader to open on an invisible sheet.
fn active_sheet_name(metadata: &WorkbookMetadata) -> String {
    let active = metadata.sheets.get(metadata.active_tab);
    active
        .filter(|sheet| !sheet.hidden)
        .or_else(|| metadata.sheets.iter().find(|sheet| !sheet.hidden))
        .or_else(|| metadata.sheets.first())
        .map(|sheet| sheet.name.clone())
        .unwrap_or_default()
}

fn write_archive(
    path: &Path,
    content_path: &Path,
    styles_path: &Path,
    meta_path: &Path,
    settings_path: &Path,
) -> Result<(), SidecarError> {
    let file = File::create(path)?;
    let mut writer = ZipWriter::new(file);
    // The mimetype entry must come first and be stored, not deflated: that is
    // how a reader recognizes the package before unpacking it.
    writer.start_file(
        "mimetype",
        SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
    )?;
    writer.write_all(MIMETYPE.as_bytes())?;
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    writer.start_file("META-INF/manifest.xml", options)?;
    writer.write_all(manifest_xml().as_bytes())?;
    for (name, source) in [
        ("content.xml", content_path),
        ("styles.xml", styles_path),
        ("meta.xml", meta_path),
        ("settings.xml", settings_path),
    ] {
        writer.start_file(name, options)?;
        let mut part = File::open(source)?;
        io::copy(&mut part, &mut writer)?;
    }
    let finished = writer.finish()?;
    crate::archive::sync_best_effort(&finished)?;
    Ok(())
}

fn manifest_xml() -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="{MIMETYPE}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/></manifest:manifest>"#
    )
}

/// Replaces `target` with the finished archive. Windows will not rename onto
/// an existing file, so an existing target is removed first — the new file is
/// complete by then, which is what keeps a failed export from leaving a
/// half-written document behind.
fn promote(staged: &Path, target: &Path) -> Result<(), SidecarError> {
    match fs::rename(staged, target) {
        Ok(()) => Ok(()),
        Err(_) if target.exists() => {
            fs::remove_file(target)?;
            fs::rename(staged, target)?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

/// Temp files beside the target, reclaimed however the export ends.
struct StagingFiles {
    directory: PathBuf,
    stem: String,
    id: String,
    paths: Vec<PathBuf>,
}

impl StagingFiles {
    fn new(target: &Path) -> Self {
        let directory = target.parent().unwrap_or_else(|| Path::new(".")).to_path_buf();
        let stem = target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("export.ods")
            .to_owned();
        Self {
            directory,
            stem,
            id: Uuid::new_v4().to_string(),
            paths: Vec::new(),
        }
    }

    fn path(&mut self, kind: &str) -> PathBuf {
        let path = self
            .directory
            .join(format!(".{}.{}.{kind}.tmp", self.stem, self.id));
        self.paths.push(path.clone());
        path
    }

    fn forget(&mut self, path: &Path) {
        self.paths.retain(|candidate| candidate != path);
    }
}

impl Drop for StagingFiles {
    fn drop(&mut self) {
        for path in &self.paths {
            let _ = fs::remove_file(path);
        }
    }
}

/// What the export saw and did not carry. `charts` and `images` come from the
/// workbook's visuals, the rest from each sheet's metadata and range results.
#[derive(Default)]
struct Counters {
    sheets: usize,
    cells: usize,
    formulas_dropped: u32,
    dropped: DroppedFeatures,
}

impl Counters {
    fn new(metadata: &WorkbookMetadata) -> Self {
        let mut dropped = DroppedFeatures::default();
        for visual in &metadata.visuals {
            match visual.kind.as_str() {
                "chart" => dropped.charts += 1,
                "image" => dropped.images += 1,
                _ => {}
            }
        }
        for sheet in &metadata.sheets {
            dropped.images += sheet.cell_images.len() as u32;
            dropped.pivots += sheet.pivot_tables.len() as u32;
            dropped.comments += sheet.comments.len() as u32;
        }
        Self {
            sheets: 0,
            cells: 0,
            formulas_dropped: 0,
            dropped,
        }
    }

    fn count_sheet(&mut self, wide: &RangeResult) {
        self.dropped.conditional_formats += wide.conditional_rules.len() as u32;
        self.dropped.validations += wide.data_validations.len() as u32;
    }

    fn finish(self) -> OdsExportResult {
        OdsExportResult {
            sheets: self.sheets,
            cells: self.cells,
            formulas_dropped: self.formulas_dropped,
            dropped: self.dropped,
        }
    }
}

/// A sheet-wide read, once the index behind it has finished. The rules,
/// validations and page setup are only complete at that point; an export that
/// read them early would silently drop them.
fn read_sheet_wide(
    sessions: &mut WorkbookSessions,
    session_id: &str,
    sheet: &SheetMetadata,
) -> Result<RangeResult, SidecarError> {
    let probe = CellRange {
        start_row: 0,
        end_row: 0,
        start_column: 0,
        end_column: 0,
    };
    let deadline = Instant::now() + INDEX_WAIT;
    loop {
        let result = sessions.read_range(session_id, &sheet.id, &probe)?;
        if result.indexing_complete || Instant::now() >= deadline {
            return Ok(result);
        }
    }
}

/// The rows and columns the export walks: the sheet's used box, narrowed to
/// the value extent when the box is large enough that its empty formatting
/// would dominate the output.
fn export_box(sheet: &SheetMetadata) -> (usize, usize) {
    let mut rows = sheet.row_count.clamp(1, MAX_ROWS);
    let mut columns = sheet.column_count.clamp(1, MAX_COLUMNS);
    if rows.saturating_mul(columns) > MAX_EXPORT_CELLS {
        rows = sheet.value_row_count.unwrap_or(rows).clamp(1, rows);
        columns = sheet.value_column_count.unwrap_or(columns).clamp(1, columns);
    }
    (rows, columns)
}

/// The number of `<table:table-column>` entries: the box, widened to whatever
/// a sized column reaches so a width set past the data still travels.
fn axis_columns(sheet: &SheetMetadata, columns: usize) -> usize {
    let widest = sheet
        .column_widths
        .iter()
        .map(|span| span.end_column.saturating_add(1))
        .max()
        .unwrap_or(0);
    columns.max(widest).min(MAX_COLUMNS)
}

/// Per-column width in Excel character units and the hidden flag, resolved
/// from the spans the sheet declares.
fn column_widths(sheet: &SheetMetadata, count: usize) -> Vec<(Option<f64>, bool)> {
    let mut widths = vec![(None, false); count];
    for span in &sheet.column_widths {
        let start = span.start_column.min(count);
        let end = span.end_column.saturating_add(1).min(count);
        for width in widths.iter_mut().take(end).skip(start) {
            *width = (span.width, span.hidden);
        }
    }
    widths
}

/// Excel's column width (characters of the default font) as the points ODF
/// measures lengths in: characters → pixels at 96 dpi → points.
fn width_points(width: f64) -> f64 {
    ((width * 7.0 + 5.0) * 0.75).max(0.0)
}

#[allow(clippy::too_many_arguments)]
fn write_table(
    sessions: &mut WorkbookSessions,
    session_id: &str,
    sheet: &SheetMetadata,
    table_style: &str,
    styles: &[CellStyle],
    base: &CellStyle,
    date1904: bool,
    out: &mut impl Write,
    registry: &mut StyleRegistry,
    counters: &mut Counters,
) -> Result<(), SidecarError> {
    let (rows, columns) = export_box(sheet);
    let axis = axis_columns(sheet, columns);
    let mut head = format!(
        r#"<table:table table:name="{}" table:style-name="{table_style}""#,
        escape_xml(&sheet.name)
    );
    if sheet.hidden {
        head.push_str(r#" table:display="false""#);
    }
    head.push('>');
    out.write_all(head.as_bytes())?;

    // Column axis: one entry per run of identical width/visibility.
    let widths = column_widths(sheet, axis);
    let column_styles: Vec<Option<usize>> = {
        let mut styles = vec![None; axis];
        for span in &sheet.column_widths {
            let start = span.start_column.min(axis);
            let end = span.end_column.saturating_add(1).min(axis);
            for style in styles.iter_mut().take(end).skip(start) {
                *style = span.style_index;
            }
        }
        styles
    };
    let mut column = 0;
    while column < axis {
        let (width, hidden) = widths[column];
        let mut run = 1;
        while column + run < axis && widths[column + run] == (width, hidden) {
            run += 1;
        }
        let mut attributes = String::new();
        if let Some(width) = width.filter(|width| *width > 0.0) {
            attributes.push_str(&format!(
                r#" table:style-name="{}""#,
                registry.column(width_points(width))
            ));
        }
        if hidden {
            attributes.push_str(r#" table:visibility="collapse""#);
        }
        if run > 1 {
            attributes.push_str(&format!(r#" table:number-columns-repeated="{run}""#));
        }
        out.write_all(format!("<table:table-column{attributes}/>").as_bytes())?;
        column += run;
    }

    let mut merges = MergeIndex::default();
    let mut sink = RowSink { out, pending: 0, wrote_row: false };
    let mut row_styles: HashMap<usize, Option<usize>> = HashMap::new();
    let mut resolved: HashMap<usize, ResolvedStyle> = HashMap::new();
    let window_rows = (READ_WINDOW_CELLS / columns.max(1)).clamp(1, 4096);

    let mut start = 0;
    while start < rows {
        let end = (start + window_rows - 1).min(rows - 1);
        let range = CellRange {
            start_row: start,
            end_row: end,
            start_column: 0,
            end_column: columns - 1,
        };
        let window = sessions.read_range(session_id, &sheet.id, &range)?;
        for merge in &window.merges {
            merges.add(*merge);
        }
        merges.sort();
        let mut by_row: HashMap<usize, Vec<&CellRecord>> = HashMap::new();
        for cell in &window.cells {
            by_row.entry(cell.row).or_default().push(cell);
        }
        for cells in by_row.values_mut() {
            cells.sort_by_key(|cell| cell.column);
        }
        row_styles.clear();
        for row in &window.rows {
            row_styles.insert(row.row, row.style_index);
        }
        let mut cursor = merges.partition_before(start);
        let mut active: Vec<&MergedRange> = merges.active_from(start, cursor);
        for row in start..=end {
            while cursor < merges.len() && merges.merges[cursor].start_row <= row {
                active.push(&merges.merges[cursor]);
                cursor += 1;
            }
            active.retain(|merge| merge.end_row >= row);
            let properties = window.rows.iter().find(|entry| entry.row == row);
            write_row(
                &mut sink,
                row,
                by_row.get(&row).map(Vec::as_slice).unwrap_or(&[]),
                properties,
                &active,
                row_styles.get(&row).copied().flatten(),
                &column_styles,
                styles,
                base,
                date1904,
                registry,
                &mut resolved,
                counters,
            )?;
        }
        start = end + 1;
    }
    sink.finish()?;
    out.write_all(b"</table:table>")?;
    Ok(())
}

/// The merges read so far, in sheet order. A window only reports the merges it
/// intersects, so the list grows as the sheet is walked; the sorted prefix is
/// what lets the row loop keep a small active set.
#[derive(Default)]
struct MergeIndex {
    merges: Vec<MergedRange>,
    seen: HashSet<(usize, usize, usize, usize)>,
}

impl MergeIndex {
    fn add(&mut self, merge: MergedRange) {
        let key = (
            merge.start_row,
            merge.start_column,
            merge.end_row,
            merge.end_column,
        );
        if self.seen.insert(key) {
            self.merges.push(merge);
        }
    }

    fn sort(&mut self) {
        self.merges
            .sort_by_key(|merge| (merge.start_row, merge.start_column));
    }

    fn partition_before(&self, row: usize) -> usize {
        self.merges.partition_point(|merge| merge.start_row <= row)
    }

    fn active_from(&self, row: usize, cursor: usize) -> Vec<&MergedRange> {
        self.merges[..cursor]
            .iter()
            .filter(|merge| merge.end_row >= row)
            .collect()
    }

    fn len(&self) -> usize {
        self.merges.len()
    }
}

/// Rows written in order, with a run of empty rows collapsed into one repeated
/// row element. Trailing empty rows are dropped: nothing needs them.
struct RowSink<'a, W: Write> {
    out: &'a mut W,
    pending: usize,
    wrote_row: bool,
}

impl<W: Write> RowSink<'_, W> {
    fn empty(&mut self) {
        self.pending += 1;
    }

    fn push(&mut self, attributes: &str, cells: &str) -> io::Result<()> {
        self.flush()?;
        write!(
            self.out,
            "<table:table-row{attributes}>{cells}</table:table-row>"
        )?;
        self.wrote_row = true;
        Ok(())
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.pending == 0 {
            return Ok(());
        }
        let repeat = if self.pending > 1 {
            format!(r#" table:number-rows-repeated="{}""#, self.pending)
        } else {
            String::new()
        };
        write!(self.out, "<table:table-row{repeat}/>")?;
        self.pending = 0;
        self.wrote_row = true;
        Ok(())
    }

    fn finish(&mut self) -> io::Result<()> {
        if !self.wrote_row {
            self.out
                .write_all(b"<table:table-row><table:table-cell/></table:table-row>")?;
        }
        self.pending = 0;
        Ok(())
    }
}

#[allow(clippy::too_many_arguments)]
fn write_row<W: Write>(
    sink: &mut RowSink<'_, W>,
    row: usize,
    cells: &[&CellRecord],
    properties: Option<&RowProperty>,
    active: &[&MergedRange],
    row_style: Option<usize>,
    column_styles: &[Option<usize>],
    styles: &[CellStyle],
    base: &CellStyle,
    date1904: bool,
    registry: &mut StyleRegistry,
    resolved: &mut HashMap<usize, ResolvedStyle>,
    counters: &mut Counters,
) -> Result<(), SidecarError> {
    let mut last = cells.last().map(|cell| cell.column);
    for merge in active {
        last = Some(last.map_or(merge.end_column, |last| last.max(merge.end_column)));
    }
    let attributes = row_attributes(properties, registry);
    let Some(last) = last else {
        if attributes.is_empty() {
            sink.empty();
        } else {
            sink.push(&attributes, "")?;
        }
        return Ok(());
    };

    let mut xml = String::with_capacity((last + 1) * 48);
    let mut column = 0;
    let mut cell_index = 0;
    while column <= last {
        // A record can only be emitted at its own column; anything left
        // behind sits inside a merged range and has no place in ODF.
        while cell_index < cells.len() && cells[cell_index].column < column {
            cell_index += 1;
        }
        if let Some(merge) = active
            .iter()
            .find(|merge| merge.start_row == row && merge.start_column == column)
        {
            let record = cells.get(cell_index).filter(|cell| cell.column == column).copied();
            if record.is_some() {
                cell_index += 1;
            }
            let style = resolve_style(
                record,
                row_style,
                column_styles,
                column,
                styles,
                base,
                registry,
                resolved,
            );
            push_cell(
                &mut xml,
                record,
                &style,
                Some(merge),
                date1904,
                counters,
            );
            column += 1;
            continue;
        }
        if let Some(merge) = active
            .iter()
            .find(|merge| merge.start_column <= column && merge.end_column >= column)
        {
            // A covered corner: ODF wants the covered cells present, and a
            // repeat count keeps a wide merged banner to one element.
            let mut run = 1;
            while column + run <= last
                && merge.end_column >= column + run
                && !(merge.start_row == row && merge.start_column == column + run)
            {
                run += 1;
            }
            if run > 1 {
                xml.push_str(&format!(
                    r#"<table:covered-table-cell table:number-columns-repeated="{run}"/>"#
                ));
            } else {
                xml.push_str("<table:covered-table-cell/>");
            }
            column += run;
            continue;
        }
        let record = cells.get(cell_index).filter(|cell| cell.column == column).copied();
        if let Some(record) = record {
            cell_index += 1;
            let style = resolve_style(
                Some(record),
                row_style,
                column_styles,
                column,
                styles,
                base,
                registry,
                resolved,
            );
            push_cell(&mut xml, Some(record), &style, None, date1904, counters);
            column += 1;
            continue;
        }
        let mut run = 1;
        while column + run <= last && !occupied(&cells, cell_index, column + run, active) {
            run += 1;
        }
        if run > 1 {
            xml.push_str(&format!(
                r#"<table:table-cell table:number-columns-repeated="{run}"/>"#
            ));
        } else {
            xml.push_str("<table:table-cell/>");
        }
        column += run;
    }
    sink.push(&attributes, &xml)?;
    Ok(())
}

/// True when the column already has a cell record or sits inside a merge, so
/// an empty run must stop before it.
fn occupied(cells: &[&CellRecord], cell_index: usize, column: usize, active: &[&MergedRange]) -> bool {
    cells
        .get(cell_index)
        .is_some_and(|cell| cell.column == column)
        || active.iter().any(|merge| {
            merge.start_column <= column && merge.end_column >= column
        })
}

fn row_attributes(properties: Option<&RowProperty>, registry: &mut StyleRegistry) -> String {
    let Some(properties) = properties else {
        return String::new();
    };
    let mut attributes = String::new();
    if let Some(height) = properties.height.filter(|height| *height > 0.0) {
        attributes.push_str(&format!(
            r#" table:style-name="{}""#,
            registry.row(height)
        ));
    }
    if properties.hidden {
        attributes.push_str(r#" table:visibility="collapse""#);
    }
    attributes
}

fn resolve_style(
    record: Option<&CellRecord>,
    row_style: Option<usize>,
    column_styles: &[Option<usize>],
    column: usize,
    styles: &[CellStyle],
    base: &CellStyle,
    registry: &mut StyleRegistry,
    cache: &mut HashMap<usize, ResolvedStyle>,
) -> ResolvedStyle {
    let own = record.and_then(|record| record.style_index).unwrap_or(0);
    let index = if own != 0 {
        own
    } else {
        row_style
            .or_else(|| column_styles.get(column).copied().flatten())
            .unwrap_or(0)
    };
    if let Some(style) = cache.get(&index) {
        return style.clone();
    }
    // An xf index past the table keeps the default look rather than dropping
    // the cell.
    let style = registry.resolve_cell(styles.get(index).unwrap_or(base));
    cache.insert(index, style.clone());
    style
}

/// One `table:table-cell` (or its merge anchor) with the value, formula and
/// style the record carries.
fn push_cell(
    out: &mut String,
    record: Option<&CellRecord>,
    style: &ResolvedStyle,
    merge: Option<&MergedRange>,
    date1904: bool,
    counters: &mut Counters,
) {
    let mut attributes = String::new();
    if let Some(name) = &style.name {
        attributes.push_str(&format!(r#" table:style-name="{name}""#));
    }
    if let Some(merge) = merge {
        let columns = merge.end_column - merge.start_column + 1;
        let rows = merge.end_row - merge.start_row + 1;
        if columns > 1 {
            attributes.push_str(&format!(r#" table:number-columns-spanned="{columns}""#));
        }
        if rows > 1 {
            attributes.push_str(&format!(r#" table:number-rows-spanned="{rows}""#));
        }
    }
    let formula = record.and_then(|record| record.formula.as_deref());
    let translated = formula.and_then(|formula| odf_formula::to_odf(formula));
    if formula.is_some() && translated.is_none() {
        counters.formulas_dropped += 1;
    }
    if let Some(translated) = &translated {
        attributes.push_str(&format!(
            r#" table:formula="{}""#,
            escape_xml(translated)
        ));
    }
    let body = match record.and_then(|record| record.value.as_ref()) {
        Some(CellValue::String(text)) => {
            attributes.push_str(r#" office:value-type="string""#);
            text_paragraphs(text)
        }
        Some(CellValue::Boolean(flag)) => {
            attributes.push_str(&format!(
                r#" office:value-type="boolean" office:boolean-value="{}""#,
                if *flag { "true" } else { "false" }
            ));
            format!("<text:p>{}</text:p>", if *flag { "TRUE" } else { "FALSE" })
        }
        Some(CellValue::Number(number)) => {
            let number = *number;
            match style.kind {
                ValueKind::Date => match serial_parts(number, date1904) {
                    Some((year, month, day, seconds)) => {
                        attributes.push_str(&format!(
                            r#" office:value-type="date" office:date-value="{}""#,
                            date_value(year, month, day, seconds)
                        ));
                        format!("<text:p>{}</text:p>", date_text(year, month, day, seconds))
                    }
                    // A serial with no real date (Excel's phantom 1900 leap
                    // day) keeps its number: a wrong date would be worse.
                    None => number_parts(number, &mut attributes),
                },
                ValueKind::Time => {
                    attributes.push_str(&format!(
                        r#" office:value-type="time" office:time-value="{}""#,
                        duration_value(number)
                    ));
                    format!("<text:p>{}</text:p>", duration_text(number))
                }
                ValueKind::Number => number_parts(number, &mut attributes),
            }
        }
        None => String::new(),
    };
    if body.is_empty() {
        out.push_str(&format!("<table:table-cell{attributes}/>"));
    } else {
        out.push_str(&format!(
            "<table:table-cell{attributes}>{body}</table:table-cell>"
        ));
    }
    counters.cells += usize::from(
        record.is_some_and(|record| record.value.is_some() || record.formula.is_some()),
    );
}

fn number_parts(number: f64, attributes: &mut String) -> String {
    attributes.push_str(&format!(
        r#" office:value-type="float" office:value="{}""#,
        number_text(number)
    ));
    format!("<text:p>{}</text:p>", number_text(number))
}

/// A number as the text an ODF attribute and a cell paragraph carry.
fn number_text(number: f64) -> String {
    if !number.is_finite() {
        return "0".to_owned();
    }
    if number == 0.0 {
        return "0".to_owned();
    }
    format!("{number}")
}

/// The serial's civil date and seconds of that day. `None` when the serial is
/// not a date a reader can show (below the grid, or Excel's 1900-02-29).
fn serial_parts(serial: f64, date1904: bool) -> Option<(i64, u32, u32, f64)> {
    if !serial.is_finite() || serial < 0.0 {
        return None;
    }
    let adjusted = if date1904 { serial + 1462.0 } else { serial };
    // Serial 60 is the day Excel shows as 1900-02-29; no calendar has it.
    if (60.0..61.0).contains(&adjusted) || adjusted < 1.0 {
        return None;
    }
    let mut days = adjusted.floor();
    if adjusted < 60.0 {
        // Excel counts from 1900-01-01 as serial 1, but its phantom leap day
        // shifts every later date by one; the 1899-12-30 epoch absorbs that
        // only from March 1900 on.
        days += 1.0;
    }
    if days > 2_958_465.0 {
        return None;
    }
    let (year, month, day) = civil_from_days(days as i64 - 25_569);
    let mut seconds = (adjusted.fract() * 86_400.0 * 1000.0).round() / 1000.0;
    if seconds >= 86_400.0 {
        seconds = 0.0;
    }
    Some((year, month, day, seconds))
}

/// Days since 1970-01-01 → the civil date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_position + 2) / 5 + 1) as u32;
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    } as u32;
    (year + i64::from(month <= 2), month, day)
}

fn date_value(year: i64, month: u32, day: u32, seconds: f64) -> String {
    let date = format!("{year:04}-{month:02}-{day:02}");
    if seconds <= 0.0 {
        return date;
    }
    format!("{date}T{}", clock(seconds))
}

fn date_text(year: i64, month: u32, day: u32, seconds: f64) -> String {
    let date = format!("{year:04}-{month:02}-{day:02}");
    if seconds <= 0.0 {
        return date;
    }
    format!("{date} {}", clock(seconds))
}

fn clock(seconds: f64) -> String {
    let whole = seconds.floor() as u64;
    let (hours, minutes, secs) = (whole / 3600, (whole / 60) % 60, whole % 60);
    let fraction = seconds - whole as f64;
    if fraction > 0.0 {
        format!("{hours:02}:{minutes:02}:{:02.3}", secs as f64 + fraction)
            .trim_end_matches('0')
            .to_owned()
    } else {
        format!("{hours:02}:{minutes:02}:{secs:02}")
    }
}

/// A fraction of a day as an ISO 8601 duration (`PT13H30M00S`).
fn duration_value(serial: f64) -> String {
    let total = if serial.is_finite() && serial > 0.0 {
        serial * 86_400.0
    } else {
        0.0
    };
    let whole = total.round() as u64;
    let (hours, minutes, seconds) = (whole / 3600, (whole / 60) % 60, whole % 60);
    format!("PT{hours}H{minutes}M{seconds}S")
}

fn duration_text(serial: f64) -> String {
    let total = if serial.is_finite() && serial > 0.0 {
        serial * 86_400.0
    } else {
        0.0
    };
    let whole = total.round() as u64;
    format!(
        "{:02}:{:02}:{:02}",
        whole / 3600,
        (whole / 60) % 60,
        whole % 60
    )
}

/// A cell's text as ODF paragraphs: one per line, with tabs and space runs the
/// format would otherwise collapse.
fn text_paragraphs(text: &str) -> String {
    let mut out = String::new();
    let mut lines = text.split('\n');
    if let Some(first) = lines.next() {
        out.push_str("<text:p>");
        push_text(&mut out, first);
        out.push_str("</text:p>");
    }
    for line in lines {
        out.push_str("<text:p>");
        push_text(&mut out, line);
        out.push_str("</text:p>");
    }
    out
}

fn push_text(out: &mut String, line: &str) {
    let characters: Vec<char> = line.chars().collect();
    let mut index = 0;
    while index < characters.len() {
        let character = characters[index];
        if character == ' ' {
            let start = index;
            while index < characters.len() && characters[index] == ' ' {
                index += 1;
            }
            let count = index - start;
            if start == 0 || count > 1 {
                out.push_str(&format!(r#"<text:s text:c="{count}"/>"#));
            } else {
                out.push(' ');
            }
            continue;
        }
        index += 1;
        match character {
            '\t' => out.push_str("<text:tab/>"),
            '\r' => {}
            character if (character as u32) < 0x20 => {}
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            character => out.push(character),
        }
    }
}

fn table_style_xml(name: &str, hidden: bool, master: &str) -> String {
    format!(
        r#"<style:style style:name="{name}" style:family="table" style:master-page-name="{master}"><style:table-properties table:display="{}" table:print="true"/></style:style>"#,
        if hidden { "false" } else { "true" },
    )
}

/// Page layouts for the sheets, deduplicated: a workbook usually has one.
#[derive(Default)]
struct PageLayouts {
    layouts: String,
    masters: String,
    seen: Vec<(String, String)>,
    counter: usize,
}

impl PageLayouts {
    /// Registers a sheet's print setup and returns the master page name its
    /// table style points at.
    fn register(&mut self, setup: Option<&PagePrintInfo>) -> String {
        let key = match setup {
            Some(setup) => format!(
                "{:?}|{:?}|{:?}|{:?}|{:?}",
                setup.orientation,
                setup.paper_size,
                setup.scale,
                setup.margins,
                setup.fit_to_page,
            ),
            None => "default".to_owned(),
        };
        if let Some((_, master)) = self.seen.iter().find(|(entry, _)| *entry == key) {
            return master.clone();
        }
        self.counter += 1;
        let layout = format!("pm{}", self.counter);
        let master = format!("m{}", self.counter);
        let (width, height) = paper_size(setup.and_then(|setup| setup.paper_size));
        let orientation = setup
            .and_then(|setup| setup.orientation.as_deref())
            .filter(|value| *value == "landscape")
            .unwrap_or("portrait");
        let (width, height) = if orientation == "landscape" {
            (height, width)
        } else {
            (width, height)
        };
        let margins = setup.and_then(|setup| setup.margins);
        let (left, right, top, bottom) = margins
            .map(|margins| {
                (
                    margins.left.max(0.0),
                    margins.right.max(0.0),
                    margins.top.max(0.0),
                    margins.bottom.max(0.0),
                )
            })
            .unwrap_or((0.7874, 0.7874, 0.7874, 0.7874));
        // Fit-to-page has no per-axis ODF spelling; a plain scale does.
        let scale = setup
            .filter(|setup| !setup.fit_to_page)
            .and_then(|setup| setup.scale)
            .filter(|scale| (10..=400).contains(scale))
            .map(|scale| format!(r#" style:scale-to="{scale}%""#))
            .unwrap_or_default();
        self.layouts.push_str(&format!(
            r#"<style:page-layout style:name="{layout}"><style:page-layout-properties fo:page-width="{width:.3}cm" fo:page-height="{height:.3}cm" style:print-orientation="{orientation}" fo:margin-left="{left:.4}in" fo:margin-right="{right:.4}in" fo:margin-top="{top:.4}in" fo:margin-bottom="{bottom:.4}in"{scale}/></style:page-layout>"#
        ));
        self.masters.push_str(&format!(
            r#"<style:master-page style:name="{master}" style:page-layout-name="{layout}"/>"#
        ));
        self.seen.push((key, master.clone()));
        master
    }
}

/// Paper size in centimetres for an Excel `paperSize` code; A4 when the code
/// is one this table does not know.
fn paper_size(code: Option<u32>) -> (f64, f64) {
    match code {
        Some(1) => (21.59, 27.94),  // Letter
        Some(3) => (27.94, 43.18),  // Tabloid
        Some(5) => (21.59, 35.56),  // Legal
        Some(8) => (29.7, 42.0),    // A3
        Some(11) => (14.8, 21.0),   // A5
        Some(13) => (17.6, 25.0),   // B5
        _ => (21.0, 29.7),          // A4
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use calamine::Reader;
    use std::io::Read;
    use tempfile::tempdir;
    use zip::ZipArchive;

    fn write_workbook(path: &Path, entries: &[(&str, String)]) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, content) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }

    fn read_entry(path: &Path, name: &str) -> String {
        let mut archive = ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut entry = archive.by_name(name).unwrap();
        let mut content = String::new();
        entry.read_to_string(&mut content).unwrap();
        content
    }

    const STYLES: &str = concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">"#,
        r#"<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFFF0000"/><name val="Arial"/></font></fonts>"#,
        r#"<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>"#,
        r#"<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders>"#,
        r#"<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>"#,
        r#"<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>"#,
        r#"</styleSheet>"#,
    );

    const SHEET: &str = concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:F4"/>"#,
        r#"<sheetFormatPr defaultRowHeight="15"/>"#,
        r#"<cols><col min="1" max="1" width="20.5" customWidth="1"/><col min="5" max="5" width="12" customWidth="1" hidden="1"/></cols>"#,
        r#"<sheetData>"#,
        r#"<row r="1"><c r="A1" t="inlineStr"><is><t>Hello &amp; &lt;World&gt;</t></is></c><c r="B1" s="1"><v>42</v></c><c r="C1" s="5"><v>3.14159</v></c><c r="D1" s="4"><v>46086</v></c><c r="E1" s="6"><v>0.25</v></c><c r="F1" s="3"/></row>"#,
        r#"<row r="2" ht="30" customHeight="1"><c r="A2" t="b"><v>1</v></c><c r="B2"><f>B1*2</f><v>84</v></c><c r="C2"><f>SUM(B1:B2)</f><v>126</v></c><c r="D2"><f>MyRange</f><v>7</v></c><c r="E2" t="e"><v>#DIV/0!</v></c></row>"#,
        r#"<row r="3"><c r="A3" t="inlineStr"><is><t>merged</t></is></c></row><row r="4"><c r="A4" s="2" t="inlineStr"><is><t>filled</t></is></c></row>"#,
        r#"</sheetData><mergeCells count="1"><mergeCell ref="A3:B3"/></mergeCells></worksheet>"#,
    );

    const HIDDEN_SHEET: &str = concat!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
        r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/>"#,
        r#"<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hidden sheet</t></is></c></row></sheetData></worksheet>"#,
    );

    fn workbook_entries(sheet: &str, hidden: &str) -> Vec<(&'static str, String)> {
        vec![
            (
                "xl/workbook.xml",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Hidden" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>"#.to_owned(),
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>"#.to_owned(),
            ),
            ("xl/styles.xml", STYLES.to_owned()),
            ("xl/worksheets/sheet1.xml", sheet.to_owned()),
            ("xl/worksheets/sheet2.xml", hidden.to_owned()),
        ]
    }

    /// A cell's value as text, so the assertions do not need `PartialEq` on
    /// the protocol enum.
    fn read_cell_value(range: &RangeResult, row: usize, column: usize) -> Option<String> {
        range
            .cells
            .iter()
            .find(|cell| cell.row == row && cell.column == column)
            .and_then(|cell| match &cell.value {
                Some(CellValue::String(text)) => Some(format!("s:{text}")),
                Some(CellValue::Number(number)) => Some(format!("n:{number}")),
                Some(CellValue::Boolean(flag)) => Some(format!("b:{flag}")),
                None => None,
            })
    }

    #[test]
    fn writes_values_formulas_dates_merges_sizes_and_styles() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("book.xlsx");
        write_workbook(&source, &workbook_entries(SHEET, HIDDEN_SHEET));
        let target = dir.path().join("book.ods");
        let result = convert_to_ods(&source, &target).unwrap();
        assert_eq!(result.sheets, 2);
        assert_eq!(result.formulas_dropped, 1, "MyRange cannot be written");

        // The mimetype has to be the first, stored entry of the package, with
        // its sizes patched in place (a data descriptor there confuses some
        // readers).
        let bytes = std::fs::read(&target).unwrap();
        assert_eq!(&bytes[0..4], b"PK\x03\x04");
        assert_eq!(&bytes[30..38], b"mimetype");
        assert_eq!(u16::from_le_bytes([bytes[8], bytes[9]]), 0, "stored");
        assert_eq!(
            u16::from_le_bytes([bytes[6], bytes[7]]) & 0x0008,
            0,
            "the local header carries its sizes"
        );
        let mut archive = ZipArchive::new(File::open(&target).unwrap()).unwrap();
        let first = archive.by_index(0).unwrap();
        assert_eq!(first.name().unwrap(), "mimetype");
        assert_eq!(first.compression(), CompressionMethod::Stored);
        drop(first);

        // Every part is well-formed XML a reader can trust.
        for name in [
            "content.xml",
            "styles.xml",
            "meta.xml",
            "settings.xml",
            "META-INF/manifest.xml",
        ] {
            let xml = read_entry(&target, name);
            roxmltree::Document::parse(&xml)
                .unwrap_or_else(|error| panic!("{name} is not well-formed: {error}"));
        }

        let content = read_entry(&target, "content.xml");
        assert!(
            content.contains(r#"table:formula="of:=[.B1]*2""#),
            "{content}"
        );
        assert!(
            content.contains(r#"table:formula="of:=SUM([.B1:.B2])""#),
            "{content}"
        );
        assert!(!content.contains("MyRange"), "a refused formula must not appear");
        assert!(
            content.contains(r#"office:value-type="string""#),
            "{content}"
        );
        assert!(content.contains(r#"office:date-value="2026-03-05""#), "{content}");
        assert!(content.contains(r#"office:boolean-value="true""#), "{content}");
        assert!(
            content.contains(r#"table:number-columns-spanned="2""#),
            "{content}"
        );
        assert!(content.contains("<table:covered-table-cell/>"), "{content}");
        assert!(content.contains(r#"table:display="false""#), "{content}");
        assert!(content.contains("style:column-width="), "{content}");
        assert!(content.contains(r#"style:row-height="30.00pt""#), "{content}");
        assert!(content.contains(r#"office:value-type="float" office:value="3.14159""#), "{content}");
        assert!(content.contains("style:data-style-name="), "{content}");
        assert!(content.contains("table:visibility=\"collapse\""), "{content}");

        let styles = read_entry(&target, "styles.xml");
        let automatic = read_entry(&target, "content.xml");
        let all = format!("{styles}{automatic}");
        assert!(all.contains(r#"fo:font-weight="bold""#), "{all}");
        assert!(all.contains(r##"fo:color="#FF0000""##), "{all}");
        assert!(all.contains(r##"fo:background-color="#FFFF00""##), "{all}");
        assert!(
            all.contains(r#"fo:border-bottom="0.75pt solid #000000""#),
            "{all}"
        );
        assert!(all.contains("number:percentage-style") || all.contains("number:number-style"), "{all}");

        // The package opens as an ordinary ODS for calamine too.
        let reopened = calamine::open_workbook_auto(&target).unwrap();
        assert_eq!(
            reopened.sheet_names(),
            vec!["Data".to_owned(), "Hidden".to_owned()]
        );

        // And comes back through the import with its values, formulas,
        // merges and sizes intact.
        let layouts = crate::odf_layout::read_layouts(&target).unwrap();
        assert_eq!(
            layouts[0].merges,
            vec![((2, 0), (2, 1))],
            "the writer's merge is readable"
        );
        let round = dir.path().join("round.xlsx");
        crate::convert::convert_to_xlsx(&target, &round).unwrap();
        let round_sheet = read_entry(&round, "xl/worksheets/sheet1.xml");
        assert!(
            round_sheet.contains("<mergeCells"),
            "the import writes the merge: {round_sheet}"
        );
        let mut sessions = WorkbookSessions::new();
        let metadata = sessions.open(&round).unwrap();
        assert_eq!(metadata.sheets[0].column_widths[0].width, Some(20.5));

        let mut range = sessions
            .read_range(
                &metadata.session_id,
                &metadata.sheets[0].id,
                &CellRange {
                    start_row: 0,
                    end_row: 3,
                    start_column: 0,
                    end_column: 4,
                },
            )
            .unwrap();
        // Merges are published with the finished index, so the cells are read
        // again once it has completed.
        for _ in 0..100 {
            if range.indexing_complete {
                break;
            }
            range = sessions
                .read_range(
                    &metadata.session_id,
                    &metadata.sheets[0].id,
                    &CellRange {
                        start_row: 0,
                        end_row: 3,
                        start_column: 0,
                        end_column: 4,
                    },
                )
                .unwrap();
        }
        assert!(range.indexing_complete);
        assert_eq!(
            read_cell_value(&range, 0, 0),
            Some("s:Hello & <World>".to_owned())
        );
        assert_eq!(read_cell_value(&range, 0, 1), Some("n:42".to_owned()));
        assert_eq!(
            read_cell_value(&range, 0, 2),
            Some("n:3.14159".to_owned())
        );
        assert_eq!(
            read_cell_value(&range, 0, 3),
            Some("n:46086".to_owned())
        );
        assert_eq!(read_cell_value(&range, 0, 4), Some("n:0.25".to_owned()));
        assert_eq!(read_cell_value(&range, 1, 0), Some("b:true".to_owned()));
        assert_eq!(read_cell_value(&range, 1, 1), Some("n:84".to_owned()));
        assert_eq!(read_cell_value(&range, 1, 2), Some("n:126".to_owned()));
        assert_eq!(read_cell_value(&range, 1, 3), Some("n:7".to_owned()));
        assert_eq!(
            read_cell_value(&range, 1, 4),
            Some("s:#DIV/0!".to_owned())
        );
        assert_eq!(
            range.merges.len(),
            1,
            "the merged banner survives the round trip: {:?}",
            range.merges
        );
        assert_eq!(
            (range.merges[0].start_row, range.merges[0].start_column),
            (2, 0)
        );
        assert_eq!(
            (range.merges[0].end_row, range.merges[0].end_column),
            (2, 1)
        );
        let height = range
            .rows
            .iter()
            .find(|row| row.row == 1)
            .and_then(|row| row.height);
        assert!(
            height.is_some_and(|height| (height - 30.0).abs() < 0.1),
            "{height:?}"
        );

        let formulas = sessions
            .read_formula_cells(&metadata.session_id, &metadata.sheets[0].id)
            .unwrap();
        let texts: Vec<&str> = formulas
            .cells
            .iter()
            .filter_map(|cell| cell.formula.as_deref())
            .collect();
        assert!(texts.contains(&"=B1*2"), "{texts:?}");
        assert!(texts.contains(&"=SUM(B1:B2)"), "{texts:?}");
        assert!(
            !texts.iter().any(|text| text.contains("MyRange")),
            "{texts:?}"
        );

        // The formulas that came back out of the package are real Excel
        // syntax: the formula engine accepts them and computes the same
        // answers. (The converted file itself is not imported here —
        // IronCalc's xlsx reader requires parts the minimal import writer
        // does not emit.)
        let mut model = ironcalc::base::Model::new_empty("check", "en", "UTC", "en").unwrap();
        model.set_user_input(0, 1, 2, "42".to_owned()).unwrap();
        for (row, column, formula) in [(2, 2, "=B1*2"), (2, 3, "=SUM(B1:B2)")] {
            model
                .set_user_input(0, row, column, formula.to_owned())
                .unwrap();
        }
        model.evaluate();
        let computed = |row: i32, column: i32| match model.get_cell_value_by_index(0, row, column) {
            Ok(ironcalc::base::cell::CellValue::Number(value)) => Some(value),
            _ => None,
        };
        assert_eq!(computed(2, 2), Some(84.0), "B2 = B1*2");
        assert_eq!(computed(2, 3), Some(126.0), "C2 = SUM(B1:B2)");
    }

    /// A chart, a picture, a note, a conditional format, a validation and a
    /// pivot leave the package, and each is counted so the app can say so.
    #[test]
    fn counts_the_features_that_do_not_travel() {
        let drawing = concat!(
            r#"<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">"#,
            r#"<xdr:twoCellAnchor><xdr:from><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>6</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>"#,
            r#"<xdr:twoCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="3" name="Picture 1"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>"#,
            r#"</xdr:wsDr>"#,
        );
        let sheet = concat!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
            r#"<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:B3"/>"#,
            r#"<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c></row><row r="3"><c r="A3"><v>5</v></c><c r="B3"><v>6</v></c></row></sheetData>"#,
            r#"<conditionalFormatting sqref="B1:B3"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>3</formula></cfRule></conditionalFormatting>"#,
            r#"<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="C1:C3"><formula1>"one,two"</formula1></dataValidation></dataValidations>"#,
            r#"<drawing r:id="rId2"/></worksheet>"#,
        );
        let entries = vec![
            (
                "xl/workbook.xml",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>"#.to_owned(),
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.to_owned(),
            ),
            ("xl/worksheets/sheet1.xml", sheet.to_owned()),
            (
                "xl/worksheets/_rels/sheet1.xml.rels",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>"#.to_owned(),
            ),
            ("xl/drawings/drawing1.xml", drawing.to_owned()),
            (
                "xl/drawings/_rels/drawing1.xml.rels",
                r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>"#.to_owned(),
            ),
            (
                "xl/charts/chart1.xml",
                r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:plotArea><c:barChart><c:barDir val="col"/><c:ser><c:idx val="0"/><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>8</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"#.to_owned(),
            ),
            ("xl/media/image1.png", String::from_utf8_lossy(&[0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]).into_owned()),
            (
                "xl/comments1.xml",
                r#"<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Me</author></authors><commentList><comment ref="A1" authorId="0"><text><r><t>Note</t></r></text></comment></commentList></comments>"#.to_owned(),
            ),
            (
                "xl/pivotTables/pivotTable1.xml",
                r#"<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="PivotTable1"><location ref="H1:J5" firstDataRow="1" firstDataCol="1"/></pivotTableDefinition>"#.to_owned(),
            ),
        ];
        let dir = tempdir().unwrap();
        let source = dir.path().join("features.xlsx");
        write_workbook(&source, &entries);
        let target = dir.path().join("features.ods");
        let result = convert_to_ods(&source, &target).unwrap();
        assert_eq!(result.dropped.charts, 1);
        assert_eq!(result.dropped.images, 1);
        assert_eq!(result.dropped.comments, 1);
        assert_eq!(result.dropped.conditional_formats, 1);
        assert_eq!(result.dropped.validations, 1);
        assert_eq!(result.dropped.pivots, 1);

        // The sheet with a chart still carries its values.
        let content = read_entry(&target, "content.xml");
        assert!(content.contains(r#"office:value="5""#), "{content}");
    }

    /// A long empty stretch is one repeated row element, and the sheet is read
    /// in more than one window without losing either end.
    #[test]
    fn collapses_long_empty_stretches_into_repeated_rows() {
        let mut sheet = String::from(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A5000"/><sheetData>"#,
        );
        for row in 1..=5000 {
            match row {
                1 => sheet.push_str(r#"<row r="1"><c r="A1"><v>11</v></c></row>"#),
                5000 => sheet.push_str(r#"<row r="5000"><c r="A5000"><v>22</v></c></row>"#),
                _ => {}
            }
        }
        sheet.push_str("</sheetData></worksheet>");

        let dir = tempdir().unwrap();
        let source = dir.path().join("long.xlsx");
        write_workbook(
            &source,
            &[
                (
                    "xl/workbook.xml",
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Long" sheetId="1" r:id="rId1"/></sheets></workbook>"#.to_owned(),
                ),
                (
                    "xl/_rels/workbook.xml.rels",
                    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#.to_owned(),
                ),
                ("xl/worksheets/sheet1.xml", sheet),
            ],
        );
        let target = dir.path().join("long.ods");
        let result = convert_to_ods(&source, &target).unwrap();
        assert_eq!(result.cells, 2, "only the two values count");
        let content = read_entry(&target, "content.xml");
        assert!(content.contains(r#"table:number-rows-repeated="4998""#), "{content}");
        assert!(content.contains(r#"office:value="11""#), "{content}");
        assert!(content.contains(r#"office:value="22""#), "{content}");
    }

    #[test]
    fn refuses_a_target_that_is_the_source_and_leaves_no_partial_file() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("book.xlsx");
        write_workbook(&source, &workbook_entries(SHEET, HIDDEN_SHEET));
        let error = convert_to_ods(&source, &source).unwrap_err();
        assert!(error.to_string().contains("must differ"), "{error}");

        let target = dir.path().join("missing").join("out.ods");
        assert!(convert_to_ods(&source, &target).is_err());
        assert!(!target.exists(), "a failed export must leave no file");
    }
}