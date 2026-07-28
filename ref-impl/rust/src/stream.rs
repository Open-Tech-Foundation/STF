//! The [STF Stream](../../../doc/stream.md) profile: line-delimited record streams (`.stfs`).
//!
//! The profile's central property is that a record can never contain a raw line terminator,
//! so the reader splits on `U+000A` *before* parsing anything.

use crate::error::{Code, Error, Result};
use crate::parser::{Limits, Mode, Parser};
use crate::ser::{document_to_string, to_string, Format};
use crate::value::{Directive, Document, Object, Value};

/// A fully-read stream: its optional header directives plus its records, in order.
#[derive(Debug, Clone, PartialEq)]
pub struct Stream {
    pub directives: Vec<Directive>,
    pub records: Vec<Object>,
}

/// One item produced by [`StreamReader`], tagged with its 1-based line number (stream §2.1).
#[derive(Debug, Clone)]
pub struct Record {
    pub line: usize,
    pub result: Result<Object>,
}

/// A line-by-line reader.
///
/// Stream §5 requires implementations to offer both abort-on-error and continue-on-error, and
/// to default to aborting. [`parse_stream`] is the aborting entry point; this iterator is the
/// continuing one, yielding a [`Record`] per non-ignorable line whether or not it parsed.
pub struct StreamReader<'a> {
    lines: Vec<(usize, &'a str, bool)>,
    index: usize,
    limits: Limits,
    header_taken: bool,
    header: Vec<Directive>,
    header_error: Option<Error>,
    bom: bool,
}

/// Splits on LF, discarding a single CR before each terminator (stream §2). The third tuple
/// field records whether a line terminator actually followed, which distinguishes a raw
/// newline inside a string from a genuinely truncated final line.
fn split_lines(input: &str) -> Vec<(usize, &str, bool)> {
    let mut out = Vec::new();
    let mut start = 0;
    let bytes = input.as_bytes();
    let mut line_no = 1;
    for i in 0..bytes.len() {
        if bytes[i] == b'\n' {
            let mut end = i;
            if end > start && bytes[end - 1] == b'\r' {
                end -= 1;
            }
            out.push((line_no, &input[start..end], true));
            line_no += 1;
            start = i + 1;
        }
    }
    if start < bytes.len() {
        out.push((line_no, &input[start..], false));
    }
    out
}

/// A line holding only horizontal whitespace and/or a comment (stream §2).
fn is_ignorable(line: &str) -> bool {
    let trimmed = line.trim_matches([' ', '\t']);
    trimmed.is_empty() || trimmed.starts_with('#')
}

impl<'a> StreamReader<'a> {
    pub fn new(input: &'a str) -> Self {
        Self::with_limits(input, Limits::default())
    }

    pub fn with_limits(input: &'a str, limits: Limits) -> Self {
        StreamReader {
            lines: split_lines(input),
            index: 0,
            limits,
            header_taken: false,
            header: Vec::new(),
            header_error: None,
            bom: input.starts_with('\u{FEFF}'),
        }
    }

    /// Consumes the header line if there is one. Must be called before iterating; iteration
    /// calls it implicitly.
    fn take_header(&mut self) {
        if self.header_taken {
            return;
        }
        self.header_taken = true;
        while self.index < self.lines.len() {
            let (line_no, text, _) = self.lines[self.index];
            if is_ignorable(text) {
                self.index += 1;
                continue;
            }
            if !text.trim_start_matches([' ', '\t']).starts_with('@') {
                return; // The first non-ignorable line is a record, so there is no header.
            }
            self.index += 1;
            // The header is parsed in Document mode, where directives are legal.
            let mut parser = Parser::new(text, self.limits.clone(), Mode::Document);
            match parser.parse_header_line() {
                Ok(directives) => self.header = directives,
                Err(e) => self.header_error = Some(e.with_line(line_no)),
            }
            return;
        }
    }

    /// The header directives, which apply to every record (stream §4).
    pub fn directives(&mut self) -> &[Directive] {
        self.take_header();
        &self.header
    }
}

impl<'a> Iterator for StreamReader<'a> {
    type Item = Record;

    fn next(&mut self) -> Option<Record> {
        if self.bom {
            self.bom = false;
            self.index = self.lines.len();
            return Some(Record {
                line: 1,
                result: Err(Error::detached(Code::Syntax, "leading byte order mark").with_line(1)),
            });
        }
        self.take_header();
        if let Some(e) = self.header_error.take() {
            let line = e.line;
            return Some(Record { line, result: Err(e) });
        }
        while self.index < self.lines.len() {
            let (line_no, text, terminated) = self.lines[self.index];
            self.index += 1;
            if is_ignorable(text) {
                continue;
            }
            // Splitting only on LF leaves any interior CR in place; it is a raw line
            // terminator inside the record either way (stream §3.2).
            if text.contains('\r') {
                return Some(Record {
                    line: line_no,
                    result: Err(Error::detached(
                        Code::StreamRawNewline,
                        "a stream record must not contain a raw carriage return",
                    )
                    .with_line(line_no)),
                });
            }
            let mode = Mode::StreamRecord { newline_follows: terminated };
            let mut parser = Parser::new(text, self.limits.clone(), mode);
            let result = parser.parse_record().map_err(|e| e.with_line(line_no));
            return Some(Record { line: line_no, result });
        }
        None
    }
}

/// The header line and its 1-based line number, if the stream has one.
///
/// A header is the first non-ignorable line, and only when it begins with `@` (stream §2). A
/// later line that begins with `@` is a malformed record, not a second header.
pub fn header_line(input: &str) -> Option<(usize, &str)> {
    let (line_no, text, _) =
        split_lines(input).into_iter().find(|(_, text, _)| !is_ignorable(text))?;
    text.trim_start_matches([' ', '\t']).starts_with('@').then_some((line_no, text))
}

/// The lines a reader will try to parse as records, each with its 1-based line number.
///
/// Blank and comment lines are skipped, as is the optional header (stream §2), so this is
/// exactly the set [`StreamReader`] yields — but as source text. Tools that need to re-read a
/// record's own bytes, to record spans over it for instance, use this rather than re-deriving
/// the framing.
pub fn record_lines(input: &str) -> Vec<(usize, &str)> {
    let lines = split_lines(input);
    let mut out = Vec::new();
    let mut header_possible = true;
    for (line_no, text, _) in lines {
        if is_ignorable(text) {
            continue;
        }
        if header_possible {
            header_possible = false;
            if text.trim_start_matches([' ', '\t']).starts_with('@') {
                continue;
            }
        }
        out.push((line_no, text));
    }
    out
}

/// Reads a whole stream, aborting at the first malformed record — the default policy required
/// by stream §5.
pub fn parse_stream(input: &str) -> Result<Stream> {
    parse_stream_with_limits(input, Limits::default())
}

pub fn parse_stream_with_limits(input: &str, limits: Limits) -> Result<Stream> {
    let mut reader = StreamReader::with_limits(input, limits);
    let mut records = Vec::new();
    while let Some(record) = reader.next() {
        records.push(record.result?);
    }
    let directives = reader.directives().to_vec();
    Ok(Stream { directives, records })
}

/// Writes a stream: an optional header line, then one canonical-or-compact record per line.
///
/// Stream §3.2 requires a string containing a line terminator to be escaped automatically
/// rather than to fail, which the interpreted form already does.
pub fn stream_to_string(stream: &Stream, format: &Format) -> Result<String> {
    // A record must occupy exactly one line, so an indented format is not expressible and
    // line terminators inside strings must be escaped (stream §3.2).
    let record_format = format.clone().single_line();
    let mut out = String::new();
    if !stream.directives.is_empty() {
        let header = Document { directives: stream.directives.clone(), root: Object::new() };
        let text = document_to_string(&header, &record_format)?;
        // document_to_string appends the (empty) root object; a header line carries no object.
        let header_line = text.trim_end_matches("{}").replace('\n', " ");
        out.push_str(header_line.trim_end());
        out.push('\n');
    }
    for record in &stream.records {
        let line = to_string(&Value::Object(record.clone()), &record_format)?;
        if line.contains('\n') || line.contains('\r') {
            return Err(Error::detached(
                Code::StreamRawNewline,
                "a serialized record must not contain a raw line terminator",
            ));
        }
        out.push_str(&line);
        out.push('\n');
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records(input: &str) -> Vec<Object> {
        parse_stream(input).unwrap().records
    }

    fn code(input: &str) -> Code {
        parse_stream(input).unwrap_err().code
    }

    /// `record_lines` and `header_line` must agree with what the reader actually parses,
    /// since tools use them to re-read a record's own bytes.
    #[test]
    fn record_lines_skip_the_header_and_ignorable_lines() {
        let input = "# notes\n\n@version(1.0)\n{a:1}\n\n  # comment\n{a:2}\n";
        assert_eq!(record_lines(input), vec![(4, "{a:1}"), (7, "{a:2}")]);
        assert_eq!(header_line(input), Some((3, "@version(1.0)")));
        assert_eq!(record_lines(input).len(), parse_stream(input).unwrap().records.len());
    }

    #[test]
    fn a_stream_without_a_header_has_none() {
        assert_eq!(header_line("{a:1}\n@version(1.0)\n"), None);
        assert_eq!(record_lines("{a:1}\n"), vec![(1, "{a:1}")]);
    }

    #[test]
    fn reads_records_in_order() {
        let r = records("{a:1}\n{a:2}\n");
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].get("a"), Some(&Value::Number(1.0)));
        assert_eq!(r[1].get("a"), Some(&Value::Number(2.0)));
    }

    #[test]
    fn final_terminator_is_optional() {
        assert_eq!(records("{a:1}\n{a:2}").len(), 2);
    }

    #[test]
    fn empty_stream_has_no_records() {
        assert!(records("").is_empty());
        assert!(records("\n\n# only comments\n").is_empty());
    }

    #[test]
    fn blank_and_comment_lines_are_ignored() {
        assert_eq!(records("{a:1}\n\n\n{a:2}\n").len(), 2);
        assert_eq!(records("# header note\n{a:1}\n# mid\n{a:2}\n").len(), 2);
        assert_eq!(records("{a:1} # note\n").len(), 1);
    }

    #[test]
    fn crlf_is_accepted_and_discarded() {
        assert_eq!(records("{a:1}\r\n{a:2}\r\n").len(), 2);
    }

    #[test]
    fn header_directives_are_read_once() {
        let s = parse_stream("@schema(event.schema.stf)\n{a:1}\n").unwrap();
        assert_eq!(s.records.len(), 1);
        assert_eq!(s.directives.len(), 1);
        assert_eq!(s.directives[0].name, "schema");
    }

    #[test]
    fn a_raw_newline_in_a_record_is_reported_as_such() {
        assert_eq!(code("{a:`x\ny`}\n"), Code::StreamRawNewline);
        assert_eq!(code("{a:`x\ry`}\n"), Code::StreamRawNewline);
    }

    #[test]
    fn an_unterminated_final_line_is_not_a_raw_newline() {
        // Nothing follows, so this is a truncated document, not a split string.
        assert_eq!(code("{a:`x"), Code::Unterminated);
    }

    #[test]
    fn directives_are_confined_to_the_header() {
        assert_eq!(code("{a:1}\n@schema(x)\n"), Code::StreamDirectiveInRecord);
        assert_eq!(code("@schema(x) {a:1}\n"), Code::StreamDirectiveInRecord);
        assert_eq!(code("@schema(a) @schema(b)\n{a:1}\n"), Code::Syntax);
    }

    #[test]
    fn record_framing_errors_use_core_codes() {
        assert_eq!(code("[1,2]\n"), Code::RootNotObject);
        assert_eq!(code("{a:1}{b:2}\n"), Code::TrailingContent);
        assert_eq!(code("\u{FEFF}{a:1}\n"), Code::Syntax);
    }

    #[test]
    fn reader_continues_past_a_bad_record_and_reports_line_numbers() {
        let mut reader = StreamReader::new("{a:1}\n{oops\n{a:3}\n");
        let items: Vec<Record> = reader.by_ref().collect();
        assert_eq!(items.len(), 3);
        assert!(items[0].result.is_ok());
        assert!(items[1].result.is_err());
        assert_eq!(items[1].line, 2);
        assert!(items[2].result.is_ok());
        assert_eq!(items[2].line, 3);
    }

    #[test]
    fn ignorable_lines_still_advance_the_line_counter() {
        let mut reader = StreamReader::new("# note\n\n{oops\n");
        let items: Vec<Record> = reader.by_ref().collect();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].line, 3);
    }

    #[test]
    fn writing_a_stream_round_trips() {
        let stream = parse_stream("@schema(x)\n{b:1,a:2}\n{msg:\"one\\ntwo\"}\n").unwrap();
        let text = stream_to_string(&stream, &Format::compact()).unwrap();
        assert_eq!(text, "@schema(x)\n{b:1,a:2}\n{msg:\"one\\ntwo\"}\n");
        assert_eq!(parse_stream(&text).unwrap(), stream);
    }

    #[test]
    fn canonical_stream_sorts_within_records_but_not_across_them() {
        let stream = parse_stream("{b:1,a:2}\n{d:1,c:2}\n").unwrap();
        let text = stream_to_string(&stream, &Format::canonical()).unwrap();
        assert_eq!(text, "{a:2,b:1}\n{c:2,d:1}\n");
    }
}
