//! End-to-end tests for the `stf` binary.
//!
//! These drive the real executable so that argument handling, exit codes, and the
//! stdout/stderr split are covered — none of which the library tests can reach.

use std::io::Write;
use std::process::{Command, Output, Stdio};

fn stf(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_stf"))
        .args(args)
        .output()
        .expect("the stf binary should run")
}

fn stf_stdin(args: &[&str], input: &str) -> Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_stf"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("the stf binary should run");
    child.stdin.as_mut().unwrap().write_all(input.as_bytes()).unwrap();
    child.wait_with_output().unwrap()
}

fn out(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).to_string()
}

fn err(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).to_string()
}

fn code(o: &Output) -> i32 {
    o.status.code().unwrap_or(-1)
}

/// A scratch directory that cleans up after itself.
struct TempDir(std::path::PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let mut path = std::env::temp_dir();
        path.push(format!("stf-cli-test-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }

    fn write(&self, name: &str, contents: &str) -> String {
        let p = self.0.join(name);
        std::fs::write(&p, contents).unwrap();
        p.to_str().unwrap().to_string()
    }

    fn read(&self, name: &str) -> String {
        std::fs::read_to_string(self.0.join(name)).unwrap()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const SAMPLE: &str = "@schema(x.schema.stf)\n# a config\n\
{ b: 2, a: `hi`, price: DECIMAL(19.90), when: DATE(2026-01-15), arr: [1, T, N] }\n";

#[test]
fn no_arguments_is_a_usage_error() {
    let o = stf(&[]);
    assert_eq!(code(&o), 2);
}

#[test]
fn help_succeeds() {
    let o = stf(&["--help"]);
    assert_eq!(code(&o), 0);
    assert!(out(&o).contains("USAGE:"));
}

#[test]
fn an_unknown_command_is_a_usage_error() {
    let o = stf(&["bogus"]);
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("unknown command"));
}

#[test]
fn check_accepts_a_valid_document() {
    let dir = TempDir::new("check-ok");
    let path = dir.write("a.stf", SAMPLE);
    let o = stf(&["check", &path]);
    assert_eq!(code(&o), 0);
    assert!(out(&o).contains("ok"));
}

#[test]
fn check_reports_the_normative_code_and_position() {
    let dir = TempDir::new("check-bad");
    let path = dir.write("bad.stf", "{\n  a: 0x10\n}\n");
    let o = stf(&["check", &path]);
    assert_eq!(code(&o), 1);
    let e = err(&o);
    assert!(e.contains("ERR_INVALID_NUMBER"), "{}", e);
    assert!(e.contains(":2:7:"), "expected line:column, got {}", e);
}

#[test]
fn fmt_output_reparses_to_the_same_value() {
    let dir = TempDir::new("fmt");
    let path = dir.write("a.stf", SAMPLE);
    let o = stf(&["fmt", &path]);
    assert_eq!(code(&o), 0);
    let formatted = out(&o);
    assert!(formatted.contains("\n  b: 2,"), "{}", formatted);
    assert_eq!(
        stf::parse(&formatted).unwrap(),
        stf::parse(SAMPLE).unwrap(),
        "formatting must not change the value"
    );
}

#[test]
fn fmt_write_is_idempotent_and_check_agrees() {
    let dir = TempDir::new("fmt-write");
    let path = dir.write("a.stf", SAMPLE);

    assert_eq!(code(&stf(&["fmt", "--check", &path])), 1, "unformatted input must fail --check");

    assert_eq!(code(&stf(&["fmt", "-w", &path])), 0);
    let once = dir.read("a.stf");

    assert_eq!(code(&stf(&["fmt", "-w", &path])), 0);
    assert_eq!(dir.read("a.stf"), once, "formatting must be idempotent");

    assert_eq!(code(&stf(&["fmt", "--check", &path])), 0);
}

#[test]
fn fmt_reads_standard_input() {
    let o = stf_stdin(&["fmt", "--compact"], "{ a : 1 , b : `x` }");
    assert_eq!(code(&o), 0);
    assert_eq!(out(&o).trim_end(), "{a:1,b:`x`}");
}

#[test]
fn canon_sorts_members_and_is_stable() {
    let o = stf_stdin(&["canon"], "{b: 2, a: 1}");
    assert_eq!(code(&o), 0);
    assert_eq!(out(&o).trim_end(), "{a:1,b:2}");
    let again = stf_stdin(&["canon"], "{a: 1, b: 2}");
    assert_eq!(out(&again).trim_end(), "{a:1,b:2}");
}

#[test]
fn parse_emits_tagged_json_that_separates_kinds() {
    let o = stf_stdin(&["parse", "--compact"], "{s: `1.5`, d: DECIMAL(1.5)}");
    assert_eq!(code(&o), 0);
    let json: serde_json::Value = serde_json::from_str(&out(&o)).unwrap();
    assert_eq!(json["s"], serde_json::json!("1.5"));
    assert_eq!(json["d"], serde_json::json!({"$": "dec", "v": "1.5"}));
}

#[test]
fn lint_warns_about_stringly_typed_values_and_unknown_directives() {
    let dir = TempDir::new("lint");
    let path = dir.write(
        "l.stf",
        "@nope(1)\n{created: `2026-01-15`, id: `9007199254740993`, ok: `hello`}\n",
    );
    let o = stf(&["lint", &path]);
    assert_eq!(code(&o), 1);
    let e = err(&o);
    assert!(e.contains("unknown directive `@nope`"), "{}", e);
    assert!(e.contains("DATE(2026-01-15)"), "{}", e);
    assert!(e.contains("BIGINT(9007199254740993)"), "{}", e);
    assert!(!e.contains("ok is a string"), "an ordinary string must not be flagged: {}", e);
    assert_eq!(e.lines().count(), 3, "exactly three warnings expected: {}", e);
}

#[test]
fn lint_is_silent_on_a_clean_document() {
    let dir = TempDir::new("lint-clean");
    let path = dir.write("l.stf", "@schema(x)\n{created: DATE(2026-01-15), ok: `hello`}\n");
    let o = stf(&["lint", &path]);
    assert_eq!(code(&o), 0);
    assert_eq!(err(&o), "");
}

#[test]
fn convert_json_to_stf() {
    let dir = TempDir::new("conv-j2s");
    let path = dir.write("in.json", r#"{"a":1,"b":[true,null,"x"],"c":{"d":1.5}}"#);
    let o = stf(&["convert", &path, "--to", "stf", "--compact"]);
    assert_eq!(code(&o), 0);
    assert_eq!(out(&o).trim_end(), "{a:1,b:[T,N,`x`],c:{d:1.5}}");
}

#[test]
fn convert_refuses_json_that_stf_cannot_represent() {
    let dir = TempDir::new("conv-refuse");
    for (name, body, needle) in [
        ("bad-key.json", r#"{"a.b":1}"#, "not a valid STF identifier"),
        ("root.json", "[1,2]", "must be an object"),
        ("big.json", r#"{"id":9007199254740993}"#, "BIGINT"),
    ] {
        let path = dir.write(name, body);
        let o = stf(&["convert", &path, "--to", "stf"]);
        assert_eq!(code(&o), 1, "{} should be refused", name);
        let e = err(&o);
        assert!(e.contains("ERR_UNREPRESENTABLE"), "{}: {}", name, e);
        assert!(e.contains(needle), "{}: {}", name, e);
    }
}

#[test]
fn convert_to_json_refuses_typed_values_unless_lossy() {
    let dir = TempDir::new("conv-s2j");
    let path = dir.write("a.stf", "{price: DECIMAL(19.90)}\n");

    let strict = stf(&["convert", &path, "--to", "json"]);
    assert_eq!(code(&strict), 1);
    assert!(err(&strict).contains("ERR_UNREPRESENTABLE"), "{}", err(&strict));

    let lossy = stf(&["convert", &path, "--to", "json", "--lossy", "--compact"]);
    assert_eq!(code(&lossy), 0);
    assert_eq!(out(&lossy).trim_end(), r#"{"price":"19.90"}"#);
}

#[test]
fn convert_needs_to_know_its_target() {
    let dir = TempDir::new("conv-target");
    let path = dir.write("a.stf", "{a:1}\n");
    let o = stf(&["convert", &path]);
    assert_eq!(code(&o), 2);
    assert!(err(&o).contains("--to"), "{}", err(&o));
}

#[test]
fn stream_commands_are_selected_by_extension() {
    let dir = TempDir::new("stream");
    let path = dir.write("s.stfs", "@schema(e.stf)\n{b:1,a:2}\n{c:3}\n");

    let check = stf(&["check", &path]);
    assert_eq!(code(&check), 0);
    assert!(out(&check).contains("2 records"), "{}", out(&check));

    let canon = stf(&["canon", &path]);
    assert_eq!(out(&canon), "@schema(e.stf)\n{a:2,b:1}\n{c:3}\n");
}

#[test]
fn stream_errors_carry_line_numbers_and_do_not_stop_at_the_first() {
    let dir = TempDir::new("stream-bad");
    let path = dir.write("bad.stfs", "{a:1}\n{oops\n{b:2}\n[1]\n");
    let o = stf(&["check", &path]);
    assert_eq!(code(&o), 1);
    let e = err(&o);
    assert!(e.contains(":2: ERR_MISSING_COLON"), "{}", e);
    assert!(e.contains(":4: ERR_ROOT_NOT_OBJECT"), "{}", e);
}

#[test]
fn ndjson_converts_to_a_stream_and_back() {
    let dir = TempDir::new("ndjson");
    let source = dir.write("s.ndjson", "{\"a\":1}\n{\"b\":2}\n");
    let target = dir.0.join("out.stfs").to_str().unwrap().to_string();

    assert_eq!(code(&stf(&["convert", &source, "-o", &target])), 0);
    assert_eq!(dir.read("out.stfs"), "{a:1}\n{b:2}\n");

    let back = dir.0.join("back.jsonl").to_str().unwrap().to_string();
    assert_eq!(code(&stf(&["convert", &target, "-o", &back])), 0);
    assert_eq!(dir.read("back.jsonl"), "{\"a\":1}\n{\"b\":2}\n");
}

#[test]
fn ndjson_conversion_reports_the_offending_line() {
    let dir = TempDir::new("ndjson-bad");
    let source = dir.write("s.ndjson", "{\"a\":1}\n{\"a.b\":2}\n");
    let o = stf(&["convert", &source, "--to", "stf", "--stream"]);
    assert_eq!(code(&o), 1);
    assert!(err(&o).contains(":2:"), "{}", err(&o));
}

#[test]
fn invalid_utf8_is_rejected_before_parsing() {
    let dir = TempDir::new("utf8");
    let path = dir.0.join("bad.stf");
    std::fs::write(&path, b"{a: \xFF}").unwrap();
    let o = stf(&["check", path.to_str().unwrap()]);
    assert_eq!(code(&o), 1);
    assert!(err(&o).contains("ERR_INVALID_UTF8"), "{}", err(&o));
}
