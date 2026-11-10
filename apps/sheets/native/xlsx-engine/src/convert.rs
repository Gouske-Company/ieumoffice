//! Legacy-format import: reads an .xls (or anything calamine understands)
//! and writes a minimal .xlsx with values, formulas, and date number formats.
//! What the binary layer of an .xls holds beyond cells comes along too — the
//! drawing group's embedded pictures with their anchors, merges, column
//! widths, hand-set row heights, and the cell formatting — fonts, fills,
//! borders, alignment, number formats (see `xls_biff`, `xls_styles` and
//! `escher`), and the print settings — page setup, margins, header/footer,
//! manual breaks, print area and titles (see `xls_print`). Charts and
//! conditional formats are not carried over — the converted file is a fresh
//! workbook, not a byte-preserving edit.
//!
//! ODF spreadsheets convert through the same calamine path, with two things
//! the reader cannot give: the OpenFormula in `table:formula` is translated to
//! Excel syntax (`odf_formula`) and the merges, column widths and row heights
//! calamine's ODS reader does not expose are read from the package itself
//! (`odf_layout`). A formula that cannot be translated is dropped and the cell
//! keeps its cached value; `formulas_dropped` reports how many (decision 0119).

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use calamine::{Data, Dimensions, Reader, Sheets, open_workbook_auto};

use crate::SidecarError;
use crate::escher::{self, Blip, BlipKind};
use crate::odf_formula;
use crate::odf_layout::{self, OdsSheetLayout};
use crate::spreadsheetml;
use crate::xls_biff::{self, XlsSheetBinary};
use crate::xls_print;
use crate::xls_styles::XlsStyles;
use crate::xlsx_package::{
    STYLES_XML, SheetArt, SheetSpec, cell_reference, escape_xml, iso_serial, worksheet_document,
    write_package,
};

/// `s` indices the converter wrote: per cell, per row, and the column spans.
#[derive(Default)]
struct SheetStyles {
    cells: HashMap<(u32, u32), u16>,
    rows: HashMap<u32, u16>,
}

/// Row heights for one sheet: sizes the file sets row by row, spans too wide to
/// expand into one entry per row, and the sheet default a grid-wide span stood
/// for.
#[derive(Default)]
struct RowHeights {
    explicit: HashMap<u32, (u16, bool)>,
    /// `(first, last, twips)` of a repeated span that is kept as a range; the
    /// writer consults it for the rows it emits.
    spans: Vec<(u32, u32, u16)>,
    /// `sheetFormatPr/@defaultRowHeight` in points, when a span stood for the
    /// sheet's own height rather than for a set of edited rows.
    default_points: Option<f64>,
}

impl RowHeights {
    /// The height `row` carries, an explicit entry winning over a wide span.
    fn height(&self, row: u32) -> Option<(u16, bool)> {
        self.explicit.get(&row).copied().or_else(|| {
            self.spans
                .iter()
                .find(|(first, last, _)| (*first..=*last).contains(&row))
                .map(|(_, _, twips)| (*twips, true))
        })
    }
}

pub struct ConvertResult {
    pub sheets: usize,
    pub cells: usize,
    /// Cells whose ODF formula could not be translated and was therefore
    /// dropped, leaving only the cached value (decision 0119).
    pub formulas_dropped: u32,
}

/// Why the reader refused a file, when the refusal is about the container and
/// a friendlier sentence helps. `None` keeps the reader's own error.
///
/// Legacy workbooks are OLE2/CFB containers; a file that starts with anything
/// else was renamed rather than exported. Excel sniffs content over extension
/// and opens plenty of those happily, so the reader's `Invalid OLE (signature
/// ...)` tells the person holding the file nothing they can act on.
///
/// An XML spreadsheet is not one of these: genoffice#2044 reads it directly,
/// and this only has to speak about files no reader should open at all.
fn unreadable_container_hint(source: &Path) -> Option<String> {
    let mut head = [0u8; 1024];
    let read = File::open(source).ok()?.read(&mut head).ok()?;
    let head = &head[..read];
    if head.starts_with(&[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) {
        // a real CFB container: whatever is wrong inside is the reader's to explain
        return None;
    }
    let text = String::from_utf8_lossy(head);
    let trimmed = text.trim_start_matches('\u{FEFF}').trim_start();
    if !trimmed.starts_with("<?xml") && !trimmed.starts_with('<') {
        return None;
    }
    let first_line = trimmed.lines().next().unwrap_or("").trim();
    let first_line = if first_line.chars().count() > 60 {
        let cut: String = first_line.chars().take(60).collect();
        format!("{cut}…")
    } else {
        first_line.to_string()
    };
    Some(format!(
        "This file is not a workbook container: its content is text or XML rather than \
         an Excel/ODF package, and it begins with \"{first_line}\"."
    ))
}

pub fn convert_to_xlsx(source: &Path, target: &Path) -> Result<ConvertResult, SidecarError> {
    let mut workbook = match open_workbook_auto(source) {
        Ok(workbook) => workbook,
        Err(error) => {
            // Excel opens an XML spreadsheet saved under a legacy name by
            // sniffing content rather than extension, so one reaches here with
            // nothing in its header for calamine to go on. The SpreadsheetML
            // importer is the only reader that can still make sense of it;
            // the container hint below covers everything left over.
            if spreadsheetml::probe(source) {
                return spreadsheetml::convert_to_xlsx(source, target);
            }
            return Err(SidecarError::Workbook(
                match unreadable_container_hint(source) {
                    Some(hint) => hint,
                    None => format!("Unable to read the workbook: {error}"),
                },
            ));
        }
    };
    let names: Vec<String> = workbook.sheet_names().to_vec();
    if names.is_empty() {
        return Err(SidecarError::Workbook("The workbook has no sheets.".into()));
    }
    // The binary layer only exists for real .xls containers; ODF and XML
    // spreadsheets convert without it.
    let binary = xls_biff::read_xls_binary(source);
    // ODF keeps merges, sizing and formula syntax in places calamine's ODS
    // reader does not look, so the package is read a second time for them.
    let odf = matches!(&workbook, Sheets::Ods(_));
    let layouts = if odf {
        odf_layout::read_layouts(source).unwrap_or_default()
    } else {
        Vec::new()
    };

    let mut sheet_xmls: Vec<String> = Vec::new();
    let mut cells = 0usize;
    let mut formulas_dropped = 0u32;
    for (index, name) in names.iter().enumerate() {
        let range = workbook
            .worksheet_range(name)
            .map_err(|error| SidecarError::Workbook(format!("Sheet {name}: {error}")))?;
        let formulas = workbook.worksheet_formula(name).ok();
        // A cell's entry is `Some` with the Excel spelling of its formula, or
        // `Some(None)` when the source had one the translation dropped.
        let mut formula_map: HashMap<(u32, u32), Option<String>> = HashMap::new();
        if let Some(formula_range) = formulas {
            let (start_row, start_col) = formula_range.start().unwrap_or((0, 0));
            for (row, column, formula) in formula_range.used_cells() {
                if formula.is_empty() {
                    continue;
                }
                let position = (start_row + row as u32, start_col + column as u32);
                if odf {
                    let translated = odf_formula::translate(formula);
                    if translated.is_none() {
                        formulas_dropped += 1;
                    }
                    formula_map.insert(position, translated);
                } else {
                    formula_map.insert(position, Some(formula.clone()));
                }
            }
        }
        let layout = layouts.get(index);
        let sheet_binary = binary.as_ref().and_then(|b| b.sheets.get(index));
        let styles = binary.as_ref().map(|b| &b.styles);
        let columns = match (sheet_binary, styles) {
            (Some(sheet), Some(styles)) => cols_xml(sheet, styles),
            _ => layout.map(odf_cols_xml).unwrap_or_default(),
        };
        let sheet_styles = match (sheet_binary, styles) {
            (Some(sheet), Some(styles)) => sheet_styles(sheet, styles),
            _ => SheetStyles::default(),
        };
        // A height Excel fitted to the row's fonts is not flagged as set by
        // hand, but it still differs from the sheet default: a title row in a
        // large font keeps its height, as an .xlsx keeps its ht without
        // customHeight.
        let used_rows = match (range.start(), range.end()) {
            (Some(start), Some(end)) => Some((start.0, end.0)),
            _ => None,
        };
        let heights: RowHeights = match sheet_binary {
            Some(sheet) => RowHeights {
                explicit: sheet
                    .row_heights
                    .iter()
                    .filter(|(_, twips, custom)| {
                        *custom
                            || sheet
                                .default_row_twips
                                .is_some_and(|default| default != *twips)
                    })
                    .map(|(row, twips, custom)| (u32::from(*row), (*twips, *custom)))
                    .collect(),
                ..RowHeights::default()
            },
            None => layout
                .map(|layout| odf_row_heights(layout, used_rows))
                .unwrap_or_default(),
        };
        let mut tail = match &mut workbook {
            Sheets::Xls(reader) => {
                merges_xml(&reader.merge_cells_by_sheet_name(name).unwrap_or_default())
            }
            // calamine reports no merges for ODF; `odf_layout` read them out
            // of the package instead.
            _ => layout.map(odf_merges_xml).unwrap_or_default(),
        };
        // printOptions … colBreaks follow mergeCells and precede drawing
        if let Some(sheet) = sheet_binary {
            tail.push_str(&sheet.print.tail_xml());
        }
        if sheet_binary.is_some_and(|sheet| sheet.drawing.is_some()) {
            // the drawing part is written beside this sheet, always rId1 there
            tail.push_str(r#"<drawing r:id="rId1"/>"#);
        }
        let (xml, sheet_cells) = worksheet_xml(
            &range,
            &formula_map,
            &columns,
            &tail,
            &heights,
            &sheet_styles,
            odf,
        );
        // sheetPr is the worksheet's first child, ahead of the dimension the
        // document opens with
        let xml = match sheet_binary.map(|sheet| sheet.print.sheet_pr_xml()) {
            Some(sheet_pr) if !sheet_pr.is_empty() => {
                xml.replacen("<dimension ", &format!("{sheet_pr}<dimension "), 1)
            }
            _ => xml,
        };
        cells += sheet_cells;
        sheet_xmls.push(xml);
    }

    let mut media_names: HashMap<usize, String> = HashMap::new();
    let art: Vec<Option<SheetArt>> = names
        .iter()
        .enumerate()
        .map(|(index, _)| {
            let binary = binary.as_ref()?;
            let sheet = binary.sheets.get(index)?;
            let drawing = sheet.drawing.as_ref()?;
            sheet_art(sheet, drawing, &binary.blips, &mut media_names)
        })
        .collect();

    let sheets: Vec<SheetSpec> = names
        .iter()
        .map(|name| SheetSpec {
            name: name.clone(),
            state: None,
        })
        .collect();
    let styles_xml = if odf {
        ods_styles_xml()
    } else {
        match &binary {
            Some(binary) if !binary.styles.is_empty() => binary.styles.styles_xml(),
            _ => STYLES_XML.to_string(),
        }
    };
    let defined_names = binary
        .as_ref()
        .map(|binary| print_defined_names(&binary.print_names, &names))
        .unwrap_or_default();
    write_package(target, &sheets, &defined_names, &sheet_xmls, &art, &styles_xml)?;
    Ok(ConvertResult {
        sheets: names.len(),
        cells,
        formulas_dropped,
    })
}

/// `<mergeCells>` for the ranges calamine reports, or nothing at zero.
/// The sheet-scoped `_xlnm.Print_Area` / `_xlnm.Print_Titles` names, one
/// of each per sheet (the first NAME record wins, as in Excel).
fn print_defined_names(print_names: &[xls_print::XlsPrintName], sheets: &[String]) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut out = String::new();
    for name in print_names {
        let Some(sheet_name) = sheets.get(name.sheet) else {
            continue;
        };
        if !seen.insert((name.sheet, name.titles)) {
            continue;
        }
        let builtin = if name.titles {
            "_xlnm.Print_Titles"
        } else {
            "_xlnm.Print_Area"
        };
        out.push_str(&format!(
            r#"<definedName name="{builtin}" localSheetId="{}">{}</definedName>"#,
            name.sheet,
            escape_xml(&xls_print::print_name_formula(sheet_name, &name.areas)),
        ));
    }
    out
}

fn merges_xml(merges: &[Dimensions]) -> String {
    if merges.is_empty() {
        return String::new();
    }
    let cells: String = merges
        .iter()
        .map(|range| {
            format!(
                r#"<mergeCell ref="{}:{}"/>"#,
                cell_reference(range.start.0, range.start.1),
                cell_reference(range.end.0, range.end.1),
            )
        })
        .collect();
    format!(
        r#"<mergeCells count="{}">{cells}</mergeCells>"#,
        merges.len()
    )
}

/// `<mergeCells>` for the spans `odf_layout` read out of the package, already
/// in sheet coordinates.
fn odf_merges_xml(layout: &OdsSheetLayout) -> String {
    if layout.merges.is_empty() {
        return String::new();
    }
    let cells: String = layout
        .merges
        .iter()
        .map(|(start, end)| {
            format!(
                r#"<mergeCell ref="{}:{}"/>"#,
                cell_reference(start.0, start.1),
                cell_reference(end.0, end.1),
            )
        })
        .collect();
    format!(
        r#"<mergeCells count="{}">{cells}</mergeCells>"#,
        layout.merges.len()
    )
}

/// `<cols>` for the widths `odf_layout` resolved, one entry per span. ODF says
/// a width per column, so a span LibreOffice wrote as one repeated column goes
/// out as one entry rather than one per column.
fn odf_cols_xml(layout: &OdsSheetLayout) -> String {
    if layout.columns.is_empty() {
        return String::new();
    }
    let entries: String = layout
        .columns
        .iter()
        .map(|(first, last, width)| {
            format!(
                r#"<col min="{}" max="{}" width="{:.2}" customWidth="1"/>"#,
                first + 1,
                last + 1,
                width,
            )
        })
        .collect();
    format!("<cols>{entries}</cols>")
}

/// Row heights from the spans `odf_layout` resolved, as OOXML twips (1/20
/// point), the unit `worksheet_xml` writes `ht` in. A height the file sets is
/// by definition a custom one.
///
/// A span repeated across thousands of rows is not expanded into one entry per
/// row — that would write a `row` element for most of the grid. When it covers
/// the sheet's empty tail (or reaches the last grid row) it is the sheet's own
/// default height and goes out through `sheetFormatPr`; when it sits over rows
/// with data it is kept as a range the writer applies to the rows it emits.
fn odf_row_heights(layout: &OdsSheetLayout, used: Option<(u32, u32)>) -> RowHeights {
    let mut heights = RowHeights::default();
    for (first, last, points) in &layout.row_heights {
        let twips = (points * 20.0).round().clamp(0.0, f64::from(u16::MAX)) as u16;
        if last.saturating_sub(*first) >= MAX_REPEATED_STYLE_ROWS {
            let outside_used = match used {
                Some((start, end)) => *last < start || *first > end,
                None => true,
            };
            if *last >= odf_layout::MAX_ROW - 1 || outside_used {
                heights.default_points = Some(*points);
            } else {
                heights.spans.push((*first, *last, twips));
            }
            continue;
        }
        for row in *first..=*last {
            heights.explicit.insert(row, (twips, true));
        }
    }
    heights
}

/// How many rows one repeated row style may stand for before it is read as the
/// sheet default instead of a set of edited rows.
const MAX_REPEATED_STYLE_ROWS: u32 = 4_096;

/// The `s` index of the time number format `ods_styles_xml` adds.
const ODS_TIME_STYLE: u16 = 3;

/// The minimal stylesheet plus one cell format for ODS times. `[h]:mm:ss`
/// brackets the hours so a duration past 24 hours reads as `30:00:00` instead
/// of wrapping to `06:00:00`. Built from `STYLES_XML` so the two stay
/// identical apart from that one format.
fn ods_styles_xml() -> String {
    STYLES_XML
        .replace(
            r#"<fonts count="1">"#,
            r#"<numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm:ss"/></numFmts><fonts count="1">"#,
        )
        .replace(r#"<cellXfs count="3">"#, r#"<cellXfs count="4">"#)
        .replace(
            "</cellXfs>",
            r#"<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>"#,
        )
}

/// An ISO 8601 duration (`PT13H30M`, `P1DT2H`) as a fraction of a day — the
/// serial Excel shows through a time number format. `None` keeps the text:
/// a duration this does not recognise is not guessed at.
fn duration_serial(text: &str) -> Option<f64> {
    let mut rest = text.strip_prefix('P')?;
    let mut days = 0.0f64;
    let mut hours = 0.0f64;
    let mut minutes = 0.0f64;
    let mut seconds = 0.0f64;
    let mut in_time = false;
    let mut seen = false;
    while let Some(character) = rest.chars().next() {
        if character == 'T' {
            in_time = true;
            rest = &rest[1..];
            continue;
        }
        let end = rest
            .find(|candidate: char| !(candidate.is_ascii_digit() || candidate == '.'))
            .unwrap_or(rest.len());
        let number: f64 = rest[..end].parse().ok()?;
        let unit = rest[end..].chars().next()?;
        match (in_time, unit) {
            (false, 'D') => days = number,
            (true, 'H') => hours = number,
            (true, 'M') => minutes = number,
            (true, 'S') => seconds = number,
            _ => return None,
        }
        rest = &rest[end + unit.len_utf8()..];
        seen = true;
    }
    if !seen {
        return None;
    }
    let serial = days + (hours * 3600.0 + minutes * 60.0 + seconds) / 86_400.0;
    if !serial.is_finite() || serial < 0.0 {
        return None;
    }
    Some(serial)
}

/// The strings a spreadsheet stores as an error result. An ODF package keeps
/// an error cell as `office:value-type="string"` holding one of these, so the
/// cell is written back as an error rather than as text a dependent formula
/// would read as a string.
fn is_error_literal(text: &str) -> bool {
    matches!(
        text,
        "#NULL!" | "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#N/A"
    )
}

/// `<cols>` from the sheet's COLINFO entries. LibreOffice echoes the sheet's
/// default width as one span covering every column; a span that wide is the
/// default, not a custom width, and goes back out only through the anchor
/// arithmetic.
fn cols_xml(sheet: &XlsSheetBinary, styles: &XlsStyles) -> String {
    let custom: Vec<_> = sheet
        .col_infos
        .iter()
        .filter(|(_, last, _)| *last < 100)
        .collect();
    if custom.is_empty() {
        return String::new();
    }
    let entries: String = custom
        .iter()
        .map(|(first, last, width)| {
            let style = sheet
                .col_styles
                .iter()
                .find(|(f, l, _)| f == first && l == last)
                .and_then(|(_, _, ixfe)| styles.cell_style(*ixfe))
                .map(|s| format!(r#" style="{s}""#))
                .unwrap_or_default();
            format!(
                r#"<col min="{}" max="{}" width="{:.2}" customWidth="1"{style}/>"#,
                first + 1,
                (*last).min(16383) + 1,
                f64::from(*width) / 256.0,
            )
        })
        .collect();
    format!("<cols>{entries}</cols>")
}

/// Every `s` the sheet's records ask for, resolved against the XF table. The
/// general XF (index 15 in a Excel-written file, 0 in a bare one) is the
/// default and stays implicit, so untouched cells do not pick up an `s`.
fn sheet_styles(sheet: &XlsSheetBinary, styles: &XlsStyles) -> SheetStyles {
    let mut out = SheetStyles::default();
    let default = default_xf(styles);
    for (row, col, ixfe) in &sheet.cell_styles {
        if *ixfe == default {
            continue;
        }
        if let Some(s) = styles.cell_style(*ixfe) {
            out.cells.insert((u32::from(*row), u32::from(*col)), s);
        }
    }
    for (row, ixfe) in &sheet.row_styles {
        if *ixfe == default {
            continue;
        }
        if let Some(s) = styles.cell_style(*ixfe) {
            out.rows.insert(u32::from(*row), s);
        }
    }
    out
}

/// The cell XF Excel hands unformatted cells: the first XF that is not a
/// style XF — index 15 in Excel's own files, where 0–14 are style XFs.
fn default_xf(styles: &XlsStyles) -> u16 {
    styles
        .xfs
        .iter()
        .position(|xf| !xf.is_style)
        .map_or(0, |index| index as u16)
}

/// The width of one column in characters of the default font, for the anchor
/// arithmetic: a custom COLINFO entry when one covers it, else the wide
/// default span, else the spec's 8.43.
fn col_width_chars(sheet: &XlsSheetBinary, column: u16) -> f64 {
    let mut default = 8.43;
    for (first, last, width) in &sheet.col_infos {
        let chars = f64::from(*width) / 256.0;
        if *last >= 100 {
            default = chars;
        } else if column >= *first && column <= *last {
            return chars;
        }
    }
    default
}

/// Column width in pixels under Calibri-11 metrics — the same 7 px per
/// character the workbook DSL's width ops use.
fn col_px(sheet: &XlsSheetBinary, column: u16) -> f64 {
    (col_width_chars(sheet, column) * 7.0).round() + 5.0
}

/// Row height in pixels: twips → points → pixels at 96 dpi. Rows the file
/// describes carry their own height; the rest get the 12.75 pt default.
fn row_px(sheet: &XlsSheetBinary, row: u16) -> f64 {
    let twips = sheet
        .row_heights
        .iter()
        .find(|(candidate, _, _)| *candidate == row)
        .map(|(_, twips, _)| *twips)
        .unwrap_or(255);
    f64::from(twips) / 15.0
}

fn px_to_emu(px: f64) -> i64 {
    (px * 9525.0).round() as i64
}

/// The drawing part of one sheet: every picture the Escher stream holds, as a
/// twoCellAnchor over the sheet's own column widths and row heights. Pictures
/// with an unsupported blip format, an out-of-range BSE index or an edge
/// sentinel in the anchor are left out.
fn sheet_art(
    sheet: &XlsSheetBinary,
    drawing: &[u8],
    blips: &[Blip],
    media_names: &mut HashMap<usize, String>,
) -> Option<SheetArt> {
    let pictures = escher::parse_pictures(drawing);
    let mut anchors_xml = String::new();
    let mut rels_xml = String::new();
    let mut media: Vec<(String, Vec<u8>)> = Vec::new();
    let mut rel_count = 0usize;
    let mut rel_of_blip: HashMap<usize, usize> = HashMap::new();
    for (position, picture) in pictures.iter().enumerate() {
        let [col_l, dx_l, row_t, dy_t, col_r, dx_r, row_b, dy_b] = picture.anchor;
        if col_r == u16::MAX || row_b == u16::MAX {
            // "runs to the sheet's edge" — an extent the cell grid cannot name
            continue;
        }
        let blip_index = match picture.blip.checked_sub(1) {
            Some(index) if (index as usize) < blips.len() => index as usize,
            _ => continue,
        };
        let blip = &blips[blip_index];
        if blip.bytes.is_empty() || matches!(blip.kind, BlipKind::Other) {
            continue;
        }
        let rel = match rel_of_blip.get(&blip_index) {
            Some(rel) => *rel,
            None => {
                rel_count += 1;
                let rel = rel_count;
                // the media map carries the bare file name (the drawing's
                // relationship target); the package part gets the media path
                let name = match media_names.get(&blip_index) {
                    Some(name) => name.clone(),
                    None => {
                        let name =
                            format!("image{}.{}", media_names.len() + 1, blip.kind.extension());
                        media_names.insert(blip_index, name.clone());
                        media.push((format!("xl/media/{name}"), blip.bytes.clone()));
                        name
                    }
                };
                rels_xml.push_str(&format!(
                    r#"<Relationship Id="rId{rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{name}"/>"#,
                ));
                rel_of_blip.insert(blip_index, rel);
                rel
            }
        };
        let from_x = column_span_px(sheet, col_l, dx_l);
        let from_y = row_span_px(sheet, row_t, dy_t);
        let to_x = column_span_px(sheet, col_r, dx_r);
        let to_y = row_span_px(sheet, row_b, dy_b);
        anchors_xml.push_str(&format!(
            r#"<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>{col_l}</xdr:col><xdr:colOff>{}</xdr:colOff><xdr:row>{row_t}</xdr:row><xdr:rowOff>{}</xdr:rowOff></xdr:from><xdr:to><xdr:col>{col_r}</xdr:col><xdr:colOff>{}</xdr:colOff><xdr:row>{row_b}</xdr:row><xdr:rowOff>{}</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="{}" name="Picture {}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId{rel}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>"#,
            px_to_emu(col_px(sheet, col_l) * f64::from(dx_l) / 1024.0),
            px_to_emu(row_px(sheet, row_t) * f64::from(dy_t) / 1024.0),
            px_to_emu(col_px(sheet, col_r) * f64::from(dx_r) / 1024.0),
            px_to_emu(row_px(sheet, row_b) * f64::from(dy_b) / 1024.0),
            position + 1,
            position + 1,
            px_to_emu(from_x),
            px_to_emu(from_y),
            px_to_emu((to_x - from_x).max(0.0)),
            px_to_emu((to_y - from_y).max(0.0)),
        ));
    }
    if rel_count == 0 {
        return None;
    }
    Some(SheetArt {
        xml: format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{anchors_xml}</xdr:wsDr>"#,
        ),
        rels: format!(
            r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels_xml}</Relationships>"#,
        ),
        media,
    })
}

/// The left edge of `column` plus `offset` 1024ths of its width, in pixels.
fn column_span_px(sheet: &XlsSheetBinary, column: u16, offset: u16) -> f64 {
    let full: f64 = (0..column).map(|step| col_px(sheet, step)).sum();
    full + col_px(sheet, column) * f64::from(offset) / 1024.0
}

/// The top edge of `row` plus `offset` 1024ths of its height, in pixels.
fn row_span_px(sheet: &XlsSheetBinary, row: u16, offset: u16) -> f64 {
    let full: f64 = (0..row).map(|step| row_px(sheet, step)).sum();
    full + row_px(sheet, row) * f64::from(offset) / 1024.0
}

fn worksheet_xml(
    range: &calamine::Range<Data>,
    formulas: &HashMap<(u32, u32), Option<String>>,
    columns: &str,
    tail: &str,
    heights: &RowHeights,
    styles: &SheetStyles,
    odf: bool,
) -> (String, usize) {
    // Rows carrying values plus rows carrying only formulas or a height.
    let mut rows: HashMap<u32, Vec<(u32, String)>> = HashMap::new();
    let mut cells = 0usize;
    let (start_row, start_col) = range.start().unwrap_or((0, 0));
    for (row, column, value) in range.used_cells() {
        let absolute = (start_row + row as u32, start_col + column as u32);
        let formula = formulas
            .get(&absolute)
            .and_then(|entry| entry.as_deref());
        let style = styles.cells.get(&absolute).copied();
        if let Some(cell) = cell_xml(absolute, value, formula, style, odf) {
            cells += 1;
            rows.entry(absolute.0).or_default().push((absolute.1, cell));
        }
    }
    for (position, formula) in formulas {
        let Some(formula) = formula else {
            continue;
        };
        let covered = range
            .get_value((position.0, position.1))
            .is_some_and(|v| *v != Data::Empty);
        if !covered {
            cells += 1;
            let style = styles
                .cells
                .get(position)
                .map(|s| format!(r#" s="{s}""#))
                .unwrap_or_default();
            rows.entry(position.0).or_default().push((
                position.1,
                format!(
                    r#"<c r="{}"{style}><f>{}</f></c>"#,
                    cell_reference(position.0, position.1),
                    escape_xml(formula),
                ),
            ));
        }
    }
    for row in heights.explicit.keys() {
        rows.entry(*row).or_default();
    }
    // A formatted empty cell (borders, a fill) has no value for calamine to
    // report; it exists only through its style.
    for (position, style) in &styles.cells {
        let covered = range
            .get_value((position.0, position.1))
            .is_some_and(|v| *v != Data::Empty)
            || formulas.contains_key(position);
        if !covered {
            rows.entry(position.0).or_default().push((
                position.1,
                format!(
                    r#"<c r="{}" s="{style}"/>"#,
                    cell_reference(position.0, position.1)
                ),
            ));
        }
    }
    for row in styles.rows.keys() {
        rows.entry(*row).or_default();
    }
    // A wide span that none of the written rows fall in would vanish; keep its
    // first row so the height is still carried, one element rather than one
    // per line of the span.
    for (first, last, _) in &heights.spans {
        if !rows.keys().any(|row| (*first..=*last).contains(row)) {
            rows.entry(*first).or_default();
        }
    }

    let mut row_numbers: Vec<u32> = rows.keys().copied().collect();
    row_numbers.sort_unstable();
    let mut body = String::new();
    for row in row_numbers {
        let mut line = rows.remove(&row).unwrap_or_default();
        line.sort_unstable_by_key(|(column, _)| *column);
        let height = match heights.height(row) {
            // a hand-set height goes out with the custom flag; the sheet
            // default the file echoed back stays with the reader
            Some((twips, true)) => {
                format!(r#" ht="{:.2}" customHeight="1""#, f64::from(twips) / 20.0)
            }
            Some((twips, false)) => format!(r#" ht="{:.2}""#, f64::from(twips) / 20.0),
            None => String::new(),
        };
        let row_style = match styles.rows.get(&row) {
            Some(s) => format!(r#" s="{s}" customFormat="1""#),
            None => String::new(),
        };
        body.push_str(&format!(r#"<row r="{}"{height}{row_style}>"#, row + 1));
        for (_, cell) in line {
            body.push_str(&cell);
        }
        body.push_str("</row>");
    }

    let dimension = match (range.start(), range.end()) {
        (Some(start), Some(end)) => format!(
            "{}:{}",
            cell_reference(start.0, start.1),
            cell_reference(end.0, end.1),
        ),
        _ => "A1:A1".into(),
    };
    // A height repeated across the sheet's empty tail is the sheet's own
    // default, not an edit to each of those rows.
    let sheet_format = match heights.default_points {
        Some(points) => {
            format!(r#"<sheetFormatPr defaultRowHeight="{points:.2}" customHeight="1"/>"#)
        }
        None => String::new(),
    };
    (
        worksheet_document(&dimension, &sheet_format, columns, &body, tail),
        cells,
    )
}

fn cell_xml(
    position: (u32, u32),
    value: &Data,
    formula: Option<&str>,
    style: Option<u16>,
    odf: bool,
) -> Option<String> {
    let reference = cell_reference(position.0, position.1);
    let head = match style {
        Some(s) => format!(r#"r="{reference}" s="{s}""#),
        None => format!(r#"r="{reference}""#),
    };
    let formula_xml = formula
        .map(|text| format!("<f>{}</f>", escape_xml(text)))
        .unwrap_or_default();
    let cell = match value {
        Data::Empty => {
            if formula.is_none() {
                return None;
            }
            format!(r#"<c {head}>{formula_xml}</c>"#)
        }
        // An ODF cell stores an error as `office:value-type="string"` holding
        // the error text, with or without a formula in front of it (pasting
        // values leaves only the text). Written back as a string, a dependent
        // formula would read text where the source had `#DIV/0!`.
        Data::String(text) if odf && is_error_literal(text) => format!(
            r#"<c {head} t="e">{formula_xml}<v>{}</v></c>"#,
            escape_xml(text),
        ),
        Data::String(text) => format!(
            r#"<c {head} t="inlineStr">{formula_xml}<is><t xml:space="preserve">{}</t></is></c>"#,
            escape_xml(text),
        ),
        Data::Float(number) => format!(r#"<c {head}>{formula_xml}<v>{number}</v></c>"#),
        Data::Int(number) => format!(r#"<c {head}>{formula_xml}<v>{number}</v></c>"#),
        Data::Bool(flag) => format!(
            r#"<c {head} t="b">{formula_xml}<v>{}</v></c>"#,
            if *flag { 1 } else { 0 },
        ),
        Data::DateTime(datetime) => date_cell(&reference, &formula_xml, datetime.as_f64(), style),
        Data::Error(error) => format!(
            r#"<c {head} t="e">{formula_xml}<v>{}</v></c>"#,
            escape_xml(&error.to_string()),
        ),
        // ODF keeps a date as ISO text (`office:date-value="2026-03-05"`) rather
        // than as a serial, so the text form is turned back into one here: left
        // as text, every imported date would sort and calculate as a string.
        Data::DateTimeIso(text) => match iso_serial(text) {
            Some(serial) => date_cell(&reference, &formula_xml, serial, style),
            None => text_cell(&head, &formula_xml, text),
        },
        // An ODF time (`office:time-value="PT13H30M"`) is a duration, and as
        // text it would neither sort nor calculate; the serial with a time
        // number format is what Excel stores for a time.
        Data::DurationIso(text) => match duration_serial(text) {
            Some(serial) if odf => time_cell(&reference, &formula_xml, serial, style),
            _ => text_cell(&head, &formula_xml, text),
        },
    };
    Some(cell)
}

/// A time cell: a fraction of a day shown through the `[h]:mm:ss` format.
fn time_cell(reference: &str, formula_xml: &str, serial: f64, style: Option<u16>) -> String {
    let style = style.unwrap_or(ODS_TIME_STYLE);
    format!(r#"<c r="{reference}" s="{style}">{formula_xml}<v>{serial}</v></c>"#)
}

/// A date cell keeps the file's own number format when it has one; otherwise
/// whole serials take the short-date format, timed ones the date+time one
/// (xf 1 / xf 2 of STYLES_XML).
fn date_cell(reference: &str, formula_xml: &str, serial: f64, style: Option<u16>) -> String {
    let style = style.unwrap_or(if serial.fract() == 0.0 { 1 } else { 2 });
    format!(r#"<c r="{reference}" s="{style}">{formula_xml}<v>{serial}</v></c>"#)
}

fn text_cell(head: &str, formula_xml: &str, text: &str) -> String {
    format!(
        r#"<c {head} t="inlineStr">{formula_xml}<is><t xml:space="preserve">{}</t></is></c>"#,
        escape_xml(text),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::{Read, Write};
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    fn read_entry(path: &Path, name: &str) -> String {
        let mut archive = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut entry = archive.by_name(name).unwrap();
        let mut content = String::new();
        entry.read_to_string(&mut content).unwrap();
        content
    }

    fn read_bytes(path: &Path, name: &str) -> Vec<u8> {
        let mut archive = zip::ZipArchive::new(File::open(path).unwrap()).unwrap();
        let mut entry = archive.by_name(name).unwrap();
        let mut content = Vec::new();
        entry.read_to_end(&mut content).unwrap();
        content
    }

    #[test]
    fn carries_pictures_merges_widths_and_heights_from_a_legacy_workbook() {
        // A real BIFF8 file written by LibreOffice: one PNG anchored beside
        // the data, a merged banner, a custom first column and row height,
        // and borders (which stay behind with the other styles).
        let fixture = Path::new("tests/fixtures/merges-widths-picture.xls");
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("converted.xlsx");
        convert_to_xlsx(fixture, &target).unwrap();

        let image = read_bytes(&target, "xl/media/image1.png");
        assert!(
            image.starts_with(&[0x89, b'P', b'N', b'G']),
            "the extracted picture is not a PNG: {:02x?}",
            &image[..image.len().min(32)]
        );
        let drawing = read_entry(&target, "xl/drawings/drawing1.xml");
        assert!(drawing.contains("<xdr:twoCellAnchor"));
        assert!(drawing.contains("<xdr:col>4</xdr:col>"));
        assert!(drawing.contains("<xdr:row>1</xdr:row>"));
        assert!(drawing.contains(r#"<a:blip r:embed="rId1"/>"#));
        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(sheet.contains(r#"<mergeCells count="1"><mergeCell ref="A5:C5"/></mergeCells>"#));
        assert!(sheet.contains(r#"<col min="1" max="1" width="27.98" customWidth="1"/>"#));
        assert!(sheet.contains(r#"<row r="2" ht="30.00" customHeight="1">"#));
        assert!(sheet.contains(r#"<drawing r:id="rId1"/>"#));
        let types = read_entry(&target, "[Content_Types].xml");
        assert!(types.contains(r#"<Default Extension="png" ContentType="image/png"/>"#));
        assert!(types.contains(r#"<Override PartName="/xl/drawings/drawing1.xml""#));
    }

    #[test]
    fn carries_print_settings_from_a_legacy_workbook() {
        // A BIFF8 file written by xlwt: fitted to one page wide on landscape
        // A4, narrow margins, centered with gridlines, a header, a manual
        // break before row 6, a title row Excel fitted to its large font and
        // a row whose height was set by hand.
        let fixture = Path::new("tests/fixtures/print-setup.xls");
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("converted.xlsx");
        convert_to_xlsx(fixture, &target).unwrap();

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(sheet.contains(r#"<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension "#));
        let tail = &sheet[sheet.find("</mergeCells>").expect("the merged title")..];
        assert!(tail.starts_with(
            r#"</mergeCells><printOptions horizontalCentered="1" gridLines="1"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.1" footer="0.1"/><pageSetup paperSize="9" "#
        ));
        assert!(tail.contains(r#" fitToHeight="0" "#));
        assert!(tail.contains(r#" orientation="landscape"/>"#));
        assert!(tail.contains("<headerFooter><oddHeader>&amp;C가</oddHeader></headerFooter>"));
        assert!(tail.contains(r#"<rowBreaks count="1" manualBreakCount="1"><brk id="5" max="16383" man="1"/></rowBreaks>"#));
        // fitted by Excel: the height without the hand-set flag
        assert!(sheet.contains(r#"<row r="1" ht="26.00">"#));
        assert!(sheet.contains(r#"<row r="4" ht="30.00" customHeight="1">"#));
        // rows at the sheet default carry no height
        assert!(sheet.contains(r#"<row r="2">"#));
    }

    #[test]
    fn print_area_and_titles_become_defined_names() {
        let names = vec![
            xls_print::XlsPrintName {
                sheet: 1,
                titles: false,
                areas: vec![xls_print::PrintRange {
                    first_row: 0,
                    last_row: 29,
                    first_col: 0,
                    last_col: 7,
                }],
            },
            xls_print::XlsPrintName {
                sheet: 1,
                titles: true,
                areas: vec![xls_print::PrintRange {
                    first_row: 0,
                    last_row: 1,
                    first_col: 0,
                    last_col: 0xFF,
                }],
            },
            // a name scoped past the last sheet is dropped
            xls_print::XlsPrintName {
                sheet: 5,
                titles: false,
                areas: vec![],
            },
        ];
        let sheets = vec!["표지".to_string(), "R&D".to_string()];
        assert_eq!(
            print_defined_names(&names, &sheets),
            r#"<definedName name="_xlnm.Print_Area" localSheetId="1">'R&amp;D'!$A$1:$H$30</definedName><definedName name="_xlnm.Print_Titles" localSheetId="1">'R&amp;D'!$1:$2</definedName>"#
        );
    }

    #[test]
    fn carries_cell_styles_from_a_legacy_workbook() {
        // A BIFF8 file written by LibreOffice: a merged banner with a white
        // bold Arial on navy, a bordered yellow header row, a custom number
        // format, a thick red bottom border, a bordered empty cell, a percent,
        // a rotated cell and a picture.
        let fixture = Path::new("tests/fixtures/cell-styles.xls");
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("converted.xlsx");
        convert_to_xlsx(fixture, &target).unwrap();

        let styles = read_entry(&target, "xl/styles.xml");
        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(styles.contains(r#"<b/>"#));
        assert!(styles.contains(r#"<name val="Arial"/>"#));
        assert!(styles.contains(r#"<fgColor rgb="FF003366"/>"#));
        assert!(styles.contains(r#"<fgColor rgb="FFFFFF99"/>"#));
        assert!(styles.contains(r#"<bottom style="thick"><color rgb="FFFF0000"/></bottom>"#));
        assert!(styles.contains(r##"formatCode="#,##0.00&quot; TL&quot;""##));
        assert!(
            styles.contains(r#"<alignment horizontal="center" vertical="center" wrapText="1"/>"#)
        );
        assert!(styles.contains(r#"textRotation="45""#));
        assert!(styles.contains(r#"<strike/>"#));
        assert!(styles.contains(r#"<u/>"#));
        let percent = styles.find(r#"numFmtId="9""#).expect("the percent xf");
        assert!(styles[percent..].starts_with(r#"numFmtId="9" fontId="#));
        // the bordered empty cell exists only through its style
        assert!(sheet.contains(r#"<c r="D3" s=""#));
        assert!(sheet.contains(r#"<c r="A1" s=""#));
        assert!(sheet.contains(r#"<col min="1" max="1" width="28"#));
        assert!(sheet.contains(r#"<drawing r:id="rId1"/>"#));
    }

    #[test]
    fn converts_a_calamine_readable_workbook_into_minimal_xlsx() {
        // calamine reads xlsx through the same auto-detect path as xls, so a
        // generated xlsx fixture exercises the converter end to end.
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.xlsx");
        convert_fixture(&source);
        let target = dir.path().join("converted.xlsx");

        let result = convert_to_xlsx(&source, &target).unwrap();
        assert_eq!(result.sheets, 1);
        assert!(result.cells >= 4);

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(sheet.contains(
            r#"<c r="A1" t="inlineStr"><is><t xml:space="preserve">Name &amp; Co</t></is></c>"#
        ));
        assert!(sheet.contains(r#"<c r="B1"><v>42</v></c>"#));
        assert!(sheet.contains(r#"<c r="B2"><f>B1*2</f>"#));
        let workbook = read_entry(&target, "xl/workbook.xml");
        assert!(workbook.contains(r#"<sheet name="Data" sheetId="1" r:id="rId1"/>"#));
    }

    #[test]
    fn iso_dates_become_serials_and_suspicious_ones_stay_text() {
        assert_eq!(iso_serial("2026-03-05"), Some(46_086.0));
        assert_eq!(iso_serial("1900-03-01"), Some(61.0));
        assert_eq!(iso_serial("2026-03-05T12:00:00"), Some(46_086.5));
        let timed = iso_serial("2026-03-05T06:30:15.5").unwrap();
        assert!((timed - 46_086.271_012_731_48).abs() < 1e-9);
        // Excel's phantom 1900 leap day sits under the 61 line.
        assert_eq!(iso_serial("1900-02-28"), None);
        assert_eq!(iso_serial("2026-02-30"), None);
        assert_eq!(iso_serial("2026-13-01"), None);
        assert_eq!(iso_serial("2026-03-05T1:2"), None);
        assert_eq!(iso_serial("2026-03-05T10:20:30Z"), None);
        assert_eq!(iso_serial("PT1H30M"), None);
    }

    fn convert_fixture(path: &Path) {
        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        let mut add = |name: &str, content: &str| {
            writer.start_file(name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        };
        add(
            "[Content_Types].xml",
            r#"<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>"#,
        );
        add(
            "_rels/.rels",
            r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>"#,
        );
        add(
            "xl/workbook.xml",
            r#"<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>"#,
        );
        add(
            "xl/_rels/workbook.xml.rels",
            r#"<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>"#,
        );
        add(
            "xl/worksheets/sheet1.xml",
            r#"<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name &amp; Co</t></is></c><c r="B1"><v>42</v></c></row><row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2"><f>B1*2</f><v>84</v></c></row></sheetData></worksheet>"#,
        );
        writer.finish().unwrap();
    }

    #[test]
    fn an_xml_spreadsheet_is_the_converter_s_business_not_a_dead_end() {
        // genoffice#2044 opens this shape instead of refusing it: the XML
        // spreadsheet converts, and the container hint keeps speaking only
        // for text a reader cannot open at all.
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("report.xls");
        std::fs::write(
            &source,
            r#"<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Data">
  <Table><Row><Cell><Data ss:Type="Number">42</Data></Cell></Row></Table>
 </Worksheet>
</Workbook>
"#,
        )
        .unwrap();
        let result = convert_to_xlsx(&source, &dir.path().join("out.xlsx"))
            .expect("an XML spreadsheet under a legacy name converts (genoffice#2044)");
        assert_eq!(result.sheets, 1, "sheets: {}", result.sheets);
        assert_eq!(result.cells, 1, "cells: {}", result.cells);
    }

    #[test]
    fn a_binary_file_that_is_no_container_at_all_keeps_the_reader_error() {
        // Neither a CFB nor anything text-shaped. Guessing what it might have
        // been would be worse than the reader's own message, and this is the
        // branch that keeps it.
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("blob.xls");
        std::fs::write(&source, [0x00u8, 0x01, 0x02, 0x03, 0xFE, 0xFF]).unwrap();
        let Err(error) = convert_to_xlsx(&source, &dir.path().join("out.xlsx")) else {
            panic!("a binary blob must not convert");
        };
        let message = error.to_string();
        assert!(message.contains("Unable to read the workbook"), "{message}");
    }

    #[test]
    fn other_text_content_says_what_the_file_is_not() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("page.xls");
        std::fs::write(
            &source,
            "<html><body><table><tr><td>1</td></tr></table></body></html>\n",
        )
        .unwrap();
        let Err(error) = convert_to_xlsx(&source, &dir.path().join("out.xlsx")) else {
            panic!("html is not a workbook");
        };
        let message = error.to_string();
        assert!(message.contains("not a workbook container"), "{message}");
        assert!(message.contains("<html>"), "{message}");
    }

    #[test]
    fn a_real_container_keeps_the_reader_error() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("broken.xls");
        let mut bytes = vec![0xD0u8, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        bytes.extend(vec![0u8; 600]);
        std::fs::write(&source, &bytes).unwrap();
        let Err(error) = convert_to_xlsx(&source, &dir.path().join("out.xlsx")) else {
            panic!("a truncated container must not convert");
        };
        let message = error.to_string();
        assert!(message.contains("Unable to read the workbook"), "{message}");
    }

    /// The namespaces a minimal ODS package needs for the table markup, the
    /// automatic styles the sizing tests declare, and the manifest.
    const ODS_NAMESPACES: &str = r#"xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0""#;

    /// A minimal valid ODS package: the `mimetype` entry first and stored, the
    /// manifest, and the two XML parts. `body` is the inside of
    /// `office:spreadsheet`, and the table markup in it must carry no
    /// whitespace text nodes — calamine's ODF parser rejects any event inside
    /// a row that is not a cell.
    fn write_ods_fixture(path: &Path, automatic_styles: &str, body: &str) {
        use zip::CompressionMethod;

        let file = File::create(path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file(
                "mimetype",
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
        writer
            .write_all(b"application/vnd.oasis.opendocument.spreadsheet")
            .unwrap();
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut add = |name: &str, content: &str| {
            writer.start_file(name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        };
        add(
            "content.xml",
            &format!(
                r#"<?xml version="1.0" encoding="UTF-8"?><office:document-content {ODS_NAMESPACES} office:version="1.2"><office:automatic-styles>{automatic_styles}</office:automatic-styles><office:body><office:spreadsheet>{body}</office:spreadsheet></office:body></office:document-content>"#,
            ),
        );
        add(
            "styles.xml",
            &format!(
                r#"<?xml version="1.0" encoding="UTF-8"?><office:document-styles {ODS_NAMESPACES} office:version="1.2"><office:styles/><office:automatic-styles/><office:master-styles/></office:document-styles>"#,
            ),
        );
        add(
            "META-INF/manifest.xml",
            r#"<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>"#,
        );
        writer.finish().unwrap();
    }

    #[test]
    fn converts_ods_values_dates_times_and_error_results() {
        let body = concat!(
            r#"<table:table table:name="Data">"#,
            r#"<table:table-column table:number-columns-repeated="4"/>"#,
            r#"<table:table-row>"#,
            r#"<table:table-cell office:value-type="string"><text:p>이름</text:p></table:table-cell>"#,
            r#"<table:table-cell office:value-type="float" office:value="42"><text:p>42</text:p></table:table-cell>"#,
            r#"<table:table-cell office:value-type="boolean" office:boolean-value="TRUE"><text:p>TRUE</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"<table:table-row>"#,
            r#"<table:table-cell office:value-type="date" office:date-value="2026-03-05"><text:p>2026-03-05</text:p></table:table-cell>"#,
            r#"<table:table-cell office:value-type="time" office:time-value="PT13H30M"><text:p>13:30:00</text:p></table:table-cell>"#,
            r##"<table:table-cell table:formula="of:=1/0" office:value-type="string" office:string-value="#DIV/0!"><text:p>#DIV/0!</text:p></table:table-cell>"##,
            // A datetime with a zone suffix cannot be trusted as a serial; it
            // stays the text the file wrote.
            r#"<table:table-cell office:value-type="date" office:date-value="2026-03-05T10:20:30Z"><text:p>2026-03-05T10:20:30Z</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"</table:table>"#,
        );
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("values.ods");
        write_ods_fixture(&source, "", body);
        let target = dir.path().join("converted.xlsx");
        let result = convert_to_xlsx(&source, &target).unwrap();
        assert_eq!(result.sheets, 1);
        assert_eq!(result.formulas_dropped, 0);

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(
            sheet.contains(
                r#"<c r="A1" t="inlineStr"><is><t xml:space="preserve">이름</t></is></c>"#
            ),
            "{sheet}"
        );
        assert!(sheet.contains(r#"<c r="B1"><v>42</v></c>"#), "{sheet}");
        assert!(
            sheet.contains(r#"<c r="C1" t="b"><v>1</v></c>"#),
            "{sheet}"
        );
        assert!(
            sheet.contains(r#"<c r="A2" s="1"><v>46086</v></c>"#),
            "{sheet}"
        );
        // PT13H30M is a fraction of a day with the time format, not text.
        assert!(
            sheet.contains(r#"<c r="B2" s="3"><v>0.5625</v></c>"#),
            "{sheet}"
        );
        assert!(
            sheet.contains(r#"<c r="C2" t="e"><f>1/0</f><v>#DIV/0!</v></c>"#),
            "{sheet}"
        );
        assert!(
            sheet.contains(
                r#"<c r="D2" t="inlineStr"><is><t xml:space="preserve">2026-03-05T10:20:30Z</t></is></c>"#
            ),
            "{sheet}"
        );
        let styles = read_entry(&target, "xl/styles.xml");
        assert!(styles.contains(r#"formatCode="[h]:mm:ss""#), "{styles}");
        assert!(styles.contains(r#"<cellXfs count="4">"#), "{styles}");

        // The package reads back through the same reader the app opens files
        // with, translated formula and all.
        let mut reopened = open_workbook_auto(&target).unwrap();
        let range = reopened.worksheet_range("Data").unwrap();
        assert_eq!(range.get_value((0, 1)), Some(&Data::Float(42.0)));
        let formulas = reopened.worksheet_formula("Data").unwrap();
        assert!(
            formulas.used_cells().any(|(_, _, text)| text == "1/0"),
            "{formulas:?}"
        );
    }

    #[test]
    fn translates_odf_formulas_and_counts_the_dropped_ones() {
        let body = concat!(
            r#"<table:table table:name="Data">"#,
            r#"<table:table-row>"#,
            r#"<table:table-cell office:value-type="float" office:value="2"><text:p>2</text:p></table:table-cell>"#,
            r#"<table:table-cell table:formula="of:=SUM([.A1])" office:value-type="float" office:value="2"><text:p>2</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"<table:table-row>"#,
            r#"<table:table-cell office:value-type="float" office:value="3"><text:p>3</text:p></table:table-cell>"#,
            r#"<table:table-cell table:formula="of:=MyName" office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"<table:table-row>"#,
            r#"<table:table-cell table:formula="of:=IF([.A1]&gt;0;&quot;yes&quot;;&quot;no&quot;)" office:value-type="string" office:string-value="yes"><text:p>yes</text:p></table:table-cell>"#,
            r#"<table:table-cell table:formula="of:={1;2}" office:value-type="float" office:value="0"><text:p>0</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"</table:table>"#,
        );
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("formulas.ods");
        write_ods_fixture(&source, "", body);
        let target = dir.path().join("converted.xlsx");
        let result = convert_to_xlsx(&source, &target).unwrap();
        assert_eq!(result.formulas_dropped, 2);

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(sheet.contains(r#"<f>SUM(A1)</f>"#), "{sheet}");
        assert!(
            sheet.contains(r#"<f>IF(A1&gt;0,&quot;yes&quot;,&quot;no&quot;)</f>"#),
            "{sheet}"
        );
        assert!(!sheet.contains("of:"), "{sheet}");
        // A defined name and an array constant leave their values behind.
        assert!(!sheet.contains("MyName"), "{sheet}");
        assert!(sheet.contains(r#"<c r="B2"><v>7</v></c>"#), "{sheet}");
        assert!(sheet.contains(r#"<c r="B3"><v>0</v></c>"#), "{sheet}");
    }

    #[test]
    fn carries_merged_ranges_across_repeated_rows_and_cells() {
        let body = concat!(
            r#"<table:table table:name="Merged">"#,
            r#"<table:table-row table:number-rows-repeated="2">"#,
            r#"<table:table-cell office:value-type="float" office:value="1"><text:p>1</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"<table:table-row>"#,
            // Two empty cells first: the merge starts at column C, not A.
            r#"<table:table-cell table:number-columns-repeated="2"/>"#,
            r#"<table:table-cell table:number-columns-spanned="2" table:number-rows-spanned="2" office:value-type="string"><text:p>merged</text:p></table:table-cell>"#,
            r#"<table:covered-table-cell/>"#,
            r#"</table:table-row>"#,
            r#"<table:table-row>"#,
            r#"<table:table-cell office:value-type="float" office:value="4"><text:p>4</text:p></table:table-cell>"#,
            r#"<table:table-cell table:number-columns-repeated="2"/>"#,
            r#"<table:covered-table-cell/><table:covered-table-cell/>"#,
            r#"</table:table-row>"#,
            r#"</table:table>"#,
        );
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("merged.ods");
        write_ods_fixture(&source, "", body);
        let target = dir.path().join("converted.xlsx");
        convert_to_xlsx(&source, &target).unwrap();

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(
            sheet.contains(r#"<mergeCells count="1"><mergeCell ref="C3:D4"/></mergeCells>"#),
            "{sheet}"
        );
    }

    #[test]
    fn carries_explicit_column_widths_and_row_heights() {
        let styles = concat!(
            r#"<style:style style:name="co1" style:family="table-column"><style:table-column-properties style:column-width="1.5in"/></style:style>"#,
            r#"<style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:row-height="0.6in"/></style:style>"#,
        );
        let body = concat!(
            r#"<table:table table:name="Sized">"#,
            r#"<table:table-column table:style-name="co1" table:number-columns-repeated="2"/>"#,
            // No style: the default width, which the file does not set.
            r#"<table:table-column/>"#,
            r#"<table:table-row table:style-name="ro1">"#,
            r#"<table:table-cell office:value-type="float" office:value="1"><text:p>1</text:p></table:table-cell>"#,
            r#"<table:table-cell office:value-type="float" office:value="2"><text:p>2</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"</table:table>"#,
        );
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("sized.ods");
        write_ods_fixture(&source, styles, body);
        let target = dir.path().join("converted.xlsx");
        convert_to_xlsx(&source, &target).unwrap();

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        // 1.5in is 144 px at 96 dpi, i.e. (144 - 5) / 7 characters.
        assert!(
            sheet.contains(r#"<cols><col min="1" max="2" width="19.86" customWidth="1"/></cols>"#),
            "{sheet}"
        );
        assert!(sheet.contains(r#"<row r="1" ht="43.20" customHeight="1">"#), "{sheet}");
        // Rows the file does not size stay implicit.
        assert!(!sheet.contains(r#"<row r="2""#), "{sheet}");
    }

    #[test]
    fn a_string_that_is_an_error_literal_becomes_an_error_cell() {
        let body = concat!(
            r#"<table:table table:name="Errors">"#,
            r#"<table:table-row>"#,
            // A pasted value: the error text with no formula behind it.
            r##"<table:table-cell office:value-type="string" office:string-value="#N/A"><text:p>#N/A</text:p></table:table-cell>"##,
            r##"<table:table-cell office:value-type="string" office:string-value="#DIV/0!"><text:p>#DIV/0!</text:p></table:table-cell>"##,
            // Text that merely mentions an error is still text.
            r#"<table:table-cell office:value-type="string"><text:p>see #N/A here</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"</table:table>"#,
        );
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("errors.ods");
        write_ods_fixture(&source, "", body);
        let target = dir.path().join("converted.xlsx");
        convert_to_xlsx(&source, &target).unwrap();

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        assert!(
            sheet.contains(r#"<c r="A1" t="e"><v>#N/A</v></c>"#),
            "{sheet}"
        );
        assert!(
            sheet.contains(r#"<c r="B1" t="e"><v>#DIV/0!</v></c>"#),
            "{sheet}"
        );
        assert!(
            sheet.contains(
                r#"<c r="C1" t="inlineStr"><is><t xml:space="preserve">see #N/A here</t></is></c>"#
            ),
            "{sheet}"
        );
    }

    #[test]
    fn keeps_a_row_height_repeated_over_a_span_too_wide_to_expand() {
        let styles = r#"<style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:row-height="1in"/></style:style>"#;
        let body = concat!(
            r#"<table:table table:name="Tall">"#,
            r#"<table:table-row>"#,
            r#"<table:table-cell office:value-type="float" office:value="1"><text:p>1</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            // Five thousand empty rows at a hand-set height: one `row` element
            // per line would put the most of the grid into the file.
            r#"<table:table-row table:style-name="ro1" table:number-rows-repeated="5000"><table:table-cell/></table:table-row>"#,
            r#"</table:table>"#,
        );
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("tall.ods");
        write_ods_fixture(&source, styles, body);
        let target = dir.path().join("converted.xlsx");
        convert_to_xlsx(&source, &target).unwrap();

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        // 1in is 72 points. The span covers the sheet's empty tail, so the
        // height is the sheet's default rather than an edit to each row — but
        // it must not be dropped.
        assert!(
            sheet.contains(r#"<sheetFormatPr defaultRowHeight="72.00" customHeight="1"/>"#),
            "{sheet}"
        );
        assert!(!sheet.contains(r#"<row r="5001""#), "{sheet}");
    }

    #[test]
    fn carries_a_row_height_repeated_over_rows_that_hold_data() {
        let styles = r#"<style:style style:name="ro1" style:family="table-row"><style:table-row-properties style:row-height="1in"/></style:style>"#;
        let body = concat!(
            r#"<table:table table:name="Tall">"#,
            r#"<table:table-row table:style-name="ro1" table:number-rows-repeated="5000">"#,
            r#"<table:table-cell office:value-type="float" office:value="1"><text:p>1</text:p></table:table-cell>"#,
            r#"</table:table-row>"#,
            r#"</table:table>"#,
        );
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("tall-data.ods");
        write_ods_fixture(&source, styles, body);
        let target = dir.path().join("converted.xlsx");
        convert_to_xlsx(&source, &target).unwrap();

        let sheet = read_entry(&target, "xl/worksheets/sheet1.xml");
        // The span sits over rows that hold data, so the rows that matter keep
        // the height; the writer never expands the span past them.
        assert!(
            sheet.contains(r#"<row r="1" ht="72.00" customHeight="1">"#),
            "{sheet}"
        );
        assert!(
            sheet.contains(r#"<row r="5000" ht="72.00" customHeight="1">"#),
            "{sheet}"
        );
        assert!(!sheet.contains(r#"<row r="5001""#), "{sheet}");
    }

    #[test]
    fn iso_durations_become_fractions_of_a_day() {
        assert_eq!(duration_serial("PT13H30M"), Some(0.5625));
        assert_eq!(duration_serial("PT1H"), Some(1.0 / 24.0));
        assert_eq!(duration_serial("P1DT2H"), Some(1.0 + 2.0 / 24.0));
        assert_eq!(duration_serial("PT0S"), Some(0.0));
        assert_eq!(duration_serial("13:30"), None);
        assert_eq!(duration_serial("PT"), None);
        assert_eq!(duration_serial("PT1X"), None);
        assert_eq!(duration_serial(""), None);
    }

    #[test]
    fn the_ods_stylesheet_keeps_the_minimal_one_and_adds_a_time_format() {
        let styles = ods_styles_xml();
        assert!(styles.contains(r#"<numFmts count="1"><numFmt numFmtId="164""#));
        assert!(styles.contains(r#"<cellXfs count="4">"#));
        assert!(styles.starts_with(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#));
        assert!(roxmltree::Document::parse(&styles).is_ok(), "{styles}");
        // The formats the date cells use are still the minimal stylesheet's.
        assert_eq!(styles.matches(r#"numFmtId="14""#).count(), 1, "{styles}");
        assert_eq!(styles.matches(r#"numFmtId="22""#).count(), 1, "{styles}");
    }
}
