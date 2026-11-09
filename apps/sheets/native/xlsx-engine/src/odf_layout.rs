//! What an `.ods` package says about its sheets beyond the cell values
//! calamine reads: merged ranges, column widths and row heights.
//!
//! calamine's ODS reader walks `content.xml` for cell data only, and its
//! `Range` cannot express a merge at all. The conversion therefore reads the
//! same package a second time, streaming `content.xml` for the table markup
//! that carries merges and sizing, and `styles.xml` for the named styles the
//! table elements point at. Both parts are best-effort: a package whose XML
//! this reader cannot follow still converts its values (the same rule the
//! `.xls` binary layer follows).

use std::collections::HashMap;
use std::fs::File;
use std::io::BufRead;
use std::path::Path;

use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
use zip::ZipArchive;

use crate::SidecarError;
use crate::xml_util::{attribute_value, read_zip_string, zip_entry};

/// Excel's own limits; a repeat count that runs past them is clamped rather
/// than trusted. LibreOffice writes a trailing `table:number-rows-repeated`
/// of 1,048,576 on a sheet's empty tail.
const MAX_ROW: u32 = 1_048_576;
const MAX_COLUMN: u32 = 16_384;

/// One sheet's layout as ODF stores it, in 0-based Excel coordinates.
pub(crate) struct OdsSheetLayout {
    /// `(start, end)` inclusive corners of every `table:number-columns-spanned`
    /// / `table:number-rows-spanned` range, repeats already applied.
    pub(crate) merges: Vec<((u32, u32), (u32, u32))>,
    /// `(first, last, width)` — the width in characters of the default font,
    /// the unit OOXML's `<col width>` uses.
    pub(crate) columns: Vec<(u32, u32, f64)>,
    /// `(first, last, height)` in points, the unit OOXML's `ht` uses.
    pub(crate) row_heights: Vec<(u32, u32, f64)>,
}

/// The sizing named styles declare, keyed by style name: lengths are resolved
/// to points once, when the style is read.
#[derive(Default)]
struct StyleTable {
    column_widths: HashMap<String, f64>,
    row_heights: HashMap<String, f64>,
}

/// A sheet while it is being read: the spans seen so far plus where the
/// cursor stands.
#[derive(Default)]
struct SheetBuilder {
    merges: Vec<((u32, u32), (u32, u32))>,
    columns: Vec<(u32, u32, String)>,
    row_heights: Vec<(u32, u32, String)>,
    /// First row of the row being read, in 0-based sheet coordinates.
    row_start: u32,
    /// Next row a `table:table-row` starts on.
    next_row: u32,
    /// Next column a cell starts on within the current row.
    column: u32,
}

/// Reads every sheet's layout from an ODS package.
pub(crate) fn read_layouts(source: &Path) -> Result<Vec<OdsSheetLayout>, SidecarError> {
    let mut archive = ZipArchive::new(File::open(source)?)?;
    let mut styles = StyleTable::default();
    // `styles.xml` holds the document's named styles, and `content.xml` holds
    // its automatic ones; a table element can point at either.
    if let Ok(xml) = read_zip_string(&mut archive, "styles.xml") {
        let mut reader = Reader::from_str(&xml);
        collect_styles(&mut reader, &mut styles)?;
    }
    let entry = zip_entry(&mut archive, "content.xml")?;
    let mut reader = Reader::from_reader(std::io::BufReader::new(entry));
    parse_content(&mut reader, styles)
}

/// The `(name, family)` of a `style:style` element. Only the table-column and
/// table-row families carry a size this module cares about.
fn style_context<R: BufRead>(
    reader: &Reader<R>,
    element: &BytesStart<'_>,
) -> Result<Option<(String, String)>, SidecarError> {
    let name = attribute_value(reader, element, b"name")?;
    let family = attribute_value(reader, element, b"family")?;
    Ok(match (name, family) {
        (Some(name), Some(family)) => Some((name, family)),
        _ => None,
    })
}

/// Records the size a `style:table-column-properties` or
/// `style:table-row-properties` element declares, under its enclosing style.
/// A property marked "optimal" is a size the application computes, not one
/// the file sets, so it is left out.
fn read_style_property<R: BufRead>(
    reader: &Reader<R>,
    element: &BytesStart<'_>,
    context: Option<&(String, String)>,
    styles: &mut StyleTable,
) -> Result<(), SidecarError> {
    let Some((name, family)) = context else {
        return Ok(());
    };
    match element.local_name().as_ref() {
        b"table-column-properties" if family == "table-column" => {
            let Some(width) = attribute_value(reader, element, b"column-width")? else {
                return Ok(());
            };
            if is_true(attribute_value(
                reader,
                element,
                b"use-optimal-column-width",
            )?) {
                return Ok(());
            }
            if let Some(points) = length_points(&width) {
                styles.column_widths.insert(name.clone(), points);
            }
        }
        b"table-row-properties" if family == "table-row" => {
            let Some(height) = attribute_value(reader, element, b"row-height")? else {
                return Ok(());
            };
            if is_true(attribute_value(
                reader,
                element,
                b"use-optimal-row-height",
            )?) {
                return Ok(());
            }
            if let Some(points) = length_points(&height) {
                styles.row_heights.insert(name.clone(), points);
            }
        }
        _ => {}
    }
    Ok(())
}

fn is_true(value: Option<String>) -> bool {
    value.as_deref() == Some("true")
}

/// Walks `styles.xml` for the sizing its named styles declare.
fn collect_styles<R: BufRead>(
    reader: &mut Reader<R>,
    styles: &mut StyleTable,
) -> Result<(), SidecarError> {
    let mut context: Option<(String, String)> = None;
    let mut buf = Vec::new();
    loop {
        let event = reader.read_event_into(&mut buf)?;
        match event {
            Event::Eof => return Ok(()),
            Event::Start(element) | Event::Empty(element) => {
                if element.local_name().as_ref() == b"style" {
                    context = style_context(reader, &element)?;
                } else {
                    read_style_property(reader, &element, context.as_ref(), styles)?;
                }
            }
            Event::End(end) if end.local_name().as_ref() == b"style" => context = None,
            _ => {}
        }
        buf.clear();
    }
}

/// `table:number-…` counts: repeats and spans. A value this cannot read is
/// left as the default one rather than failing the sheet.
fn count_attribute<R: BufRead>(
    reader: &Reader<R>,
    element: &BytesStart<'_>,
    name: &[u8],
) -> Result<Option<u32>, SidecarError> {
    Ok(attribute_value(reader, element, name)?
        .and_then(|value| value.trim().parse().ok()))
}

/// Streams `content.xml`: one `SheetBuilder` per `table:table`, finished at its
/// end tag. Coordinates come from the repeat counts, since ODF omits the
/// cells a repeat stands for.
fn parse_content<R: BufRead>(
    reader: &mut Reader<R>,
    mut styles: StyleTable,
) -> Result<Vec<OdsSheetLayout>, SidecarError> {
    let mut builders: Vec<SheetBuilder> = Vec::new();
    let mut current: Option<SheetBuilder> = None;
    let mut style: Option<(String, String)> = None;
    let mut next_column = 0u32;
    let mut buf = Vec::new();
    loop {
        let event = reader.read_event_into(&mut buf)?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Eof => break,
            Event::Start(element) | Event::Empty(element) => {
                match element.local_name().as_ref() {
                    b"style" => style = style_context(reader, &element)?,
                    b"table" => {
                        if let Some(builder) = current.take() {
                            builders.push(builder);
                        }
                        current = Some(SheetBuilder::default());
                        next_column = 0;
                    }
                    b"table-column" | b"table-columns" => {
                        // A `table:table-columns` with children is a group
                        // wrapper: its members carry the widths, so its own
                        // repeat count is not applied.
                        let group = element.local_name().as_ref() == b"table-columns";
                        if !(group && !empty) {
                            let repeats = count_attribute(
                                reader,
                                &element,
                                b"number-columns-repeated",
                            )?
                            .unwrap_or(1)
                            .max(1);
                            let name = attribute_value(reader, &element, b"style-name")?;
                            if let Some(name) = name {
                                let builder = current.get_or_insert_with(SheetBuilder::default);
                                let first = next_column;
                                let last = first.saturating_add(repeats - 1).min(MAX_COLUMN - 1);
                                builder.columns.push((first, last, name));
                            }
                            next_column =
                                next_column.saturating_add(repeats).min(MAX_COLUMN);
                        }
                    }
                    b"table-row" => {
                        let repeats =
                            count_attribute(reader, &element, b"number-rows-repeated")?
                                .unwrap_or(1)
                                .max(1);
                        let name = attribute_value(reader, &element, b"style-name")?;
                        let builder = current.get_or_insert_with(SheetBuilder::default);
                        let first = builder.next_row;
                        let last = first.saturating_add(repeats - 1).min(MAX_ROW - 1);
                        if let Some(name) = name {
                            builder.row_heights.push((first, last, name));
                        }
                        builder.row_start = first;
                        builder.column = 0;
                        builder.next_row = first.saturating_add(repeats).min(MAX_ROW);
                    }
                    b"table-cell" | b"covered-table-cell" => {
                        let repeats =
                            count_attribute(reader, &element, b"number-columns-repeated")?
                                .unwrap_or(1)
                                .max(1);
                        let columns =
                            count_attribute(reader, &element, b"number-columns-spanned")?
                                .unwrap_or(1)
                                .max(1);
                        let rows = count_attribute(reader, &element, b"number-rows-spanned")?
                            .unwrap_or(1)
                            .max(1);
                        let builder = current.get_or_insert_with(SheetBuilder::default);
                        if columns > 1 || rows > 1 {
                            let start = (builder.row_start, builder.column);
                            let end = (
                                builder
                                    .row_start
                                    .saturating_add(rows - 1)
                                    .min(MAX_ROW - 1),
                                builder
                                    .column
                                    .saturating_add(columns - 1)
                                    .min(MAX_COLUMN - 1),
                            );
                            builder.merges.push((start, end));
                        }
                        builder.column = builder.column.saturating_add(repeats).min(MAX_COLUMN);
                    }
                    _ => read_style_property(reader, &element, style.as_ref(), &mut styles)?,
                }
            }
            Event::End(end) => match end.local_name().as_ref() {
                b"table" => {
                    if let Some(builder) = current.take() {
                        builders.push(builder);
                    }
                    next_column = 0;
                }
                b"style" => style = None,
                _ => {}
            },
            _ => {}
        }
        buf.clear();
    }
    Ok(builders
        .into_iter()
        .map(|builder| OdsSheetLayout {
            merges: builder.merges,
            columns: builder
                .columns
                .iter()
                .filter_map(|(first, last, name)| {
                    styles
                        .column_widths
                        .get(name)
                        .map(|points| (*first, *last, column_chars(*points)))
                })
                .collect(),
            row_heights: builder
                .row_heights
                .iter()
                .filter_map(|(first, last, name)| {
                    styles
                        .row_heights
                        .get(name)
                        .map(|points| (*first, *last, *points))
                })
                .collect(),
        })
        .collect())
}

/// An ODF length as points. A unitless number is 1/100 mm (ODF 1.2 §18.3.13),
/// and `px` is the CSS pixel: 96 to the inch.
fn length_points(text: &str) -> Option<f64> {
    let text = text.trim();
    let split = text
        .find(|character: char| {
            !(character.is_ascii_digit() || character == '.' || character == '-' || character == '+')
        })
        .unwrap_or(text.len());
    let number: f64 = text[..split].parse().ok()?;
    let factor = match &text[split..] {
        "" => 72.0 / 2540.0,
        "mm" => 72.0 / 25.4,
        "cm" => 72.0 / 2.54,
        "in" => 72.0,
        "pt" => 1.0,
        "pc" => 12.0,
        "px" => 0.75,
        _ => return None,
    };
    Some(number * factor)
}

/// ODF column widths are lengths; OOXML's are characters of the default font.
/// The standard conversion is the one every spreadsheet uses: pixels at 96 dpi
/// from the length, then `(pixels - 5) / 7` characters.
fn column_chars(points: f64) -> f64 {
    let pixels = points * 96.0 / 72.0;
    ((pixels - 5.0) / 7.0).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn odf_lengths_become_points() {
        assert!((length_points("1in").unwrap() - 72.0).abs() < 1e-9);
        assert!((length_points("2.54cm").unwrap() - 72.0).abs() < 1e-6);
        assert!((length_points("25.4mm").unwrap() - 72.0).abs() < 1e-6);
        assert!((length_points("2540").unwrap() - 72.0).abs() < 1e-9);
        assert!((length_points("12pt").unwrap() - 12.0).abs() < 1e-9);
        assert!((length_points("1pc").unwrap() - 12.0).abs() < 1e-9);
        assert!((length_points("96px").unwrap() - 72.0).abs() < 1e-9);
        assert_eq!(length_points("wide"), None);
        assert_eq!(length_points(""), None);
    }

    #[test]
    fn column_widths_use_the_character_arithmetic() {
        assert!((column_chars(72.0) - 13.0).abs() < 1e-9);
        assert!((column_chars(0.0) - 0.0).abs() < 1e-9);
    }
}
