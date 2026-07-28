package stf

import "fmt"

// Code is a normative STF error code.
//
// Every rejection required by the specification maps to exactly one of these, as defined by
// the condition -> code table in doc/error-codes.md. Reporting a related-but-different code
// is non-conformant, so callers switch on Code rather than on message text.
type Code string

// The codes of STF 1.0.
const (
	// Encoding.
	ErrInvalidUTF8 Code = "ERR_INVALID_UTF8"

	// General syntax.
	ErrSyntax          Code = "ERR_SYNTAX"
	ErrUnterminated    Code = "ERR_UNTERMINATED"
	ErrTrailingContent Code = "ERR_TRAILING_CONTENT"

	// Structure.
	ErrRootNotObject Code = "ERR_ROOT_NOT_OBJECT"
	ErrDuplicateKey  Code = "ERR_DUPLICATE_KEY"
	ErrMissingColon  Code = "ERR_MISSING_COLON"
	ErrMissingComma  Code = "ERR_MISSING_COMMA"

	// Identifiers.
	ErrInvalidIdentifier Code = "ERR_INVALID_IDENTIFIER"

	// Primitive values.
	ErrInvalidNumber  Code = "ERR_INVALID_NUMBER"
	ErrNumberOverflow Code = "ERR_NUMBER_OVERFLOW"
	ErrInvalidString  Code = "ERR_INVALID_STRING"

	// Constructors.
	ErrUnknownConstructor        Code = "ERR_UNKNOWN_CONSTRUCTOR"
	ErrInvalidConstructorPayload Code = "ERR_INVALID_CONSTRUCTOR_PAYLOAD"
	ErrNestedConstructor         Code = "ERR_NESTED_CONSTRUCTOR"
	ErrDecimalOverflow           Code = "ERR_DECIMAL_OVERFLOW"

	// Resource limits.
	ErrNestingDepth Code = "ERR_NESTING_DEPTH"
	ErrDocumentSize Code = "ERR_DOCUMENT_SIZE"
	ErrPayloadSize  Code = "ERR_PAYLOAD_SIZE"

	// Serialization.
	ErrUnrepresentable Code = "ERR_UNREPRESENTABLE"

	// Stream profile.
	ErrStreamRawNewline        Code = "ERR_STREAM_RAW_NEWLINE"
	ErrStreamDirectiveInRecord Code = "ERR_STREAM_DIRECTIVE_IN_RECORD"
)

// AllCodes lists every code, for tests and documentation.
var AllCodes = []Code{
	ErrInvalidUTF8, ErrSyntax, ErrUnterminated, ErrTrailingContent,
	ErrRootNotObject, ErrDuplicateKey, ErrMissingColon, ErrMissingComma,
	ErrInvalidIdentifier, ErrInvalidNumber, ErrNumberOverflow, ErrInvalidString,
	ErrUnknownConstructor, ErrInvalidConstructorPayload, ErrNestedConstructor,
	ErrDecimalOverflow, ErrNestingDepth, ErrDocumentSize, ErrPayloadSize,
	ErrUnrepresentable, ErrStreamRawNewline, ErrStreamDirectiveInRecord,
}

// Error is a rejection.
//
// Only Code is normative; spec §16 states that message text is not.
type Error struct {
	Code Code
	// Detail is a human-readable explanation. Not normative.
	Detail string
	// Offset is the byte offset into the input where the problem was detected.
	Offset int
	// Line is 1-based, or 0 when the error has no input position.
	Line int
	// Column is 1-based, counted in runes.
	Column int
}

func (e *Error) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("%s at %d:%d: %s", e.Code, e.Line, e.Column, e.Detail)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Detail)
}

// CodeOf returns the normative code of err, or the empty string if err is not an STF error.
func CodeOf(err error) Code {
	if e, ok := err.(*Error); ok {
		return e.Code
	}
	return ""
}

// newError builds an error whose position is resolved against src.
func newError(src string, offset int, code Code, format string, args ...any) *Error {
	line, column := lineColumn(src, offset)
	return &Error{
		Code:   code,
		Detail: fmt.Sprintf(format, args...),
		Offset: offset,
		Line:   line,
		Column: column,
	}
}

// detachedError builds an error with no meaningful input position.
func detachedError(code Code, format string, args ...any) *Error {
	return &Error{Code: code, Detail: fmt.Sprintf(format, args...)}
}

// lineColumn resolves a byte offset to a 1-based line and column, counting columns in runes.
func lineColumn(src string, offset int) (int, int) {
	if offset > len(src) {
		offset = len(src)
	}
	if offset < 0 {
		offset = 0
	}
	line, lineStart := 1, 0
	for i := 0; i < offset; i++ {
		if src[i] == '\n' {
			line++
			lineStart = i + 1
		}
	}
	column := 1
	for range src[lineStart:offset] {
		column++
	}
	return line, column
}
