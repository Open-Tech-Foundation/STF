package stf

import "strings"

// Stream is a fully-read stream: its header directives plus its records, in order.
type Stream struct {
	Directives []Directive
	Records    []*Object
}

// Record is one item from a StreamReader, tagged with its 1-based line number (stream §2.1).
type Record struct {
	Line  int
	Value *Object
	Err   *Error
}

type streamLine struct {
	no   int
	text string
	// terminated records whether a line terminator actually followed, which distinguishes a
	// raw newline inside a string from a genuinely truncated final line.
	terminated bool
}

// splitStreamLines splits on LF, discarding a single CR before each terminator (stream §2).
func splitStreamLines(input string) []streamLine {
	var out []streamLine
	start, no := 0, 1
	for i := 0; i < len(input); i++ {
		if input[i] != '\n' {
			continue
		}
		end := i
		if end > start && input[end-1] == '\r' {
			end--
		}
		out = append(out, streamLine{no: no, text: input[start:end], terminated: true})
		no++
		start = i + 1
	}
	if start < len(input) {
		out = append(out, streamLine{no: no, text: input[start:], terminated: false})
	}
	return out
}

// isIgnorableLine reports a line holding only horizontal whitespace and/or a comment (§2).
func isIgnorableLine(text string) bool {
	trimmed := strings.Trim(text, " \t")
	return trimmed == "" || strings.HasPrefix(trimmed, "#")
}

// StreamReader reads a stream one record at a time, continuing past malformed records.
//
// Stream §5 requires implementations to offer both abort-on-error and continue-on-error, and
// to default to aborting. ParseStream is the aborting entry point; this is the continuing one.
type StreamReader struct {
	lines  []streamLine
	index  int
	limits Limits
	header []Directive
	// pending holds an error that must be reported before any record.
	pending *Record
	started bool
	bom     bool
}

// NewStreamReader returns a reader over input.
func NewStreamReader(input string, limits Limits) *StreamReader {
	return &StreamReader{
		lines:  splitStreamLines(input),
		limits: limits,
		bom:    strings.HasPrefix(input, "\uFEFF"),
	}
}

// takeHeader consumes the header line if there is one.
func (r *StreamReader) takeHeader() {
	if r.started {
		return
	}
	r.started = true
	for r.index < len(r.lines) && isIgnorableLine(r.lines[r.index].text) {
		r.index++
	}
	if r.index >= len(r.lines) {
		return
	}
	line := r.lines[r.index]
	if !strings.HasPrefix(strings.TrimLeft(line.text, " \t"), "@") {
		return // The first non-ignorable line is a record, so there is no header.
	}
	r.index++
	// The header is parsed in document mode, where directives are legal.
	p := &parser{src: line.text, limits: r.limits, mode: modeDocument}
	directives, err := p.parseHeaderLine()
	if err != nil {
		err.Line = line.no
		r.pending = &Record{Line: line.no, Err: err}
		return
	}
	r.header = directives
}

// Directives returns the header directives, which apply to every record (stream §4).
func (r *StreamReader) Directives() []Directive {
	r.takeHeader()
	return r.header
}

// Next returns the next record, or nil when the stream is exhausted.
func (r *StreamReader) Next() *Record {
	if r.bom {
		r.bom = false
		r.index = len(r.lines)
		e := detachedError(ErrSyntax, "leading byte order mark")
		e.Line = 1
		e.Column = 1
		return &Record{Line: 1, Err: e}
	}
	r.takeHeader()
	if r.pending != nil {
		p := r.pending
		r.pending = nil
		r.index = len(r.lines)
		return p
	}
	for r.index < len(r.lines) {
		line := r.lines[r.index]
		r.index++
		if isIgnorableLine(line.text) {
			continue
		}
		// Splitting only on LF leaves any interior CR in place; it is a raw line terminator
		// inside the record either way (stream §3.2).
		if strings.ContainsRune(line.text, '\r') {
			e := detachedError(ErrStreamRawNewline,
				"a stream record must not contain a raw carriage return")
			e.Line = line.no
			e.Column = 1
			return &Record{Line: line.no, Err: e}
		}
		p := &parser{
			src:            line.text,
			limits:         r.limits,
			mode:           modeRecord,
			newlineFollows: line.terminated,
		}
		object, err := p.parseRecord()
		if err != nil {
			err.Line = line.no
			return &Record{Line: line.no, Err: err}
		}
		return &Record{Line: line.no, Value: object}
	}
	return nil
}

// ParseStream reads a whole stream, aborting at the first malformed record — the default
// policy required by stream §5.
func ParseStream(input string) (*Stream, error) {
	return ParseStreamWithLimits(input, DefaultLimits())
}

// ParseStreamWithLimits is ParseStream with explicit resource limits.
func ParseStreamWithLimits(input string, limits Limits) (*Stream, error) {
	reader := NewStreamReader(input, limits)
	records := []*Object{}
	for {
		record := reader.Next()
		if record == nil {
			break
		}
		if record.Err != nil {
			return nil, record.Err
		}
		records = append(records, record.Value)
	}
	return &Stream{Directives: reader.Directives(), Records: records}, nil
}

// SerializeStream writes a stream: an optional header line, then one record per line.
//
// Stream §3.2 requires a string containing a line terminator to be escaped automatically
// rather than to fail, which the interpreted form already does.
func SerializeStream(stream *Stream, f Format) (string, error) {
	// A record must occupy exactly one line, so an indented format is not expressible.
	recordFormat := SingleLine(f)
	var sb strings.Builder
	if len(stream.Directives) > 0 {
		header, err := SerializeDocument(
			&Document{Directives: stream.Directives, Root: NewObject()}, recordFormat)
		if err != nil {
			return "", err
		}
		// SerializeDocument appends the (empty) root object; a header line carries no object.
		header = strings.TrimSuffix(header, "{}")
		sb.WriteString(strings.TrimRight(strings.ReplaceAll(header, "\n", " "), " "))
		sb.WriteByte('\n')
	}
	for _, record := range stream.Records {
		line, err := Serialize(record, recordFormat)
		if err != nil {
			return "", err
		}
		if strings.ContainsAny(line, "\n\r") {
			return "", detachedError(ErrStreamRawNewline,
				"a serialized record must not contain a raw line terminator")
		}
		sb.WriteString(line)
		sb.WriteByte('\n')
	}
	return sb.String(), nil
}
