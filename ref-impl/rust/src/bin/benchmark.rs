//! Payload-size and throughput benchmark for the Rust implementation.
//!
//! The dataset uses only JSON-native kinds so the STF and JSON figures measure base format
//! overhead rather than the constructor types, and it is generated from a **fixed seed** so
//! runs are comparable to each other. Figures from different languages are still not
//! comparable — each implementation benchmarks its own dataset.

use std::fs;
use std::io::Write;
use std::time::Instant;
use stf::value::{Object, Value};
use stf::{to_string, Format};

const DATASET_SIZE: usize = 30_000;
const ITERATIONS: usize = 5;
const SEED: u64 = 0x5745_5354_4632_3031;

/// SplitMix64. Deterministic and dependency-free, so the dataset is identical on every run.
struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A float in [0, 1) with 53 bits of mantissa.
    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn object(members: Vec<(&str, Value)>) -> Value {
    let mut o = Object::with_capacity(members.len());
    for (k, v) in members {
        o.insert(k, v);
    }
    Value::Object(o)
}

fn generate(count: usize) -> Value {
    let mut rng = Rng(SEED);
    let tags = Value::Array(
        ["data", "benchmark", "storage", "json", "stf"]
            .iter()
            .map(|s| Value::String((*s).to_string()))
            .collect(),
    );

    let mut entries = Vec::with_capacity(count);
    for i in 0..count {
        let nested = object(vec![
            ("a", Value::Number(1.0)),
            ("b", Value::Bool(false)),
            ("c", Value::String("nested string".to_string())),
        ]);
        let meta = object(vec![
            ("level", Value::Number((i % 10) as f64)),
            ("verified", Value::Bool(i % 3 == 0)),
            ("note", Value::Null),
            ("nested", nested),
        ]);
        entries.push(object(vec![
            ("id", Value::Number(i as f64)),
            ("uid", Value::String(format!("user-{}", i))),
            ("isActive", Value::Bool(i % 2 == 0)),
            ("score", Value::Number(rng.next_f64() * 1000.0)),
            ("tags", tags.clone()),
            ("meta", meta),
        ]));
    }

    object(vec![
        ("title", Value::String("STF vs JSON (Rust)".to_string())),
        ("description", Value::String("Benchmark for base format overhead".to_string())),
        ("entries", Value::Array(entries)),
    ])
}

fn average_ms(iterations: usize, mut body: impl FnMut()) -> f64 {
    let mut total = 0.0;
    for _ in 0..iterations {
        let start = Instant::now();
        body();
        total += start.elapsed().as_secs_f64() * 1000.0;
    }
    total / iterations as f64
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Generating dataset with {} entries (seed {:#x})...", DATASET_SIZE, SEED);
    let value = generate(DATASET_SIZE);

    let stf_text = to_string(&value, &Format::compact())?;
    let json_value = stf::json::to_json(&value, stf::json::TypedValuePolicy::Reject)?;
    let json_text = serde_json::to_string(&json_value)?;

    println!("\n--- Payload Size ---");
    let mb = |n: usize| n as f64 / 1024.0 / 1024.0;
    println!("STF:   {:.2} MB", mb(stf_text.len()));
    println!("JSON:  {:.2} MB", mb(json_text.len()));
    println!(
        "STF is {:.1}% smaller",
        (1.0 - stf_text.len() as f64 / json_text.len() as f64) * 100.0
    );

    println!("\n--- Parsing (average of {} runs) ---", ITERATIONS);
    let stf_parse = average_ms(ITERATIONS, || {
        stf::parse(&stf_text).expect("generated STF must parse");
    });
    let json_parse = average_ms(ITERATIONS, || {
        let _: serde_json::Value =
            serde_json::from_str(&json_text).expect("generated JSON must parse");
    });
    println!("stf:         {:.2} ms", stf_parse);
    println!("serde_json:  {:.2} ms", json_parse);

    println!("\n--- Serialization (average of {} runs) ---", ITERATIONS);
    let stf_ser = average_ms(ITERATIONS, || {
        to_string(&value, &Format::compact()).expect("value must serialize");
    });
    let json_ser = average_ms(ITERATIONS, || {
        serde_json::to_string(&json_value).expect("value must serialize");
    });
    println!("stf:         {:.2} ms", stf_ser);
    println!("serde_json:  {:.2} ms", json_ser);

    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../benchmarks/rust");
    fs::create_dir_all(dir)?;
    let stf_out = format!("{}/bench_v2_rust.stf", dir);
    fs::File::create(&stf_out)?.write_all(stf_text.as_bytes())?;
    let json_out = format!("{}/bench_v2_rust.json", dir);
    fs::File::create(&json_out)?.write_all(json_text.as_bytes())?;
    println!("\nWrote {} and {}", stf_out, json_out);
    Ok(())
}
