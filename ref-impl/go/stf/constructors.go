package stf

import (
	"fmt"
	"math/big"
	"strings"
)

// ConstructorNames are the five constructor names of STF 1.0, matched byte-for-byte.
var ConstructorNames = [5]string{"BIGINT", "DECIMAL", "DATE", "TIMESTAMP", "BINARY"}

const (
	// maxSignificantDigits is decimal128 coefficient precision (spec §10.2).
	maxSignificantDigits = 34
	// maxScale is the decimal128 exponent range (spec §10.2).
	maxScale = 6143
)

const b64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

// payloadError is a validation failure carrying the normative code.
type payloadError struct {
	code   Code
	detail string
}

func (e *payloadError) Error() string { return e.detail }

func badPayload(format string, args ...any) *payloadError {
	return &payloadError{ErrInvalidConstructorPayload, fmt.Sprintf(format, args...)}
}

func decimalOverflow(format string, args ...any) *payloadError {
	return &payloadError{ErrDecimalOverflow, fmt.Sprintf(format, args...)}
}

// IsKnownConstructor reports whether name is one of the five STF 1.0 constructors.
func IsKnownConstructor(name string) bool {
	for _, n := range ConstructorNames {
		if n == name {
			return true
		}
	}
	return false
}

// IsReservedConstructor reports whether name is in the reserved namespace (spec §10.1).
//
// That is any identifier beginning with an ASCII uppercase letter, plus any ASCII
// case-insensitive match of a defined name. A reserved name that is not an exact match is
// ERR_UNKNOWN_CONSTRUCTOR; anything else before "(" is ERR_SYNTAX.
func IsReservedConstructor(name string) bool {
	if name != "" && name[0] >= 'A' && name[0] <= 'Z' {
		return true
	}
	upper := strings.ToUpper(name)
	for _, n := range ConstructorNames {
		if n == upper {
			return true
		}
	}
	return false
}

func buildConstructor(name, payload string) (Value, *payloadError) {
	switch name {
	case "DECIMAL":
		return ParseDecimal(payload)
	case "BIGINT":
		return ParseBigInt(payload)
	case "DATE":
		return ParseDate(payload)
	case "TIMESTAMP":
		return ParseTimestamp(payload)
	case "BINARY":
		return ParseBinary(payload)
	}
	return nil, &payloadError{ErrUnknownConstructor, fmt.Sprintf("`%s` is not an STF 1.0 constructor", name)}
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

// ParseDecimal validates `[ "-" ] ( "0" | digit1_9 { digit } ) [ "." digit { digit } ]`.
// Plain notation only: no exponent, no leading "+", no leading zeros, no trailing point.
func ParseDecimal(payload string) (*Decimal, *payloadError) {
	if payload == "" {
		return nil, badPayload("DECIMAL payload is empty")
	}

	i := 0
	negative := payload[0] == '-'
	if negative {
		i = 1
	}

	intStart := i
	switch {
	case i < len(payload) && payload[i] == '0':
		i++
	case i < len(payload) && isDigit(payload[i]):
		for i < len(payload) && isDigit(payload[i]) {
			i++
		}
	default:
		return nil, badPayload("DECIMAL integer part is missing")
	}
	// A "0" integer part may only be followed by ".", which rules out `01.5`.
	if payload[intStart] == '0' && i-intStart > 1 {
		return nil, badPayload("DECIMAL has a leading zero")
	}
	intPart := payload[intStart:i]

	fracPart := ""
	if i < len(payload) && payload[i] == '.' {
		i++
		fracStart := i
		for i < len(payload) && isDigit(payload[i]) {
			i++
		}
		if i == fracStart {
			return nil, badPayload("DECIMAL fraction has no digits")
		}
		fracPart = payload[fracStart:i]
	}
	if i != len(payload) {
		return nil, badPayload("DECIMAL payload must be plain notation: no exponent, sign, or trailing characters")
	}

	scale := len(fracPart)
	if scale > maxScale {
		return nil, decimalOverflow("DECIMAL scale %d exceeds the maximum of %d", scale, maxScale)
	}

	digits := intPart + fracPart
	// §10.2: leading zeros are not significant, trailing zeros are, and zero counts as 1.
	stripped := strings.TrimLeft(digits, "0")
	significant := len(stripped)
	if significant == 0 {
		significant = 1
	}
	if significant > maxSignificantDigits {
		return nil, decimalOverflow(
			"DECIMAL has %d significant digits, exceeding the maximum of %d",
			significant, maxSignificantDigits)
	}

	coefficient, ok := new(big.Int).SetString(digits, 10)
	if !ok {
		return nil, badPayload("DECIMAL coefficient is not an integer")
	}
	return NewDecimal(negative, coefficient, scale), nil
}

// ParseBigInt validates `"0" | [ "-" ] digit1_9 { digit }` — one spelling per value, so no
// leading zeros and no negative zero.
func ParseBigInt(payload string) (*big.Int, *payloadError) {
	if payload == "" {
		return nil, badPayload("BIGINT payload is empty")
	}
	if payload == "0" {
		return big.NewInt(0), nil
	}

	i := 0
	if payload[0] == '-' {
		i = 1
	}
	if i >= len(payload) || payload[i] < '1' || payload[i] > '9' {
		return nil, badPayload("BIGINT must be `0` or an optionally-signed integer with no leading zero")
	}
	i++
	for i < len(payload) && isDigit(payload[i]) {
		i++
	}
	if i != len(payload) {
		return nil, badPayload("BIGINT payload contains a non-digit character")
	}

	n, ok := new(big.Int).SetString(payload, 10)
	if !ok {
		return nil, badPayload("BIGINT payload is not an integer")
	}
	return n, nil
}

func isLeapYear(year int) bool {
	return (year%4 == 0 && year%100 != 0) || year%400 == 0
}

func daysInMonth(year, month int) int {
	switch month {
	case 1, 3, 5, 7, 8, 10, 12:
		return 31
	case 4, 6, 9, 11:
		return 30
	case 2:
		if isLeapYear(year) {
			return 29
		}
		return 28
	}
	return 0
}

// asciiDigits reports whether text[start:start+count] is all ASCII digits.
func asciiDigits(text string, start, count int) bool {
	if start+count > len(text) {
		return false
	}
	for i := start; i < start+count; i++ {
		if !isDigit(text[i]) {
			return false
		}
	}
	return true
}

func atoi(text string) int {
	n := 0
	for i := 0; i < len(text); i++ {
		n = n*10 + int(text[i]-'0')
	}
	return n
}

// ParseDate validates YYYY-MM-DD with full proleptic-Gregorian calendar checks (spec §10.4).
func ParseDate(payload string) (Date, *payloadError) {
	if len(payload) != 10 {
		return Date{}, badPayload("DATE must be exactly `YYYY-MM-DD`")
	}
	return parseDateAt(payload)
}

func parseDateAt(text string) (Date, *payloadError) {
	if len(text) < 10 {
		return Date{}, badPayload("DATE must be exactly `YYYY-MM-DD`")
	}
	if !asciiDigits(text, 0, 4) || !asciiDigits(text, 5, 2) || !asciiDigits(text, 8, 2) {
		return Date{}, badPayload("DATE must be exactly `YYYY-MM-DD`")
	}
	if text[4] != '-' || text[7] != '-' {
		return Date{}, badPayload("DATE must be exactly `YYYY-MM-DD`")
	}
	year, month, day := atoi(text[0:4]), atoi(text[5:7]), atoi(text[8:10])
	if month < 1 || month > 12 {
		return Date{}, badPayload("month %02d is out of range", month)
	}
	if day < 1 || day > daysInMonth(year, month) {
		return Date{}, badPayload("day %02d is out of range for %04d-%02d", day, year, month)
	}
	return Date{Year: year, Month: month, Day: day}, nil
}

// ParseTimestamp validates `date "T" hh:mm:ss [ "." digit{1,9} ] ( "Z" | ±hh:mm )` (spec §10.4).
func ParseTimestamp(payload string) (Timestamp, *payloadError) {
	date, err := parseDateAt(payload)
	if err != nil {
		return Timestamp{}, err
	}
	if len(payload) < 19 || payload[10] != 'T' {
		return Timestamp{}, badPayload("TIMESTAMP requires an uppercase `T` between date and time")
	}
	if payload[13] != ':' || payload[16] != ':' {
		return Timestamp{}, badPayload("TIMESTAMP time must be `hh:mm:ss`")
	}
	if !asciiDigits(payload, 11, 2) || !asciiDigits(payload, 14, 2) || !asciiDigits(payload, 17, 2) {
		return Timestamp{}, badPayload("TIMESTAMP time must be `hh:mm:ss`")
	}

	hour, minute, second := atoi(payload[11:13]), atoi(payload[14:16]), atoi(payload[17:19])
	if hour > 23 {
		return Timestamp{}, badPayload("hour %02d is out of range", hour)
	}
	if minute > 59 {
		return Timestamp{}, badPayload("minute %02d is out of range", minute)
	}
	// §10.4: leap seconds are not supported, so 60 is simply out of range.
	if second > 59 {
		return Timestamp{}, badPayload("second %02d is out of range; leap seconds are not supported", second)
	}

	i := 19
	fraction := ""
	if i < len(payload) && payload[i] == '.' {
		i++
		start := i
		for i < len(payload) && isDigit(payload[i]) {
			i++
		}
		if n := i - start; n < 1 || n > 9 {
			return Timestamp{}, badPayload("TIMESTAMP fraction must have 1 to 9 digits")
		}
		fraction = payload[start:i]
	}

	var offset Offset
	switch {
	case i < len(payload) && payload[i] == 'Z':
		offset = Offset{UTC: true}
		i++
	case i < len(payload) && (payload[i] == '+' || payload[i] == '-'):
		if i+6 > len(payload) || payload[i+3] != ':' {
			return Timestamp{}, badPayload("TIMESTAMP offset must be `±hh:mm`")
		}
		if !asciiDigits(payload, i+1, 2) || !asciiDigits(payload, i+4, 2) {
			return Timestamp{}, badPayload("TIMESTAMP offset must be `±hh:mm`")
		}
		hours, minutes := atoi(payload[i+1:i+3]), atoi(payload[i+4:i+6])
		if hours > 23 {
			return Timestamp{}, badPayload("offset hour %02d is out of range", hours)
		}
		if minutes > 59 {
			return Timestamp{}, badPayload("offset minute %02d is out of range", minutes)
		}
		offset = Offset{Negative: payload[i] == '-', Hours: hours, Minutes: minutes}
		i += 6
	default:
		return Timestamp{}, badPayload("TIMESTAMP requires a UTC offset (`Z` or `±hh:mm`)")
	}

	if i != len(payload) {
		return Timestamp{}, badPayload("TIMESTAMP has trailing characters after the offset")
	}
	return Timestamp{
		Date: date, Hour: hour, Minute: minute, Second: second,
		Fraction: fraction, Offset: offset,
	}, nil
}

func b64Index(c byte) int {
	switch {
	case c >= 'A' && c <= 'Z':
		return int(c - 'A')
	case c >= 'a' && c <= 'z':
		return int(c-'a') + 26
	case c >= '0' && c <= '9':
		return int(c-'0') + 52
	case c == '+':
		return 62
	case c == '/':
		return 63
	}
	return -1
}

// ParseBinary decodes canonical RFC 4648 §4 base64 (spec §10.5). The empty payload is valid.
//
// The standard library's base64.StdEncoding accepts non-canonical trailing bits, so the
// decoding is done here rather than delegated.
func ParseBinary(payload string) ([]byte, *payloadError) {
	if payload == "" {
		return []byte{}, nil
	}
	if len(payload)%4 != 0 {
		return nil, badPayload("BINARY length must be a multiple of 4")
	}

	pad := 0
	for pad < len(payload) && payload[len(payload)-1-pad] == '=' {
		pad++
	}
	if pad > 2 {
		return nil, badPayload("BINARY has more than two padding characters")
	}

	data := payload[:len(payload)-pad]
	for i := 0; i < len(data); i++ {
		if b64Index(data[i]) < 0 {
			// Covers the URL-safe alphabet, internal whitespace, and a stray "=".
			return nil, badPayload("BINARY contains a character outside the standard base64 alphabet")
		}
	}

	// Canonical encoding: the bits the padding discards must be zero.
	if pad > 0 {
		if len(data) == 0 {
			return nil, badPayload("BINARY has only padding")
		}
		mask := 0b11
		if pad == 2 {
			mask = 0b1111
		}
		if b64Index(data[len(data)-1])&mask != 0 {
			return nil, badPayload("BINARY has non-canonical trailing bits")
		}
	}

	out := make([]byte, 0, len(data)*6/8)
	acc, bits := 0, 0
	for i := 0; i < len(data); i++ {
		acc = acc<<6 | b64Index(data[i])
		bits += 6
		if bits >= 8 {
			bits -= 8
			out = append(out, byte(acc>>bits))
		}
	}
	return out, nil
}

// BinaryToBase64 encodes octets as canonical base64, for serialization (spec §13.7).
func BinaryToBase64(data []byte) string {
	var sb strings.Builder
	sb.Grow((len(data) + 2) / 3 * 4)
	for i := 0; i < len(data); i += 3 {
		remaining := len(data) - i
		b0 := int(data[i])
		b1, b2 := 0, 0
		if remaining > 1 {
			b1 = int(data[i+1])
		}
		if remaining > 2 {
			b2 = int(data[i+2])
		}
		n := b0<<16 | b1<<8 | b2
		sb.WriteByte(b64Alphabet[n>>18&63])
		sb.WriteByte(b64Alphabet[n>>12&63])
		if remaining > 1 {
			sb.WriteByte(b64Alphabet[n>>6&63])
		} else {
			sb.WriteByte('=')
		}
		if remaining > 2 {
			sb.WriteByte(b64Alphabet[n&63])
		} else {
			sb.WriteByte('=')
		}
	}
	return sb.String()
}
