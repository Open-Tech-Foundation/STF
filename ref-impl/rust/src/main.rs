use dtxt_rs::{DTXTValue, parse, stringify};
use std::time::Instant;
use rustc_hash::FxHashMap;
use std::fs::File;
use std::io::Write;

// For benchmarking, we need to own the strings that DTXTValue borrows from.
struct DataStore {
    strings: Vec<String>,
}

impl DataStore {
    fn new() -> Self {
        Self { strings: Vec::with_capacity(DATASET_SIZE * 10) }
    }
    fn add(&mut self, s: String) -> &str {
        self.strings.push(s);
        self.strings.last().unwrap()
    }
}

fn generate_large_data<'a>(
    count: usize, 
    uids: &'a [String], 
    tags: &'a [DTXTValue<'a>]
) -> FxHashMap<&'a str, DTXTValue<'a>> {
    let mut entries = Vec::with_capacity(count);
    for i in 0..count {
        let mut meta = FxHashMap::default();
        meta.insert("level", DTXTValue::Number((i % 10) as f64));
        meta.insert("verified", DTXTValue::Bool(i % 3 == 0));
        meta.insert("note", DTXTValue::Null);

        let mut nested = FxHashMap::default();
        nested.insert("a", DTXTValue::Number(1.0));
        nested.insert("b", DTXTValue::Bool(false));
        nested.insert("c", DTXTValue::String(std::borrow::Cow::Borrowed("nested string")));
        meta.insert("nested", DTXTValue::Object(nested));

        let mut entry = FxHashMap::default();
        entry.insert("id", DTXTValue::Number(i as f64));
        entry.insert("uid", DTXTValue::String(std::borrow::Cow::Borrowed(&uids[i])));
        entry.insert("isActive", DTXTValue::Bool(i % 2 == 0));
        entry.insert("score", DTXTValue::Number(rand::random::<f64>() * 1000.0));
        entry.insert("tags", DTXTValue::Array(tags.to_vec()));
        entry.insert("meta", DTXTValue::Object(meta));
        entries.push(DTXTValue::Object(entry));
    }

    let mut root = FxHashMap::default();
    root.insert("title", DTXTValue::String(std::borrow::Cow::Borrowed("DTXT vs JSON (Rust)")));
    root.insert("description", DTXTValue::String(std::borrow::Cow::Borrowed("Benchmark for base format overhead")));
    root.insert("entries", DTXTValue::Array(entries));

    root
}

const DATASET_SIZE: usize = 30000;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Generating dataset with {} entries...", DATASET_SIZE);
    
    // Pre-generate strings to satisfy lifetimes
    let uids: Vec<String> = (0..DATASET_SIZE).map(|i| format!("user-{}", i)).collect();
    let tag_strs = vec!["data", "benchmark", "storage", "json", "dtxt"];
    let tags: Vec<DTXTValue> = tag_strs.iter().map(|&s| DTXTValue::String(std::borrow::Cow::Borrowed(s))).collect();

    let raw_data = generate_large_data(DATASET_SIZE, &uids, &tags);
    let root_value = DTXTValue::Object(raw_data);
    
    let dtxt_str = stringify(&root_value, None);
    let dtxt_size = dtxt_str.len();

    println!("\n--- Payload Size ---");
    println!("DTXT:  {:.2} MB", dtxt_size as f64 / 1024.0 / 1024.0);

    let iterations = 5;

    println!("\n--- Parsing Performance (Average of {} runs) ---", iterations);

    let mut dtxt_parse_total = 0.0;
    for _ in 0..iterations {
        let start = Instant::now();
        let _ = parse(&dtxt_str)?;
        dtxt_parse_total += start.elapsed().as_secs_f64() * 1000.0;
    }
    println!("dtxt-rs:     {:.2} ms", dtxt_parse_total / iterations as f64);

    println!("\n--- Serialization Performance (Average of {} runs) ---", iterations);

    let mut dtxt_stringify_total = 0.0;
    for _ in 0..iterations {
        let start = Instant::now();
        let _ = stringify(&root_value, None);
        dtxt_stringify_total += start.elapsed().as_secs_f64() * 1000.0;
    }
    println!("dtxt-rs:     {:.2} ms", dtxt_stringify_total / iterations as f64);

    let mut f_dtxt = File::create("../../benchmarks/rs/bench_v2_rs_updated.dtxt")?;
    f_dtxt.write_all(dtxt_str.as_bytes())?;

    Ok(())
}
