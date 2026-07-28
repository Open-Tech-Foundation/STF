//! Warnings beyond conformance.
//!
//! A conformant document can still be a bad one. The rules here flag the JSON habits STF
//! exists to remove — a date, an instant, or a big integer smuggled through a string because
//! JSON had no other way to carry it — and the unknown directives spec §5.1 requires a parser
//! to accept but recommends it warn about.
//!
//! Nothing here is normative: a lint warning never makes a document non-conformant, and the
//! rule names are not error codes. The `stf lint` command and the language server share this
//! module so that both report the same set.

use crate::parser::Spans;
use crate::value::{Directive, Document, Object, Value};

/// The directives the reference implementation knows. Spec §5.1 requires an unknown directive
/// to be accepted, so this list only drives the warning.
const KNOWN_DIRECTIVES: [&str; 2] = ["schema", "version"];

/// Which rule produced a warning. Stable identifiers, safe to match on in an editor or a
/// script; unlike error codes they are not normative.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    /// A directive outside [`KNOWN_DIRECTIVES`] (spec §5.1).
    UnknownDirective,
    /// A string whose content is a well-formed `DATE`, `TIMESTAMP`, or `BIGINT` payload.
    StringlyTyped,
}

impl Rule {
    pub fn as_str(self) -> &'static str {
        match self {
            Rule::UnknownDirective => "unknown-directive",
            Rule::StringlyTyped => "stringly-typed",
        }
    }
}

/// One warning, anchored to the byte range of the source it concerns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Warning {
    pub rule: Rule,
    /// Dotted path to the value, or `root`.
    pub path: String,
    /// Human-readable explanation.
    pub message: String,
    /// Byte offset of the start of the offending source text.
    pub start: usize,
    /// Byte offset one past its end.
    pub end: usize,
}

/// Lints a whole document, including its directives.
pub fn lint(document: &Document, spans: &Spans) -> Vec<Warning> {
    let mut out = Vec::new();
    for (i, directive) in document.directives.iter().enumerate() {
        if let Some(warning) = directive_warning(directive, span_at(spans.directives.get(i))) {
            out.push(warning);
        }
    }
    lint_root(&document.root, spans, &mut out);
    out
}

/// Lints one stream record. Records carry no directives (stream §3.2).
pub fn lint_record(record: &Object, spans: &Spans) -> Vec<Warning> {
    let mut out = Vec::new();
    lint_root(record, spans, &mut out);
    out
}

fn lint_root(root: &Object, spans: &Spans, out: &mut Vec<Warning>) {
    walk(&Value::Object(root.clone()), spans, &mut |value, path, span| {
        if let Value::String(s) = value {
            if let Some(suggestion) = suggestion_for(s) {
                out.push(Warning {
                    rule: Rule::StringlyTyped,
                    path: path.to_string(),
                    message: format!(
                        "{} is a string that looks like a typed value; consider {}",
                        path, suggestion
                    ),
                    start: span.0,
                    end: span.1,
                });
            }
        }
    });
}

fn directive_warning(directive: &Directive, span: (usize, usize)) -> Option<Warning> {
    if KNOWN_DIRECTIVES.contains(&directive.name.as_str()) {
        return None;
    }
    Some(Warning {
        rule: Rule::UnknownDirective,
        path: format!("@{}", directive.name),
        message: format!("unknown directive `@{}`", directive.name),
        start: span.0,
        end: span.1,
    })
}

/// The constructor a string should have been, if any.
///
/// The `BIGINT` case requires more than 15 digits because shorter runs of digits are usually
/// identifiers — a zip code or an order number — that happen to be numeric, and STF has no
/// opinion about those.
fn suggestion_for(s: &str) -> Option<String> {
    if crate::constructors::date(s).is_ok() {
        Some(format!("DATE({})", s))
    } else if crate::constructors::timestamp(s).is_ok() {
        Some(format!("TIMESTAMP({})", s))
    } else if s.len() > 15
        && s.bytes().all(|b| b.is_ascii_digit())
        && crate::constructors::bigint(s).is_ok()
    {
        Some(format!("BIGINT({})", s))
    } else {
        None
    }
}

/// Visits every value in pre-order, pairing it with the source range it was parsed from.
///
/// [`Spans::values`] is recorded in pre-order by the parser, so consuming one entry per
/// visited value keeps the two aligned. A caller that passes spans from a different parse
/// gets `(0, 0)` for the values that run past the end rather than a panic.
///
/// The root itself is named `root`; everything below it is named by its path from the root,
/// as `stf lint` has always printed them (`created`, `servers[0].host`).
pub fn walk(root: &Value, spans: &Spans, visit: &mut impl FnMut(&Value, &str, (usize, usize))) {
    let mut next = 0usize;
    walk_inner(root, "", spans, &mut next, visit);
}

fn walk_inner(
    value: &Value,
    path: &str,
    spans: &Spans,
    next: &mut usize,
    visit: &mut impl FnMut(&Value, &str, (usize, usize)),
) {
    let span = span_at(spans.values.get(*next));
    *next += 1;
    visit(value, if path.is_empty() { "root" } else { path }, span);
    match value {
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                walk_inner(item, &format!("{}[{}]", path, i), spans, next, visit);
            }
        }
        Value::Object(object) => {
            for (key, item) in object.iter() {
                let child =
                    if path.is_empty() { key.to_string() } else { format!("{}.{}", path, key) };
                walk_inner(item, &child, spans, next, visit);
            }
        }
        _ => {}
    }
}

fn span_at(span: Option<&(usize, usize)>) -> (usize, usize) {
    span.copied().unwrap_or((0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse_document_with_spans, Limits};

    fn warnings(input: &str) -> Vec<Warning> {
        let (document, spans) = parse_document_with_spans(input, Limits::default()).unwrap();
        lint(&document, &spans)
    }

    /// The span of every warning must quote the text it is complaining about. This is what
    /// breaks if the pre-order invariant between the parser and `walk` is ever violated.
    fn quoted<'a>(input: &'a str, w: &Warning) -> &'a str {
        &input[w.start..w.end]
    }

    #[test]
    fn flags_a_date_shaped_string() {
        let input = "{ created: `2026-01-15` }";
        let w = warnings(input);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].rule, Rule::StringlyTyped);
        assert_eq!(w[0].path, "created");
        assert!(w[0].message.contains("DATE(2026-01-15)"));
        assert_eq!(quoted(input, &w[0]), "`2026-01-15`");
    }

    #[test]
    fn flags_a_timestamp_and_a_bigint() {
        let input = "{ at: `2026-01-15T10:30:00Z`, id: `9007199254740993000` }";
        let w = warnings(input);
        assert_eq!(w.len(), 2);
        assert_eq!(quoted(input, &w[0]), "`2026-01-15T10:30:00Z`");
        assert_eq!(quoted(input, &w[1]), "`9007199254740993000`");
    }

    #[test]
    fn leaves_short_digit_runs_alone() {
        assert!(warnings("{ zip: `94107` }").is_empty());
    }

    #[test]
    fn leaves_typed_values_alone() {
        assert!(warnings("{ created: DATE(2026-01-15), id: BIGINT(9007199254740993) }").is_empty());
    }

    /// Nesting is where a mis-ordered span table would show up first.
    #[test]
    fn spans_survive_nesting_and_mixed_kinds() {
        let input = "{ a: [1, { b: `2026-01-15` }, T], c: { d: [N, `2026-03-04`] } }";
        let w = warnings(input);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].path, "a[1].b");
        assert_eq!(quoted(input, &w[0]), "`2026-01-15`");
        assert_eq!(w[1].path, "c.d[1]");
        assert_eq!(quoted(input, &w[1]), "`2026-03-04`");
    }

    /// Comments and directives shift offsets without contributing values.
    #[test]
    fn spans_account_for_comments_and_directives() {
        let input = "@version(1.0)\n# a comment\n{\n  created: \"2026-01-15\", # trailing\n}";
        let w = warnings(input);
        assert_eq!(w.len(), 1);
        assert_eq!(quoted(input, &w[0]), "\"2026-01-15\"");
    }

    #[test]
    fn flags_an_unknown_directive() {
        let input = "@wat(x)\n{ a: 1 }";
        let w = warnings(input);
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].rule, Rule::UnknownDirective);
        assert_eq!(w[0].path, "@wat");
        assert_eq!(quoted(input, &w[0]), "@wat(x)");
    }

    #[test]
    fn accepts_the_known_directives_without_warning() {
        assert!(warnings("@schema(x.stf)\n@version(1.0)\n{ a: 1 }").is_empty());
    }

    #[test]
    fn walk_visits_every_value_once() {
        let input = "{ a: [1, 2], b: { c: T } }";
        let (document, spans) = parse_document_with_spans(input, Limits::default()).unwrap();
        let mut seen = Vec::new();
        walk(&Value::Object(document.root), &spans, &mut |_, path, span| {
            seen.push((path.to_string(), span));
        });
        let paths: Vec<&str> = seen.iter().map(|(p, _)| p.as_str()).collect();
        assert_eq!(paths, ["root", "a", "a[0]", "a[1]", "b", "b.c"]);
        // One span per value, and the root spans the whole object.
        assert_eq!(spans.values.len(), seen.len());
        assert_eq!(&input[seen[0].1 .0..seen[0].1 .1], input);
        assert_eq!(&input[seen[1].1 .0..seen[1].1 .1], "[1, 2]");
    }

    #[test]
    fn lints_a_stream_record() {
        let input = "{ at: `2026-01-15` }";
        let (record, spans) = crate::parse_record_with_spans(input, Limits::default()).unwrap();
        let w = lint_record(&record, &spans);
        assert_eq!(w.len(), 1);
        assert_eq!(quoted(input, &w[0]), "`2026-01-15`");
    }
}
