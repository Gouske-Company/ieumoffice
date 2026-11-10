//! Formula translation between Excel syntax and OpenFormula, in both
//! directions the `.ods` bridge needs.
//!
//! An ODS cell keeps its formula in the `table:formula` attribute, written in
//! OpenFormula: `of:=SUM([.B1:.B2])`, with references in brackets, arguments
//! separated by `;` and an `of:` namespace ahead of the `=`. calamine hands
//! that text over verbatim, and an .xlsx carrying it does not calculate:
//! Excel matches `[.B1:.B2]` to nothing and shows the cached value forever.
//! `translate` rewrites that text for the import, and `to_odf` writes the
//! export's `table:formula` back the other way (decision 0119).
//!
//! Both directions translate the pieces the two dialects spell the same way
//! and refuse the rest (decision 0119). A refused formula leaves the cell with
//! its cached value only, and the count of refused cells travels back to the
//! caller as `formulasDropped`. Refusing is the safe direction: a wrong
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

/// The end of a word in an Excel formula: a function name may carry a dot
/// (`ERROR.TYPE`) and a reference may carry `$` markers.
fn word_end(text: &str) -> usize {
    let mut end = 0;
    for character in text.chars() {
        if !(character.is_alphanumeric() || character == '_' || character == '.' || character == '$')
        {
            break;
        }
        end += character.len_utf8();
    }
    end
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

/// Excel functions that OpenFormula 1.2 does not define. Excel stores them
/// with the `_xlfn.` marker, which the index strips before the exporter sees
/// the text, so a name that reaches `to_odf` cannot be told apart from one
/// both dialects share. Writing one unchanged would make LibreOffice read a
/// name it does not know, so the formula is refused and the cached value
/// stays. The list is the Excel-2013-and-later set that only the
/// `COM.MICROSOFT.` namespace covers.
const EXCEL_ONLY_FUNCTIONS: [&str; 45] = [
    "ANCHORARRAY",
    "BYCOL",
    "BYROW",
    "CHOOSECOLS",
    "CHOOSEROWS",
    "CONCAT",
    "DROP",
    "EXPAND",
    "FIELDVALUE",
    "FILTER",
    "FILTERXML",
    "HSTACK",
    "IFS",
    "IMAGE",
    "ISOMITTED",
    "LAMBDA",
    "LET",
    "MAKEARRAY",
    "MAP",
    "MAXIFS",
    "MINIFS",
    "NUMBERVALUE",
    "RANDARRAY",
    "REDUCE",
    "SCAN",
    "SEQUENCE",
    "SINGLE",
    "SORT",
    "SORTBY",
    "STOCKHISTORY",
    "SWITCH",
    "TAKE",
    "TEXTBEFORE",
    "TEXTAFTER",
    "TEXTJOIN",
    "TEXTSPLIT",
    "TOCOL",
    "TOROW",
    "UNIQUE",
    "VSTACK",
    "WEBSERVICE",
    "WRAPCOLS",
    "WRAPROWS",
    "XLOOKUP",
    "XMATCH",
];

/// Translates one Excel formula into the OpenFormula value a `table:formula`
/// attribute carries: `SUM(B1:B2)` → `of:=SUM([.B1:.B2])`.
///
/// `None` means "not confidently translatable" — the exporter keeps the cell's
/// cached value and counts it in `formulasDropped`. The refused shapes are the
/// mirror of `translate`'s: a defined name (a bare word that is neither a
/// function call nor a reference), an array constant, a structured or external
/// reference, an error literal, the intersection and union operators, an
/// Excel-only function, and a 3-D reference.
pub(crate) fn to_odf(raw: &str) -> Option<String> {
    let body = raw.trim_start();
    let body = body.strip_prefix('=').map(str::trim_start).unwrap_or(body);
    if body.is_empty() {
        return None;
    }
    let mut out = String::with_capacity(body.len() + 8);
    out.push_str("of:=");
    let mut rest = body;
    // Excel's intersection operator is a space between two references; a
    // space anywhere else is layout and is dropped.
    let mut previous_reference = false;
    // One entry per open `(`: true when it starts a function call's argument
    // list, false when it only groups an expression. The two spell a comma
    // differently — `SUM(A1,B1)` separates arguments, `SUM((A1,B1))` joins two
    // references into a union — so the difference has to be remembered.
    let mut calls: Vec<bool> = Vec::new();
    // Set by a function name and read by the `(` that follows it (a space
    // between the two is layout, so the flag survives the whitespace arm).
    let mut after_call_name = false;
    while let Some(character) = rest.chars().next() {
        match character {
            '"' => {
                let (literal, remainder) = string_literal(rest)?;
                out.push_str(literal);
                rest = remainder;
                previous_reference = false;
                after_call_name = false;
            }
            '\'' => {
                // A quoted name can only be a sheet ahead of `!`; Excel's
                // string literals use double quotes.
                let quoted = rest.strip_prefix('\'')?;
                let (name, remainder) = quoted_name(quoted)?;
                let remainder = remainder.strip_prefix('!')?;
                let (reference, remainder) = reference_at(remainder, Some(&name))?;
                out.push_str(&reference);
                rest = remainder;
                previous_reference = true;
                after_call_name = false;
            }
            character if character.is_whitespace() => {
                rest = rest.trim_start();
                if previous_reference
                    && rest
                        .chars()
                        .next()
                        .is_some_and(|next| next.is_alphabetic() || next == '$' || next == '\'')
                {
                    return None;
                }
            }
            // Arguments: OpenFormula separates them with `;`, but only inside
            // a call. Elsewhere the comma is Excel's union operator (a
            // multi-area reference), which OpenFormula spells with `~` — a
            // spelling `translate` refuses — so it cannot be translated here
            // either. Writing `;` there would change what the formula means.
            ',' => {
                if !calls.last().is_some_and(|call| *call) {
                    return None;
                }
                out.push(';');
                rest = &rest[1..];
                previous_reference = false;
                after_call_name = false;
            }
            '(' => {
                calls.push(after_call_name);
                out.push('(');
                rest = &rest[1..];
                previous_reference = false;
                after_call_name = false;
            }
            ')' => {
                // A close without an open cannot be part of a formula this
                // translation understands.
                calls.pop()?;
                out.push(')');
                rest = &rest[1..];
                previous_reference = false;
                after_call_name = false;
            }
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
                previous_reference = false;
                after_call_name = false;
            }
            character if character.is_ascii_digit() => {
                // A whole-row range starts with a digit: `1:2`.
                if let Some((reference, remainder)) = reference_at(rest, None) {
                    out.push_str(&reference);
                    rest = remainder;
                    previous_reference = true;
                } else {
                    let end = number_end(rest);
                    out.push_str(&rest[..end]);
                    rest = &rest[end..];
                    previous_reference = false;
                }
                after_call_name = false;
            }
            character if is_identifier_start(character) || character == '$' => {
                let (token, remainder, kind) = word_at(rest)?;
                out.push_str(&token);
                rest = remainder;
                previous_reference = matches!(kind, WordKind::Reference);
                after_call_name = matches!(kind, WordKind::Call);
            }
            // Array constants, structured and external references, error
            // literals, the spill and implicit-intersection operators, a
            // stray range colon, and an argument separator the stored formula
            // already rewrote.
            '{' | '}' | '[' | ']' | ';' | ':' | '#' | '@' | '!' | '~' => return None,
            _ => {
                out.push(character);
                rest = &rest[character.len_utf8()..];
                previous_reference = false;
                after_call_name = false;
            }
        }
    }
    if !calls.is_empty() {
        return None;
    }
    Some(out)
}

/// What a copied word turned out to be. The caller needs the difference to
/// know whether the `(` after it opens an argument list.
enum WordKind {
    Reference,
    Call,
    Value,
}

/// One word and what follows it: a function call, a sheet-qualified
/// reference, a bare `TRUE`/`FALSE`, or a reference. The returned kind says
/// what the copied token was: the intersection check needs to know whether it
/// was a reference, and the comma check whether the next `(` opens a call.
fn word_at(text: &str) -> Option<(String, &str, WordKind)> {
    let end = word_end(text);
    if end == 0 {
        return None;
    }
    let word = &text[..end];
    let after = text[end..].trim_start();
    if after.starts_with('(') {
        if word.contains('.') && !word.eq_ignore_ascii_case("ERROR.TYPE") {
            return None;
        }
        if EXCEL_ONLY_FUNCTIONS
            .iter()
            .any(|function| word.eq_ignore_ascii_case(function))
        {
            return None;
        }
        return Some((word.to_owned(), &text[end..], WordKind::Call));
    }
    if let Some(qualified) = after.strip_prefix('!') {
        let (reference, remainder) = reference_at(qualified, Some(word))?;
        return Some((reference, remainder, WordKind::Reference));
    }
    if word.eq_ignore_ascii_case("TRUE") {
        return Some(("TRUE()".to_owned(), &text[end..], WordKind::Value));
    }
    if word.eq_ignore_ascii_case("FALSE") {
        return Some(("FALSE()".to_owned(), &text[end..], WordKind::Value));
    }
    let (reference, remainder) = reference_at(text, None)?;
    Some((reference, remainder, WordKind::Reference))
}

/// One endpoint of an Excel reference as written: `$A$1`, `A`, `1`.
struct ExcelEndpoint {
    address: String,
    kind: AddressKind,
}

/// `A1`, `A1:B2`, `$A:$A`, `1:2` → the OpenFormula spelling and what follows.
/// `sheet` is the qualifier the caller already read, if any; the sheet is
/// written absolute because an Excel sheet reference never shifts with the
/// cell.
fn reference_at<'a>(text: &'a str, sheet: Option<&str>) -> Option<(String, &'a str)> {
    let (first, rest) = endpoint_at(text)?;
    let (second, rest) = match rest.strip_prefix(':') {
        Some(after) => {
            let (second, rest) = endpoint_at(after)?;
            if second.kind != first.kind {
                return None;
            }
            (Some(second), rest)
        }
        None => (None, rest),
    };
    // Half of a range is only a reference in Excel; a bare column would read
    // as a defined name.
    if second.is_none() && first.kind != AddressKind::Cell {
        return None;
    }
    let mut out = String::from("[");
    match sheet {
        Some(name) => {
            out.push('$');
            out.push_str(&odf_sheet_name(name));
            out.push('.');
        }
        None => out.push('.'),
    }
    out.push_str(&first.address);
    if let Some(second) = second {
        out.push(':');
        out.push('.');
        out.push_str(&second.address);
    }
    out.push(']');
    Some((out, rest))
}

fn endpoint_at(text: &str) -> Option<(ExcelEndpoint, &str)> {
    let mut rest = text;
    let column_absolute = rest.starts_with('$');
    if column_absolute {
        rest = &rest[1..];
    }
    let column_end = rest
        .find(|character: char| !character.is_ascii_alphabetic())
        .unwrap_or(rest.len());
    let column = &rest[..column_end];
    rest = &rest[column_end..];
    // Excel's last column is XFD; a longer run of letters is a name, not an
    // address (and would overflow the column arithmetic below).
    if column.len() > 3 {
        return None;
    }
    let row_absolute = rest.starts_with('$');
    if row_absolute {
        rest = &rest[1..];
    }
    let row_end = rest
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(rest.len());
    let row = &rest[..row_end];
    rest = &rest[row_end..];
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
    let mut address = String::with_capacity(column.len() + row.len() + 2);
    if column_absolute && !column.is_empty() {
        address.push('$');
    }
    address.push_str(column);
    if row_absolute && !row.is_empty() {
        address.push('$');
    }
    address.push_str(row);
    Some((ExcelEndpoint { address, kind }, rest))
}

/// The sheet name inside a bracketed reference, quoted when it needs to be
/// (the same rule the Excel side follows, with `''` for one quote).
fn odf_sheet_name(name: &str) -> String {
    if needs_quotes(name) {
        format!("'{}'", name.replace('\'', "''"))
    } else {
        name.to_owned()
    }
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

    #[test]
    fn writes_references_and_ranges_for_the_export() {
        assert_eq!(
            to_odf("=SUM(B1:B2)").as_deref(),
            Some("of:=SUM([.B1:.B2])")
        );
        assert_eq!(to_odf("=B1*2+C3").as_deref(), Some("of:=[.B1]*2+[.C3]"));
        assert_eq!(
            to_odf("=SUM($A:$A)").as_deref(),
            Some("of:=SUM([.$A:.$A])")
        );
        assert_eq!(to_odf("=SUM(1:2)").as_deref(), Some("of:=SUM([.1:.2])"));
    }

    #[test]
    fn writes_sheet_qualified_references() {
        assert_eq!(
            to_odf("=Sheet1!$B$1").as_deref(),
            Some("of:=[$Sheet1.$B$1]")
        );
        assert_eq!(
            to_odf("='My Sheet'!A1:B2").as_deref(),
            Some("of:=[$'My Sheet'.A1:.B2]")
        );
        assert_eq!(
            to_odf("='O''Brien'!$A$1*2").as_deref(),
            Some("of:=[$'O''Brien'.$A$1]*2")
        );
        // A name that reads like a cell address needs quotes as well.
        assert_eq!(to_odf("='A1'!B2").as_deref(), Some("of:=[$'A1'.B2]"));
    }

    #[test]
    fn rewrites_argument_separators_for_the_export() {
        assert_eq!(
            to_odf(r#"=IF(A1>0,"a;b","c""d")"#).as_deref(),
            Some(r#"of:=IF([.A1]>0;"a;b";"c""d")"#)
        );
    }

    #[test]
    fn a_comma_separates_arguments_only_inside_a_call() {
        assert_eq!(
            to_odf("=SUM(A1,B1)").as_deref(),
            Some("of:=SUM([.A1];[.B1])")
        );
        assert_eq!(
            to_odf("=IF(A1,SUM(B1,C1),0)").as_deref(),
            Some("of:=IF([.A1];SUM([.B1];[.C1]);0)")
        );
        // A space between the name and its `(` is layout, not a break.
        assert_eq!(
            to_odf("=SUM (A1,B1)").as_deref(),
            Some("of:=SUM([.A1];[.B1])")
        );
        // A comma inside grouping parentheses is Excel's union operator (a
        // multi-area reference), which has no `;` spelling in OpenFormula.
        assert_eq!(to_odf("=SUM((A1,B1))"), None);
        assert_eq!(to_odf("=A1,B1"), None);
        // Grouping without a comma is an ordinary expression.
        assert_eq!(
            to_odf("=(A1+B1)*2").as_deref(),
            Some("of:=([.A1]+[.B1])*2")
        );
    }

    #[test]
    fn keeps_functions_for_the_export() {
        assert_eq!(to_odf("=TRUE()").as_deref(), Some("of:=TRUE()"));
        assert_eq!(
            to_odf("=IF(TRUE,A1,FALSE)").as_deref(),
            Some("of:=IF(TRUE();[.A1];FALSE())")
        );
        // A function name that also parses as an address is a call first.
        assert_eq!(to_odf("=LOG10(A1)").as_deref(), Some("of:=LOG10([.A1])"));
        assert_eq!(
            to_odf("=ERROR.TYPE(A1)").as_deref(),
            Some("of:=ERROR.TYPE([.A1])")
        );
    }

    #[test]
    fn refuses_what_it_cannot_write() {
        for raw in [
            "=MyRange",
            "=SUM(MyRange)",
            "={1,2}",
            "=A1 B1",
            "=[1]Sheet1!A1",
            "=Table1[Column]",
            "=#N/A",
            "=@A1",
            "=Sheet1:Sheet2!A1",
            "=A1:B2:C3",
            "=IFS(A1>0,1)",
            "=XLOOKUP(A1,B1:B2,C1:C2)",
            "=XMATCH(A1,B1:B2)",
            "=NETWORKDAYS.INTL(A1,B1)",
            "=SUM((A1,B1))",
            "=SUM(A1",
            "=SUM(A1,B1))",
            "=",
        ] {
            assert_eq!(to_odf(raw), None, "{raw}");
        }
    }

    #[test]
    fn the_two_directions_round_trip_the_shared_shapes() {
        for (excel, odf) in [
            ("SUM(B1:B2)", "of:=SUM([.B1:.B2])"),
            ("B1*2+C3", "of:=[.B1]*2+[.C3]"),
            ("Sheet1!$B$1", "of:=[$Sheet1.$B$1]"),
            ("'My Sheet'!A1:B2", "of:=[$'My Sheet'.A1:.B2]"),
            ("SUM($A:$A)", "of:=SUM([.$A:.$A])"),
            ("SUM(1:2)", "of:=SUM([.1:.2])"),
            ("TRUE()", "of:=TRUE()"),
        ] {
            assert_eq!(to_odf(&format!("={excel}")).as_deref(), Some(odf));
            assert_eq!(translate(odf).as_deref(), Some(excel));
        }
    }
}
