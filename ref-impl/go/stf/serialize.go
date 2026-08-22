package stf

import (
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strconv"
	"strings"
)

// Format is the output shape.
type Format struct {
	// Indent is the indent string. Empty emits everything on one line.
	Indent string
	// Canonical selects Canonical Form (spec §14): sorted keys, no spacing, all strings
	// emitted in the interpreted form.
	Canonical bool
	// EscapeLineTerminators forces the interpreted form for any string containing LF or CR,
	// so the output stays on one line. Required by stream §3.2; off for discrete documents,
	// where spec §8.1 permits a literal line terminator inside a raw string.
	EscapeLineTerminators bool
}

// Compact emits one line with no padding: {a:1,b:[1,2]}.
func Compact() Format { return Format{} }

// Pretty emits one member per line, indented.
func Pretty(indent string) Format { return Format{Indent: indent} }

// Canonical returns the Canonical Form settings.
func Canonical() Format { return Format{Canonical: true} }

// SingleLine returns a copy of f that keeps every value on one line.
func SingleLine(f Format) Format {
	f.Indent = ""
	f.EscapeLineTerminators = true
	return f
}

func unrepresentable(format string, args ...any) *Error {
	return detachedError(ErrUnrepresentable, format, args...)
}

func isIdentifier(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !isIdentByte(s[i]) {
			return false
		}
	}
	return true
}

// Serialize renders a value as STF text. The root must be an object (spec §5).
func Serialize(v Value, f Format) (string, error) {
	object, ok := v.(*Object)
	if !ok {
		return "", unrepresentable("an STF document root must be an object, not %s", KindOf(v))
	}
	var sb strings.Builder
	if err := writeObject(object, f, 0, &sb); err != nil {
		return "", err
	}
	return sb.String(), nil
}

// SerializeDocument renders a document, emitting its directives before the root object.
func SerializeDocument(doc *Document, f Format) (string, error) {
	var sb strings.Builder
	for _, d := range doc.Directives {
		if !isIdentifier(d.Name) {
			return "", unrepresentable("`%s` is not a valid directive name", d.Name)
		}
		if strings.ContainsAny(d.Payload, "()") {
			return "", unrepresentable("a directive payload must not contain parentheses")
		}
		fmt.Fprintf(&sb, "@%s(%s)\n", d.Name, d.Payload)
	}
	if err := writeObject(doc.Root, f, 0, &sb); err != nil {
		return "", err
	}
	return sb.String(), nil
}

func writeValue(v Value, f Format, level int, sb *strings.Builder) error {
	switch value := v.(type) {
	case nil:
		sb.WriteByte('N')
	case bool:
		if value {
			sb.WriteByte('T')
		} else {
			sb.WriteByte('F')
		}
	case float64:
		text, err := FormatNumber(value)
		if err != nil {
			return err
		}
		sb.WriteString(text)
	case string:
		writeString(value, f, sb)
	case []Value:
		return writeArray(value, f, level, sb)
	case *Object:
		return writeObject(value, f, level, sb)
	case *big.Int:
		sb.WriteString("BIGINT(")
		sb.WriteString(value.String())
		sb.WriteByte(')')
	case *Decimal:
		sb.WriteString("DECIMAL(")
		sb.WriteString(value.Payload())
		sb.WriteByte(')')
	case Date:
		sb.WriteString("DATE(")
		sb.WriteString(value.Payload())
		sb.WriteByte(')')
	case Timestamp:
		sb.WriteString("TIMESTAMP(")
		sb.WriteString(value.Payload())
		sb.WriteByte(')')
	case []byte:
		sb.WriteString("BINARY(")
		sb.WriteString(BinaryToBase64(value))
		sb.WriteByte(')')
	case *Geometry:
		sb.WriteString("Geometry(\"")
		sb.WriteString(string(value.Type))
		sb.WriteString("\", ")
		if b, err := json.Marshal(value.Coordinates); err == nil {
			sb.Write(b)
		} else {
			sb.WriteString("null")
		}
		sb.WriteByte(')')
	case Time:
		sb.WriteString("Time(\"")
		sb.WriteString(value.Payload())
		sb.WriteString("\")")
	case Duration:
		sb.WriteString("Duration(\"")
		sb.WriteString(string(value))
		sb.WriteString("\")")
	default:
		return unrepresentable("%T has no STF representation", v)
	}
	return nil
}

func writeArray(items []Value, f Format, level int, sb *strings.Builder) error {
	if len(items) == 0 {
		sb.WriteString("[]")
		return nil
	}
	sb.WriteByte('[')
	if f.Indent == "" {
		for i, item := range items {
			if i > 0 {
				sb.WriteByte(',')
			}
			if err := writeValue(item, f, level+1, sb); err != nil {
				return err
			}
		}
	} else {
		for _, item := range items {
			sb.WriteByte('\n')
			sb.WriteString(strings.Repeat(f.Indent, level+1))
			if err := writeValue(item, f, level+1, sb); err != nil {
				return err
			}
			sb.WriteByte(',')
		}
		sb.WriteByte('\n')
		sb.WriteString(strings.Repeat(f.Indent, level))
	}
	sb.WriteByte(']')
	return nil
}

func writeObject(object *Object, f Format, level int, sb *strings.Builder) error {
	keys := object.Keys()
	for _, key := range keys {
		// §13.6: a key outside the identifier grammar has no STF spelling.
		if key == "" {
			return unrepresentable("an STF key must not be empty")
		}
		if !isIdentifier(key) {
			return unrepresentable("key `%s` is not a valid STF identifier ([A-Za-z0-9_-]+)", key)
		}
	}

	if len(keys) == 0 {
		sb.WriteString("{}")
		return nil
	}

	// §14 rule 5: canonical output orders members by ascending UTF-8 key bytes. Go compares
	// strings bytewise, so a plain sort is already a byte sort.
	if f.Canonical {
		sorted := make([]string, len(keys))
		copy(sorted, keys)
		sort.Strings(sorted)
		keys = sorted
	}

	sb.WriteByte('{')
	if f.Indent == "" {
		for i, key := range keys {
			if i > 0 {
				sb.WriteByte(',')
			}
			sb.WriteString(key)
			sb.WriteByte(':')
			v, _ := object.Get(key)
			if err := writeValue(v, f, level+1, sb); err != nil {
				return err
			}
		}
	} else {
		for _, key := range keys {
			sb.WriteByte('\n')
			sb.WriteString(strings.Repeat(f.Indent, level+1))
			sb.WriteString(key)
			sb.WriteString(": ")
			v, _ := object.Get(key)
			if err := writeValue(v, f, level+1, sb); err != nil {
				return err
			}
			sb.WriteByte(',')
		}
		sb.WriteByte('\n')
		sb.WriteString(strings.Repeat(f.Indent, level))
	}
	sb.WriteByte('}')
	return nil
}

// writeString emits a string.
//
// §13.3: prefer the raw form, but a backtick has no raw escape. §14 rule 6 forces the
// interpreted form for canonical output.
//
// §13.2 is what this function does *not* do: string content never causes a constructor to be
// emitted.
func writeString(s string, f Format, sb *strings.Builder) {
	needsInterpreted := f.Canonical || strings.ContainsRune(s, '`')
	if !needsInterpreted {
		for i := 0; i < len(s); i++ {
			c := s[i]
			if c < 0x20 && c != '\n' && c != '\r' && c != '\t' {
				needsInterpreted = true
				break
			}
			if f.EscapeLineTerminators && (c == '\n' || c == '\r') {
				needsInterpreted = true
				break
			}
		}
	}
	if !needsInterpreted {
		sb.WriteByte('`')
		sb.WriteString(s)
		sb.WriteByte('`')
		return
	}

	sb.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			sb.WriteString(`\"`)
		case '\\':
			sb.WriteString(`\\`)
		case '\b':
			sb.WriteString(`\b`)
		case '\f':
			sb.WriteString(`\f`)
		case '\n':
			sb.WriteString(`\n`)
		case '\r':
			sb.WriteString(`\r`)
		case '\t':
			sb.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(sb, `\u%04X`, r)
			} else {
				// §13.5: non-ASCII scalars are emitted literally as UTF-8.
				sb.WriteRune(r)
			}
		}
	}
	sb.WriteByte('"')
}

// FormatNumber renders a number per §13.4: the shortest decimal form that parses back to the
// identical binary64.
//
// strconv's 'g' with precision -1 gives shortest round-trip digits but switches to exponent
// notation on its own schedule, and 'f' never does. Both spellings are within the §7.1 number
// grammar, so the shorter is taken.
func FormatNumber(n float64) (string, error) {
	if math.IsNaN(n) {
		return "", unrepresentable("NaN is not an STF Number")
	}
	if math.IsInf(n, 0) {
		return "", unrepresentable("an infinity is not an STF Number")
	}
	if n == 0 {
		if math.Signbit(n) {
			return "-0", nil
		}
		return "0", nil
	}

	best := strconv.FormatFloat(n, 'g', -1, 64)
	// 'g' emits an exponent as "1e+09"; the grammar allows it, but "1e9" is shorter and both
	// round-trip. Normalize the exponent so the comparison below is fair.
	best = trimExponent(best)
	if plain := strconv.FormatFloat(n, 'f', -1, 64); len(plain) < len(best) {
		best = plain
	}
	return best, nil
}

// trimExponent rewrites "1e+09" as "1e9" and "1e-07" as "1e-7". Both parse identically.
func trimExponent(s string) string {
	i := strings.IndexAny(s, "eE")
	if i < 0 {
		return s
	}
	mantissa, exp := s[:i], s[i+1:]
	negative := strings.HasPrefix(exp, "-")
	exp = strings.TrimLeft(exp, "+-")
	exp = strings.TrimLeft(exp, "0")
	if exp == "" {
		exp = "0"
	}
	if negative {
		return mantissa + "e-" + exp
	}
	return mantissa + "e" + exp
}
