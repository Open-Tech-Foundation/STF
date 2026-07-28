//! The `stf` command-line tool.
//!
//! Six subcommands over the reference library: `check`, `fmt`, `lint`, `parse`, `canon`, and
//! `convert`. Every one reports the normative error code from `doc/error-codes.md`, so a
//! script can branch on `ERR_INVALID_NUMBER` rather than on message text.
//!
//! Conversion is deliberately strict. STF replaces JSON rather than extending it, so a JSON
//! document STF cannot represent is reported and refused, never silently repaired.

use std::io::{Read, Write};
use std::path::Path;
use std::process::ExitCode;

use stf::json::{from_json, to_json, to_tagged_json, TypedValuePolicy};
use stf::stream::{stream_to_string, Stream, StreamReader};
use stf::value::{Object, Value};
use stf::{document_to_string, parse_document, to_string, Format};

const USAGE: &str = "\
stf — the Structured Text Format toolkit

USAGE:
    stf <COMMAND> [OPTIONS] [FILE...]

COMMANDS:
    check      Parse each input and report any error. Exits non-zero on failure.
    fmt        Reformat each input. Prints to stdout, or rewrites with --write.
    lint       Report style and portability warnings beyond mere conformance.
    parse      Print the parsed data model as tagged JSON, one kind per value.
    canon      Print STF Canonical Form (spec §14), for hashing and signing.
    convert    Convert between STF and JSON. Refuses what the target cannot express.

COMMON OPTIONS:
    -h, --help          Show this help.
        --stream        Treat inputs as STF Stream records (.stfs). Inferred from the
                        extension when not given.
    FILE                Path to read. `-` or no FILE reads standard input.

fmt / canon OPTIONS:
    -w, --write         Rewrite each file in place instead of printing.
        --check         Print nothing; exit non-zero if any file is not already formatted.
        --indent <N>    Indent with N spaces. Default 2.
        --compact       Emit one line with no padding.

convert OPTIONS:
        --to <FORMAT>   `stf` or `json`. Inferred from --output's extension otherwise.
    -o, --output <PATH> Write here instead of standard output.
        --lossy         When writing JSON, encode BIGINT/DECIMAL/DATE/TIMESTAMP/BINARY
                        payloads as JSON strings. The type is lost; without this the
                        conversion is refused.

EXIT CODES:
    0  success
    1  an input was rejected, or --check found a difference
    2  usage error
";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() || args[0] == "-h" || args[0] == "--help" {
        print!("{}", USAGE);
        return if args.is_empty() { ExitCode::from(2) } else { ExitCode::SUCCESS };
    }

    let command = args[0].clone();
    let rest = &args[1..];
    let result = match command.as_str() {
        "check" => run(rest, Action::Check),
        "fmt" => run(rest, Action::Fmt),
        "lint" => run(rest, Action::Lint),
        "parse" => run(rest, Action::Parse),
        "canon" => run(rest, Action::Canon),
        "convert" => run(rest, Action::Convert),
        other => Err(Fatal::Usage(format!("unknown command `{}`", other))),
    };

    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(Fatal::Usage(msg)) => {
            eprintln!("stf: {}\n", msg);
            eprint!("{}", USAGE);
            ExitCode::from(2)
        }
        Err(Fatal::Io(msg)) => {
            eprintln!("stf: {}", msg);
            ExitCode::FAILURE
        }
    }
}

enum Fatal {
    Usage(String),
    Io(String),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Action {
    Check,
    Fmt,
    Lint,
    Parse,
    Canon,
    Convert,
}

struct Options {
    files: Vec<String>,
    stream: Option<bool>,
    write: bool,
    check_only: bool,
    indent: Option<usize>,
    compact: bool,
    to: Option<String>,
    output: Option<String>,
    lossy: bool,
}

fn parse_args(args: &[String], action: Action) -> Result<Options, Fatal> {
    let mut o = Options {
        files: Vec::new(),
        stream: None,
        write: false,
        check_only: false,
        indent: None,
        compact: false,
        to: None,
        output: None,
        lossy: false,
    };
    let mut i = 0;
    let usage = |m: String| Fatal::Usage(m);
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "-h" | "--help" => {
                print!("{}", USAGE);
                std::process::exit(0);
            }
            "--stream" => o.stream = Some(true),
            "-w" | "--write" => o.write = true,
            "--check" => o.check_only = true,
            "--compact" => o.compact = true,
            "--lossy" => o.lossy = true,
            "--indent" => {
                i += 1;
                let v = args.get(i).ok_or_else(|| usage("--indent needs a value".into()))?;
                o.indent = Some(
                    v.parse().map_err(|_| usage(format!("--indent expects a number, got `{}`", v)))?,
                );
            }
            "--to" => {
                i += 1;
                let v = args.get(i).ok_or_else(|| usage("--to needs a value".into()))?;
                o.to = Some(v.clone());
            }
            "-o" | "--output" => {
                i += 1;
                let v = args.get(i).ok_or_else(|| usage("--output needs a path".into()))?;
                o.output = Some(v.clone());
            }
            _ if a.starts_with("--") => return Err(usage(format!("unknown option `{}`", a))),
            _ => o.files.push(a.to_string()),
        }
        i += 1;
    }

    if o.write && o.files.is_empty() {
        return Err(usage("--write needs at least one file".into()));
    }
    if o.write && o.check_only {
        return Err(usage("--write and --check are mutually exclusive".into()));
    }
    if action != Action::Convert && (o.to.is_some() || o.lossy) {
        return Err(usage(format!("--to and --lossy apply only to `convert`")));
    }
    if o.files.is_empty() {
        o.files.push("-".to_string());
    }
    Ok(o)
}

fn is_stream_path(path: &str) -> bool {
    Path::new(path).extension().is_some_and(|e| e == "stfs" || e == "ndjson" || e == "jsonl")
}

fn read_input(path: &str) -> Result<String, Fatal> {
    if path == "-" {
        let mut buf = Vec::new();
        std::io::stdin()
            .read_to_end(&mut buf)
            .map_err(|e| Fatal::Io(format!("cannot read standard input: {}", e)))?;
        // Enforce spec §2 before the parser sees the text.
        return String::from_utf8(buf).map_err(|_| {
            Fatal::Io("ERR_INVALID_UTF8: standard input is not well-formed UTF-8".to_string())
        });
    }
    let bytes = std::fs::read(path).map_err(|e| Fatal::Io(format!("{}: {}", path, e)))?;
    String::from_utf8(bytes)
        .map_err(|_| Fatal::Io(format!("{}: ERR_INVALID_UTF8: not well-formed UTF-8", path)))
}

fn format_for(o: &Options, canonical: bool) -> Format {
    if canonical {
        return Format::canonical();
    }
    if o.compact {
        return Format::compact();
    }
    Format::pretty(&" ".repeat(o.indent.unwrap_or(2)))
}

/// Returns `Ok(true)` when every input was handled successfully.
fn run(args: &[String], action: Action) -> Result<bool, Fatal> {
    let o = parse_args(args, action)?;
    if action == Action::Convert {
        return convert(&o);
    }

    let mut ok = true;
    let multiple = o.files.len() > 1;
    for path in &o.files {
        let stream = o.stream.unwrap_or_else(|| is_stream_path(path));
        let text = read_input(path)?;
        let label = if path == "-" { "<stdin>" } else { path.as_str() };

        match handle_one(&text, &o, action, stream, label) {
            Ok(Some(output)) => {
                if o.check_only {
                    if output != text {
                        eprintln!("{}: not formatted", label);
                        ok = false;
                    }
                } else if o.write {
                    if output != text {
                        std::fs::write(path, &output)
                            .map_err(|e| Fatal::Io(format!("{}: {}", path, e)))?;
                        eprintln!("{}: formatted", label);
                    }
                } else {
                    if multiple && action != Action::Lint {
                        println!("# {}", label);
                    }
                    print!("{}", output);
                    std::io::stdout().flush().ok();
                }
            }
            Ok(None) => {}
            Err(messages) => {
                for m in messages {
                    eprintln!("{}", m);
                }
                ok = false;
            }
        }
    }
    Ok(ok)
}

/// Produces this command's output for one input, or the diagnostics that rejected it.
fn handle_one(
    text: &str,
    o: &Options,
    action: Action,
    stream: bool,
    label: &str,
) -> Result<Option<String>, Vec<String>> {
    if stream {
        return handle_stream(text, o, action, label);
    }

    let document = parse_document(text).map_err(|e| {
        vec![format!("{}:{}:{}: {}: {}", label, e.line, e.column, e.code, e.message)]
    })?;
    let root = Value::Object(document.root.clone());

    match action {
        Action::Check => {
            println!("{}: ok", label);
            Ok(None)
        }
        Action::Lint => {
            let warnings = lint_document(&document, label);
            if warnings.is_empty() {
                Ok(None)
            } else {
                Err(warnings)
            }
        }
        Action::Parse => {
            let json = to_tagged_json(&root);
            Ok(Some(format!("{}\n", serde_json::to_string_pretty(&json).unwrap())))
        }
        Action::Canon | Action::Fmt => {
            let format = format_for(o, action == Action::Canon);
            let body = document_to_string(&stf::Document { ..document }, &format)
                .map_err(|e| vec![format!("{}: {}: {}", label, e.code, e.message)])?;
            Ok(Some(format!("{}\n", body)))
        }
        Action::Convert => unreachable!("convert is handled separately"),
    }
}

fn handle_stream(
    text: &str,
    o: &Options,
    action: Action,
    label: &str,
) -> Result<Option<String>, Vec<String>> {
    let mut reader = StreamReader::new(text);
    let mut records: Vec<Object> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    // Stream §5: report every bad record with its line, rather than stopping at the first.
    for record in reader.by_ref() {
        match record.result {
            Ok(r) => records.push(r),
            Err(e) => errors.push(format!("{}:{}: {}: {}", label, record.line, e.code, e.message)),
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }
    let directives = reader.directives().to_vec();

    match action {
        Action::Check => {
            println!("{}: ok ({} records)", label, records.len());
            Ok(None)
        }
        Action::Lint => {
            let mut warnings = Vec::new();
            for d in &directives {
                if !matches!(d.name.as_str(), "schema" | "version") {
                    warnings.push(format!("{}:1: warning: unknown directive `@{}`", label, d.name));
                }
            }
            for (i, record) in records.iter().enumerate() {
                lint_value(&Value::Object(record.clone()), "", &mut warnings, label, i + 1);
            }
            if warnings.is_empty() {
                Ok(None)
            } else {
                Err(warnings)
            }
        }
        Action::Parse => {
            let mut out = String::new();
            for record in &records {
                let json = to_tagged_json(&Value::Object(record.clone()));
                out.push_str(&serde_json::to_string(&json).unwrap());
                out.push('\n');
            }
            Ok(Some(out))
        }
        Action::Canon | Action::Fmt => {
            let format = format_for(o, action == Action::Canon);
            let stream = Stream { directives, records };
            let body = stream_to_string(&stream, &format)
                .map_err(|e| vec![format!("{}: {}: {}", label, e.code, e.message)])?;
            Ok(Some(body))
        }
        Action::Convert => unreachable!("convert is handled separately"),
    }
}

fn lint_document(document: &stf::Document, label: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    for d in &document.directives {
        // Spec §5.1: a parser must accept an unknown directive but should warn.
        if !matches!(d.name.as_str(), "schema" | "version") {
            warnings.push(format!("{}: warning: unknown directive `@{}`", label, d.name));
        }
    }
    lint_value(&Value::Object(document.root.clone()), "", &mut warnings, label, 0);
    warnings
}

/// Flags the JSON habits STF exists to remove: a date, an instant, or a big integer smuggled
/// through a string because JSON had no other way to carry it.
fn lint_value(value: &Value, path: &str, out: &mut Vec<String>, label: &str, line: usize) {
    let here = |p: &str| if p.is_empty() { "root".to_string() } else { p.to_string() };
    match value {
        Value::String(s) => {
            let suggestion = if stf::constructors::date(s).is_ok() {
                Some(format!("DATE({})", s))
            } else if stf::constructors::timestamp(s).is_ok() {
                Some(format!("TIMESTAMP({})", s))
            } else if s.len() > 15
                && s.bytes().all(|b| b.is_ascii_digit())
                && stf::constructors::bigint(s).is_ok()
            {
                Some(format!("BIGINT({})", s))
            } else {
                None
            };
            if let Some(suggestion) = suggestion {
                let where_ = if line > 0 {
                    format!("{}:{}", label, line)
                } else {
                    label.to_string()
                };
                out.push(format!(
                    "{}: warning: {} is a string that looks like a typed value; \
                     consider {}",
                    where_,
                    here(path),
                    suggestion
                ));
            }
        }
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                lint_value(item, &format!("{}[{}]", path, i), out, label, line);
            }
        }
        Value::Object(object) => {
            for (key, item) in object.iter() {
                let child =
                    if path.is_empty() { key.to_string() } else { format!("{}.{}", path, key) };
                lint_value(item, &child, out, label, line);
            }
        }
        _ => {}
    }
}

/// Which side of the conversion the target is.
fn target_format(o: &Options) -> Result<&'static str, Fatal> {
    if let Some(to) = &o.to {
        return match to.as_str() {
            "stf" | "stfs" => Ok("stf"),
            "json" | "ndjson" | "jsonl" => Ok("json"),
            other => Err(Fatal::Usage(format!("--to expects `stf` or `json`, got `{}`", other))),
        };
    }
    if let Some(out) = &o.output {
        return match Path::new(out).extension().and_then(|e| e.to_str()) {
            Some("stf") | Some("stfs") => Ok("stf"),
            Some("json") | Some("ndjson") | Some("jsonl") => Ok("json"),
            _ => Err(Fatal::Usage(
                "cannot infer the target from --output; pass --to stf or --to json".into(),
            )),
        };
    }
    Err(Fatal::Usage("pass --to stf or --to json".into()))
}

fn convert(o: &Options) -> Result<bool, Fatal> {
    if o.files.len() != 1 {
        return Err(Fatal::Usage("convert takes exactly one input".into()));
    }
    let path = &o.files[0];
    let target = target_format(o)?;
    let text = read_input(path)?;
    let label = if path == "-" { "<stdin>" } else { path.as_str() };
    let stream = o.stream.unwrap_or_else(|| {
        is_stream_path(path) || o.output.as_deref().is_some_and(is_stream_path)
    });
    let policy =
        if o.lossy { TypedValuePolicy::PayloadAsString } else { TypedValuePolicy::Reject };

    let output = if target == "stf" {
        json_to_stf(&text, o, stream, label)?
    } else {
        stf_to_json(&text, o, stream, label, policy)?
    };

    match &o.output {
        Some(p) => std::fs::write(p, &output).map_err(|e| Fatal::Io(format!("{}: {}", p, e)))?,
        None => {
            print!("{}", output);
            std::io::stdout().flush().ok();
        }
    }
    Ok(true)
}

fn json_to_stf(text: &str, o: &Options, stream: bool, label: &str) -> Result<String, Fatal> {
    let format = format_for(o, false);
    if stream {
        // Migration guide §2 and stream §8: NDJSON converts line by line, and a record whose
        // keys are not STF identifiers is reported with its line number, never renamed.
        let mut records = Vec::new();
        for (i, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let json: serde_json::Value = serde_json::from_str(line)
                .map_err(|e| Fatal::Io(format!("{}:{}: invalid JSON: {}", label, i + 1, e)))?;
            let value = from_json(&json).map_err(|e| {
                Fatal::Io(format!("{}:{}: {}: {}", label, i + 1, e.code, e.message))
            })?;
            match value {
                Value::Object(object) => records.push(object),
                other => {
                    return Err(Fatal::Io(format!(
                        "{}:{}: ERR_ROOT_NOT_OBJECT: a record must be an object, not {}",
                        label,
                        i + 1,
                        other.kind()
                    )))
                }
            }
        }
        let stream = Stream { directives: Vec::new(), records };
        return stream_to_string(&stream, &format)
            .map_err(|e| Fatal::Io(format!("{}: {}: {}", label, e.code, e.message)));
    }

    let json: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| Fatal::Io(format!("{}: invalid JSON: {}", label, e)))?;
    let value =
        from_json(&json).map_err(|e| Fatal::Io(format!("{}: {}: {}", label, e.code, e.message)))?;
    let body = to_string(&value, &format)
        .map_err(|e| Fatal::Io(format!("{}: {}: {}", label, e.code, e.message)))?;
    Ok(format!("{}\n", body))
}

fn stf_to_json(
    text: &str,
    o: &Options,
    stream: bool,
    label: &str,
    policy: TypedValuePolicy,
) -> Result<String, Fatal> {
    if stream {
        let mut out = String::new();
        for record in StreamReader::new(text) {
            let object = record.result.map_err(|e| {
                Fatal::Io(format!("{}:{}: {}: {}", label, record.line, e.code, e.message))
            })?;
            let json = to_json(&Value::Object(object), policy).map_err(|e| {
                Fatal::Io(format!("{}:{}: {}: {}", label, record.line, e.code, e.message))
            })?;
            out.push_str(&serde_json::to_string(&json).unwrap());
            out.push('\n');
        }
        return Ok(out);
    }

    let value =
        stf::parse(text).map_err(|e| {
            Fatal::Io(format!("{}:{}:{}: {}: {}", label, e.line, e.column, e.code, e.message))
        })?;
    let json = to_json(&value, policy)
        .map_err(|e| Fatal::Io(format!("{}: {}: {}", label, e.code, e.message)))?;
    let body = if o.compact {
        serde_json::to_string(&json).unwrap()
    } else {
        serde_json::to_string_pretty(&json).unwrap()
    };
    Ok(format!("{}\n", body))
}
