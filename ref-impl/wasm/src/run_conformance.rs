use dtxt_rs::{DTXTValue, parse};
use serde::{Deserialize};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::Path;

#[derive(Deserialize)]
struct TestItem {
    name: String,
    input: String,
    expected: Option<JsonValue>,
    error: Option<String>,
}

fn normalize(val: &DTXTValue) -> JsonValue {
    match val {
        DTXTValue::String(s) => JsonValue::String(s.to_string()),
        DTXTValue::Number(n) => {
            if n.fract() == 0.0 {
                JsonValue::Number(serde_json::Number::from(*n as i64))
            } else {
                serde_json::Number::from_f64(*n)
                    .map(JsonValue::Number)
                    .unwrap_or(JsonValue::Null)
            }
        }
        DTXTValue::Bool(b) => JsonValue::Bool(*b),
        DTXTValue::Null => JsonValue::Null,
        DTXTValue::BigInt(n) => {
             JsonValue::String(format!("$bigint:{}", n))
        }
        DTXTValue::Date(s) => {
            // Truncate to YYYY-MM-DD
            let truncated = s.split('T').next().unwrap_or(s);
            JsonValue::String(format!("$date:{}", truncated))
        }
        DTXTValue::Bytes(b) => {
            let hex = b.iter().map(|b| format!("{:02X}", b)).collect::<String>();
            JsonValue::String(format!("$binary:{}", hex))
        }
        DTXTValue::Array(a) => JsonValue::Array(a.iter().map(normalize).collect()),
        DTXTValue::Object(m) => {
            let mut map = serde_json::Map::new();
            let mut keys: Vec<_> = m.keys().collect();
            keys.sort();
            for k in keys {
                map.insert(k.to_string(), normalize(m.get(k).unwrap()));
            }
            JsonValue::Object(map)
        }
    }
}

fn main() {
    let tests_path = Path::new("../../tests/conformance/tests.json");
    let tests_data = fs::read_to_string(tests_path).expect("Failed to read tests.json");
    let tests: Vec<TestItem> = serde_json::from_str(&tests_data).expect("Failed to parse tests.json");

    let mut passed = 0;
    let mut failed = 0;

    println!("Running {} conformance tests...", tests.len());

    for test in tests {
        match parse(&test.input) {
            Ok(parsed_map) => {
                if let Some(expected_error) = test.error {
                    println!("FAIL: {} - Expected error {}, but it parsed successfully. Result: {:?}", test.name, expected_error, parsed_map);
                    failed += 1;
                } else {
                    let actual = normalize(&DTXTValue::Object(parsed_map));
                    if let Some(expected) = test.expected {
                        if actual == expected {
                            println!("PASS: {}", test.name);
                            passed += 1;
                        } else {
                            println!("FAIL: {} - Result mismatch.", test.name);
                            println!("  Expected: {}", expected);
                            println!("  Got:      {}", actual);
                            failed += 1;
                        }
                    }
                }
            }
            Err(e) => {
                if test.error.is_some() {
                    println!("PASS: {} (Caught expected error: {})", test.name, e);
                    passed += 1;
                } else {
                    println!("FAIL: {} - Unexpected error: {}", test.name, e);
                    failed += 1;
                }
            }
        }
    }

    println!("\nConformance Test Results: {} passed, {} failed.", passed, failed);
    if failed > 0 {
        std::process::exit(1);
    }
}
