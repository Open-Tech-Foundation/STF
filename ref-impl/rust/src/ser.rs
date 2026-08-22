//! Serialization (spec §13) and Canonical Form (spec §14).
//!
//! The contract is `parse(serialize(v)) == v`. Where a host value cannot be represented, this
//! module fails with `ERR_UNREPRESENTABLE` rather than emitting text a parser would reject.

use crate::constructors;
use crate::error::{Code, Error, Result};
use crate::value::{Document, Object, Value};

/// Output shape.
#[derive(Debug, Clone)]
pub struct Format {
    /// Indent string. `None` emits everything on one line.
    pub indent: Option<String>,
    /// Canonical Form (spec §14): sorted keys, no comments, interpreted strings, no spacing.
    pub canonical: bool,
    /// Force the interpreted form for any string containing LF or CR, so the output occupies
    /// a single line. Required by stream §3.2; off for discrete documents, where spec §8.1
    /// permits a literal line terminator inside a raw string.
    pub escape_line_terminators: bool,
}

impl Format {
    /// One line, no padding: `{a:1,b:[1,2]}`.
    pub fn compact() -> Self {
        Format { indent: None, canonical: false, escape_line_terminators: false }
    }

    /// Indented, one member per line.
    pub fn pretty(indent: &str) -> Self {
        Format {
            indent: Some(indent.to_string()),
            canonical: false,
            escape_line_terminators: false,
        }
    }

    /// Canonical Form. Implies compact output and sorted members.
    pub fn canonical() -> Self {
        Format { indent: None, canonical: true, escape_line_terminators: false }
    }

    /// Returns a copy that keeps every value on one line.
    pub fn single_line(mut self) -> Self {
        self.indent = None;
        self.escape_line_terminators = true;
        self
    }
}

impl Default for Format {
    fn default() -> Self {
        Format::pretty("  ")
    }
}

fn unrepresentable<T>(msg: impl Into<String>) -> Result<T> {
    Err(Error::detached(Code::Unrepresentable, msg))
}

/// Serializes a value. The root must be an object (spec §5).
pub fn to_string(value: &Value, format: &Format) -> Result<String> {
    let object = match value {
        Value::Object(o) => o,
        other => {
            return unrepresentable(format!(
                "an STF document root must be an object, not {}",
                other.kind()
            ))
        }
    };
    let mut out = String::new();
    write_object(object, format, 0, &mut out)?;
    Ok(out)
}

/// Serializes a document, emitting its directives before the root object.
pub fn document_to_string(doc: &Document, format: &Format) -> Result<String> {
    let mut out = String::new();
    for d in &doc.directives {
        if d.name.is_empty() || !d.name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return unrepresentable(format!("`{}` is not a valid directive name", d.name));
        }
        if d.payload.contains('(') || d.payload.contains(')') {
            return unrepresentable("a directive payload must not contain parentheses");
        }
        out.push('@');
        out.push_str(&d.name);
        out.push('(');
        out.push_str(&d.payload);
        out.push(')');
        out.push('\n');
    }
    write_object(&doc.root, format, 0, &mut out)?;
    Ok(out)
}

fn write_value(value: &Value, format: &Format, level: usize, out: &mut String) -> Result<()> {
    match value {
        Value::Null => out.push('N'),
        Value::Bool(true) => out.push('T'),
        Value::Bool(false) => out.push('F'),
        Value::Number(n) => out.push_str(&format_number(*n)?),
        Value::String(s) => write_string(s, format, out),
        Value::Array(items) => write_array(items, format, level, out)?,
        Value::Object(o) => write_object(o, format, level, out)?,
        Value::BigInt(n) => {
            out.push_str("BIGINT(");
            out.push_str(&n.to_string());
            out.push(')');
        }
        Value::Decimal(d) => {
            out.push_str("DECIMAL(");
            out.push_str(&d.payload());
            out.push(')');
        }
        Value::Date(d) => {
            out.push_str("DATE(");
            out.push_str(&d.payload());
            out.push(')');
        }
        Value::Timestamp(t) => {
            out.push_str("TIMESTAMP(");
            out.push_str(&t.payload());
            out.push(')');
        }
        Value::Binary(b) => {
            out.push_str("BINARY(");
            out.push_str(&constructors::binary_to_base64(b));
            out.push(')');
        }
        Value::Geometry(g) => {
            out.push_str("Geometry(\"");
            out.push_str(g.ty.as_str());
            out.push_str("\", ");
            out.push_str(&g.coordinates.to_string());
            out.push(')');
        }
        Value::Time(t) => {
            out.push_str("Time(\"");
            out.push_str(&t.payload());
            out.push_str("\")");
        }
        Value::Duration(d) => {
            out.push_str("Duration(\"");
            out.push_str(d.payload());
            out.push_str("\")");
        }
    }
    Ok(())
}

fn write_array(items: &[Value], format: &Format, level: usize, out: &mut String) -> Result<()> {
    if items.is_empty() {
        out.push_str("[]");
        return Ok(());
    }
    out.push('[');
    match &format.indent {
        None => {
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(item, format, level + 1, out)?;
            }
        }
        Some(indent) => {
            for item in items {
                out.push('\n');
                for _ in 0..=level {
                    out.push_str(indent);
                }
                write_value(item, format, level + 1, out)?;
                out.push(',');
            }
            out.push('\n');
            for _ in 0..level {
                out.push_str(indent);
            }
        }
    }
    out.push(']');
    Ok(())
}

fn write_object(object: &Object, format: &Format, level: usize, out: &mut String) -> Result<()> {
    // §13.6: a key outside the identifier grammar has no STF spelling.
    for key in object.keys() {
        if key.is_empty() {
            return unrepresentable("an STF key must not be empty");
        }
        if !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return unrepresentable(format!(
                "key `{}` is not a valid STF identifier ([A-Za-z0-9_-]+)",
                key
            ));
        }
    }

    if object.is_empty() {
        out.push_str("{}");
        return Ok(());
    }

    // §14 rule 5: canonical output orders members by ascending UTF-8 key bytes.
    let mut members: Vec<(&str, &Value)> = object.iter().collect();
    if format.canonical {
        members.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    }

    out.push('{');
    match &format.indent {
        None => {
            for (i, (key, value)) in members.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(key);
                out.push(':');
                write_value(value, format, level + 1, out)?;
            }
        }
        Some(indent) => {
            for (key, value) in members {
                out.push('\n');
                for _ in 0..=level {
                    out.push_str(indent);
                }
                out.push_str(key);
                out.push_str(": ");
                write_value(value, format, level + 1, out)?;
                out.push(',');
            }
            out.push('\n');
            for _ in 0..level {
                out.push_str(indent);
            }
        }
    }
    out.push('}');
    Ok(())
}

/// §13.3: prefer the raw form, but a backtick has no raw escape. §14 rule 6 forces the
/// interpreted form for canonical output.
fn write_string(s: &str, format: &Format, out: &mut String) {
    let needs_interpreted = format.canonical
        || s.contains('`')
        || s.bytes().any(|b| b < 0x20 && b != b'\n' && b != b'\r' && b != b'\t')
        || (format.escape_line_terminators && s.bytes().any(|b| b == b'\n' || b == b'\r'));
    if !needs_interpreted {
        out.push('`');
        out.push_str(s);
        out.push('`');
        return;
    }
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04X}", c as u32)),
            // §13.5: non-ASCII scalars are emitted literally as UTF-8.
            c => out.push(c),
        }
    }
    out.push('"');
}

/// §13.4: shortest decimal form that parses back to the identical `binary64`.
///
/// Rust's `Display` and `LowerExp` for `f64` both emit shortest round-trip digits; `Display`
/// never uses exponent notation, so the shorter of the two is taken. Both spellings are within
/// the §7.1 number grammar.
pub fn format_number(n: f64) -> Result<String> {
    if n.is_nan() {
        return unrepresentable("NaN is not an STF Number");
    }
    if n.is_infinite() {
        return unrepresentable("an infinity is not an STF Number");
    }
    if n == 0.0 {
        return Ok(if n.is_sign_negative() { "-0".to_string() } else { "0".to_string() });
    }
    let plain = format!("{}", n);
    let exp = format!("{:e}", n);
    Ok(if exp.len() < plain.len() { exp } else { plain })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse;

    fn canon(input: &str) -> String {
        to_string(&parse(input).unwrap(), &Format::canonical()).unwrap()
    }

    #[test]
    fn canonical_sorts_by_utf8_key_bytes() {
        assert_eq!(canon("{b: 2, a: 1, c: 3}"), "{a:1,b:2,c:3}");
        assert_eq!(canon("{a: 1, B: 2}"), "{B:2,a:1}");
    }

    #[test]
    fn canonical_strips_comments_and_trailing_commas() {
        assert_eq!(canon("# lead\n{a: 1} # trail"), "{a:1}");
        assert_eq!(canon("{a: 1,}"), "{a:1}");
    }

    #[test]
    fn canonical_uses_interpreted_strings() {
        assert_eq!(canon("{a: `hi`}"), "{a:\"hi\"}");
    }

    #[test]
    fn canonical_preserves_decimal_scale() {
        assert_eq!(canon("{a: DECIMAL(1.50)}"), "{a:DECIMAL(1.50)}");
    }

    #[test]
    fn canonical_does_not_reorder_arrays() {
        assert_eq!(canon("{b: {d: 1, c: 2}, a: [3, 1]}"), "{a:[3,1],b:{c:2,d:1}}");
    }

    #[test]
    fn default_serialization_preserves_authored_order() {
        let v = parse("{b: 1, a: 2}").unwrap();
        assert_eq!(to_string(&v, &Format::compact()).unwrap(), "{b:1,a:2}");
    }

    #[test]
    fn negative_zero_survives_a_round_trip() {
        let v = parse("{a: -0}").unwrap();
        let text = to_string(&v, &Format::compact()).unwrap();
        assert_eq!(text, "{a:-0}");
        assert_eq!(parse(&text).unwrap(), v);
    }

    #[test]
    fn strings_are_never_promoted_to_constructors() {
        // §13.2: the content of a String must not influence the emitted form.
        let v = parse("{a: `DECIMAL(1.5)`, b: `2026-01-15`, c: `$decimal:abc`}").unwrap();
        let text = to_string(&v, &Format::compact()).unwrap();
        assert_eq!(text, "{a:`DECIMAL(1.5)`,b:`2026-01-15`,c:`$decimal:abc`}");
        assert_eq!(parse(&text).unwrap(), v);
    }

    #[test]
    fn backtick_forces_the_interpreted_form() {
        let v = parse("{a: \"x`y\"}").unwrap();
        let text = to_string(&v, &Format::compact()).unwrap();
        assert_eq!(text, "{a:\"x`y\"}");
        assert_eq!(parse(&text).unwrap(), v);
    }

    #[test]
    fn invalid_keys_fail_rather_than_emit_bad_output() {
        let mut o = Object::new();
        o.insert("a.b", Value::Null);
        let err = to_string(&Value::Object(o), &Format::compact()).unwrap_err();
        assert_eq!(err.code, Code::Unrepresentable);
    }

    #[test]
    fn non_finite_numbers_fail() {
        let mut o = Object::new();
        o.insert("a", Value::Number(f64::INFINITY));
        assert_eq!(
            to_string(&Value::Object(o), &Format::compact()).unwrap_err().code,
            Code::Unrepresentable
        );
    }

    #[test]
    fn numbers_use_the_shortest_round_tripping_form() {
        assert_eq!(format_number(1.0).unwrap(), "1");
        assert_eq!(format_number(-0.0).unwrap(), "-0");
        assert_eq!(format_number(0.0).unwrap(), "0");
        assert_eq!(format_number(1e300).unwrap(), "1e300");
        assert_eq!(format_number(3.14).unwrap(), "3.14");
        // Every spelling must parse back to the same bits.
        for n in [1.0, -0.0, 1e300, 3.14, 9007199254740992.0, 1e-320, 2.5e-3] {
            let text = format_number(n).unwrap();
            let doc = format!("{{a:{}}}", text);
            let back = parse(&doc).unwrap();
            assert_eq!(back.as_object().unwrap().get("a"), Some(&Value::Number(n)), "{}", text);
        }
    }

    #[test]
    fn pretty_output_round_trips() {
        let v = parse("{a: 1, b: [1, 2, {c: `x`}], d: {}}").unwrap();
        let text = to_string(&v, &Format::pretty("  ")).unwrap();
        assert_eq!(parse(&text).unwrap(), v);
        assert!(text.contains('\n'));
    }
}
