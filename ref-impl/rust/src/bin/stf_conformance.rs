//! Runs the STF 1.0 conformance corpus against this implementation.
//!
//! Implements the runner contract in `tests/conformance/README.md` §3: error codes are
//! compared exactly, values are compared by kind, Numbers by `binary64` bit pattern, Decimals
//! by coefficient *and* scale, and Binary by decoded octets. Nothing is skipped.
//!
//! ```sh
//! cargo run --bin stf-conformance [-- path/to/corpus.json]
//! ```

use serde_json::Value as Json;
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;
use stf::value::Value;
use stf::{constructors, parse_stream, to_string, Format};

struct Failure {
    name: String,
    detail: String,
}

fn main() -> ExitCode {
    let path = std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(default_corpus_path);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("cannot read corpus at {}: {}", path.display(), e);
            return ExitCode::FAILURE;
        }
    };
    let cases: Vec<Json> = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("corpus at {} is not valid JSON: {}", path.display(), e);
            return ExitCode::FAILURE;
        }
    };

    let mut failures: Vec<Failure> = Vec::new();
    let mut by_group: BTreeMap<String, (usize, usize)> = BTreeMap::new();

    for case in &cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>").to_string();
        let group = case["group"].as_str().unwrap_or("<none>").to_string();
        let entry = by_group.entry(group).or_insert((0, 0));
        entry.1 += 1;
        match run_case(case) {
            Ok(()) => entry.0 += 1,
            Err(detail) => failures.push(Failure { name, detail }),
        }
    }

    println!("STF 1.0 conformance — {} ({} cases)", path.display(), cases.len());
    println!();
    for (group, (passed, total)) in &by_group {
        let mark = if passed == total { "ok  " } else { "FAIL" };
        println!("  {} {:<12} {:>3}/{:<3}", mark, group, passed, total);
    }

    if !failures.is_empty() {
        println!("\nFailures:");
        for f in &failures {
            println!("  {}\n      {}", f.name, f.detail);
        }
    }

    let passed = cases.len() - failures.len();
    println!("\n{}/{} passed", passed, cases.len());
    if failures.is_empty() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn default_corpus_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/conformance/corpus.json")
}

fn run_case(case: &Json) -> Result<(), String> {
    let input = case["input"].as_str().ok_or("case has no string `input`")?;
    let is_stream = case.get("profile").and_then(|p| p.as_str()) == Some("stream");

    let expected_error = case.get("error").and_then(|e| e.as_str());
    let expected_value = case.get("value");

    match (expected_error, expected_value) {
        (Some(code), None) => {
            let actual = if is_stream {
                parse_stream(input).err().map(|e| e.code.as_str())
            } else {
                stf::parse(input).err().map(|e| e.code.as_str())
            };
            match actual {
                None => Err(format!("expected {}, but the input parsed successfully", code)),
                Some(got) if got == code => Ok(()),
                Some(got) => Err(format!("expected {}, got {}", code, got)),
            }
        }
        (None, Some(expected)) => {
            if is_stream {
                let stream = parse_stream(input)
                    .map_err(|e| format!("expected a value, got {}: {}", e.code, e.message))?;
                let records: Vec<Value> = stream.records.into_iter().map(Value::Object).collect();
                let expected_records =
                    expected.as_array().ok_or("a stream case must expect an array of records")?;
                if records.len() != expected_records.len() {
                    return Err(format!(
                        "expected {} records, got {}",
                        expected_records.len(),
                        records.len()
                    ));
                }
                for (i, (got, want)) in records.iter().zip(expected_records).enumerate() {
                    matches_expected(got, want).map_err(|e| format!("record {}: {}", i, e))?;
                }
                return Ok(());
            }

            let value = stf::parse(input)
                .map_err(|e| format!("expected a value, got {}: {}", e.code, e.message))?;
            matches_expected(&value, expected)?;

            // README §3, the SHOULD: parse(serialize(parse(input))) == parse(input).
            for format in [Format::compact(), Format::pretty("  "), Format::canonical()] {
                let text =
                    to_string(&value, &format).map_err(|e| format!("serialization failed: {}", e))?;
                let reparsed = stf::parse(&text).map_err(|e| {
                    format!("serialized output does not parse ({}): {}", e.code, text)
                })?;
                if reparsed != value {
                    return Err(format!("round trip changed the value via {}", text));
                }
            }

            if let Some(expected_canonical) = case.get("canonical").and_then(|c| c.as_str()) {
                let got = to_string(&value, &Format::canonical())
                    .map_err(|e| format!("canonical serialization failed: {}", e))?;
                if got != expected_canonical {
                    return Err(format!(
                        "canonical form: expected {:?}, got {:?}",
                        expected_canonical, got
                    ));
                }
            }
            Ok(())
        }
        _ => Err("a case must have exactly one of `value` or `error`".to_string()),
    }
}

/// Compares a parsed value against the corpus's tagged-JSON encoding.
///
/// Kind is checked first in every branch, so a String can never satisfy a `dec`, `date`,
/// `ts`, `bin`, or `bigint` expectation however closely the text matches.
fn matches_expected(got: &Value, want: &Json) -> Result<(), String> {
    match want {
        Json::Null => match got {
            Value::Null => Ok(()),
            _ => mismatch(got, "Null"),
        },
        Json::Bool(b) => match got {
            Value::Bool(g) if g == b => Ok(()),
            _ => mismatch(got, &format!("Boolean {}", b)),
        },
        Json::String(s) => match got {
            Value::String(g) if g == s => Ok(()),
            _ => mismatch(got, &format!("String {:?}", s)),
        },
        Json::Number(_) => Err(format!(
            "corpus error: bare JSON numbers are never used; found {} (README §2)",
            want
        )),
        Json::Array(items) => match got {
            Value::Array(g) => {
                if g.len() != items.len() {
                    return Err(format!("expected {} elements, got {}", items.len(), g.len()));
                }
                for (i, (a, b)) in g.iter().zip(items).enumerate() {
                    matches_expected(a, b).map_err(|e| format!("[{}]: {}", i, e))?;
                }
                Ok(())
            }
            _ => mismatch(got, "Array"),
        },
        Json::Object(map) => {
            if let Some(tag) = map.get("$").and_then(|t| t.as_str()) {
                let text = map
                    .get("v")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("corpus error: tag `{}` has no string `v`", tag))?;
                return matches_tagged(got, tag, text);
            }
            let object = match got {
                Value::Object(o) => o,
                _ => return mismatch(got, "Object"),
            };
            if object.len() != map.len() {
                return Err(format!("expected {} members, got {}", map.len(), object.len()));
            }
            for (key, want_child) in map {
                let child = object.get(key).ok_or_else(|| format!("missing key `{}`", key))?;
                matches_expected(child, want_child).map_err(|e| format!(".{}: {}", key, e))?;
            }
            Ok(())
        }
    }
}

fn matches_tagged(got: &Value, tag: &str, text: &str) -> Result<(), String> {
    match tag {
        "num" => {
            let want: f64 =
                text.parse().map_err(|_| format!("corpus error: `{}` is not a number", text))?;
            match got {
                // Bit comparison, so -0 never satisfies 0 (README §3.3).
                Value::Number(g) if g.to_bits() == want.to_bits() => Ok(()),
                Value::Number(g) => Err(format!("expected Number {}, got {}", text, g)),
                _ => mismatch(got, &format!("Number {}", text)),
            }
        }
        "bigint" => {
            let want: num_bigint::BigInt =
                text.parse().map_err(|_| format!("corpus error: `{}` is not an integer", text))?;
            match got {
                Value::BigInt(g) if *g == want => Ok(()),
                _ => mismatch(got, &format!("BigInt {}", text)),
            }
        }
        "dec" => {
            let want = constructors::decimal(text)
                .map_err(|e| format!("corpus error: DECIMAL({}): {}", text, e.1))?;
            match got {
                // Decimal's PartialEq compares coefficient and scale (README §3.4).
                Value::Decimal(g) if *g == want => Ok(()),
                Value::Decimal(g) => Err(format!(
                    "expected Decimal {} (scale {}), got {} (scale {})",
                    want.payload(),
                    want.scale(),
                    g.payload(),
                    g.scale()
                )),
                _ => mismatch(got, &format!("Decimal {}", text)),
            }
        }
        "date" => {
            let want = constructors::date(text)
                .map_err(|e| format!("corpus error: DATE({}): {}", text, e.1))?;
            match got {
                Value::Date(g) if *g == want => Ok(()),
                _ => mismatch(got, &format!("Date {}", text)),
            }
        }
        "ts" => {
            let want = constructors::timestamp(text)
                .map_err(|e| format!("corpus error: TIMESTAMP({}): {}", text, e.1))?;
            match got {
                Value::Timestamp(g) if *g == want => Ok(()),
                _ => mismatch(got, &format!("Timestamp {}", text)),
            }
        }
        "bin" => {
            let want = constructors::binary(text)
                .map_err(|e| format!("corpus error: BINARY({}): {}", text, e.1))?;
            match got {
                // Octet comparison after decoding (README §3.5).
                Value::Binary(g) if *g == want => Ok(()),
                _ => mismatch(got, &format!("Binary {}", text)),
            }
        }
        other => Err(format!("corpus error: unknown tag `{}`", other)),
    }
}

fn mismatch(got: &Value, what: &str) -> Result<(), String> {
    Err(format!("expected {}, got {}", what, describe(got)))
}

fn describe(value: &Value) -> String {
    match value {
        Value::String(s) => format!("String {:?}", s),
        Value::Number(n) => format!("Number {}", n),
        other => format!(
            "{} {}",
            other.kind(),
            to_string(other, &Format::compact())
                .unwrap_or_else(|_| String::from("<unrepresentable>"))
        ),
    }
}
