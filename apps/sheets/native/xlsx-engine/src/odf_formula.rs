//! OpenFormula → Excel formula translation for the `.ods` import.
//!
//! An ODS cell keeps its formula in the `table:formula` attribute, written in
//! OpenFormula: `of:=SUM([.B1:.B2])`, with references in brackets, arguments
//! separated by `;` and an `of:` namespace ahead of the `=`. calamine hands
//! that text over verbatim, and an .xlsx carrying it does not calculate:
//! Excel matches `[.B1:.B2]` to nothing and shows the cached value forever.
//!
//! The converter therefore translates the pieces both dialects spell the same
//! way and refuses the rest (decision 0119). A refused formula leaves the cell
//! with its cached value only, and the count of refused cells travels back to
//! the caller as `formulasDropped`. Refusing is the safe direction: a wrong
//! translation would silently change the numbers in the document.

/// Translates one `table:formula` value into Excel syntax.
///
/// `None` means "not confidently translatable" — the caller keeps the cached
/// value and counts the cell. A formula is refused rather than guessed when it
/// carries a namespace Excel has no spelling for (`oooc:`, `msoxl:`), an array
/// constant, an intersection or union operator, a defined name, or a function
/// only ODF knows.
pub(crate) fn translate(raw: &str) -> Option<String> {
    let body = formula_body(raw.trim())?;
    let translated = expression(body)?;
    if translated.is_empty() {
        return None;
    }
    Some(translated)
}

/// The expression behind the namespace: `of:=SUM(…)` → `SUM(…)`.
///
/// OpenFormula puts a namespace ahead of the `=`, and only `of` (the shared
/// OpenFormula set) has an Excel spelling. `oooc` holds LibreOffice-only
/// functions and `msoxl` holds Excel functions written with `_xlfn`-style
/// names; neither survives a translation this code can vouch for.
fn formula_body(raw: &str) -> Option<&str> {
    let namespace_len = raw
        .chars()
        .take_while(|character| character.is_ascii_alphanumeric())
        .count();
    if raw.as_bytes().get(namespace_len..namespace_len + 2) == Some(b":=") {
        let body = &raw[namespace_len + 2..];
        return match &raw[..namespace_len] {
            "of" => Some(body.trim_start()),
            _ => None,
        };
    }
    raw.strip_prefix('=').map(str::trim_start)
}

/// Walks the expression once, copying what both dialects spell the same way
/// and translating the pieces that differ.
fn expression(text: &str) -> Option<String> {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(character) = rest.chars().next() {
        match character {
            '"' => {
                let (literal, remainder) = string_literal(rest)?;
                out.push_str(literal);
                rest = remainder;
            }
            '[' => {
                let (inner, remainder) = bracketed(rest)?;
                out.push_str(&reference(inner)?);
                rest = remainder;
            }
            // Arguments: OpenFormula separates them with `;`.
            ';' => {
                out.push(',');
                rest = &rest[1..];
            }
            // Array constants, intersection, union, a quoted sheet name
            // outside a reference, and bare `$` or `#` have no reading here.
            '{' | '}' | '!' | '~' | '\'' | '$' | '#' => return None,
            '.' => {
                if !rest[1..]
                    .chars()
                    .next()
                    .is_some_and(|next| next.is_ascii_digit())
                {
                    return None;
                }
                let end = number_end(rest);
                out.push_str(&rest[..end]);
                rest = &rest[end..];
            }
            character if character.is_ascii_digit() => {
                let end = number_end(rest);
                out.push_str(&rest[..end]);
                rest = &rest[end..];
            }
            character if is_identifier_start(character) => {
                let end = identifier_end(rest);
                let name = &rest[..end];
                let after = &rest[end..];
                let trimmed = after.trim_start();
                let is_call = trimmed.starts_with('(');
                out.push_str(function_or_value(name, is_call)?);
                rest = if is_call { trimmed } else { after };
            }
            _ => {
                out.push(character);
                rest = &rest[character.len_utf8()..];
            }
        }
    }
    Some(out)
}

fn is_identifier_start(character: char) -> bool {
    character.is_alphabetic() || character == '_'
}

/// Function names may carry a namespace (`COM.MICROSOFT.`), so a dot is part
/// of the name rather than the end of it.
fn identifier_end(text: &str) -> usize {
    let mut end = 0;
    for character in text.chars() {
        if !(character.is_alphanumeric() || character == '_' || character == '.') {
            break;
        }
        end += character.len_utf8();
    }
    end
}

/// The end of a numeric literal: digits, an optional fraction, an optional
/// exponent. A `+` or `-` belongs to the number only right after the `e`.
fn number_end(text: &str) -> usize {
    let bytes = text.as_bytes();
    let mut end = 0;
    while end < bytes.len() && bytes[end].is_ascii_digit() {
        end += 1;
    }
    if end < bytes.len() && bytes[end] == b'.' {
        end += 1;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
    }
    if end < bytes.len() && (bytes[end] == b'e' || bytes[end] == b'E') {
        let mut exponent = end + 1;
        if exponent < bytes.len() && (bytes[exponent] == b'+' || bytes[exponent] == b'-') {
            exponent += 1;
        }
        let digits = exponent;
        while exponent < bytes.len() && bytes[exponent].is_ascii_digit() {
            exponent += 1;
        }
        if exponent > digits {
            end = exponent;
        }
    }
    end
}

/// A string literal and what follows it. Both dialects escape an embedded
/// quote by doubling it, so the literal is copied through unchanged.
fn string_literal(text: &str) -> Option<(&str, &str)> {
    let bytes = text.as_bytes();
    let mut index = 1;
    while index < bytes.len() {
        if bytes[index] == b'"' {
            if bytes.get(index + 1) == Some(&b'"') {
                index += 2;
                continue;
            }
            return Some((&text[..index + 1], &text[index + 1..]));
        }
        index += 1;
    }
    None
}

/// The text inside `[` … `]` and what follows it. A quoted sheet name may hold
/// a bracket, so the closing bracket is only taken outside single quotes.
fn bracketed(text: &str) -> Option<(&str, &str)> {
    let mut quoted = false;
    for (index, character) in text.char_indices().skip(1) {
        match character {
            '\'' => quoted = !quoted,
            ']' if !quoted => return Some((&text[1..index], &text[index + 1..])),
            _ => {}
        }
    }
    None
}

/// One endpoint of a reference as OpenFormula spells it: an optional sheet
/// name and the address inside it.
struct CellReference {
    sheet: Option<String>,
    address: String,
    kind: AddressKind,
}

/// How an address names its target. A whole column or row is only a reference
/// as one half of `A:B` / `1:2`; alone it would read as a name in Excel.
#[derive(Clone, Copy, PartialEq)]
enum AddressKind {
    Cell,
    Column,
    Row,
}

/// `[.B1]` → `B1`, `[.B1:.B2]` → `B1:B2`, `[Sheet1.B1]` → `Sheet1!B1`,
/// `[$Sheet1.$B$1]` → `Sheet1!$B$1`.
fn reference(inner: &str) -> Option<String> {
    let (first_text, second_text) = match split_range(inner) {
        Some((first, second)) => (first, Some(second)),
        None => (inner, None),
    };
    let first = endpoint(first_text)?;
    let mut out = String::new();
    if let Some(sheet) = &first.sheet {
        out.push_str(&sheet_prefix(sheet));
    }
    match second_text {
        None => {
            if first.kind != AddressKind::Cell {
                return None;
            }
            out.push_str(&first.address);
        }
        Some(second_text) => {
            let second = endpoint(second_text)?;
            // A range across two sheets is a 3-D reference, which Excel spells
            // with the sheets joined (`Sheet1:Sheet2!A1`). Refusing is cheaper
            // than proving this translation right.
            if second.sheet.is_some() && second.sheet != first.sheet {
                return None;
            }
            if second.kind != first.kind {
                return None;
            }
            out.push_str(&first.address);
            out.push(':');
            out.push_str(&second.address);
        }
    }
    Some(out)
}

fn split_range(inner: &str) -> Option<(&str, &str)> {
    let mut quoted = false;
    for (index, character) in inner.char_indices() {
        match character {
            '\'' => quoted = !quoted,
            ':' if !quoted => return Some((&inner[..index], &inner[index + 1..])),
            _ => {}
        }
    }
    None
}

fn endpoint(text: &str) -> Option<CellReference> {
    // `[$Sheet1.…]`: the `$` locks the sheet, not part of its name.
    let text = text.strip_prefix('$').unwrap_or(text);
    let (sheet, address) = if let Some(rest) = text.strip_prefix('\'') {
        let (name, rest) = quoted_name(rest)?;
        (Some(name), rest.strip_prefix('.')?)
    } else {
        let dot = text.find('.')?;
        let name = &text[..dot];
        (
            (!name.is_empty()).then(|| name.to_string()),
            &text[dot + 1..],
        )
    };
    let (address, kind) = cell_address(address)?;
    Some(CellReference {
        sheet,
        address,
        kind,
    })
}

/// A sheet name that was quoted with `'`, with `''` standing for one quote.
fn quoted_name(text: &str) -> Option<(String, &str)> {
    let bytes = text.as_bytes();
    let mut name = String::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\'' {
            if bytes.get(index + 1) == Some(&b'\'') {
                name.push('\'');
                index += 2;
                continue;
            }
            return Some((name, &text[index + 1..]));
        }
        let character = text[index..].chars().next()?;
        name.push(character);
        index += character.len_utf8();
    }
    None
}

/// A cell, whole-column or whole-row address in Excel's A1 spelling, with the
/// `$` markers kept. `None` for anything outside the grid.
fn cell_address(text: &str) -> Option<(String, AddressKind)> {
    let mut rest = text;
    let column_absolute = rest.starts_with('$');
    if column_absolute {
        rest = &rest[1..];
    }
    let column_end = rest
        .find(|character: char| !character.is_ascii_alphabetic())
        .unwrap_or(rest.len());
    let column = &rest[..column_end];
    let mut rest = &rest[column_end..];
    let row_absolute = rest.starts_with('$');
    if row_absolute {
        rest = &rest[1..];
    }
    let row = rest;
    if column.len() > 3 || !row.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    let kind = match (column.is_empty(), row.is_empty()) {
        (false, false) => AddressKind::Cell,
        (false, true) => AddressKind::Column,
        (true, false) => AddressKind::Row,
        (true, true) => return None,
    };
    if !column.is_empty() {
        let number = column.chars().fold(0u32, |total, character| {
            total * 26 + (character.to_ascii_uppercase() as u32 - 'A' as u32 + 1)
        });
        if !(1..=16_384).contains(&number) {
            return None;
        }
    }
    if !row.is_empty() {
        let number: u32 = row.parse().ok()?;
        if !(1..=1_048_576).contains(&number) {
            return None;
        }
    }
    let mut address = String::with_capacity(text.len());
    if column_absolute && !column.is_empty() {
        address.push('$');
    }
    address.push_str(column);
    if row_absolute && !row.is_empty() {
        address.push('$');
    }
    address.push_str(row);
    Some((address, kind))
}

/// `Sheet1!` or `'My Sheet'!` — Excel needs the quotes for a name holding a
/// space or another special character, and an embedded quote doubles.
fn sheet_prefix(name: &str) -> String {
    if needs_quotes(name) {
        format!("'{}'!", name.replace('\'', "''"))
    } else {
        format!("{name}!")
    }
}

fn needs_quotes(name: &str) -> bool {
    name.is_empty()
        || name.starts_with(|character: char| character.is_ascii_digit())
        || name
            .chars()
            .any(|character| !(character.is_alphanumeric() || character == '_'))
        || cell_address(name).is_some()
}

/// Functions OpenFormula defines that Excel does not have. A formula using
/// one is refused rather than written as a name Excel reads as `#NAME?`.
const ODF_ONLY_FUNCTIONS: [&str; 2] = ["STYLE", "CURRENT"];

fn function_or_value(name: &str, is_call: bool) -> Option<&str> {
    if name.eq_ignore_ascii_case("TRUE") || name.eq_ignore_ascii_case("FALSE") {
        return Some(name);
    }
    if !is_call {
        // A name with no argument list is a defined name, which this
        // translation has no way to carry over.
        return None;
    }
    if let Some(stripped) = strip_prefix_ignore_case(name, "COM.MICROSOFT.") {
        if stripped.is_empty() || stripped.contains('.') {
            return None;
        }
        return Some(stripped);
    }
    if name.contains('.') {
        // `ERROR.TYPE` is the one dotted name both dialects spell alike.
        return name.eq_ignore_ascii_case("ERROR.TYPE").then_some(name);
    }
    if ODF_ONLY_FUNCTIONS
        .iter()
        .any(|function| name.eq_ignore_ascii_case(function))
    {
        return None;
    }
    Some(name)
}

fn strip_prefix_ignore_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_the_namespace_and_rewrites_relative_references() {
        assert_eq!(
            translate("of:=SUM([.B1:.B2])").as_deref(),
            Some("SUM(B1:B2)")
        );
        assert_eq!(translate("of:=[.B1]*2+[.C3]").as_deref(), Some("B1*2+C3"));
    }

    #[test]
    fn keeps_absolute_and_sheet_qualified_references() {
        assert_eq!(
            translate("of:=[$Sheet1.$B$1]+[Other.A2]").as_deref(),
            Some("Sheet1!$B$1+Other!A2")
        );
        assert_eq!(
            translate("of:=[Sheet1.A1:.B2]").as_deref(),
            Some("Sheet1!A1:B2")
        );
        assert_eq!(translate("of:=[.$A$1]").as_deref(), Some("$A$1"));
        // An absolute, quoted sheet: the `$` locks the sheet, the quotes are
        // the name's own.
        assert_eq!(
            translate("of:=[$'My Sheet'.$A$1]").as_deref(),
            Some("'My Sheet'!$A$1")
        );
    }

    #[test]
    fn translates_whole_column_and_whole_row_ranges() {
        assert_eq!(
            translate("of:=SUM([.A:.A])").as_deref(),
            Some("SUM(A:A)")
        );
        assert_eq!(translate("of:=SUM([.1:.2])").as_deref(), Some("SUM(1:2)"));
        // Half a reference is not one in Excel: a bare column would read as a
        // defined name.
        assert_eq!(translate("of:=[.A]"), None);
    }

    #[test]
    fn quotes_sheet_names_that_need_it() {
        assert_eq!(
            translate("of:=[My Sheet.A1]").as_deref(),
            Some("'My Sheet'!A1")
        );
        assert_eq!(
            translate("of:=['O''Brien'.$A$1]").as_deref(),
            Some("'O''Brien'!$A$1")
        );
        // A name that reads like a cell address needs quotes as well.
        assert_eq!(translate("of:=[A1.B2]").as_deref(), Some("'A1'!B2"));
    }

    #[test]
    fn rewrites_argument_separators_but_not_inside_strings() {
        assert_eq!(
            translate(r#"of:=IF([.A1]>0;"a;b";"c""d")"#).as_deref(),
            Some(r#"IF(A1>0,"a;b","c""d")"#)
        );
    }

    #[test]
    fn keeps_functions_both_dialects_spell_the_same() {
        assert_eq!(translate("of:=TRUE()").as_deref(), Some("TRUE()"));
        assert_eq!(
            translate("of:=IF(TRUE();1;FALSE())").as_deref(),
            Some("IF(TRUE(),1,FALSE())")
        );
        assert_eq!(
            translate("of:=COM.MICROSOFT.IFS([.A1]>1;2)").as_deref(),
            Some("IFS(A1>1,2)")
        );
        // `ERROR.TYPE` is a dotted name both dialects share.
        assert_eq!(
            translate("of:=ERROR.TYPE([.A1])").as_deref(),
            Some("ERROR.TYPE(A1)")
        );
    }

    #[test]
    fn refuses_what_it_cannot_translate() {
        for raw in [
            "oooc:=SUM(A1:A2)",
            "msoxl:=SUM(A1:A2)",
            "of:={1;2}",
            "of:=[.A1]![.A2]",
            "of:=[.A1]~[.A2]",
            "of:=MyRange",
            "of:=ORG.OPENOFFICE.STYLE([.A1])",
            "of:=STYLE([.A1])",
            "of:=[#This Row]",
            "of:=Sheet1.A1",
            "of:=[.A1",
            "of:=[.A]",
            "",
            "SUM([.A1:.A2])",
        ] {
            assert_eq!(translate(raw), None, "{raw}");
        }
    }
}
