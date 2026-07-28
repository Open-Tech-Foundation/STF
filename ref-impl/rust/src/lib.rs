//! Reference implementation of **STF 1.0** — the Structured Text Format.
//!
//! The normative documents are [`doc/spec.md`](../../../doc/spec.md) and
//! [`doc/error-codes.md`](../../../doc/error-codes.md); section references throughout this
//! crate point at them. The executable contract is the corpus under
//! [`tests/conformance/`](../../../tests/conformance/), run by the `stf-conformance` binary.
//!
//! ```
//! use stf::{parse, to_string, Format, Value};
//!
//! let value = parse("{ price: DECIMAL(19.99), tags: [`a`, `b`] }")?;
//! let object = value.as_object().unwrap();
//! assert_eq!(object.get("price").unwrap().kind(), stf::Kind::Decimal);
//! assert_eq!(to_string(&value, &Format::canonical())?, "{price:DECIMAL(19.99),tags:[\"a\",\"b\"]}");
//! # Ok::<(), stf::Error>(())
//! ```

pub mod constructors;
pub mod error;
pub mod json;
pub mod lint;
pub mod lsp;
mod parser;
pub mod ser;
pub mod stream;
pub mod value;

pub use error::{Code, Error, Result};
pub use parser::{Limits, Spans, DEFAULT_MAX_DEPTH};
pub use ser::{document_to_string, to_string, Format};
pub use stream::{parse_stream, Record, Stream, StreamReader};
pub use value::{
    Date, Decimal, Directive, Document, Kind, Object, Offset, Timestamp, Value,
};

use parser::{Mode, Parser};

/// Parses a document and returns its root object as a [`Value::Object`].
pub fn parse(input: &str) -> Result<Value> {
    parse_document(input).map(|d| Value::Object(d.root))
}

/// Parses a document, keeping its directives (spec §5.1), which are metadata rather than data.
pub fn parse_document(input: &str) -> Result<Document> {
    Parser::new(input, Limits::default(), Mode::Document).parse_document()
}

/// Parses with explicit resource limits (spec §15).
pub fn parse_with_limits(input: &str, limits: Limits) -> Result<Document> {
    Parser::new(input, limits, Mode::Document).parse_document()
}

/// Parses a document and records where each value and directive came from in the source.
///
/// For tools that report on source rather than consume data — the linter and the language
/// server. [`Spans::values`] is in pre-order, so it zips with a pre-order walk of the tree;
/// [`lint::walk`] does exactly that.
pub fn parse_document_with_spans(input: &str, limits: Limits) -> Result<(Document, Spans)> {
    let mut parser = Parser::new(input, limits, Mode::Document).recording_spans();
    let document = parser.parse_document()?;
    let spans = parser.take_spans().expect("recording was switched on");
    Ok((document, spans))
}

/// Parses one stream record (stream §2), recording spans as
/// [`parse_document_with_spans`] does. Offsets are relative to `input`.
pub fn parse_record_with_spans(input: &str, limits: Limits) -> Result<(Object, Spans)> {
    let mut parser = Parser::new(input, limits, Mode::StreamRecord { newline_follows: false })
        .recording_spans();
    let root = parser.parse_record()?;
    let spans = parser.take_spans().expect("recording was switched on");
    Ok((root, spans))
}

/// Parses raw bytes, enforcing the UTF-8 requirement of spec §2.
///
/// Substituting `U+FFFD` is prohibited, so malformed input is rejected outright.
pub fn parse_bytes(input: &[u8]) -> Result<Value> {
    let text = std::str::from_utf8(input)
        .map_err(|e| Error::detached(Code::InvalidUtf8, format!("input is not valid UTF-8: {}", e)))?;
    parse(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use num_bigint::BigInt;

    fn code(input: &str) -> Code {
        parse(input).unwrap_err().code
    }

    fn get(input: &str, key: &str) -> Value {
        parse(input).unwrap().as_object().unwrap().get(key).unwrap().clone()
    }

    #[test]
    fn parses_a_representative_document() {
        let doc = parse_document(
            "@schema(x.schema.stf)\n\
             # a comment\n\
             {\n\
               service: `checkout`,\n\
               port: 8080,\n\
               enabled: T,\n\
               missing: N,\n\
               when: TIMESTAMP(2026-01-15T10:30:00Z),\n\
               cap: DECIMAL(199.00),\n\
               id: BIGINT(9007199254740993),\n\
               key: BINARY(SGVsbG8=),\n\
               regions: [`eu-west-1`, `us-east-1`],\n\
             }",
        )
        .unwrap();
        assert_eq!(doc.directives.len(), 1);
        assert_eq!(doc.root.len(), 9);
        assert_eq!(doc.root.get("cap").unwrap().kind(), Kind::Decimal);
        assert_eq!(doc.root.get("key").unwrap(), &Value::Binary(b"Hello".to_vec()));
    }

    #[test]
    fn typed_values_are_not_strings() {
        // Spec §3.1: the defect this implementation exists to not have.
        assert_eq!(get("{a: DECIMAL(1.5)}", "a").kind(), Kind::Decimal);
        assert_eq!(get("{a: BIGINT(1)}", "a").kind(), Kind::BigInt);
        assert_eq!(get("{a: DATE(2026-01-15)}", "a").kind(), Kind::Date);
        assert_eq!(get("{a: TIMESTAMP(2026-01-15T00:00:00Z)}", "a").kind(), Kind::Timestamp);
        assert_eq!(get("{a: BINARY(SGVsbG8=)}", "a").kind(), Kind::Binary);
        assert_ne!(get("{a: DECIMAL(1.5)}", "a"), get("{a: `1.5`}", "a"));
    }

    #[test]
    fn numbers_are_binary64_not_widened() {
        // §7.2: precision loss past 2^53 is conformant and required.
        assert_eq!(get("{a: 9007199254740993}", "a"), Value::Number(9007199254740992.0));
        assert_ne!(get("{a: 1}", "a"), Value::BigInt(BigInt::from(1)));
    }

    #[test]
    fn number_domain_edges() {
        assert_eq!(code("{a: 1e400}"), Code::NumberOverflow);
        assert_eq!(get("{a: 1e-400}", "a"), Value::Number(0.0));
        assert_eq!(get("{a: -0}", "a"), Value::Number(-0.0));
        assert_ne!(get("{a: -0}", "a"), Value::Number(0.0));
    }

    #[test]
    fn number_grammar_rejections() {
        for (input, expected) in [
            ("{a: +1}", Code::InvalidNumber),
            ("{a: 0123}", Code::InvalidNumber),
            ("{a: .5}", Code::InvalidNumber),
            ("{a: 1.}", Code::InvalidNumber),
            ("{a: 1e}", Code::InvalidNumber),
            ("{a: 1e+}", Code::InvalidNumber),
            ("{a: -}", Code::InvalidNumber),
            ("{a: 0x10}", Code::InvalidNumber),
            ("{a: 1_000}", Code::InvalidNumber),
            ("{a: 1.2.3}", Code::InvalidNumber),
        ] {
            assert_eq!(code(input), expected, "{}", input);
        }
    }

    #[test]
    fn literals_are_case_sensitive_and_bounded() {
        assert_eq!(get("{a: T}", "a"), Value::Bool(true));
        assert_eq!(get("{a: F}", "a"), Value::Bool(false));
        assert_eq!(get("{a: N}", "a"), Value::Null);
        for input in ["{a: t}", "{a: true}", "{a: True}", "{a: null}", "{a: NaN}", "{a: Infinity}"]
        {
            assert_eq!(code(input), Code::Syntax, "{}", input);
        }
    }

    #[test]
    fn root_must_be_an_object() {
        for input in ["", "   ", "# hi", "@schema(x)", "[]", "42", "`hi`", "T", "DATE(2026-01-15)"]
        {
            assert_eq!(code(input), Code::RootNotObject, "{:?}", input);
        }
    }

    #[test]
    fn content_after_the_root_is_rejected() {
        assert_eq!(code("{a:1}{b:2}"), Code::TrailingContent);
        assert_eq!(code("{a:1} x"), Code::TrailingContent);
        assert_eq!(code("{a:1}\n@schema(x)"), Code::TrailingContent);
    }

    #[test]
    fn directive_framing() {
        assert!(parse("@nope(1)\n{a:1}").is_ok(), "an unknown directive must not fail");
        assert_eq!(code("@ schema(x)\n{a:1}"), Code::Syntax);
        assert_eq!(code("@schema (x)\n{a:1}"), Code::Syntax);
        assert_eq!(code("@schema(a)\n@schema(b)\n{a:1}"), Code::Syntax);
    }

    #[test]
    fn bom_is_not_whitespace() {
        assert_eq!(code("\u{FEFF}{a:1}"), Code::Syntax);
        // Inside a string it is an ordinary character (§2).
        assert_eq!(get("{a: `\u{FEFF}`}", "a"), Value::String("\u{FEFF}".into()));
    }

    #[test]
    fn key_rejections_are_specific() {
        assert_eq!(code("{ : 1 }"), Code::InvalidIdentifier);
        assert_eq!(code("{ a.b: 1 }"), Code::InvalidIdentifier);
        assert_eq!(code("{ café: 1 }"), Code::InvalidIdentifier);
        assert_eq!(code("{ \u{1F511}: 1 }"), Code::InvalidIdentifier);
        assert_eq!(code("{ \"a\": 1 }"), Code::Syntax);
        assert_eq!(code("{ `a`: 1 }"), Code::Syntax);
    }

    #[test]
    fn keys_may_lead_with_digits_or_hyphens() {
        assert!(parse("{123key: 1, content-type: 2, -: 3, _x: 4}").is_ok());
        // An uppercase word in key position is a key, not a constructor (§6.3).
        assert!(parse("{DATE: 1, BIGINT: 2, DECIMAL: 3}").is_ok());
    }

    #[test]
    fn separator_errors_are_specific() {
        assert_eq!(code("{ a 1 }"), Code::MissingColon);
        // §6.2: a second identifier followed by `:` means one key with whitespace in it.
        assert_eq!(code("{ a b: 1 }"), Code::InvalidIdentifier);
        assert_eq!(code("{ a: }"), Code::Syntax);
        assert_eq!(code("{ a:1 b:2 }"), Code::MissingComma);
        assert_eq!(code("{ a:1,, b:2 }"), Code::MissingComma);
        assert_eq!(code("{ , a:1 }"), Code::MissingComma);
        assert_eq!(code("[,1]"), Code::RootNotObject);
        assert_eq!(code("{a: [1,,2]}"), Code::MissingComma);
        assert_eq!(code("{a: [,1]}"), Code::MissingComma);
        assert_eq!(code("{ a: 1"), Code::Unterminated);
        assert_eq!(code("{a:[1}"), Code::MissingComma);
    }

    #[test]
    fn trailing_commas_are_permitted() {
        assert!(parse("{a:1,}").is_ok());
        assert!(parse("{a:[1,]}").is_ok());
    }

    #[test]
    fn duplicate_keys_are_rejected_at_any_depth() {
        assert_eq!(code("{a:1, a:2}"), Code::DuplicateKey);
        assert_eq!(code("{x: {a:1, a:2}}"), Code::DuplicateKey);
    }

    #[test]
    fn nesting_depth_default_is_64() {
        let at_limit = format!("{}{}", "{a:".repeat(63), "{}".to_string() + &"}".repeat(63));
        assert!(parse(&at_limit).is_ok());
        let over = format!("{}{}", "{a:".repeat(64), "{}".to_string() + &"}".repeat(64));
        assert_eq!(code(&over), Code::NestingDepth);
    }

    #[test]
    fn string_forms_denote_the_same_kind() {
        assert_eq!(get("{a: `hi`}", "a"), get("{a: \"hi\"}", "a"));
    }

    #[test]
    fn raw_strings_preserve_everything() {
        assert_eq!(get("{a: `x\ny`}", "a"), Value::String("x\ny".into()));
        assert_eq!(get("{a: `\\n`}", "a"), Value::String("\\n".into()));
        assert_eq!(get("{a: `x # y`}", "a"), Value::String("x # y".into()));
        assert_eq!(code("{a: `hi}"), Code::Unterminated);
        // The second backtick closes the string, so `y` is a stray token.
        assert_eq!(code("{a: `x`y`}"), Code::MissingComma);
    }

    #[test]
    fn interpreted_string_escapes() {
        assert_eq!(get(r#"{a: "\u0041\t\n\\\/\""}"#, "a"), Value::String("A\t\n\\/\"".into()));
        assert_eq!(get(r#"{a: "\u0000"}"#, "a"), Value::String("\0".into()));
        assert_eq!(code("{a: \"hi}"), Code::Unterminated);
        assert_eq!(code("{a: \"hi\n\"}"), Code::InvalidString);
        assert_eq!(code(r#"{a: "\x41"}"#), Code::InvalidString);
        assert_eq!(code(r#"{a: "\U0041"}"#), Code::InvalidString);
        assert_eq!(code(r#"{a: "\u41"}"#), Code::InvalidString);
    }

    #[test]
    fn surrogates_must_be_paired() {
        let pair = format!("{{a: \"\\u{}\\u{}\"}}", "D83D", "DE00");
        assert_eq!(get(&pair, "a"), Value::String("\u{1F600}".into()));
        assert_eq!(get("{a: `\u{1F600}`}", "a"), Value::String("\u{1F600}".into()));
        assert_eq!(code(&format!("{{a: \"\\u{}\"}}", "D800")), Code::InvalidString);
        assert_eq!(code(&format!("{{a: \"\\u{}\"}}", "DC00")), Code::InvalidString);
        assert_eq!(
            code(&format!("{{a: \"\\u{}\\u{}\"}}", "D83D", "0041")),
            Code::InvalidString
        );
    }

    #[test]
    fn constructor_framing() {
        assert_eq!(code("{a: DATE (2026-01-15)}"), Code::Syntax);
        assert_eq!(code("{a: CUSTOM(1)}"), Code::UnknownConstructor);
        assert_eq!(code("{a: TIME(10:00:00)}"), Code::UnknownConstructor);
        assert_eq!(code("{a: MY_TYPE(1)}"), Code::UnknownConstructor);
        assert_eq!(code("{a: date(2026-01-15)}"), Code::UnknownConstructor);
        assert_eq!(code("{a: Date(2026-01-15)}"), Code::UnknownConstructor);
        assert_eq!(code("{a: BigNumber(1)}"), Code::UnknownConstructor);
        assert_eq!(code("{a: Binary(48656C6C6F)}"), Code::UnknownConstructor);
        assert_eq!(code("{a: foo(1)}"), Code::Syntax);
        assert_eq!(code("{a: DATE(DATE(2026-01-15))}"), Code::NestedConstructor);
        assert_eq!(code("{a: DATE(2026-01-15}"), Code::Unterminated);
    }

    #[test]
    fn constructor_payloads_are_not_tokenized() {
        // `#` and whitespace inside a payload are ordinary characters, so they reach the
        // validator rather than starting a comment.
        assert_eq!(code("{a: DATE(2026-01-15 # x)}"), Code::InvalidConstructorPayload);
    }

    #[test]
    fn empty_payload_is_valid_only_for_binary() {
        assert_eq!(get("{a: BINARY()}", "a"), Value::Binary(vec![]));
        for input in ["{a: DECIMAL()}", "{a: BIGINT()}", "{a: DATE()}", "{a: TIMESTAMP()}"] {
            assert_eq!(code(input), Code::InvalidConstructorPayload, "{}", input);
        }
    }

    #[test]
    fn decimal_overflow_uses_its_own_code() {
        assert_eq!(code(&format!("{{a: DECIMAL({})}}", "1".repeat(35))), Code::DecimalOverflow);
        assert_eq!(code("{a: DECIMAL(1.5e3)}"), Code::InvalidConstructorPayload);
    }

    #[test]
    fn utf8_is_enforced_on_bytes() {
        assert_eq!(parse_bytes(b"{a: 1}").unwrap(), parse("{a: 1}").unwrap());
        assert_eq!(parse_bytes(b"{a: \xFF}").unwrap_err().code, Code::InvalidUtf8);
    }

    #[test]
    fn errors_carry_a_position() {
        let err = parse("{\n  a: 0x10\n}").unwrap_err();
        assert_eq!(err.code, Code::InvalidNumber);
        assert_eq!(err.line, 2);
        assert_eq!(err.column, 7);
    }

    #[test]
    fn round_trip_holds_for_every_kind() {
        let input = "{n:N,b:T,num:-2.5e-3,s:`hi`,arr:[1,`x`],obj:{k:1},\
                     big:BIGINT(-99999999999999999999),dec:DECIMAL(1.50),\
                     d:DATE(2024-02-29),t:TIMESTAMP(2026-01-15T10:30:00.100+05:30),\
                     bin:BINARY(SGVsbG9X)}";
        let value = parse(input).unwrap();
        for format in [Format::compact(), Format::pretty("  "), Format::canonical()] {
            let text = to_string(&value, &format).unwrap();
            assert_eq!(parse(&text).unwrap(), value, "round trip via {:?}", format);
        }
    }
}
