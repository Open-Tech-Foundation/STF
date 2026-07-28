//! A Language Server Protocol server for STF.
//!
//! Editors are where most STF is written, so the diagnostics an author sees while typing
//! should be the same ones `stf check` and `stf lint` produce in CI — same normative error
//! code, same rule, same position. This server is a thin layer over the reference parser
//! rather than a second, approximate one.
//!
//! It speaks [LSP 3.17](https://microsoft.github.io/language-server-protocol/) over stdio and
//! implements the subset that a data format needs:
//!
//! * `textDocument/publishDiagnostics` — parse errors carrying their `ERR_*` code, plus lint
//!   warnings, recomputed on open, change, and save.
//! * `textDocument/formatting` — the formatting `stf fmt` performs.
//!
//! Both `.stf` documents and `.stfs` streams are served; the URI's extension selects the
//! framing, as it does on the command line.
//!
//! Positions are UTF-16 code unit offsets, the protocol's default encoding, which is not what
//! [`crate::Error`] carries — it counts Unicode scalar values, and its offsets are bytes. The
//! conversion happens in [`LineIndex`].

use std::collections::HashMap;
use std::io::{self, BufRead, Write};

use serde_json::{json, Value as Json};

use crate::stream::{parse_stream_with_limits, stream_to_string, StreamReader};
use crate::{document_to_string, lint, parse_document_with_spans, parse_record_with_spans};
use crate::{Format, Limits};

/// JSON-RPC error codes used by this server.
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;

/// Severities from the protocol's `DiagnosticSeverity`.
const SEVERITY_ERROR: u8 = 1;
const SEVERITY_WARNING: u8 = 2;

/// How a document is framed. Taken from the URI, so an editor that opens a `.stfs` file gets
/// per-record diagnostics rather than one "trailing content" error on line 2.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framing {
    /// A discrete `.stf` document (spec §5).
    Document,
    /// An STF Stream (`.stfs`).
    Stream,
}

impl Framing {
    /// Infers the framing from a document URI or path.
    pub fn for_uri(uri: &str) -> Framing {
        let path = uri.split(['?', '#']).next().unwrap_or(uri);
        if path.rsplit('.').next().is_some_and(|e| e.eq_ignore_ascii_case("stfs")) {
            Framing::Stream
        } else {
            Framing::Document
        }
    }
}

/// A zero-based position in UTF-16 code units, as the protocol defines it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

/// One published diagnostic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub range: Range,
    pub severity: u8,
    /// The normative `ERR_*` code for an error, or the lint rule name for a warning.
    pub code: String,
    pub message: String,
}

impl Diagnostic {
    fn to_json(&self) -> Json {
        json!({
            "range": {
                "start": { "line": self.range.start.line, "character": self.range.start.character },
                "end": { "line": self.range.end.line, "character": self.range.end.character },
            },
            "severity": self.severity,
            "code": self.code,
            "source": "stf",
            "message": self.message,
        })
    }
}

/// Byte offset to line/UTF-16 column, computed once per document version.
pub struct LineIndex<'a> {
    text: &'a str,
    /// Byte offset of the start of each line.
    starts: Vec<usize>,
}

impl<'a> LineIndex<'a> {
    pub fn new(text: &'a str) -> Self {
        let mut starts = vec![0];
        for (i, b) in text.bytes().enumerate() {
            if b == b'\n' {
                starts.push(i + 1);
            }
        }
        LineIndex { text, starts }
    }

    /// Byte offset where 1-based `line` begins. Out-of-range lines clamp to the end.
    fn line_start(&self, line: usize) -> usize {
        match line.checked_sub(1).and_then(|i| self.starts.get(i)) {
            Some(&start) => start,
            None => self.text.len(),
        }
    }

    /// The text of 1-based `line`, without its terminator.
    fn line_text(&self, line: usize) -> &'a str {
        let start = self.line_start(line);
        let end = match self.starts.get(line) {
            Some(&next) => next,
            None => self.text.len(),
        };
        self.text[start..end].trim_end_matches('\n').trim_end_matches('\r')
    }

    /// Converts a byte offset into a protocol position.
    pub fn position(&self, offset: usize) -> Position {
        let offset = offset.min(self.text.len());
        // The last line whose start is at or before `offset`.
        let line = match self.starts.binary_search(&offset) {
            Ok(i) => i,
            Err(i) => i - 1,
        };
        let start = self.starts[line];
        // A byte offset can land inside a multi-byte scalar only if a caller invented it;
        // walking characters rather than slicing keeps that from panicking.
        let mut character = 0u32;
        for (i, c) in self.text[start..].char_indices() {
            if start + i >= offset {
                break;
            }
            character += c.len_utf16() as u32;
        }
        Position { line: line as u32, character }
    }

    /// The position one past the last character of the document.
    pub fn end_position(&self) -> Position {
        self.position(self.text.len())
    }
}

/// The end of the token starting at `offset`, so a diagnostic underlines something.
///
/// An error is reported at the first offending byte. Highlighting a single character there is
/// accurate but nearly invisible, so an identifier-like run is extended to its end.
fn token_end(text: &str, offset: usize) -> usize {
    let bytes = text.as_bytes();
    if offset >= bytes.len() {
        return bytes.len();
    }
    let is_word = |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'-';
    if is_word(bytes[offset]) {
        let mut end = offset;
        while end < bytes.len() && is_word(bytes[end]) {
            end += 1;
        }
        return end;
    }
    // Otherwise one whole scalar value, never a partial one.
    text[offset..].chars().next().map(|c| offset + c.len_utf8()).unwrap_or(bytes.len())
}

/// Every diagnostic for `text`: parse errors first, then lint warnings.
///
/// A document that does not parse produces exactly one error and no warnings, because there is
/// no tree to lint. A stream produces one error per malformed record (stream §5), so a single
/// bad line does not hide the rest.
pub fn diagnostics(text: &str, framing: Framing) -> Vec<Diagnostic> {
    let index = LineIndex::new(text);
    match framing {
        Framing::Document => document_diagnostics(text, &index),
        Framing::Stream => stream_diagnostics(text, &index),
    }
}

fn document_diagnostics(text: &str, index: &LineIndex) -> Vec<Diagnostic> {
    match parse_document_with_spans(text, Limits::default()) {
        Err(e) => vec![error_diagnostic(text, index, e.offset, &e.code.to_string(), &e.message)],
        Ok((document, spans)) => lint::lint(&document, &spans)
            .into_iter()
            .map(|w| warning_diagnostic(index, w.start, w.end, w.rule.as_str(), &w.message))
            .collect(),
    }
}

fn stream_diagnostics(text: &str, index: &LineIndex) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    let mut reader = StreamReader::new(text);
    let mut good: Vec<usize> = Vec::new();
    for record in reader.by_ref() {
        match record.result {
            Ok(_) => good.push(record.line),
            Err(e) => {
                // Record errors carry an offset within their own line (stream §2.1).
                let offset = index.line_start(record.line) + e.offset;
                out.push(error_diagnostic(
                    text,
                    index,
                    offset,
                    &e.code.to_string(),
                    &e.message,
                ));
            }
        }
    }
    // The header is a line of directives with no root object, so it is linted as a document
    // with an empty one appended — the same rule, over the same span table.
    if let Some((line, header)) = crate::stream::header_line(text) {
        let source = format!("{}\n{{}}", header);
        if let Ok((document, spans)) = parse_document_with_spans(&source, Limits::default()) {
            let base = index.line_start(line);
            for w in lint::lint(&document, &spans) {
                out.push(warning_diagnostic(
                    index,
                    base + w.start,
                    base + w.end,
                    w.rule.as_str(),
                    &w.message,
                ));
            }
        }
    }
    for line in good {
        let start = index.line_start(line);
        let record_text = index.line_text(line);
        let Ok((record, spans)) = parse_record_with_spans(record_text, Limits::default()) else {
            continue;
        };
        for w in lint::lint_record(&record, &spans) {
            out.push(warning_diagnostic(
                index,
                start + w.start,
                start + w.end,
                w.rule.as_str(),
                &w.message,
            ));
        }
    }
    out
}

fn error_diagnostic(
    text: &str,
    index: &LineIndex,
    offset: usize,
    code: &str,
    message: &str,
) -> Diagnostic {
    let start = offset.min(text.len());
    Diagnostic {
        range: Range { start: index.position(start), end: index.position(token_end(text, start)) },
        severity: SEVERITY_ERROR,
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn warning_diagnostic(
    index: &LineIndex,
    start: usize,
    end: usize,
    rule: &str,
    message: &str,
) -> Diagnostic {
    Diagnostic {
        range: Range { start: index.position(start), end: index.position(end) },
        severity: SEVERITY_WARNING,
        code: rule.to_string(),
        message: message.to_string(),
    }
}

/// Reformats a document, or returns `None` when it does not parse — an editor must never be
/// handed a "formatted" document built from a guess about what the author meant.
pub fn format_text(text: &str, framing: Framing, indent: &str) -> Option<String> {
    let format = Format::pretty(indent);
    match framing {
        Framing::Document => {
            let document = crate::parse_document(text).ok()?;
            // `document_to_string` emits no trailing newline; `stf fmt` adds one, and a
            // formatter that strips the final newline from every file on save would be a
            // constant source of one-line diffs.
            document_to_string(&document, &format).ok().map(|body| format!("{}\n", body))
        }
        Framing::Stream => {
            let stream = parse_stream_with_limits(text, Limits::default()).ok()?;
            stream_to_string(&stream, &format).ok()
        }
    }
}

/// A server bound to one output stream, holding the text of every open document.
///
/// The protocol makes the client's copy authoritative, so the server keeps the full text of
/// each open document and replaces it wholesale on change (`TextDocumentSyncKind.Full`).
pub struct Server<W: Write> {
    out: W,
    documents: HashMap<String, String>,
    shutdown_requested: bool,
}

impl<W: Write> Server<W> {
    pub fn new(out: W) -> Self {
        Server { out, documents: HashMap::new(), shutdown_requested: false }
    }

    /// Runs the message loop until `exit`, or until the input ends.
    ///
    /// Returns the process exit code the protocol prescribes: 0 when `exit` followed
    /// `shutdown`, 1 when it did not.
    pub fn serve<R: BufRead>(&mut self, input: &mut R) -> io::Result<i32> {
        loop {
            match read_message(input)? {
                None => return Ok(1), // The client vanished without saying `exit`.
                Some(Err(message)) => {
                    self.respond_error(Json::Null, PARSE_ERROR, &message)?;
                }
                Some(Ok(message)) => {
                    if self.handle(&message)? {
                        return Ok(if self.shutdown_requested { 0 } else { 1 });
                    }
                }
            }
        }
    }

    /// Handles one message. Returns true when the server should exit.
    fn handle(&mut self, message: &Json) -> io::Result<bool> {
        let method = message.get("method").and_then(Json::as_str);
        let id = message.get("id").cloned();
        let params = message.get("params").cloned().unwrap_or(Json::Null);

        let Some(method) = method else {
            // A response to a request we never sent, or nonsense. Neither is actionable.
            if let Some(id) = id {
                self.respond_error(id, INVALID_REQUEST, "expected a method")?;
            }
            return Ok(false);
        };

        match (method, id) {
            ("initialize", Some(id)) => {
                self.respond(id, initialize_result())?;
            }
            ("initialized", _) => {}
            ("shutdown", Some(id)) => {
                self.shutdown_requested = true;
                self.respond(id, Json::Null)?;
            }
            ("exit", _) => return Ok(true),
            ("textDocument/didOpen", _) => {
                if let Some((uri, text)) = opened_document(&params) {
                    self.documents.insert(uri.clone(), text);
                    self.publish(&uri)?;
                }
            }
            ("textDocument/didChange", _) => {
                if let Some(uri) = document_uri(&params) {
                    // Full sync: the last content change carries the whole document.
                    if let Some(text) = params
                        .get("contentChanges")
                        .and_then(Json::as_array)
                        .and_then(|c| c.last())
                        .and_then(|c| c.get("text"))
                        .and_then(Json::as_str)
                    {
                        self.documents.insert(uri.clone(), text.to_string());
                        self.publish(&uri)?;
                    }
                }
            }
            ("textDocument/didSave", _) => {
                if let Some(uri) = document_uri(&params) {
                    if let Some(text) = params.get("text").and_then(Json::as_str) {
                        self.documents.insert(uri.clone(), text.to_string());
                    }
                    self.publish(&uri)?;
                }
            }
            ("textDocument/didClose", _) => {
                if let Some(uri) = document_uri(&params) {
                    self.documents.remove(&uri);
                    // Diagnostics for a closed document are the client's to forget, but only
                    // after the server clears them.
                    self.notify(
                        "textDocument/publishDiagnostics",
                        json!({ "uri": uri, "diagnostics": [] }),
                    )?;
                }
            }
            ("textDocument/formatting", Some(id)) => {
                let result = self.formatting(&params);
                self.respond(id, result)?;
            }
            (_, Some(id)) => {
                self.respond_error(id, METHOD_NOT_FOUND, &format!("unsupported: {}", method))?;
            }
            // An unknown notification must be ignored (LSP §"Request, Notification …").
            (_, None) => {}
        }
        Ok(false)
    }

    fn formatting(&self, params: &Json) -> Json {
        let Some(uri) = document_uri(params) else { return Json::Null };
        let Some(text) = self.documents.get(&uri) else { return Json::Null };
        let indent = indent_from(params.get("options"));
        let Some(formatted) = format_text(text, Framing::for_uri(&uri), &indent) else {
            // Malformed input: the diagnostics already say why. Formatting reports no edits
            // rather than an error, which is what editors handle gracefully.
            return Json::Null;
        };
        if &formatted == text {
            return json!([]);
        }
        let index = LineIndex::new(text);
        let end = index.end_position();
        json!([{
            "range": {
                "start": { "line": 0, "character": 0 },
                "end": { "line": end.line, "character": end.character },
            },
            "newText": formatted,
        }])
    }

    fn publish(&mut self, uri: &str) -> io::Result<()> {
        let Some(text) = self.documents.get(uri) else { return Ok(()) };
        let diagnostics: Vec<Json> =
            diagnostics(text, Framing::for_uri(uri)).iter().map(Diagnostic::to_json).collect();
        self.notify(
            "textDocument/publishDiagnostics",
            json!({ "uri": uri, "diagnostics": diagnostics }),
        )
    }

    fn respond(&mut self, id: Json, result: Json) -> io::Result<()> {
        self.send(&json!({ "jsonrpc": "2.0", "id": id, "result": result }))
    }

    fn respond_error(&mut self, id: Json, code: i64, message: &str) -> io::Result<()> {
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }))
    }

    fn notify(&mut self, method: &str, params: Json) -> io::Result<()> {
        self.send(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
    }

    fn send(&mut self, message: &Json) -> io::Result<()> {
        write_message(&mut self.out, message)
    }
}

fn initialize_result() -> Json {
    json!({
        "capabilities": {
            "positionEncoding": "utf-16",
            "textDocumentSync": {
                "openClose": true,
                "change": 1, // Full
                "save": { "includeText": true },
            },
            "documentFormattingProvider": true,
        },
        "serverInfo": { "name": "stf", "version": env!("CARGO_PKG_VERSION") },
    })
}

fn document_uri(params: &Json) -> Option<String> {
    params.get("textDocument")?.get("uri")?.as_str().map(str::to_string)
}

fn opened_document(params: &Json) -> Option<(String, String)> {
    let document = params.get("textDocument")?;
    let uri = document.get("uri")?.as_str()?.to_string();
    let text = document.get("text")?.as_str()?.to_string();
    Some((uri, text))
}

/// The indent the client asked for. STF is indented with spaces by default (`stf fmt`
/// `--indent`), but a client that wants tabs gets them.
fn indent_from(options: Option<&Json>) -> String {
    let Some(options) = options else { return "  ".to_string() };
    let spaces = options.get("insertSpaces").and_then(Json::as_bool).unwrap_or(true);
    let size = options.get("tabSize").and_then(Json::as_u64).unwrap_or(2).clamp(1, 16) as usize;
    if spaces {
        " ".repeat(size)
    } else {
        "\t".to_string()
    }
}

/// Reads one `Content-Length`-framed message.
///
/// `Ok(None)` is end of input. `Ok(Some(Err(_)))` is a message that arrived intact but is not
/// JSON, which the protocol answers with a parse error rather than by hanging up.
fn read_message<R: BufRead>(input: &mut R) -> io::Result<Option<Result<Json, String>>> {
    let mut length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if input.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        let line = line.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            break; // End of headers.
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("Content-Length") {
                length = value.trim().parse().ok();
            }
        }
    }
    let Some(length) = length else {
        return Ok(Some(Err("message has no Content-Length header".to_string())));
    };
    let mut body = vec![0u8; length];
    input.read_exact(&mut body)?;
    let text = match String::from_utf8(body) {
        Ok(text) => text,
        Err(_) => return Ok(Some(Err("message body is not valid UTF-8".to_string()))),
    };
    Ok(Some(serde_json::from_str(&text).map_err(|e| e.to_string())))
}

fn write_message<W: Write>(out: &mut W, message: &Json) -> io::Result<()> {
    let body = serde_json::to_string(message)?;
    write!(out, "Content-Length: {}\r\n\r\n{}", body.len(), body)?;
    out.flush()
}

/// Serves the protocol over stdio, as an editor launches it.
pub fn serve_stdio() -> io::Result<i32> {
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let mut server = Server::new(io::stdout().lock());
    server.serve(&mut input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// Frames `messages` as a client would, runs the server, and returns what it wrote.
    fn exchange(messages: &[Json]) -> Vec<Json> {
        let mut input = Vec::new();
        for message in messages {
            let body = serde_json::to_string(message).unwrap();
            input.extend_from_slice(
                format!("Content-Length: {}\r\n\r\n{}", body.len(), body).as_bytes(),
            );
        }
        let mut out = Vec::new();
        let mut server = Server::new(&mut out);
        server.serve(&mut Cursor::new(input)).unwrap();
        decode(&out)
    }

    fn decode(bytes: &[u8]) -> Vec<Json> {
        let mut cursor = Cursor::new(bytes);
        let mut out = Vec::new();
        while let Some(message) = read_message(&mut cursor).unwrap() {
            out.push(message.unwrap());
        }
        out
    }

    fn did_open(uri: &str, text: &str) -> Json {
        json!({
            "jsonrpc": "2.0",
            "method": "textDocument/didOpen",
            "params": {
                "textDocument":
                    { "uri": uri, "languageId": "stf", "version": 1, "text": text },
            },
        })
    }

    fn diagnostics_of(message: &Json) -> &Vec<Json> {
        message["params"]["diagnostics"].as_array().unwrap()
    }

    #[test]
    fn initialize_advertises_what_it_implements() {
        let out = exchange(&[
            json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }),
            json!({ "jsonrpc": "2.0", "method": "exit" }),
        ]);
        assert_eq!(out.len(), 1);
        let capabilities = &out[0]["result"]["capabilities"];
        assert_eq!(capabilities["positionEncoding"], "utf-16");
        assert_eq!(capabilities["textDocumentSync"]["change"], 1);
        assert_eq!(capabilities["documentFormattingProvider"], true);
        assert_eq!(out[0]["id"], 1);
    }

    #[test]
    fn shutdown_then_exit_is_a_clean_exit() {
        let mut input = Vec::new();
        for message in [
            json!({ "jsonrpc": "2.0", "id": 1, "method": "shutdown" }),
            json!({ "jsonrpc": "2.0", "method": "exit" }),
        ] {
            let body = serde_json::to_string(&message).unwrap();
            input.extend_from_slice(
                format!("Content-Length: {}\r\n\r\n{}", body.len(), body).as_bytes(),
            );
        }
        let mut out = Vec::new();
        let mut server = Server::new(&mut out);
        assert_eq!(server.serve(&mut Cursor::new(input)).unwrap(), 0);
        let messages = decode(&out);
        assert_eq!(messages[0]["result"], Json::Null);
    }

    #[test]
    fn exit_without_shutdown_reports_failure() {
        let body = serde_json::to_string(&json!({ "jsonrpc": "2.0", "method": "exit" })).unwrap();
        let input = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut out = Vec::new();
        let mut server = Server::new(&mut out);
        assert_eq!(server.serve(&mut Cursor::new(input.into_bytes())).unwrap(), 1);
    }

    #[test]
    fn a_clean_document_publishes_no_diagnostics() {
        let out = exchange(&[did_open("file:///a.stf", "{ a: 1 }\n")]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["method"], "textDocument/publishDiagnostics");
        assert_eq!(out[0]["params"]["uri"], "file:///a.stf");
        assert!(diagnostics_of(&out[0]).is_empty());
    }

    #[test]
    fn a_parse_error_carries_its_normative_code_and_position() {
        let out = exchange(&[did_open("file:///a.stf", "{\n  a: 0x10,\n}\n")]);
        let diagnostics = diagnostics_of(&out[0]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0]["code"], "ERR_INVALID_NUMBER");
        assert_eq!(diagnostics[0]["severity"], SEVERITY_ERROR);
        assert_eq!(diagnostics[0]["source"], "stf");
        // Line 2 (zero-based 1), at the `x` that ends the number token.
        assert_eq!(diagnostics[0]["range"]["start"]["line"], 1);
        assert_eq!(diagnostics[0]["range"]["start"]["character"], 6);
    }

    #[test]
    fn an_unknown_constructor_underlines_the_whole_name() {
        let out = exchange(&[did_open("file:///a.stf", "{ a: DATETIME(x) }")]);
        let d = &diagnostics_of(&out[0])[0];
        assert_eq!(d["code"], "ERR_UNKNOWN_CONSTRUCTOR");
        assert_eq!(d["range"]["start"]["character"], 5);
        assert_eq!(d["range"]["end"]["character"], 13);
    }

    #[test]
    fn lint_warnings_are_published_for_a_valid_document() {
        let out = exchange(&[did_open("file:///a.stf", "{ created: `2026-01-15` }")]);
        let diagnostics = diagnostics_of(&out[0]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0]["severity"], SEVERITY_WARNING);
        assert_eq!(diagnostics[0]["code"], "stringly-typed");
        assert_eq!(diagnostics[0]["range"]["start"]["character"], 11);
        assert_eq!(diagnostics[0]["range"]["end"]["character"], 23);
    }

    /// The protocol counts UTF-16 code units, so an emoji before the error shifts the column
    /// by two, and an accented letter by one.
    #[test]
    fn positions_are_utf16_code_units() {
        let out = exchange(&[did_open("file:///a.stf", "{ a: `🎈é`, b: 0x1 }")]);
        let d = &diagnostics_of(&out[0])[0];
        assert_eq!(d["code"], "ERR_INVALID_NUMBER");
        // `{ a: ` = 5, backtick + emoji(2) + é(1) + backtick = 5, `, b: ` = 5, then `0x1`
        // where `x` is the offending character.
        assert_eq!(d["range"]["start"]["character"], 16);
    }

    #[test]
    fn a_change_recomputes_diagnostics() {
        let out = exchange(&[
            did_open("file:///a.stf", "{ a: 0x10 }"),
            json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didChange",
                "params": {
                    "textDocument": { "uri": "file:///a.stf", "version": 2 },
                    "contentChanges": [{ "text": "{ a: 16 }" }],
                },
            }),
        ]);
        assert_eq!(out.len(), 2);
        assert_eq!(diagnostics_of(&out[0]).len(), 1);
        assert!(diagnostics_of(&out[1]).is_empty());
    }

    #[test]
    fn closing_a_document_clears_its_diagnostics() {
        let out = exchange(&[
            did_open("file:///a.stf", "{ a: 0x10 }"),
            json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didClose",
                "params": { "textDocument": { "uri": "file:///a.stf" } },
            }),
        ]);
        assert_eq!(out.len(), 2);
        assert!(diagnostics_of(&out[1]).is_empty());
    }

    #[test]
    fn a_stream_reports_every_bad_record() {
        let text = "{ a: 1 }\n{ b: 0x10 }\n{ c: 3 }\n{ d: }\n";
        let out = exchange(&[did_open("file:///a.stfs", text)]);
        let diagnostics = diagnostics_of(&out[0]);
        assert_eq!(diagnostics.len(), 2);
        assert_eq!(diagnostics[0]["code"], "ERR_INVALID_NUMBER");
        assert_eq!(diagnostics[0]["range"]["start"]["line"], 1);
        assert_eq!(diagnostics[0]["range"]["start"]["character"], 6);
        assert_eq!(diagnostics[1]["range"]["start"]["line"], 3);
    }

    #[test]
    fn a_stream_lints_each_record_in_place() {
        let text = "{ a: 1 }\n{ at: `2026-01-15` }\n";
        let out = exchange(&[did_open("file:///a.stfs", text)]);
        let diagnostics = diagnostics_of(&out[0]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0]["code"], "stringly-typed");
        assert_eq!(diagnostics[0]["range"]["start"]["line"], 1);
        assert_eq!(diagnostics[0]["range"]["start"]["character"], 6);
        assert_eq!(diagnostics[0]["range"]["end"]["character"], 18);
    }

    #[test]
    fn a_stream_lints_its_header_directives() {
        let text = "# notes\n@nope(1)\n{ a: 1 }\n";
        let out = exchange(&[did_open("file:///a.stfs", text)]);
        let diagnostics = diagnostics_of(&out[0]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0]["code"], "unknown-directive");
        // The whole `@nope(1)` on line 2 is underlined, not just the name.
        assert_eq!(diagnostics[0]["range"]["start"], json!({ "line": 1, "character": 0 }));
        assert_eq!(diagnostics[0]["range"]["end"], json!({ "line": 1, "character": 8 }));
    }

    /// A `@` line that is not the first non-ignorable one is a malformed record, and must be
    /// reported as one rather than mistaken for a second header.
    #[test]
    fn a_late_directive_line_is_a_record_error() {
        let out = exchange(&[did_open("file:///a.stfs", "{ a: 1 }\n@version(1.0)\n")]);
        let diagnostics = diagnostics_of(&out[0]);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0]["code"], "ERR_STREAM_DIRECTIVE_IN_RECORD");
        assert_eq!(diagnostics[0]["range"]["start"]["line"], 1);
    }

    /// The same bytes are a document or a stream depending only on the URI.
    #[test]
    fn framing_follows_the_extension() {
        assert_eq!(Framing::for_uri("file:///a.stf"), Framing::Document);
        assert_eq!(Framing::for_uri("file:///a.stfs"), Framing::Stream);
        assert_eq!(Framing::for_uri("file:///a.STFS"), Framing::Stream);
        assert_eq!(Framing::for_uri("untitled:Untitled-1"), Framing::Document);
        let text = "{ a: 1 }\n{ b: 2 }\n";
        assert_eq!(diagnostics(text, Framing::Stream).len(), 0);
        assert_eq!(diagnostics(text, Framing::Document)[0].code, "ERR_TRAILING_CONTENT");
    }

    #[test]
    fn formatting_returns_one_whole_document_edit() {
        let out = exchange(&[
            did_open("file:///a.stf", "{a:1,b:[2,3]}"),
            json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "textDocument/formatting",
                "params": {
                    "textDocument": { "uri": "file:///a.stf" },
                    "options": { "tabSize": 2, "insertSpaces": true },
                },
            }),
        ]);
        let edits = out[1]["result"].as_array().unwrap();
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0]["range"]["start"], json!({ "line": 0, "character": 0 }));
        assert_eq!(edits[0]["range"]["end"], json!({ "line": 0, "character": 13 }));
        assert_eq!(edits[0]["newText"], "{\n  a: 1,\n  b: [\n    2,\n    3,\n  ],\n}\n");
    }

    #[test]
    fn formatting_honours_the_requested_indent() {
        let out = exchange(&[
            did_open("file:///a.stf", "{a:1}"),
            json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "textDocument/formatting",
                "params": {
                    "textDocument": { "uri": "file:///a.stf" },
                    "options": { "tabSize": 4, "insertSpaces": true },
                },
            }),
        ]);
        assert_eq!(out[1]["result"][0]["newText"], "{\n    a: 1,\n}\n");
    }

    #[test]
    fn formatting_an_already_formatted_document_edits_nothing() {
        let out = exchange(&[
            did_open("file:///a.stf", "{\n  a: 1,\n}\n"),
            json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "textDocument/formatting",
                "params": { "textDocument": { "uri": "file:///a.stf" }, "options": {} },
            }),
        ]);
        assert_eq!(out[1]["result"], json!([]));
    }

    #[test]
    fn formatting_a_malformed_document_makes_no_edit() {
        let out = exchange(&[
            did_open("file:///a.stf", "{ a: 0x10 }"),
            json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "textDocument/formatting",
                "params": { "textDocument": { "uri": "file:///a.stf" }, "options": {} },
            }),
        ]);
        assert_eq!(out[1]["result"], Json::Null);
    }

    #[test]
    fn an_unsupported_request_is_answered_not_ignored() {
        let out = exchange(&[json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "textDocument/rename",
            "params": {},
        })]);
        assert_eq!(out[0]["id"], 3);
        assert_eq!(out[0]["error"]["code"], METHOD_NOT_FOUND);
    }

    #[test]
    fn an_unknown_notification_is_ignored() {
        let out = exchange(&[json!({ "jsonrpc": "2.0", "method": "$/setTrace", "params": {} })]);
        assert!(out.is_empty());
    }

    #[test]
    fn a_malformed_body_gets_a_parse_error() {
        let input = b"Content-Length: 3\r\n\r\n{ x".to_vec();
        let mut out = Vec::new();
        let mut server = Server::new(&mut out);
        server.serve(&mut Cursor::new(input)).unwrap();
        let messages = decode(&out);
        assert_eq!(messages[0]["error"]["code"], PARSE_ERROR);
    }

    #[test]
    fn headers_are_case_insensitive_and_extra_ones_are_ignored() {
        let body = serde_json::to_string(&json!({ "jsonrpc": "2.0", "method": "exit" })).unwrap();
        let input = format!(
            "content-length: {}\r\n\
             Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}",
            body.len(),
            body
        );
        let mut out = Vec::new();
        let mut server = Server::new(&mut out);
        assert_eq!(server.serve(&mut Cursor::new(input.into_bytes())).unwrap(), 1);
    }

    #[test]
    fn line_index_maps_offsets_across_lines() {
        let text = "{\n  a: `é🎈`,\n}\n";
        let index = LineIndex::new(text);
        assert_eq!(index.position(0), Position { line: 0, character: 0 });
        assert_eq!(index.position(2), Position { line: 1, character: 0 });
        // Past `é` (1 unit) and `🎈` (2 units) inside the string on line 2.
        let close_backtick = text.find("`,").unwrap();
        assert_eq!(index.position(close_backtick), Position { line: 1, character: 9 });
        assert_eq!(index.end_position(), Position { line: 3, character: 0 });
    }
}
