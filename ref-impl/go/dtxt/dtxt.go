package dtxt

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"
)

// DTXTValue represents any valid DTXT value
type DTXTValue interface{}

// Parser handles DTXT parsing
type Parser struct {
	input []byte
	pos   int
	depth int
}

const maxDepth = 64

// NewParser creates a new DTXT parser
func NewParser(input string) *Parser {
	return &Parser{
		input: []byte(input),
		pos:   0,
	}
}

func (p *Parser) current() byte {
	if p.pos < len(p.input) {
		return p.input[p.pos]
	}
	return 0
}

func (p *Parser) advance() {
	p.pos++
}

func (p *Parser) skipWhitespace() {
	for p.pos < len(p.input) {
		ch := p.current()
		switch ch {
		case ' ', '\t', '\r', '\n':
			p.advance()
		case '#':
			// Skip comment
			p.pos += 1
			for p.pos < len(p.input) && p.current() != '\n' {
				p.advance()
			}
		default:
			return
		}
	}
}

// Parse parses a DTXT string and returns a map
func (p *Parser) Parse() (map[string]DTXTValue, error) {
	p.skipWhitespace()
	for p.current() == '@' {
		if err := p.parseDirective(); err != nil {
			return nil, err
		}
		p.skipWhitespace()
	}
	result, err := p.parseObject()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	if p.pos < len(p.input) {
		return nil, fmt.Errorf("trailing data at position %d", p.pos)
	}
	return result, nil
}

func (p *Parser) parseDirective() error {
	p.advance() // skip '@'
	for p.pos < len(p.input) {
		ch := p.current()
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-' {
			p.advance()
		} else {
			break
		}
	}
	if p.current() != '(' {
		return fmt.Errorf("expected '(' after directive name at position %d", p.pos)
	}
	p.advance()
	for p.pos < len(p.input) && p.current() != ')' {
		p.advance()
	}
	if p.pos >= len(p.input) {
		return fmt.Errorf("unterminated directive at position %d", p.pos)
	}
	p.advance() // skip ')'
	return nil
}

func (p *Parser) parseValue() (DTXTValue, error) {
	p.skipWhitespace()
	ch := p.current()

	switch ch {
	case '{':
		return p.parseObject()
	case '[':
		return p.parseArray()
	case '`':
		return p.parseString()
	case '"':
		return p.parseInterpretedString()
	case '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9':
		return p.parseNumber()
	case 'T':
		if p.pos+1 < len(p.input) && p.input[p.pos+1] == '(' {
			return p.parseConstructor()
		}
		p.advance()
		return true, nil
	case 'F':
		if p.pos+1 < len(p.input) && p.input[p.pos+1] == '(' {
			return p.parseConstructor()
		}
		p.advance()
		return false, nil
	case 'N':
		if p.pos+1 < len(p.input) && p.input[p.pos+1] == '(' {
			return p.parseConstructor()
		}
		p.advance()
		return nil, nil
	default:
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch == '_' {
			return p.parseConstructor()
		}
		return nil, fmt.Errorf("unexpected character at position %d: %c", p.pos, ch)
	}
}

func (p *Parser) parseObject() (map[string]DTXTValue, error) {
	p.advance() // skip '{'
	p.depth++
	if p.depth > maxDepth {
		return nil, fmt.Errorf("ERR_NESTING_DEPTH: exceeded %d levels", maxDepth)
	}
	defer func() { p.depth-- }()

	obj := make(map[string]DTXTValue)

	p.skipWhitespace()
	for p.current() != '}' {
		// Parse key
		key, err := p.parseKey()
		if err != nil {
			return nil, err
		}

		p.skipWhitespace()
		if p.current() != ':' {
			return nil, fmt.Errorf("expected ':' at position %d", p.pos)
		}
		p.advance()

		value, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		if _, ok := obj[key]; ok {
			return nil, fmt.Errorf("duplicate key: %s", key)
		}
		obj[key] = value

		p.skipWhitespace()
		if p.current() == ',' {
			p.advance()
			p.skipWhitespace()
		}
	}

	p.advance() // skip '}'
	return obj, nil
}

func (p *Parser) parseArray() ([]DTXTValue, error) {
	p.advance() // skip '['
	p.depth++
	if p.depth > maxDepth {
		return nil, fmt.Errorf("ERR_NESTING_DEPTH: exceeded %d levels", maxDepth)
	}
	defer func() { p.depth-- }()

	arr := make([]DTXTValue, 0)

	p.skipWhitespace()
	for p.current() != ']' {
		value, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		arr = append(arr, value)

		p.skipWhitespace()
		if p.current() == ',' {
			p.advance()
			p.skipWhitespace()
		}
	}

	p.advance() // skip ']'
	return arr, nil
}

func (p *Parser) parseKey() (string, error) {
	start := p.pos
	for p.pos < len(p.input) {
		ch := p.current()
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-' {
			p.advance()
		} else {
			break
		}
	}
	if p.pos == start {
		return "", fmt.Errorf("ERR_INVALID_IDENTIFIER: empty key")
	}
	return string(p.input[start:p.pos]), nil
}

func (p *Parser) parseString() (string, error) {
	p.advance() // skip opening '`'
	start := p.pos
	for p.pos < len(p.input) && p.current() != '`' {
		p.advance()
	}
	if p.pos == len(p.input) {
		return "", fmt.Errorf("ERR_UNTERMINATED: string")
	}
	result := string(p.input[start:p.pos])
	p.advance() // skip closing '`'
	return result, nil
}

func (p *Parser) parseInterpretedString() (string, error) {
	p.advance() // skip opening '"'
	var buf strings.Builder
	for p.pos < len(p.input) {
		ch := p.current()
		if ch == '"' {
			p.advance()
			return buf.String(), nil
		}
		if ch == '\n' || ch == '\r' {
			return "", fmt.Errorf("ERR_INVALID_STRING: literal newline in interpreted string")
		}
		if ch == '\\' {
			p.advance()
			if p.pos >= len(p.input) {
				return "", fmt.Errorf("ERR_INVALID_STRING: unterminated escape")
			}
			esc := p.current()
			switch esc {
			case '"':
				buf.WriteByte('"')
			case '\\':
				buf.WriteByte('\\')
			case '/':
				buf.WriteByte('/')
			case 'b':
				buf.WriteByte('\b')
			case 'f':
				buf.WriteByte('\f')
			case 'n':
				buf.WriteByte('\n')
			case 'r':
				buf.WriteByte('\r')
			case 't':
				buf.WriteByte('\t')
			case 'u':
				if p.pos+4 >= len(p.input) {
					return "", fmt.Errorf("ERR_INVALID_STRING: incomplete unicode escape")
				}
				hexStr := string(p.input[p.pos+1 : p.pos+5])
				var codepoint uint32
				_, err := fmt.Sscanf(hexStr, "%x", &codepoint)
				if err != nil {
					return "", fmt.Errorf("ERR_INVALID_STRING: invalid unicode escape")
				}
				buf.WriteRune(rune(codepoint))
				p.pos += 4
			default:
				return "", fmt.Errorf("ERR_INVALID_STRING: invalid escape sequence")
			}
			p.advance()
			continue
		}
		buf.WriteByte(ch)
		p.advance()
	}
	return "", fmt.Errorf("ERR_INVALID_STRING: unterminated string")
}

func (p *Parser) parseNumber() (float64, error) {
	start := p.pos

	// Optional negative sign
	if p.current() == '-' {
		p.advance()
	}

	// Integer part
	if p.current() == '0' {
		p.advance()
	} else if p.current() >= '1' && p.current() <= '9' {
		for p.pos < len(p.input) && p.current() >= '0' && p.current() <= '9' {
			p.advance()
		}
	}

	// Decimal part
	if p.current() == '.' {
		p.advance()
		for p.pos < len(p.input) && p.current() >= '0' && p.current() <= '9' {
			p.advance()
		}
	}

	// Exponent
	if p.current() == 'e' || p.current() == 'E' {
		p.advance()
		if p.current() == '+' || p.current() == '-' {
			p.advance()
		}
		for p.pos < len(p.input) && p.current() >= '0' && p.current() <= '9' {
			p.advance()
		}
	}

	numStr := string(p.input[start:p.pos])
	if strings.HasSuffix(numStr, ".") {
		return 0, fmt.Errorf("invalid number: %s (trailing dot)", numStr)
	}
	return strconv.ParseFloat(numStr, 64)
}

func (p *Parser) parseConstructor() (DTXTValue, error) {
	start := p.pos
	for p.pos < len(p.input) {
		ch := p.current()
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '-' {
			p.advance()
		} else {
			break
		}
	}
	typeName := string(p.input[start:p.pos])

	if p.current() != '(' {
		return nil, fmt.Errorf("expected '(' after constructor name at position %d", p.pos)
	}
	p.advance()

	payloadStart := p.pos
	for p.pos < len(p.input) && p.current() != ')' {
		p.advance()
	}
	payload := string(p.input[payloadStart:p.pos])
	p.advance() // skip ')'

		switch typeName {
		case "Date":
			// Handle payload with spaces
			// Try different formats
			formats := []string{
				"2006-01-02 15:04:05",
				"2006-01-02T15:04:05Z07:00",
				"2006-01-02T15:04:05",
				"2006-01-02",
			}
			for _, fmt := range formats {
				t, err := time.Parse(fmt, payload)
				if err == nil {
					return t, nil
				}
			}
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")
		case "BigNumber":
			if len(payload) == 0 {
				return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: empty BigNumber payload")
			}
			for _, ch := range payload {
				if ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' {
					return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: whitespace in BigNumber payload")
				}
			}
			n := new(big.Int)
			_, ok := n.SetString(payload, 10)
			if !ok {
				return nil, fmt.Errorf("invalid BigNumber payload: %s", payload)
			}
			return n, nil
		case "Binary":
			if len(payload) == 0 {
				return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: empty Binary payload")
			}
			for _, ch := range payload {
				if ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' {
					return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: whitespace in Binary payload")
				}
			}
			bytes, err := hex.DecodeString(payload)
			if err != nil {
				return nil, fmt.Errorf("invalid Binary(hex) payload: %s", payload)
			}
			return bytes, nil
		default:
			return nil, fmt.Errorf("unknown constructor: %s", typeName)
		}
}

// Parse is a convenience function to parse DTXT strings
func Parse(input string) (map[string]DTXTValue, error) {
	parser := NewParser(input)
	return parser.Parse()
}

// Stringify converts a DTXT value to a string
func Stringify(value DTXTValue, indent string) string {
	var sb strings.Builder
	stringifyValue(value, &sb, indent, 0)
	return sb.String()
}

func stringifyValue(value DTXTValue, sb *strings.Builder, indent string, level int) {
	switch v := value.(type) {
	case string:
		if strings.Contains(v, "`") {
			sb.WriteString(strconv.Quote(v))
		} else {
			sb.WriteString("`")
			sb.WriteString(v)
			sb.WriteString("`")
		}
	case float64:
		sb.WriteString(strconv.FormatFloat(v, 'g', -1, 64))
	case int:
		sb.WriteString(strconv.Itoa(v))
	case bool:
		if v {
			sb.WriteString("T")
		} else {
			sb.WriteString("F")
		}
	case nil:
		sb.WriteString("N")
	case *big.Int:
		sb.WriteString("BigNumber(")
		sb.WriteString(v.String())
		sb.WriteString(")")
	case time.Time:
		sb.WriteString("Date(")
		str := v.Format(time.RFC3339Nano)
		if strings.HasSuffix(str, ".000Z") {
			str = str[:len(str)-5] + "Z"
		}
		sb.WriteString(str)
		sb.WriteString(")")
	case []byte:
		sb.WriteString("Binary(")
		sb.WriteString(strings.ToUpper(hex.EncodeToString(v)))
		sb.WriteString(")")
	case []DTXTValue:
		if len(v) == 0 {
			sb.WriteString("[]")
			return
		}
		sb.WriteString("[")
		if indent != "" {
			sb.WriteString("\n")
			for _, item := range v {
				for j := 0; j <= level; j++ {
					sb.WriteString(indent)
				}
				stringifyValue(item, sb, indent, level+1)
				sb.WriteString(",\n")
			}
			for j := 0; j < level; j++ {
				sb.WriteString(indent)
			}
		} else {
			for i, item := range v {
				stringifyValue(item, sb, indent, level+1)
				if i < len(v)-1 {
					sb.WriteString(",")
				}
			}
		}
		sb.WriteString("]")
	case map[string]DTXTValue:
		if len(v) == 0 {
			sb.WriteString("{}")
			return
		}
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		sb.WriteString("{")
		if indent != "" {
			sb.WriteString("\n")
			for _, k := range keys {
				for j := 0; j <= level; j++ {
					sb.WriteString(indent)
				}
				sb.WriteString(k)
				sb.WriteString(": ")
				stringifyValue(v[k], sb, indent, level+1)
				sb.WriteString(",\n")
			}
			for j := 0; j < level; j++ {
				sb.WriteString(indent)
			}
		} else {
			for i, k := range keys {
				sb.WriteString(k)
				sb.WriteString(":")
				stringifyValue(v[k], sb, indent, level+1)
				if i < len(keys)-1 {
					sb.WriteString(",")
				}
			}
		}
		sb.WriteString("}")
	}
}
