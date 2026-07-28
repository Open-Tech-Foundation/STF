//! The STF 1.0 parser.
//!
//! Byte-oriented over a `&str`, so the UTF-8 well-formedness required by spec §2 is either
//! guaranteed by the caller's type or checked once in [`crate::parse_bytes`].

use crate::constructors;
use crate::error::{Code, Error, Result};
use crate::value::{Directive, Document, Object, Value};

/// Spec §11.3. The default MUST be 64 so a document accepted by one conformant parser is
/// accepted by all.
pub const DEFAULT_MAX_DEPTH: usize = 64;

/// Optional resource limits (spec §15). `None` means unlimited, which is the specified
/// default for the two optional limits.
#[derive(Debug, Clone)]
pub struct Limits {
    pub max_depth: usize,
    pub max_document_bytes: Option<usize>,
    pub max_payload_bytes: Option<usize>,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_depth: DEFAULT_MAX_DEPTH,
            max_document_bytes: None,
            max_payload_bytes: None,
        }
    }
}

/// How the parser frames its input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    /// A discrete `.stf` document (spec §5).
    Document,
    /// One record of an STF Stream. Directives are rejected and an unterminated string is
    /// attributed to a raw line terminator when one actually follows (stream §3.2).
    StreamRecord { newline_follows: bool },
}

/// Byte offsets of the source text a value or directive was parsed from.
///
/// Positions are not part of the data model (spec §3), so recording them is opt-in: the
/// parser collects nothing unless asked. Tools that report on source — the linter and the
/// language server — need them; a plain `parse` does not pay for them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Spans {
    /// One `[start, end)` byte range per value, in document (pre-order) order — the order a
    /// pre-order walk of the parsed tree visits them, so the two can be zipped.
    pub values: Vec<(usize, usize)>,
    /// One `[start, end)` byte range per directive, in source order.
    pub directives: Vec<(usize, usize)>,
}

pub(crate) struct Parser<'a> {
    src: &'a str,
    bytes: &'a [u8],
    pos: usize,
    depth: usize,
    limits: Limits,
    mode: Mode,
    /// `Some` once span recording is switched on by [`Parser::recording_spans`].
    spans: Option<Spans>,
}

#[inline]
fn is_ident_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

impl<'a> Parser<'a> {
    pub(crate) fn new(src: &'a str, limits: Limits, mode: Mode) -> Self {
        Parser { src, bytes: src.as_bytes(), pos: 0, depth: 0, limits, mode, spans: None }
    }

    /// Switches on span recording. See [`Spans`].
    pub(crate) fn recording_spans(mut self) -> Self {
        self.spans = Some(Spans::default());
        self
    }

    /// Takes the recorded spans, if recording was switched on.
    pub(crate) fn take_spans(&mut self) -> Option<Spans> {
        self.spans.take()
    }

    /// Reserves a slot in pre-order and returns its index, or `None` when not recording.
    ///
    /// The slot is reserved *before* the value's children are parsed so that the recorded
    /// order matches a pre-order walk of the finished tree; [`Parser::close_value`] fills in
    /// the end offset once the extent is known.
    #[inline]
    fn open_value(&mut self, start: usize) -> Option<usize> {
        let spans = self.spans.as_mut()?;
        spans.values.push((start, start));
        Some(spans.values.len() - 1)
    }

    #[inline]
    fn close_value(&mut self, slot: Option<usize>, start: usize) {
        if let (Some(slot), Some(spans)) = (slot, self.spans.as_mut()) {
            spans.values[slot] = (start, self.pos);
        }
    }

    fn err<T>(&self, code: Code, offset: usize, msg: impl Into<String>) -> Result<T> {
        Err(Error::at(code, self.src, offset, msg))
    }

    #[inline]
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    #[inline]
    fn peek_at(&self, n: usize) -> Option<u8> {
        self.bytes.get(self.pos + n).copied()
    }

    /// Skips whitespace and comments (spec §4). A comment ends at LF *or* CR.
    fn skip_ws(&mut self) {
        while let Some(b) = self.peek() {
            match b {
                b' ' | b'\t' | b'\n' | b'\r' => self.pos += 1,
                b'#' => {
                    self.pos += 1;
                    while let Some(c) = self.peek() {
                        if c == b'\n' || c == b'\r' {
                            break;
                        }
                        self.pos += 1;
                    }
                }
                _ => break,
            }
        }
    }

    /// Parses a whole document: directives, one root object, then end of input.
    pub(crate) fn parse_document(&mut self) -> Result<Document> {
        if let Some(max) = self.limits.max_document_bytes {
            if self.src.len() > max {
                return self.err(
                    Code::DocumentSize,
                    0,
                    format!("document is {} bytes, limit is {}", self.src.len(), max),
                );
            }
        }

        // A BOM is not whitespace (spec §2) and must not be mistaken for a missing root.
        if self.bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            return self.err(Code::Syntax, 0, "leading byte order mark");
        }

        let mut directives: Vec<Directive> = Vec::new();
        self.skip_ws();
        while self.peek() == Some(b'@') {
            let at = self.pos;
            let d = self.parse_directive()?;
            if let Some(spans) = self.spans.as_mut() {
                spans.directives.push((at, self.pos));
            }
            if directives.iter().any(|e| e.name == d.name) {
                return self.err(
                    Code::Syntax,
                    self.pos,
                    format!("directive `@{}` appears more than once", d.name),
                );
            }
            directives.push(d);
            self.skip_ws();
        }

        if self.peek() != Some(b'{') {
            let what = match self.peek() {
                None => "document contains no root object".to_string(),
                Some(_) => "document root must be an object".to_string(),
            };
            return self.err(Code::RootNotObject, self.pos, what);
        }

        // The root is parsed directly rather than through `parse_value`, so its span is
        // reserved here to keep it first in pre-order.
        let root_at = self.pos;
        let slot = self.open_value(root_at);
        let root = self.parse_object()?;
        self.close_value(slot, root_at);
        self.skip_ws();
        if self.pos < self.bytes.len() {
            return self.err(Code::TrailingContent, self.pos, "content follows the root object");
        }
        Ok(Document { directives, root })
    }

    /// `@name(payload)` with no whitespace around `@` or before `(` (spec §5.1).
    fn parse_directive(&mut self) -> Result<Directive> {
        let at = self.pos;
        if self.mode != Mode::Document {
            return self.err(
                Code::StreamDirectiveInRecord,
                at,
                "a stream record must not contain a directive",
            );
        }
        self.pos += 1; // '@'
        let name_start = self.pos;
        while matches!(self.peek(), Some(b) if is_ident_byte(b)) {
            self.pos += 1;
        }
        if self.pos == name_start {
            return self.err(Code::Syntax, self.pos, "directive name is empty");
        }
        let name = self.src[name_start..self.pos].to_string();
        if self.peek() != Some(b'(') {
            return self.err(
                Code::Syntax,
                self.pos,
                "expected `(` immediately after the directive name",
            );
        }
        self.pos += 1;
        let payload_start = self.pos;
        loop {
            match self.peek() {
                None => return self.err(Code::Unterminated, self.pos, "unterminated directive"),
                Some(b')') => break,
                Some(b'(') => {
                    return self.err(
                        Code::NestedConstructor,
                        self.pos,
                        "`(` inside a directive payload",
                    )
                }
                Some(_) => self.pos += 1,
            }
        }
        let payload = self.src[payload_start..self.pos].to_string();
        self.pos += 1; // ')'
        Ok(Directive { name, payload })
    }

    fn enter(&mut self, at: usize) -> Result<()> {
        self.depth += 1;
        if self.depth > self.limits.max_depth {
            return self.err(
                Code::NestingDepth,
                at,
                format!("nesting exceeds the maximum depth of {}", self.limits.max_depth),
            );
        }
        Ok(())
    }

    fn parse_object(&mut self) -> Result<Object> {
        let open = self.pos;
        self.pos += 1; // '{'
        self.enter(open)?;
        let mut object = Object::new();

        self.skip_ws();
        if self.peek() == Some(b',') {
            return self.err(Code::MissingComma, self.pos, "leading comma");
        }
        while self.peek() != Some(b'}') {
            if self.peek().is_none() {
                return self.err(Code::Unterminated, self.pos, "unterminated object");
            }

            let key_at = self.pos;
            let key = self.parse_key()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                // `{a b: 1}` is a key containing whitespace (§6.2), while `{a 1}` is a
                // missing colon (error-codes §2.2). They differ only in what follows, so
                // the choice of code needs this bounded lookahead.
                if self.looks_like_split_key() {
                    return self.err(
                        Code::InvalidIdentifier,
                        self.pos,
                        "whitespace is not permitted within a key",
                    );
                }
                return self.err(Code::MissingColon, self.pos, "expected `:` after the key");
            }
            self.pos += 1;

            let value = self.parse_value()?;
            if object.contains_key(&key) {
                return self.err(Code::DuplicateKey, key_at, format!("duplicate key `{}`", key));
            }
            object.insert(key, value);

            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                    self.skip_ws();
                    if self.peek() == Some(b',') {
                        return self.err(Code::MissingComma, self.pos, "consecutive commas");
                    }
                }
                Some(b'}') => break,
                None => return self.err(Code::Unterminated, self.pos, "unterminated object"),
                Some(_) => {
                    return self.err(Code::MissingComma, self.pos, "expected `,` between members")
                }
            }
        }
        self.pos += 1; // '}'
        self.depth -= 1;
        Ok(object)
    }

    fn parse_array(&mut self) -> Result<Vec<Value>> {
        let open = self.pos;
        self.pos += 1; // '['
        self.enter(open)?;
        let mut items = Vec::new();

        self.skip_ws();
        if self.peek() == Some(b',') {
            return self.err(Code::MissingComma, self.pos, "leading comma");
        }
        while self.peek() != Some(b']') {
            if self.peek().is_none() {
                return self.err(Code::Unterminated, self.pos, "unterminated array");
            }
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                    self.skip_ws();
                    if self.peek() == Some(b',') {
                        return self.err(Code::MissingComma, self.pos, "consecutive commas");
                    }
                }
                Some(b']') => break,
                None => return self.err(Code::Unterminated, self.pos, "unterminated array"),
                Some(_) => {
                    return self.err(Code::MissingComma, self.pos, "expected `,` between elements")
                }
            }
        }
        self.pos += 1; // ']'
        self.depth -= 1;
        Ok(items)
    }

    /// Keys are unquoted identifiers (spec §6.1). A quoted key is `ERR_SYNTAX`; anything else
    /// outside the identifier set is `ERR_INVALID_IDENTIFIER`.
    fn parse_key(&mut self) -> Result<String> {
        match self.peek() {
            Some(b'"') | Some(b'`') => {
                return self.err(Code::Syntax, self.pos, "keys must not be quoted")
            }
            _ => {}
        }
        let start = self.pos;
        while matches!(self.peek(), Some(b) if is_ident_byte(b)) {
            self.pos += 1;
        }
        if self.pos == start {
            return self.err(
                Code::InvalidIdentifier,
                start,
                "expected a key matching [A-Za-z0-9_-]+",
            );
        }
        // A character that is neither whitespace, a comment, nor `:` directly after the
        // identifier is a bad key character (`a.b`), not a missing colon.
        if let Some(b) = self.peek() {
            if !matches!(b, b' ' | b'\t' | b'\n' | b'\r' | b'#' | b':') {
                return self.err(
                    Code::InvalidIdentifier,
                    self.pos,
                    "character is not permitted in a key",
                );
            }
        }
        Ok(self.src[start..self.pos].to_string())
    }

    /// True when the text at the cursor is a second identifier that is itself followed by
    /// `:` — that is, the author wrote one key with whitespace inside it.
    fn looks_like_split_key(&self) -> bool {
        let mut i = self.pos;
        let start = i;
        while matches!(self.bytes.get(i), Some(b) if is_ident_byte(*b)) {
            i += 1;
        }
        if i == start {
            return false;
        }
        while matches!(self.bytes.get(i), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            i += 1;
        }
        self.bytes.get(i) == Some(&b':')
    }

    fn parse_value(&mut self) -> Result<Value> {
        self.skip_ws();
        let b = match self.peek() {
            Some(b) => b,
            None => return self.err(Code::Unterminated, self.pos, "expected a value"),
        };
        let start = self.pos;
        let slot = self.open_value(start);
        let value = match b {
            b'{' => Ok(Value::Object(self.parse_object()?)),
            b'[' => Ok(Value::Array(self.parse_array()?)),
            b'`' => Ok(Value::String(self.parse_raw_string()?)),
            b'"' => Ok(Value::String(self.parse_interpreted_string()?)),
            // `+` and `.` cannot start a valid number, but dispatching them here reports the
            // specific ERR_INVALID_NUMBER that §7.1 requires rather than generic syntax.
            b'+' | b'-' | b'.' | b'0'..=b'9' => Ok(Value::Number(self.parse_number()?)),
            b'A'..=b'Z' | b'a'..=b'z' | b'_' => self.parse_word(),
            _ => self.err(Code::Syntax, self.pos, "expected a value"),
        }?;
        self.close_value(slot, start);
        Ok(value)
    }

    /// A bare word in value position: a `T`/`F`/`N` literal, or a constructor when `(` follows.
    fn parse_word(&mut self) -> Result<Value> {
        let start = self.pos;
        while matches!(self.peek(), Some(b) if is_ident_byte(b)) {
            self.pos += 1;
        }
        let word = &self.src[start..self.pos];

        if self.peek() != Some(b'(') {
            // Scanning greedily is what enforces the §7.4 boundary rule: `NaN` never reaches
            // this point as `N` followed by `aN`.
            return match word {
                "T" => Ok(Value::Bool(true)),
                "F" => Ok(Value::Bool(false)),
                "N" => Ok(Value::Null),
                _ => self.err(
                    Code::Syntax,
                    start,
                    format!("`{}` is not a value; literals are `T`, `F`, and `N`", word),
                ),
            };
        }

        if !constructors::is_known(word) {
            let code = if constructors::is_reserved(word) {
                Code::UnknownConstructor
            } else {
                Code::Syntax
            };
            let msg = if code == Code::UnknownConstructor {
                format!("`{}` is not an STF 1.0 constructor", word)
            } else {
                format!("`{}` is not valid in value position", word)
            };
            return self.err(code, start, msg);
        }

        let name = word.to_string();
        self.pos += 1; // '('
        let payload_start = self.pos;
        loop {
            match self.peek() {
                None => {
                    return self.err(Code::Unterminated, self.pos, "unterminated constructor")
                }
                Some(b')') => break,
                Some(b'(') => {
                    return self.err(
                        Code::NestedConstructor,
                        self.pos,
                        "`(` inside a constructor payload",
                    )
                }
                Some(_) => self.pos += 1,
            }
        }
        let payload = &self.src[payload_start..self.pos];
        if let Some(max) = self.limits.max_payload_bytes {
            if payload.len() > max {
                return self.err(
                    Code::PayloadSize,
                    payload_start,
                    format!("payload is {} bytes, limit is {}", payload.len(), max),
                );
            }
        }
        let value = constructors::build(&name, payload)
            .map_err(|(code, msg)| Error::at(code, self.src, payload_start, msg))?;
        self.pos += 1; // ')'
        Ok(value)
    }

    /// Spec §8.1. No escape processing; a backtick cannot appear inside.
    fn parse_raw_string(&mut self) -> Result<String> {
        let open = self.pos;
        self.pos += 1;
        let start = self.pos;
        while let Some(b) = self.peek() {
            if b == b'`' {
                let s = self.src[start..self.pos].to_string();
                self.pos += 1;
                return Ok(s);
            }
            self.pos += 1;
        }
        Err(self.unterminated_string(open, "unterminated raw string"))
    }

    /// Spec §8.2 and §8.3. The JSON escape set exactly, with surrogate pairing enforced.
    fn parse_interpreted_string(&mut self) -> Result<String> {
        let open = self.pos;
        self.pos += 1;
        let mut out = String::new();
        loop {
            let b = match self.peek() {
                Some(b) => b,
                None => {
                    return Err(
                        self.unterminated_string(open, "unterminated interpreted string")
                    )
                }
            };
            match b {
                b'"' => {
                    self.pos += 1;
                    return Ok(out);
                }
                b'\n' | b'\r' => {
                    return self.err(
                        Code::InvalidString,
                        self.pos,
                        "literal line terminator in an interpreted string",
                    )
                }
                b'\\' => {
                    self.pos += 1;
                    let esc = match self.peek() {
                        Some(e) => e,
                        None => {
                            return Err(self
                                .unterminated_string(open, "unterminated interpreted string"))
                        }
                    };
                    self.pos += 1;
                    match esc {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{0008}'),
                        b'f' => out.push('\u{000C}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let at = self.pos - 2;
                            let unit = self.parse_hex4(at)?;
                            if (0xD800..=0xDBFF).contains(&unit) {
                                if self.peek() != Some(b'\\') || self.peek_at(1) != Some(b'u') {
                                    return self.err(
                                        Code::InvalidString,
                                        at,
                                        "high surrogate is not followed by a low surrogate",
                                    );
                                }
                                self.pos += 2;
                                let low = self.parse_hex4(at)?;
                                if !(0xDC00..=0xDFFF).contains(&low) {
                                    return self.err(
                                        Code::InvalidString,
                                        at,
                                        "high surrogate is not followed by a low surrogate",
                                    );
                                }
                                let scalar = 0x10000
                                    + ((unit - 0xD800) << 10)
                                    + (low - 0xDC00);
                                // Always in range: the arithmetic yields U+10000..=U+10FFFF.
                                out.push(char::from_u32(scalar).unwrap());
                            } else if (0xDC00..=0xDFFF).contains(&unit) {
                                return self.err(
                                    Code::InvalidString,
                                    at,
                                    "lone low surrogate",
                                );
                            } else {
                                // Non-surrogate BMP scalars are always valid characters.
                                out.push(char::from_u32(unit).unwrap());
                            }
                        }
                        _ => {
                            return self.err(
                                Code::InvalidString,
                                self.pos - 2,
                                "unrecognized escape sequence",
                            )
                        }
                    }
                }
                _ => {
                    // Copy one whole scalar; the input is known to be valid UTF-8.
                    let ch = self.src[self.pos..].chars().next().unwrap();
                    out.push(ch);
                    self.pos += ch.len_utf8();
                }
            }
        }
    }

    fn parse_hex4(&mut self, at: usize) -> Result<u32> {
        if self.pos + 4 > self.bytes.len() {
            return self.err(Code::InvalidString, at, "`\\u` needs four hex digits");
        }
        let mut value = 0u32;
        for i in 0..4 {
            let b = self.bytes[self.pos + i];
            let digit = match b {
                b'0'..=b'9' => (b - b'0') as u32,
                b'a'..=b'f' => (b - b'a') as u32 + 10,
                b'A'..=b'F' => (b - b'A') as u32 + 10,
                _ => return self.err(Code::InvalidString, at, "`\\u` needs four hex digits"),
            };
            value = value * 16 + digit;
        }
        self.pos += 4;
        Ok(value)
    }

    /// In a stream record, a string left open at end of line is a raw line terminator inside
    /// a string (stream §3.2) — but only when a line terminator actually follows.
    fn unterminated_string(&self, at: usize, msg: &str) -> Error {
        if let Mode::StreamRecord { newline_follows: true } = self.mode {
            return Error::at(
                Code::StreamRawNewline,
                self.src,
                at,
                "a stream record must not contain a raw line terminator",
            );
        }
        Error::at(Code::Unterminated, self.src, at, msg)
    }

    /// Spec §7. Grammar, then the §7.4 boundary rule, then the `binary64` conversion.
    fn parse_number(&mut self) -> Result<f64> {
        let start = self.pos;
        if self.peek() == Some(b'+') {
            return self.err(Code::InvalidNumber, start, "leading `+` is not permitted");
        }
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.pos += 1;
                }
            }
            _ => return self.err(Code::InvalidNumber, start, "number has no integer part"),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return self.err(Code::InvalidNumber, self.pos, "fraction has no digits");
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some(b'e') | Some(b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+') | Some(b'-')) {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return self.err(Code::InvalidNumber, self.pos, "exponent has no digits");
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        // §7.4: this is what rejects `0x10`, `1_000`, `0123`, and `1.2.3` at the offending
        // character instead of letting a prefix parse as a complete value.
        if let Some(b) = self.peek() {
            if is_ident_byte(b) || b == b'.' {
                return self.err(
                    Code::InvalidNumber,
                    self.pos,
                    "number is immediately followed by an identifier character",
                );
            }
        }
        let text = &self.src[start..self.pos];
        // The grammar above is a subset of Rust's float grammar, so this cannot fail.
        let n: f64 = text.parse().unwrap();
        if !n.is_finite() {
            return self.err(
                Code::NumberOverflow,
                start,
                "magnitude exceeds the finite binary64 range",
            );
        }
        Ok(n)
    }

    /// Parses one stream record: a root object with no directives, then end of line.
    pub(crate) fn parse_record(&mut self) -> Result<Object> {
        self.skip_ws();
        if self.peek() == Some(b'@') {
            // Reported by parse_directive, which knows the mode.
            self.parse_directive()?;
            unreachable!("parse_directive rejects every directive in stream mode");
        }
        if self.peek() != Some(b'{') {
            return self.err(Code::RootNotObject, self.pos, "a record root must be an object");
        }
        let root_at = self.pos;
        let slot = self.open_value(root_at);
        let root = self.parse_object()?;
        self.close_value(slot, root_at);
        self.skip_ws();
        if self.pos < self.bytes.len() {
            return self.err(Code::TrailingContent, self.pos, "content follows the record");
        }
        Ok(root)
    }

    /// Parses a stream header line: one or more directives and nothing else.
    pub(crate) fn parse_header_line(&mut self) -> Result<Vec<Directive>> {
        let mut out: Vec<Directive> = Vec::new();
        self.skip_ws();
        while self.peek() == Some(b'@') {
            // The header is parsed in Document mode so directives are permitted here.
            let d = self.parse_directive()?;
            if out.iter().any(|e| e.name == d.name) {
                return self.err(
                    Code::Syntax,
                    self.pos,
                    format!("directive `@{}` appears more than once", d.name),
                );
            }
            out.push(d);
            self.skip_ws();
        }
        if self.pos < self.bytes.len() {
            return self.err(
                Code::StreamDirectiveInRecord,
                self.pos,
                "a header line must contain only directives",
            );
        }
        Ok(out)
    }
}
