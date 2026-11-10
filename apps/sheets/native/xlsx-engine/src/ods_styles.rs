//! Styles for the `.ods` export.
//!
//! Excel keeps a cell's look in a shared `xf` table and its number format in a
//! code such as `#,##0.00` or `yyyy-mm-dd`. ODF wants the first as a
//! `style:style` of family `table-cell` and the second as a `number:*` data
//! style that the cell style points at. `StyleRegistry` builds both while the
//! table body is written: every distinct body it derives gets a name, and the
//! caller assembles the automatic-styles block from what it collected.
//!
//! A format this code cannot map (fractions, scientific notation, accounting
//! paddings) becomes no data style at all. The value is still written as a
//! number, so the only thing lost is how it is displayed.

use std::collections::{BTreeSet, HashMap};

use crate::CellStyle;
use crate::visuals::BorderEdge;
use crate::xlsx_package::escape_xml;

/// What a number-format code says the cell holds. The content writer picks the
/// matching ODF value attribute and display text from it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ValueKind {
    Number,
    Date,
    Time,
}

/// One cell's formatting as the content writer needs it.
#[derive(Clone)]
pub(crate) struct ResolvedStyle {
    /// `table:style-name`, absent when the cell looks like the workbook
    /// default and needs no style element.
    pub(crate) name: Option<String>,
    pub(crate) kind: ValueKind,
}

/// Automatic styles collected while the table body is written.
pub(crate) struct StyleRegistry {
    /// cellXfs[0]: the font, fill and size every cell starts from. The
    /// stylesheet writes it as the document default style, so cell styles
    /// only have to carry what differs.
    base: CellStyle,
    data_styles: HashMap<String, (Option<String>, ValueKind)>,
    data_bodies: Vec<(String, String)>,
    cell_styles: HashMap<String, String>,
    cell_bodies: Vec<(String, Option<String>, String)>,
    column_styles: HashMap<String, String>,
    column_bodies: Vec<(String, String)>,
    row_styles: HashMap<String, String>,
    row_bodies: Vec<(String, String)>,
    fonts: BTreeSet<String>,
    counter: usize,
}

impl StyleRegistry {
    pub(crate) fn new(base: CellStyle) -> Self {
        let mut fonts = BTreeSet::new();
        if let Some(family) = &base.font_family {
            fonts.insert(family.clone());
        }
        Self {
            base,
            data_styles: HashMap::new(),
            data_bodies: Vec::new(),
            cell_styles: HashMap::new(),
            cell_bodies: Vec::new(),
            column_styles: HashMap::new(),
            column_bodies: Vec::new(),
            row_styles: HashMap::new(),
            row_bodies: Vec::new(),
            fonts,
            counter: 0,
        }
    }

    fn next_name(&mut self, prefix: &str) -> String {
        self.counter += 1;
        format!("{prefix}{}", self.counter)
    }

    /// The data style for a cell's number format, plus what the value is.
    fn data_style(&mut self, format: Option<&str>) -> (Option<String>, ValueKind) {
        let Some(format) = format.map(str::trim).filter(|code| !code.is_empty()) else {
            return (None, ValueKind::Number);
        };
        if let Some(cached) = self.data_styles.get(format) {
            return cached.clone();
        }
        let resolved = match analyze(format) {
            Analysis::General | Analysis::Text | Analysis::Unknown => (None, ValueKind::Number),
            Analysis::Number(spec) => {
                let name = self.next_name("N");
                self.data_bodies
                    .push((name.clone(), number_style_xml(&name, &spec, None)));
                (Some(name), ValueKind::Number)
            }
            Analysis::Percent(spec) => {
                let name = self.next_name("N");
                self.data_bodies
                    .push((name.clone(), percentage_style_xml(&name, &spec)));
                (Some(name), ValueKind::Number)
            }
            Analysis::Currency { symbol, spec } => {
                let name = self.next_name("N");
                self.data_bodies.push((
                    name.clone(),
                    number_style_xml(&name, &spec, Some(&symbol)),
                ));
                (Some(name), ValueKind::Number)
            }
            Analysis::Calendar {
                fields,
                time_only,
                elapsed,
            } => {
                let name = self.next_name("N");
                self.data_bodies.push((
                    name.clone(),
                    calendar_style_xml(&name, &fields, time_only, elapsed),
                ));
                (
                    Some(name),
                    if time_only {
                        ValueKind::Time
                    } else {
                        ValueKind::Date
                    },
                )
            }
        };
        self.data_styles
            .insert(format.to_owned(), resolved.clone());
        resolved
    }

    /// One cell style for a workbook `CellStyle`, or `None` when the cell looks
    /// exactly like the document default.
    pub(crate) fn resolve_cell(&mut self, style: &CellStyle) -> ResolvedStyle {
        let (data, kind) = self.data_style(style.number_format.as_deref());
        // A format that needs a data style needs a cell style to point at it,
        // even when the format is the workbook default's own.
        if data.is_none() && style.is_default_like(&self.base) {
            return ResolvedStyle { name: None, kind };
        }
        let inner = self.cell_properties(style);
        let key = format!("{}\u{1}{}", data.as_deref().unwrap_or(""), inner);
        if let Some(name) = self.cell_styles.get(&key) {
            return ResolvedStyle {
                name: Some(name.clone()),
                kind,
            };
        }
        let name = self.next_name("ce");
        self.cell_styles.insert(key, name.clone());
        self.cell_bodies.push((name.clone(), data, inner));
        ResolvedStyle {
            name: Some(name),
            kind,
        }
    }

    /// The properties of one cell style, as the inside of its `style:style`.
    fn cell_properties(&mut self, style: &CellStyle) -> String {
        let mut cell = String::new();
        let mut paragraph = String::new();
        let mut text = String::new();

        if let Some(color) = &style.fill_color {
            if self.base.fill_color.as_ref() != Some(color) {
                cell.push_str(&format!(
                    r#" fo:background-color="{}""#,
                    escape_xml(color)
                ));
            }
        }
        // Borders are always written: the ODF default is "no border", so a
        // cell edge the workbook draws has to say so even when the default xf
        // shares it.
        for (attribute, edge) in [
            ("fo:border-top", &style.border_top),
            ("fo:border-bottom", &style.border_bottom),
            ("fo:border-left", &style.border_left),
            ("fo:border-right", &style.border_right),
        ] {
            if let Some(edge) = edge {
                cell.push_str(&format!(
                    r#" {attribute}="{}""#,
                    escape_xml(&border_line(edge))
                ));
            }
        }
        if stroke_only(&self.base, style) {
            for attribute in [
                "fo:border-top",
                "fo:border-bottom",
                "fo:border-left",
                "fo:border-right",
            ] {
                cell.push_str(&format!(r#" {attribute}="none""#));
            }
        }
        if let Some(vertical) = &style.vertical_alignment {
            let value = match vertical.as_str() {
                "top" => Some("top"),
                "center" => Some("middle"),
                "bottom" => Some("bottom"),
                _ => None,
            };
            if let Some(value) = value {
                cell.push_str(&format!(r#" style:vertical-align="{value}""#));
            }
        }
        if style.wrap_text {
            cell.push_str(r#" style:wrap-text="true""#);
        }
        if let Some(indent) = style.indent.filter(|steps| *steps > 0) {
            // One Excel indent step is about three characters of the default
            // font, which the 0.1in the app's grid uses matches closely.
            cell.push_str(&format!(
                r#" fo:padding-left="{}in""#,
                0.1 * f64::from(indent)
            ));
        }

        if let Some(horizontal) = &style.horizontal_alignment {
            let value = match horizontal.as_str() {
                "left" => Some("start"),
                "center" => Some("center"),
                "right" => Some("end"),
                "justify" => Some("justify"),
                "distributed" => Some("justify"),
                _ => None,
            };
            if let Some(value) = value {
                paragraph.push_str(&format!(r#" fo:text-align="{value}""#));
            }
        }

        let font_family = style.font_family.as_ref().filter(|family| {
            font_family_differs(&self.base, family)
        });
        if let Some(family) = font_family {
            self.fonts.insert(family.clone());
            text.push_str(&format!(
                r#" style:font-name="{}""#,
                escape_xml(family)
            ));
        }
        if let Some(size) = style.font_size.filter(|size| {
            self.base.font_size.map(|base| (base - size).abs() > 1e-6) != Some(false)
        }) {
            text.push_str(&format!(r#" fo:font-size="{size}pt""#));
        }
        if style.bold != self.base.bold {
            text.push_str(if style.bold {
                r#" fo:font-weight="bold""#
            } else {
                r#" fo:font-weight="normal""#
            });
        }
        if style.italic != self.base.italic {
            text.push_str(if style.italic {
                r#" fo:font-style="italic""#
            } else {
                r#" fo:font-style="normal""#
            });
        }
        if style.underline != self.base.underline {
            if style.underline {
                text.push_str(
                    r#" style:text-underline-style="solid" style:text-underline-type="single" style:text-underline-width="auto" style:text-underline-color="font-color""#,
                );
            } else {
                text.push_str(r#" style:text-underline-style="none""#);
            }
        }
        if style.strikethrough != self.base.strikethrough {
            if style.strikethrough {
                text.push_str(
                    r#" style:text-line-through-style="solid" style:text-line-through-type="single""#,
                );
            } else {
                text.push_str(r#" style:text-line-through-style="none""#);
            }
        }
        if let Some(color) = &style.font_color {
            if self.base.font_color.as_ref() != Some(color) {
                text.push_str(&format!(r#" fo:color="{}""#, escape_xml(color)));
            }
        }
        if let Some(align) = &style.vert_align {
            let position = match align.as_str() {
                "superscript" => "super 58%",
                "subscript" => "sub 58%",
                _ => "",
            };
            if !position.is_empty() {
                text.push_str(&format!(r#" style:text-position="{position}""#));
            }
        }

        let mut out = String::new();
        if !cell.is_empty() {
            out.push_str("<style:table-cell-properties");
            out.push_str(&cell);
            out.push_str("/>");
        }
        if !paragraph.is_empty() {
            out.push_str("<style:paragraph-properties");
            out.push_str(&paragraph);
            out.push_str("/>");
        }
        if !text.is_empty() {
            out.push_str("<style:text-properties");
            out.push_str(&text);
            out.push_str("/>");
        }
        out
    }

    /// A `table-column` style for a width in points.
    pub(crate) fn column(&mut self, width_points: f64) -> String {
        let key = format!("{width_points:.2}");
        if let Some(name) = self.column_styles.get(&key) {
            return name.clone();
        }
        let name = self.next_name("co");
        self.column_styles.insert(key, name.clone());
        self.column_bodies.push((
            name.clone(),
            format!(
                r#"<style:style style:name="{name}" style:family="table-column"><style:table-column-properties style:column-width="{width_points:.2}pt"/></style:style>"#,
            ),
        ));
        name
    }

    /// A `table-row` style for a height in points.
    pub(crate) fn row(&mut self, height_points: f64) -> String {
        let key = format!("{height_points:.2}");
        if let Some(name) = self.row_styles.get(&key) {
            return name.clone();
        }
        let name = self.next_name("ro");
        self.row_styles.insert(key, name.clone());
        self.row_bodies.push((
            name.clone(),
            format!(
                r#"<style:style style:name="{name}" style:family="table-row"><style:table-row-properties style:row-height="{height_points:.2}pt"/></style:style>"#,
            ),
        ));
        name
    }

    /// The `<office:automatic-styles>` content: data styles first (the cell
    /// styles point at them), then cell, column and row styles.
    pub(crate) fn automatic_styles(&self) -> String {
        let mut out = String::new();
        for (_, body) in &self.data_bodies {
            out.push_str(body);
        }
        for (name, data, inner) in &self.cell_bodies {
            out.push_str(&format!(
                r#"<style:style style:name="{name}" style:family="table-cell"{}>{inner}</style:style>"#,
                data.as_ref()
                    .map(|data| format!(r#" style:data-style-name="{data}""#))
                    .unwrap_or_default(),
            ));
        }
        for (_, body) in &self.column_bodies {
            out.push_str(body);
        }
        for (_, body) in &self.row_bodies {
            out.push_str(body);
        }
        out
    }

    /// `<office:font-face-decls>` for the fonts the cells name. ODF wants a
    /// declaration before a style may reference the font by name.
    pub(crate) fn font_face_decls(&self) -> String {
        let mut out = String::new();
        for family in &self.fonts {
            out.push_str(&format!(
                r#"<style:font-face style:name="{}" svg:font-family="{}"/>"#,
                escape_xml(family),
                escape_xml(family),
            ));
        }
        out
    }

    /// The default cell style for `styles.xml`: the workbook's Normal xf.
    pub(crate) fn default_cell_style(&self) -> String {
        let mut text = String::new();
        if let Some(family) = &self.base.font_family {
            text.push_str(&format!(
                r#" style:font-name="{}""#,
                escape_xml(family)
            ));
        }
        if let Some(size) = self.base.font_size {
            text.push_str(&format!(r#" fo:font-size="{size}pt""#));
        }
        if let Some(color) = &self.base.font_color {
            text.push_str(&format!(r#" fo:color="{}""#, escape_xml(color)));
        }
        if self.base.bold {
            text.push_str(r#" fo:font-weight="bold""#);
        }
        if self.base.italic {
            text.push_str(r#" fo:font-style="italic""#);
        }
        let mut cell = String::from(r#" fo:padding="0.02in""#);
        if let Some(fill) = &self.base.fill_color {
            cell.push_str(&format!(
                r#" fo:background-color="{}""#,
                escape_xml(fill)
            ));
        }
        let mut out = String::from(r#"<style:default-style style:family="table-cell">"#);
        out.push_str(&format!(
            "<style:table-cell-properties{cell}/>"
        ));
        out.push_str(r#"<style:paragraph-properties fo:margin="0in"/>"#);
        out.push_str(&format!("<style:text-properties{text}/>"));
        out.push_str("</style:default-style>");
        out
    }
}

fn font_family_differs(base: &CellStyle, family: &str) -> bool {
    base.font_family.as_deref() != Some(family)
}

/// True when the base xf has an edge this style turns off; ODF needs the
/// explicit `none` for that.
fn stroke_only(base: &CellStyle, style: &CellStyle) -> bool {
    let edge = |value: &Option<BorderEdge>| value.is_some();
    (edge(&base.border_top) && !edge(&style.border_top))
        || (edge(&base.border_bottom) && !edge(&style.border_bottom))
        || (edge(&base.border_left) && !edge(&style.border_left))
        || (edge(&base.border_right) && !edge(&style.border_right))
}

/// An OOXML border token as the ODF line it paints.
fn border_line(edge: &BorderEdge) -> String {
    let (width, style) = match edge.style.as_str() {
        "hair" => ("0.50", "solid"),
        "thin" => ("0.75", "solid"),
        "medium" => ("1.50", "solid"),
        "thick" => ("2.25", "solid"),
        "double" => ("1.50", "double"),
        "dotted" => ("0.75", "dotted"),
        "dashed" | "mediumDashed" | "dashDot" | "mediumDashDot" | "dashDotDot"
        | "mediumDashDotDot" | "slantDashDot" => ("0.75", "dashed"),
        _ => ("0.75", "solid"),
    };
    format!(
        "{width}pt {style} {}",
        edge.color.as_deref().unwrap_or("#000000")
    )
}

impl CellStyle {
    /// True when nothing about this xf differs from the document default.
    fn is_default_like(&self, base: &CellStyle) -> bool {
        number_format_key(self) == number_format_key(base)
            && self.fill_color == base.fill_color
            && self.border_top.is_none()
            && self.border_bottom.is_none()
            && self.border_left.is_none()
            && self.border_right.is_none()
            && self.horizontal_alignment.is_none()
            && self.vertical_alignment.is_none()
            && self.indent.is_none()
            && !self.wrap_text
            && self.font_family.as_deref() == base.font_family.as_deref()
            && self.font_size == base.font_size
            && self.bold == base.bold
            && self.italic == base.italic
            && self.underline == base.underline
            && self.strikethrough == base.strikethrough
            && self.vert_align == base.vert_align
            && self.font_color == base.font_color
    }
}

/// A number format code that asks for nothing beyond the plain number, as a
/// key two styles can be compared by.
fn number_format_key(style: &CellStyle) -> Option<&str> {
    style
        .number_format
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty() && !code.eq_ignore_ascii_case("general"))
}

// ---------------------------------------------------------------------------
// Number-format analysis
// ---------------------------------------------------------------------------

/// The plain-number shape a format code asks for.
struct NumberSpec {
    decimals: u32,
    min_integer_digits: u32,
    grouping: bool,
}

/// One field of a date or time format, in the order the code spells it.
enum Field {
    Year { long: bool },
    Month { long: bool, textual: bool },
    Day { long: bool },
    DayOfWeek { long: bool },
    Hour { long: bool },
    Minute { long: bool },
    Second { long: bool, decimals: u32 },
    AmPm,
    Text(String),
}

enum Analysis {
    General,
    Text,
    Number(NumberSpec),
    Percent(NumberSpec),
    Currency { symbol: String, spec: NumberSpec },
    Calendar { fields: Vec<Field>, time_only: bool, elapsed: bool },
    Unknown,
}

/// A token the scanner emits before the fields are classified.
enum Raw {
    Year(u32),
    MonthOrMinute(u32),
    Day(u32),
    Hour(u32),
    Second(u32),
    Elapsed(char),
    AmPm,
    Text(String),
    Zero,
    Hash,
    Question,
    Decimal,
    Group,
    Percent,
    At,
}

fn analyze(code: &str) -> Analysis {
    let section = first_section(code);
    if section.trim().is_empty() || section.trim().eq_ignore_ascii_case("general") {
        return Analysis::General;
    }
    let mut tokens: Vec<Raw> = Vec::new();
    let mut currency = String::new();
    let mut characters = section.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '"' => {
                let mut literal = String::new();
                for next in characters.by_ref() {
                    if next == '"' {
                        break;
                    }
                    literal.push(next);
                }
                if is_currency_text(&literal) {
                    currency.push_str(&literal);
                }
                tokens.push(Raw::Text(literal));
            }
            '\\' => {
                if let Some(literal) = characters.next() {
                    tokens.push(Raw::Text(literal.to_string()));
                }
            }
            // `_x` reserves the width of x and `*x` repeats x to fill the
            // cell; neither is part of the value's shape.
            '_' => {
                characters.next();
            }
            '*' => {
                characters.next();
            }
            '[' => {
                let mut inner = String::new();
                for next in characters.by_ref() {
                    if next == ']' {
                        break;
                    }
                    inner.push(next);
                }
                let lower = inner.to_ascii_lowercase();
                if !lower.is_empty() && lower.chars().all(|ch| matches!(ch, 'h' | 'm' | 's')) {
                    tokens.push(Raw::Elapsed(lower.chars().next().unwrap_or('h')));
                } else if let Some(symbol) = currency_in_bracket(&inner) {
                    currency = symbol;
                }
            }
            'y' | 'Y' => tokens.push(Raw::Year(run_length(character, &mut characters))),
            'm' | 'M' => tokens.push(Raw::MonthOrMinute(run_length(character, &mut characters))),
            'd' | 'D' => tokens.push(Raw::Day(run_length(character, &mut characters))),
            'h' | 'H' => tokens.push(Raw::Hour(run_length(character, &mut characters))),
            's' | 'S' => tokens.push(Raw::Second(run_length(character, &mut characters))),
            'a' | 'A' => {
                let rest: String = characters.clone().collect();
                let upper = rest.to_ascii_uppercase();
                if upper.starts_with("M/PM") {
                    for _ in 0..4 {
                        characters.next();
                    }
                    tokens.push(Raw::AmPm);
                } else if upper.starts_with("AM/PM") {
                    for _ in 0..5 {
                        characters.next();
                    }
                    tokens.push(Raw::AmPm);
                } else {
                    tokens.push(Raw::Text(character.to_string()));
                }
            }
            '0' => tokens.push(Raw::Zero),
            '#' => tokens.push(Raw::Hash),
            '?' => tokens.push(Raw::Question),
            '.' => {
                if matches!(
                    tokens.last(),
                    Some(Raw::Zero | Raw::Hash | Raw::Question)
                ) {
                    tokens.push(Raw::Decimal);
                } else {
                    tokens.push(Raw::Text(".".into()));
                }
            }
            ',' => {
                if matches!(
                    tokens.last(),
                    Some(Raw::Zero | Raw::Hash | Raw::Question | Raw::Decimal)
                ) {
                    tokens.push(Raw::Group);
                } else {
                    tokens.push(Raw::Text(",".into()));
                }
            }
            '%' => tokens.push(Raw::Percent),
            '@' => tokens.push(Raw::At),
            _ => tokens.push(Raw::Text(character.to_string())),
        }
    }

    let has_calendar = tokens.iter().any(|token| {
        matches!(
            token,
            Raw::Year(_)
                | Raw::MonthOrMinute(_)
                | Raw::Day(_)
                | Raw::Hour(_)
                | Raw::Second(_)
                | Raw::Elapsed(_)
                | Raw::AmPm
        )
    });
    if has_calendar {
        let fields = calendar_fields(&tokens);
        let has_date = fields.iter().any(|field| {
            matches!(
                field,
                Field::Year { .. } | Field::Month { .. } | Field::Day { .. } | Field::DayOfWeek { .. }
            )
        });
        return Analysis::Calendar {
            fields,
            time_only: !has_date,
            // `[h]`, `[m]` or `[s]` is the one thing an Excel code says about a
            // value running past a day, so it decides whether the ODF time
            // style may truncate at 24 hours.
            elapsed: tokens.iter().any(|token| matches!(token, Raw::Elapsed(_))),
        };
    }
    let spec = if fraction_or_scientific(&tokens) {
        None
    } else {
        number_spec(&tokens)
    };
    if tokens.iter().any(|token| matches!(token, Raw::Percent)) {
        return spec.map_or(Analysis::Unknown, Analysis::Percent);
    }
    if spec.is_none() && tokens.iter().any(|token| matches!(token, Raw::At)) {
        return Analysis::Text;
    }
    let Some(spec) = spec else {
        return Analysis::Unknown;
    };
    if currency.is_empty() {
        Analysis::Number(spec)
    } else {
        Analysis::Currency {
            symbol: currency,
            spec,
        }
    }
}

fn run_length(character: char, characters: &mut std::iter::Peekable<std::str::Chars<'_>>) -> u32 {
    let mut count = 1;
    while characters.peek().is_some_and(|next| *next == character
        || next.to_ascii_lowercase() == character.to_ascii_lowercase())
    {
        characters.next();
        count += 1;
    }
    count
}

/// The first `;`-separated section: the format Excel shows for a positive
/// number. A section list is what the shape of the value follows.
fn first_section(code: &str) -> &str {
    let mut quoted = false;
    let mut bracketed: i32 = 0;
    for (index, character) in code.char_indices() {
        match character {
            '"' => quoted = !quoted,
            '[' if !quoted => bracketed += 1,
            ']' if !quoted => bracketed = bracketed.saturating_sub(1),
            ';' if !quoted && bracketed == 0 => return &code[..index],
            _ => {}
        }
    }
    code
}

fn is_currency_text(text: &str) -> bool {
    text.chars().any(is_currency_character)
}

fn is_currency_character(character: char) -> bool {
    matches!(character, '$' | '€' | '£' | '¥' | '₩' | '₹' | '₽' | '¢')
}

/// `[$€-407]` and `[$$-409]` carry the symbol between `[` and `-`.
fn currency_in_bracket(inner: &str) -> Option<String> {
    let inner = inner.strip_prefix('$')?;
    let (symbol, _) = inner.split_once('-').unwrap_or((inner, ""));
    let symbol: String = symbol.chars().filter(|ch| !ch.is_ascii_alphabetic()).collect();
    let symbol = symbol.trim();
    if symbol.is_empty() {
        return None;
    }
    Some(symbol.to_owned())
}

/// Fractions and scientific notation have their own ODF elements; until this
/// writer emits them, the cell is better off with the plain number than with a
/// rounded one.
fn fraction_or_scientific(tokens: &[Raw]) -> bool {
    let mut previous: Option<&Raw> = None;
    for token in tokens {
        match token {
            Raw::Text(text) if text == "/" => return true,
            Raw::Text(text)
                if (text == "+" || text == "-")
                    && matches!(previous, Some(Raw::Text(exponent)) if exponent.eq_ignore_ascii_case("e")) =>
            {
                return true
            }
            _ => {}
        }
        previous = Some(token);
    }
    false
}

/// Decimals, integer padding and grouping from the digit placeholders.
fn number_spec(tokens: &[Raw]) -> Option<NumberSpec> {
    let mut decimals = 0u32;
    let mut integer_digits = 0u32;
    let mut grouping = false;
    let mut after_point = false;
    let mut seen_placeholder = false;
    for token in tokens {
        match token {
            Raw::Zero | Raw::Hash | Raw::Question => {
                seen_placeholder = true;
                if after_point {
                    decimals += 1;
                } else if matches!(token, Raw::Zero) {
                    integer_digits += 1;
                }
            }
            Raw::Decimal => after_point = true,
            Raw::Group => {
                if !after_point {
                    grouping = true;
                }
            }
            _ => {}
        }
    }
    if !seen_placeholder {
        return None;
    }
    Some(NumberSpec {
        decimals,
        min_integer_digits: integer_digits.max(1),
        grouping,
    })
}

/// Date and time fields in the code's own order, with each `m` decided between
/// month and minute.
fn calendar_fields(tokens: &[Raw]) -> Vec<Field> {
    let mut fields = Vec::new();
    for (index, token) in tokens.iter().enumerate() {
        match token {
            Raw::Year(count) => fields.push(Field::Year { long: *count >= 3 }),
            Raw::MonthOrMinute(count) => {
                if is_minute(tokens, index) {
                    fields.push(Field::Minute { long: *count >= 2 });
                } else if *count >= 3 {
                    fields.push(Field::Month {
                        long: *count >= 4,
                        textual: true,
                    });
                } else {
                    fields.push(Field::Month {
                        long: *count >= 2,
                        textual: false,
                    });
                }
            }
            Raw::Day(count) => {
                if *count >= 3 {
                    fields.push(Field::DayOfWeek { long: *count >= 4 });
                } else {
                    fields.push(Field::Day { long: *count >= 2 });
                }
            }
            Raw::Hour(count) => fields.push(Field::Hour { long: *count >= 2 }),
            Raw::Second(count) => {
                let decimals = match tokens.get(index + 1) {
                    Some(Raw::Decimal) => tokens[index + 2..]
                        .iter()
                        .take_while(|next| {
                            matches!(next, Raw::Zero | Raw::Hash | Raw::Question)
                        })
                        .count() as u32,
                    _ => 0,
                };
                fields.push(Field::Second {
                    long: *count >= 2,
                    decimals,
                });
            }
            Raw::Elapsed(unit) => match unit {
                'h' => fields.push(Field::Hour { long: true }),
                'm' => fields.push(Field::Minute { long: true }),
                _ => fields.push(Field::Second {
                    long: true,
                    decimals: 0,
                }),
            },
            Raw::AmPm => fields.push(Field::AmPm),
            Raw::Text(text) => fields.push(Field::Text(text.clone())),
            _ => {}
        }
    }
    fields
}

/// `m` is a minute when an hour came before it in the same time part, or when
/// it sits in front of `:ss`. Everything else is a month.
fn is_minute(tokens: &[Raw], index: usize) -> bool {
    let mut hour_before = false;
    let mut date_before = false;
    for token in &tokens[..index] {
        match token {
            Raw::Hour(_) | Raw::Elapsed('h') => hour_before = true,
            Raw::Year(_) | Raw::Day(_) => date_before = true,
            _ => {}
        }
    }
    if hour_before && !date_before {
        return true;
    }
    let mut next = tokens[index + 1..].iter();
    match next.next() {
        Some(Raw::Text(text)) if text == ":" => matches!(next.next(), Some(Raw::Second(_))),
        _ => false,
    }
}

fn number_style_xml(name: &str, spec: &NumberSpec, currency: Option<&str>) -> String {
    let number = number_element(spec);
    match currency {
        Some(symbol) => format!(
            r#"<number:currency-style style:name="{name}"><number:currency-symbol>{}</number:currency-symbol>{number}</number:currency-style>"#,
            escape_xml(symbol),
        ),
        None => format!(r#"<number:number-style style:name="{name}">{number}</number:number-style>"#),
    }
}

fn percentage_style_xml(name: &str, spec: &NumberSpec) -> String {
    format!(
        r#"<number:percentage-style style:name="{name}">{}<number:text>%</number:text></number:percentage-style>"#,
        number_element(spec),
    )
}

fn number_element(spec: &NumberSpec) -> String {
    format!(
        r#"<number:number number:decimal-places="{}" number:min-integer-digits="{}"{}/>"#,
        spec.decimals,
        spec.min_integer_digits,
        if spec.grouping {
            r#" number:grouping="true""#
        } else {
            ""
        },
    )
}

fn calendar_style_xml(name: &str, fields: &[Field], time_only: bool, elapsed: bool) -> String {
    let element = if time_only {
        "number:time-style"
    } else {
        "number:date-style"
    };
    // A time style truncates at a day unless told otherwise, so a duration of
    // 30 hours would read as `06:00:00`. Excel asks for the full hours with the
    // bracketed `[h]`, which reaches here as an elapsed field; a plain `h:mm`
    // clock time keeps the truncating default because Excel wraps it too.
    let truncate = if time_only && elapsed {
        r#" number:truncate-on-overflow="false""#
    } else {
        ""
    };
    let mut body = String::new();
    for field in fields {
        match field {
            Field::Year { long } => body.push_str(&empty_element(
                "number:year",
                if *long { r#" number:style="long""# } else { "" },
            )),
            Field::Month { long, textual } => body.push_str(&empty_element(
                "number:month",
                &format!(
                    "{}{}",
                    if *textual {
                        r#" number:textual="true""#
                    } else {
                        ""
                    },
                    if *long { r#" number:style="long""# } else { "" },
                ),
            )),
            Field::Day { long } => body.push_str(&empty_element(
                "number:day",
                if *long { r#" number:style="long""# } else { "" },
            )),
            Field::DayOfWeek { long } => body.push_str(&empty_element(
                "number:day-of-week",
                if *long { r#" number:style="long""# } else { "" },
            )),
            Field::Hour { long } => body.push_str(&empty_element(
                "number:hours",
                if *long { r#" number:style="long""# } else { "" },
            )),
            Field::Minute { long } => body.push_str(&empty_element(
                "number:minutes",
                if *long { r#" number:style="long""# } else { "" },
            )),
            Field::Second { long, decimals } => {
                let mut attributes = String::new();
                if *long {
                    attributes.push_str(r#" number:style="long""#);
                }
                if *decimals > 0 {
                    attributes.push_str(&format!(r#" number:decimal-places="{decimals}""#));
                }
                body.push_str(&empty_element("number:seconds", &attributes));
            }
            Field::AmPm => body.push_str("<number:am-pm/>"),
            Field::Text(text) => body.push_str(&format!(
                "<number:text>{}</number:text>",
                escape_xml(text)
            )),
        }
    }
    if body.is_empty() {
        body.push_str(r#"<number:year number:style="long"/>"#);
    }
    format!(r#"<{element} style:name="{name}"{truncate}>{body}</{element}>"#)
}

fn empty_element(name: &str, attributes: &str) -> String {
    format!("<{name}{attributes}/>")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec_of(code: &str) -> (u32, u32, bool) {
        match analyze(code) {
            Analysis::Number(spec) | Analysis::Percent(spec) => {
                (spec.decimals, spec.min_integer_digits, spec.grouping)
            }
            _ => panic!("{code} is not a plain number format"),
        }
    }

    #[test]
    fn reads_the_common_number_formats() {
        assert_eq!(spec_of("0"), (0, 1, false));
        assert_eq!(spec_of("0.00"), (2, 1, false));
        assert_eq!(spec_of("#,##0"), (0, 1, true));
        assert_eq!(spec_of("#,##0.00"), (2, 1, true));
        assert_eq!(spec_of("00000"), (0, 5, false));
        assert!(matches!(analyze("0%"), Analysis::Percent(_)));
        assert!(matches!(analyze("0.00%"), Analysis::Percent(_)));
        assert!(matches!(analyze("General"), Analysis::General));
        assert!(matches!(analyze("@"), Analysis::Text));
        assert!(matches!(analyze("# ?/?"), Analysis::Unknown));
    }

    #[test]
    fn finds_the_currency_symbol_and_its_place() {
        match analyze(r##""$"#,##0.00_);("$"#,##0.00)"##) {
            Analysis::Currency { symbol, .. } => assert_eq!(symbol, "$"),
            _ => panic!("a quoted dollar is a currency format"),
        }
        match analyze("#,##0.00 [$€-407]") {
            Analysis::Currency { symbol, .. } => assert_eq!(symbol, "€"),
            _ => panic!("a bracketed currency is a currency format"),
        }
    }

    #[test]
    fn separates_dates_times_and_minutes() {
        for (code, time_only) in [
            ("yyyy-mm-dd", false),
            ("m/d/yyyy", false),
            ("m/d/yy hh:mm", false),
            ("h:mm", true),
            ("h:mm:ss AM/PM", true),
            ("mm:ss", true),
            ("[h]:mm:ss", true),
            ("d-mmm-yy", false),
        ] {
            match analyze(code) {
                Analysis::Calendar { time_only: actual, .. } => {
                    assert_eq!(actual, time_only, "{code}")
                }
                _ => panic!("{code} is not a calendar format"),
            }
        }
    }

    #[test]
    fn a_calendar_style_spells_the_minutes_not_the_months() {
        let Analysis::Calendar { fields, .. } = analyze("hh:mm") else {
            panic!("hh:mm is a time format");
        };
        let rendered = calendar_style_xml("N1", &fields, true, false);
        assert!(rendered.contains("<number:hours"), "{rendered}");
        assert!(rendered.contains("<number:minutes"), "{rendered}");
        assert!(!rendered.contains("<number:month"), "{rendered}");
    }

    #[test]
    fn a_bracketed_hour_keeps_its_time_style_from_truncating_at_a_day() {
        let Analysis::Calendar {
            fields, elapsed, ..
        } = analyze("[h]:mm:ss")
        else {
            panic!("[h]:mm:ss is a time format");
        };
        assert!(elapsed, "the bracketed hour asks for elapsed time");
        let rendered = calendar_style_xml("N3", &fields, true, elapsed);
        assert!(
            rendered.contains(r#"number:truncate-on-overflow="false""#),
            "{rendered}"
        );

        // A plain clock time keeps the ODF default, which matches Excel's
        // `h:mm` wrapping at midnight.
        let Analysis::Calendar {
            fields, elapsed, ..
        } = analyze("h:mm")
        else {
            panic!("h:mm is a time format");
        };
        assert!(!elapsed);
        let rendered = calendar_style_xml("N4", &fields, true, elapsed);
        assert!(!rendered.contains("truncate-on-overflow"), "{rendered}");
    }

    #[test]
    fn localised_date_formats_keep_their_literals() {
        let Analysis::Calendar { fields, .. } = analyze(r#"yyyy"년" mm"월" dd"일""#) else {
            panic!("a Korean date format is a calendar format");
        };
        let rendered = calendar_style_xml("N2", &fields, false, false);
        assert!(rendered.contains("<number:text>년</number:text>"), "{rendered}");
        assert!(rendered.contains("<number:month"), "{rendered}");
    }
}
