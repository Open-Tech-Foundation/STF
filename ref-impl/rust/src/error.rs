//! Error codes and error values.
//!
//! Every rejection required by [STF 1.0](../../../doc/spec.md) maps to exactly one
//! [`Code`], as defined by the normative condition -> code table in
//! [error-codes.md](../../../doc/error-codes.md). Reporting a related-but-different code is
//! non-conformant, so this module exists to make the mapping explicit and testable.

use std::fmt;

/// A normative STF error code.
///
/// The string form returned by [`Code::as_str`] is the code as it appears in the
/// specification, and is what conformance runners compare against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Code {
    // Encoding
    InvalidUtf8,
    // General syntax
    Syntax,
    Unterminated,
    TrailingContent,
    // Structure
    RootNotObject,
    DuplicateKey,
    MissingColon,
    MissingComma,
    // Identifiers
    InvalidIdentifier,
    // Primitive values
    InvalidNumber,
    NumberOverflow,
    InvalidString,
    // Constructors
    UnknownConstructor,
    InvalidConstructorPayload,
    NestedConstructor,
    DecimalOverflow,
    // Resource limits
    NestingDepth,
    DocumentSize,
    PayloadSize,
    // Serialization
    Unrepresentable,
    // Stream profile
    StreamRawNewline,
    StreamDirectiveInRecord,
}

impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Code::InvalidUtf8 => "ERR_INVALID_UTF8",
            Code::Syntax => "ERR_SYNTAX",
            Code::Unterminated => "ERR_UNTERMINATED",
            Code::TrailingContent => "ERR_TRAILING_CONTENT",
            Code::RootNotObject => "ERR_ROOT_NOT_OBJECT",
            Code::DuplicateKey => "ERR_DUPLICATE_KEY",
            Code::MissingColon => "ERR_MISSING_COLON",
            Code::MissingComma => "ERR_MISSING_COMMA",
            Code::InvalidIdentifier => "ERR_INVALID_IDENTIFIER",
            Code::InvalidNumber => "ERR_INVALID_NUMBER",
            Code::NumberOverflow => "ERR_NUMBER_OVERFLOW",
            Code::InvalidString => "ERR_INVALID_STRING",
            Code::UnknownConstructor => "ERR_UNKNOWN_CONSTRUCTOR",
            Code::InvalidConstructorPayload => "ERR_INVALID_CONSTRUCTOR_PAYLOAD",
            Code::NestedConstructor => "ERR_NESTED_CONSTRUCTOR",
            Code::DecimalOverflow => "ERR_DECIMAL_OVERFLOW",
            Code::NestingDepth => "ERR_NESTING_DEPTH",
            Code::DocumentSize => "ERR_DOCUMENT_SIZE",
            Code::PayloadSize => "ERR_PAYLOAD_SIZE",
            Code::Unrepresentable => "ERR_UNREPRESENTABLE",
            Code::StreamRawNewline => "ERR_STREAM_RAW_NEWLINE",
            Code::StreamDirectiveInRecord => "ERR_STREAM_DIRECTIVE_IN_RECORD",
        }
    }
}

impl fmt::Display for Code {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A rejection, carrying the normative code plus non-normative position and message.
///
/// Only [`Error::code`] is normative; spec §16 explicitly states that message text is not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub code: Code,
    /// Byte offset into the input where the problem was detected.
    pub offset: usize,
    /// 1-based line number.
    pub line: usize,
    /// 1-based column, counted in Unicode scalar values.
    pub column: usize,
    /// Human-readable explanation. Not normative.
    pub message: String,
}

impl Error {
    /// Builds an error whose position is resolved against `input`.
    pub fn at(code: Code, input: &str, offset: usize, message: impl Into<String>) -> Self {
        let (line, column) = line_column(input, offset);
        Error { code, offset, line, column, message: message.into() }
    }

    /// Builds an error with no meaningful input position (serialization, stream framing).
    pub fn detached(code: Code, message: impl Into<String>) -> Self {
        Error { code, offset: 0, line: 0, column: 0, message: message.into() }
    }

    /// Returns a copy re-anchored to `line`, for the stream profile, which numbers lines
    /// across the whole input rather than within a single record (stream §2.1).
    pub fn with_line(mut self, line: usize) -> Self {
        self.line = line;
        self
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.line > 0 {
            write!(f, "{} at {}:{}: {}", self.code, self.line, self.column, self.message)
        } else {
            write!(f, "{}: {}", self.code, self.message)
        }
    }
}

impl std::error::Error for Error {}

/// Resolves a byte offset to a 1-based line and column, counting columns in scalar values.
fn line_column(input: &str, offset: usize) -> (usize, usize) {
    let offset = offset.min(input.len());
    let mut line = 1;
    let mut line_start = 0;
    for (i, b) in input.as_bytes()[..offset].iter().enumerate() {
        if *b == b'\n' {
            line += 1;
            line_start = i + 1;
        }
    }
    let column = input[line_start..offset].chars().count() + 1;
    (line, column)
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_render_as_specified() {
        assert_eq!(Code::InvalidConstructorPayload.as_str(), "ERR_INVALID_CONSTRUCTOR_PAYLOAD");
        assert_eq!(Code::StreamRawNewline.as_str(), "ERR_STREAM_RAW_NEWLINE");
    }

    #[test]
    fn line_column_is_one_based() {
        assert_eq!(line_column("abc", 0), (1, 1));
        assert_eq!(line_column("abc", 2), (1, 3));
        assert_eq!(line_column("a\nbc", 2), (2, 1));
        assert_eq!(line_column("a\nbc", 4), (2, 3));
    }

    #[test]
    fn column_counts_scalars_not_bytes() {
        // "e" plus a 4-byte emoji, then the offset of the following byte.
        let s = "e\u{1F600}x";
        assert_eq!(line_column(s, 5), (1, 3));
    }
}
