package stf

import (
	"strconv"
	"strings"
	"unicode/utf8"
)

// DefaultMaxDepth is the nesting limit of spec §11.3. The default MUST be 64 so a document
// accepted by one conformant parser is accepted by all.
const DefaultMaxDepth = 64

// Limits are the optional resource limits of spec §15. A zero MaxDocumentBytes or
// MaxPayloadBytes means unlimited, which is the specified default.
type Limits struct {
	MaxDepth         int
	MaxDocumentBytes int
	MaxPayloadBytes  int
}

// DefaultLimits returns the specified defaults.
func DefaultLimits() Limits {
	return Limits{MaxDepth: DefaultMaxDepth}
}

func (l Limits) maxDepth() int {
	if l.MaxDepth <= 0 {
		return DefaultMaxDepth
	}
	return l.MaxDepth
}

// mode is how the parser frames its input.
type mode int

const (
	modeDocument mode = iota
	// modeRecord parses one record of a stream. Directives are rejected and an unterminated
	// string is attributed to a raw line terminator when one actually follows.
	modeRecord
)

type parser struct {
	src            string
	pos            int
	depth          int
	limits         Limits
	mode           mode
	newlineFollows bool
}

func isIdentByte(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
		c == '_' || c == '-'
}

func (p *parser) err(code Code, offset int, format string, args ...any) *Error {
	return newError(p.src, offset, code, format, args...)
}

// peek returns the byte at pos+n, or 0 past the end. A real NUL is never structurally
// significant, so the sentinel is unambiguous for the parser's purposes.
func (p *parser) peek(n int) byte {
	if p.pos+n < len(p.src) {
		return p.src[p.pos+n]
	}
	return 0
}

func (p *parser) atEnd() bool { return p.pos >= len(p.src) }

// skipWS skips whitespace and comments (spec §4). A comment ends at LF *or* CR.
func (p *parser) skipWS() {
	for p.pos < len(p.src) {
		switch p.src[p.pos] {
		case ' ', '\t', '\n', '\r':
			p.pos++
		case '#':
			p.pos++
			for p.pos < len(p.src) && p.src[p.pos] != '\n' && p.src[p.pos] != '\r' {
				p.pos++
			}
		default:
			return
		}
	}
}

// parseDocument parses directives, one root object, then end of input.
func (p *parser) parseDocument() (*Document, *Error) {
	if p.limits.MaxDocumentBytes > 0 && len(p.src) > p.limits.MaxDocumentBytes {
		return nil, p.err(ErrDocumentSize, 0, "document is %d bytes, limit is %d",
			len(p.src), p.limits.MaxDocumentBytes)
	}
	// A BOM is not whitespace (spec §2) and must not read as a missing root.
	if strings.HasPrefix(p.src, "\uFEFF") {
		return nil, p.err(ErrSyntax, 0, "leading byte order mark")
	}

	var directives []Directive
	p.skipWS()
	for !p.atEnd() && p.src[p.pos] == '@' {
		d, err := p.parseDirective()
		if err != nil {
			return nil, err
		}
		for _, existing := range directives {
			if existing.Name == d.Name {
				return nil, p.err(ErrSyntax, p.pos, "directive `@%s` appears more than once", d.Name)
			}
		}
		directives = append(directives, d)
		p.skipWS()
	}

	if p.atEnd() || p.src[p.pos] != '{' {
		detail := "document root must be an object"
		if p.atEnd() {
			detail = "document contains no root object"
		}
		return nil, p.err(ErrRootNotObject, p.pos, "%s", detail)
	}

	root, err := p.parseObject()
	if err != nil {
		return nil, err
	}
	p.skipWS()
	if !p.atEnd() {
		return nil, p.err(ErrTrailingContent, p.pos, "content follows the root object")
	}
	return &Document{Directives: directives, Root: root}, nil
}

// parseDirective reads `@name(payload)`, with no whitespace around `@` or before `(` (§5.1).
func (p *parser) parseDirective() (Directive, *Error) {
	at := p.pos
	if p.mode == modeRecord {
		return Directive{}, p.err(ErrStreamDirectiveInRecord, at,
			"a stream record must not contain a directive")
	}
	p.pos++ // '@'
	nameStart := p.pos
	for !p.atEnd() && isIdentByte(p.src[p.pos]) {
		p.pos++
	}
	if p.pos == nameStart {
		return Directive{}, p.err(ErrSyntax, p.pos, "directive name is empty")
	}
	name := p.src[nameStart:p.pos]
	if p.atEnd() || p.src[p.pos] != '(' {
		return Directive{}, p.err(ErrSyntax, p.pos, "expected `(` immediately after the directive name")
	}
	p.pos++
	payloadStart := p.pos
	for {
		if p.atEnd() {
			return Directive{}, p.err(ErrUnterminated, p.pos, "unterminated directive")
		}
		switch p.src[p.pos] {
		case ')':
			payload := p.src[payloadStart:p.pos]
			p.pos++
			return Directive{Name: name, Payload: payload}, nil
		case '(':
			return Directive{}, p.err(ErrNestedConstructor, p.pos, "`(` inside a directive payload")
		}
		p.pos++
	}
}

func (p *parser) enter(at int) *Error {
	p.depth++
	if p.depth > p.limits.maxDepth() {
		return p.err(ErrNestingDepth, at, "nesting exceeds the maximum depth of %d", p.limits.maxDepth())
	}
	return nil
}

func (p *parser) parseObject() (*Object, *Error) {
	open := p.pos
	p.pos++ // '{'
	if err := p.enter(open); err != nil {
		return nil, err
	}
	object := NewObject()

	p.skipWS()
	if !p.atEnd() && p.src[p.pos] == ',' {
		return nil, p.err(ErrMissingComma, p.pos, "leading comma")
	}
	for p.atEnd() || p.src[p.pos] != '}' {
		if p.atEnd() {
			return nil, p.err(ErrUnterminated, p.pos, "unterminated object")
		}

		keyAt := p.pos
		key, err := p.parseKey()
		if err != nil {
			return nil, err
		}
		p.skipWS()
		if p.atEnd() || p.src[p.pos] != ':' {
			// `{a b: 1}` is a key containing whitespace (§6.2); `{a 1}` is a missing colon.
			if p.looksLikeSplitKey() {
				return nil, p.err(ErrInvalidIdentifier, p.pos, "whitespace is not permitted within a key")
			}
			return nil, p.err(ErrMissingColon, p.pos, "expected `:` after the key")
		}
		p.pos++

		value, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		if !object.Set(key, value) {
			return nil, p.err(ErrDuplicateKey, keyAt, "duplicate key `%s`", key)
		}

		p.skipWS()
		if p.atEnd() {
			return nil, p.err(ErrUnterminated, p.pos, "unterminated object")
		}
		switch p.src[p.pos] {
		case ',':
			p.pos++
			p.skipWS()
			if !p.atEnd() && p.src[p.pos] == ',' {
				return nil, p.err(ErrMissingComma, p.pos, "consecutive commas")
			}
		case '}':
			// Loop condition ends it.
		default:
			return nil, p.err(ErrMissingComma, p.pos, "expected `,` between members")
		}
	}
	p.pos++ // '}'
	p.depth--
	return object, nil
}

func (p *parser) parseArray() ([]Value, *Error) {
	open := p.pos
	p.pos++ // '['
	if err := p.enter(open); err != nil {
		return nil, err
	}
	items := []Value{}

	p.skipWS()
	if !p.atEnd() && p.src[p.pos] == ',' {
		return nil, p.err(ErrMissingComma, p.pos, "leading comma")
	}
	for p.atEnd() || p.src[p.pos] != ']' {
		if p.atEnd() {
			return nil, p.err(ErrUnterminated, p.pos, "unterminated array")
		}
		value, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		items = append(items, value)

		p.skipWS()
		if p.atEnd() {
			return nil, p.err(ErrUnterminated, p.pos, "unterminated array")
		}
		switch p.src[p.pos] {
		case ',':
			p.pos++
			p.skipWS()
			if !p.atEnd() && p.src[p.pos] == ',' {
				return nil, p.err(ErrMissingComma, p.pos, "consecutive commas")
			}
		case ']':
			// Loop condition ends it.
		default:
			return nil, p.err(ErrMissingComma, p.pos, "expected `,` between elements")
		}
	}
	p.pos++ // ']'
	p.depth--
	return items, nil
}

// parseKey reads an unquoted identifier (spec §6.1). A quoted key is ERR_SYNTAX.
func (p *parser) parseKey() (string, *Error) {
	if !p.atEnd() && (p.src[p.pos] == '"' || p.src[p.pos] == '`') {
		return "", p.err(ErrSyntax, p.pos, "keys must not be quoted")
	}
	start := p.pos
	for !p.atEnd() && isIdentByte(p.src[p.pos]) {
		p.pos++
	}
	if p.pos == start {
		return "", p.err(ErrInvalidIdentifier, start, "expected a key matching [A-Za-z0-9_-]+")
	}
	// A character that is neither whitespace, a comment, nor `:` straight after the
	// identifier is a bad key character (`a.b`), not a missing colon.
	if !p.atEnd() {
		switch p.src[p.pos] {
		case ' ', '\t', '\n', '\r', '#', ':':
		default:
			return "", p.err(ErrInvalidIdentifier, p.pos, "character is not permitted in a key")
		}
	}
	return p.src[start:p.pos], nil
}

// looksLikeSplitKey reports whether the cursor holds a second identifier followed by `:`.
func (p *parser) looksLikeSplitKey() bool {
	i := p.pos
	start := i
	for i < len(p.src) && isIdentByte(p.src[i]) {
		i++
	}
	if i == start {
		return false
	}
	for i < len(p.src) {
		switch p.src[i] {
		case ' ', '\t', '\n', '\r':
			i++
			continue
		}
		break
	}
	return i < len(p.src) && p.src[i] == ':'
}

func (p *parser) parseValue() (Value, *Error) {
	p.skipWS()
	if p.atEnd() {
		return nil, p.err(ErrUnterminated, p.pos, "expected a value")
	}
	c := p.src[p.pos]
	switch {
	case c == '{':
		return p.parseObject()
	case c == '[':
		return p.parseArray()
	case c == '`':
		return p.parseRawString()
	case c == '"':
		return p.parseInterpretedString()
	// `+` and `.` cannot start a valid number, but dispatching them here yields the specific
	// ERR_INVALID_NUMBER that §7.1 requires rather than generic syntax.
	case c == '+' || c == '-' || c == '.' || isDigit(c):
		return p.parseNumber()
	case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_':
		return p.parseWord()
	}
	return nil, p.err(ErrSyntax, p.pos, "expected a value")
}

// parseWord reads a bare word: a T/F/N literal, or a constructor when `(` follows.
func (p *parser) parseWord() (Value, *Error) {
	start := p.pos
	for !p.atEnd() && isIdentByte(p.src[p.pos]) {
		p.pos++
	}
	word := p.src[start:p.pos]

	if p.atEnd() || p.src[p.pos] != '(' {
		// Scanning greedily is what enforces the §7.4 boundary rule: `NaN` never reaches
		// here as `N` followed by `aN`.
		switch word {
		case "T":
			return true, nil
		case "F":
			return false, nil
		case "N":
			return nil, nil
		}
		return nil, p.err(ErrSyntax, start,
			"`%s` is not a value; literals are `T`, `F`, and `N`", word)
	}

	if !IsKnownConstructor(word) {
		if IsReservedConstructor(word) {
			return nil, p.err(ErrUnknownConstructor, start, "`%s` is not an STF 1.0 constructor", word)
		}
		return nil, p.err(ErrSyntax, start, "`%s` is not valid in value position", word)
	}

	p.pos++ // '('
	payloadStart := p.pos
	for {
		if p.atEnd() {
			return nil, p.err(ErrUnterminated, p.pos, "unterminated constructor")
		}
		if p.src[p.pos] == ')' {
			break
		}
		if p.src[p.pos] == '(' {
			return nil, p.err(ErrNestedConstructor, p.pos, "`(` inside a constructor payload")
		}
		p.pos++
	}
	payload := p.src[payloadStart:p.pos]
	if p.limits.MaxPayloadBytes > 0 && len(payload) > p.limits.MaxPayloadBytes {
		return nil, p.err(ErrPayloadSize, payloadStart, "payload is %d bytes, limit is %d",
			len(payload), p.limits.MaxPayloadBytes)
	}
	value, perr := buildConstructor(word, payload)
	if perr != nil {
		return nil, p.err(perr.code, payloadStart, "%s", perr.detail)
	}
	p.pos++ // ')'
	return value, nil
}

// parseRawString reads a backtick string (spec §8.1). No escape processing.
func (p *parser) parseRawString() (Value, *Error) {
	open := p.pos
	p.pos++
	start := p.pos
	end := strings.IndexByte(p.src[start:], '`')
	if end < 0 {
		p.pos = len(p.src)
		return nil, p.unterminatedString(open, "unterminated raw string")
	}
	p.pos = start + end + 1
	return p.src[start : start+end], nil
}

// parseInterpretedString reads a double-quoted string (spec §8.2, §8.3).
//
// The JSON escape set exactly, with surrogate pairing enforced. Runes are decoded and
// re-encoded explicitly so supplementary characters survive, which the previous
// implementation dropped.
func (p *parser) parseInterpretedString() (Value, *Error) {
	open := p.pos
	p.pos++
	var sb strings.Builder
	for {
		if p.atEnd() {
			return nil, p.unterminatedString(open, "unterminated interpreted string")
		}
		c := p.src[p.pos]
		switch {
		case c == '"':
			p.pos++
			return sb.String(), nil
		case c == '\n' || c == '\r':
			return nil, p.err(ErrInvalidString, p.pos, "literal line terminator in an interpreted string")
		case c != '\\':
			r, size := utf8.DecodeRuneInString(p.src[p.pos:])
			if r == utf8.RuneError && size == 1 {
				return nil, p.err(ErrInvalidUTF8, p.pos, "input is not well-formed UTF-8")
			}
			sb.WriteRune(r)
			p.pos += size
			continue
		}

		escAt := p.pos
		p.pos++
		if p.atEnd() {
			return nil, p.unterminatedString(open, "unterminated interpreted string")
		}
		esc := p.src[p.pos]
		p.pos++
		switch esc {
		case '"':
			sb.WriteByte('"')
		case '\\':
			sb.WriteByte('\\')
		case '/':
			sb.WriteByte('/')
		case 'b':
			sb.WriteByte('\b')
		case 'f':
			sb.WriteByte('\f')
		case 'n':
			sb.WriteByte('\n')
		case 'r':
			sb.WriteByte('\r')
		case 't':
			sb.WriteByte('\t')
		case 'u':
			unit, err := p.parseHex4(escAt)
			if err != nil {
				return nil, err
			}
			switch {
			case unit >= 0xD800 && unit <= 0xDBFF:
				if p.peek(0) != '\\' || p.peek(1) != 'u' {
					return nil, p.err(ErrInvalidString, escAt,
						"high surrogate is not followed by a low surrogate")
				}
				p.pos += 2
				low, err := p.parseHex4(escAt)
				if err != nil {
					return nil, err
				}
				if low < 0xDC00 || low > 0xDFFF {
					return nil, p.err(ErrInvalidString, escAt,
						"high surrogate is not followed by a low surrogate")
				}
				sb.WriteRune(rune(0x10000 + (unit-0xD800)<<10 + (low - 0xDC00)))
			case unit >= 0xDC00 && unit <= 0xDFFF:
				return nil, p.err(ErrInvalidString, escAt, "lone low surrogate")
			default:
				sb.WriteRune(rune(unit))
			}
		default:
			return nil, p.err(ErrInvalidString, escAt, "unrecognized escape sequence")
		}
	}
}

func (p *parser) parseHex4(at int) (int, *Error) {
	if p.pos+4 > len(p.src) {
		return 0, p.err(ErrInvalidString, at, "`\\u` needs four hex digits")
	}
	value := 0
	for i := 0; i < 4; i++ {
		c := p.src[p.pos+i]
		var d int
		switch {
		case c >= '0' && c <= '9':
			d = int(c - '0')
		case c >= 'a' && c <= 'f':
			d = int(c-'a') + 10
		case c >= 'A' && c <= 'F':
			d = int(c-'A') + 10
		default:
			return 0, p.err(ErrInvalidString, at, "`\\u` needs four hex digits")
		}
		value = value*16 + d
	}
	p.pos += 4
	return value, nil
}

// unterminatedString attributes an open string at end of a stream record to a raw line
// terminator (stream §3.2), but only when a terminator actually follows.
func (p *parser) unterminatedString(at int, detail string) *Error {
	if p.mode == modeRecord && p.newlineFollows {
		return p.err(ErrStreamRawNewline, at, "a stream record must not contain a raw line terminator")
	}
	return p.err(ErrUnterminated, at, "%s", detail)
}

// parseNumber reads a number (spec §7): grammar, then the §7.4 boundary rule, then the
// binary64 conversion.
func (p *parser) parseNumber() (Value, *Error) {
	start := p.pos
	if p.src[p.pos] == '+' {
		return nil, p.err(ErrInvalidNumber, start, "leading `+` is not permitted")
	}
	if p.src[p.pos] == '-' {
		p.pos++
	}

	switch {
	case !p.atEnd() && p.src[p.pos] == '0':
		p.pos++
	case !p.atEnd() && p.src[p.pos] >= '1' && p.src[p.pos] <= '9':
		for !p.atEnd() && isDigit(p.src[p.pos]) {
			p.pos++
		}
	default:
		return nil, p.err(ErrInvalidNumber, start, "number has no integer part")
	}

	if !p.atEnd() && p.src[p.pos] == '.' {
		p.pos++
		fracStart := p.pos
		for !p.atEnd() && isDigit(p.src[p.pos]) {
			p.pos++
		}
		if p.pos == fracStart {
			return nil, p.err(ErrInvalidNumber, p.pos, "fraction has no digits")
		}
	}

	if !p.atEnd() && (p.src[p.pos] == 'e' || p.src[p.pos] == 'E') {
		p.pos++
		if !p.atEnd() && (p.src[p.pos] == '+' || p.src[p.pos] == '-') {
			p.pos++
		}
		expStart := p.pos
		for !p.atEnd() && isDigit(p.src[p.pos]) {
			p.pos++
		}
		if p.pos == expStart {
			return nil, p.err(ErrInvalidNumber, p.pos, "exponent has no digits")
		}
	}

	// §7.4: rejects `0x10`, `1_000`, `0123`, and `1.2.3` at the offending character.
	if !p.atEnd() && (isIdentByte(p.src[p.pos]) || p.src[p.pos] == '.') {
		return nil, p.err(ErrInvalidNumber, p.pos,
			"number is immediately followed by an identifier character")
	}

	text := p.src[start:p.pos]
	// §7.2: the domain is binary64, so an integer literal is a float64 too. Returning an
	// int64 here would widen the domain and is explicitly non-conformant.
	n, err := strconv.ParseFloat(text, 64)
	if err != nil {
		// ParseFloat reports ErrRange for a magnitude past binary64, returning ±Inf.
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return nil, p.err(ErrNumberOverflow, start, "magnitude exceeds the finite binary64 range")
		}
		return nil, p.err(ErrInvalidNumber, start, "number literal is not valid")
	}
	return n, nil
}

// parseRecord parses one stream record: a root object with no directives, then end of line.
func (p *parser) parseRecord() (*Object, *Error) {
	p.skipWS()
	if !p.atEnd() && p.src[p.pos] == '@' {
		_, err := p.parseDirective() // always fails in record mode
		return nil, err
	}
	if p.atEnd() || p.src[p.pos] != '{' {
		return nil, p.err(ErrRootNotObject, p.pos, "a record root must be an object")
	}
	root, err := p.parseObject()
	if err != nil {
		return nil, err
	}
	p.skipWS()
	if !p.atEnd() {
		return nil, p.err(ErrTrailingContent, p.pos, "content follows the record")
	}
	return root, nil
}

// parseHeaderLine parses a stream header line: one or more directives and nothing else.
func (p *parser) parseHeaderLine() ([]Directive, *Error) {
	var out []Directive
	p.skipWS()
	for !p.atEnd() && p.src[p.pos] == '@' {
		d, err := p.parseDirective()
		if err != nil {
			return nil, err
		}
		for _, existing := range out {
			if existing.Name == d.Name {
				return nil, p.err(ErrSyntax, p.pos, "directive `@%s` appears more than once", d.Name)
			}
		}
		out = append(out, d)
		p.skipWS()
	}
	if !p.atEnd() {
		return nil, p.err(ErrStreamDirectiveInRecord, p.pos, "a header line must contain only directives")
	}
	return out, nil
}
