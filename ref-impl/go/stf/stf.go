package stf

import (
	"encoding/base64"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// STFValue represents any valid STF value
type STFValue interface{}

// Parser handles STF parsing
type Parser struct {
	input []byte
	pos   int
	depth int
}

const maxDepth = 64

// NewParser creates a new STF parser
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
			p.pos += 1
			for p.pos < len(p.input) && p.current() != '\n' {
				p.advance()
			}
		default:
			return
		}
	}
}

// Parse parses a STF string and returns a map
func (p *Parser) Parse() (map[string]STFValue, error) {
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
		return nil, fmt.Errorf("ERR_TRAILING_CONTENT: trailing data at position %d", p.pos)
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
		return fmt.Errorf("ERR_SYNTAX: expected '(' after directive name at position %d", p.pos)
	}
	p.advance()
	for p.pos < len(p.input) && p.current() != ')' {
		p.advance()
	}
	if p.pos >= len(p.input) {
		return fmt.Errorf("ERR_UNTERMINATED: unterminated directive at position %d", p.pos)
	}
	p.advance() // skip ')'
	return nil
}

func (p *Parser) parseValue() (STFValue, error) {
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
		if p.pos+1 < len(p.input) && ((p.input[p.pos+1] >= 'A' && p.input[p.pos+1] <= 'Z') || (p.input[p.pos+1] >= 'a' && p.input[p.pos+1] <= 'z') || p.input[p.pos+1] == '_' || p.input[p.pos+1] == '-') {
			return p.parseConstructor()
		}
		p.advance()
		return true, nil
	case 'F':
		if p.pos+1 < len(p.input) && ((p.input[p.pos+1] >= 'A' && p.input[p.pos+1] <= 'Z') || (p.input[p.pos+1] >= 'a' && p.input[p.pos+1] <= 'z') || p.input[p.pos+1] == '_' || p.input[p.pos+1] == '-') {
			return p.parseConstructor()
		}
		p.advance()
		return false, nil
	case 'N':
		if p.pos+1 < len(p.input) && ((p.input[p.pos+1] >= 'A' && p.input[p.pos+1] <= 'Z') || (p.input[p.pos+1] >= 'a' && p.input[p.pos+1] <= 'z') || p.input[p.pos+1] == '_' || p.input[p.pos+1] == '-') {
			return p.parseConstructor()
		}
		p.advance()
		return nil, nil
	default:
		if (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch == '_' {
			return p.parseConstructor()
		}
		return nil, fmt.Errorf("ERR_SYNTAX: unexpected character at position %d: %c", p.pos, ch)
	}
}

func (p *Parser) parseObject() (map[string]STFValue, error) {
	if p.current() != '{' {
		return nil, fmt.Errorf("ERR_ROOT_NOT_OBJECT: expected '{'")
	}
	p.advance()
	p.depth++
	if p.depth > maxDepth {
		return nil, fmt.Errorf("ERR_NESTING_DEPTH: exceeded %d levels", maxDepth)
	}
	defer func() { p.depth-- }()

	obj := make(map[string]STFValue)

	p.skipWhitespace()
	for p.current() != '}' {
		key, err := p.parseKey()
		if err != nil {
			return nil, err
		}

		p.skipWhitespace()
		if p.current() != ':' {
			return nil, fmt.Errorf("ERR_MISSING_COLON: expected ':' at position %d", p.pos)
		}
		p.advance()

		value, err := p.parseValue()
		if err != nil {
			return nil, err
		}
		if _, ok := obj[key]; ok {
			return nil, fmt.Errorf("ERR_DUPLICATE_KEY: duplicate key: %s", key)
		}
		obj[key] = value

		p.skipWhitespace()
		if p.current() == ',' {
			p.advance()
			p.skipWhitespace()
		} else if p.current() != '}' {
			return nil, fmt.Errorf("ERR_MISSING_COMMA: expected ',' or '}' in object")
		}
	}

	if p.pos >= len(p.input) {
		return nil, fmt.Errorf("ERR_UNTERMINATED: unclosed object")
	}
	p.advance() // skip '}'
	return obj, nil
}

func (p *Parser) parseArray() ([]STFValue, error) {
	p.advance() // skip '['
	p.depth++
	if p.depth > maxDepth {
		return nil, fmt.Errorf("ERR_NESTING_DEPTH: exceeded %d levels", maxDepth)
	}
	defer func() { p.depth-- }()

	arr := make([]STFValue, 0)

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
		} else if p.current() != ']' {
			return nil, fmt.Errorf("ERR_MISSING_COMMA: expected ',' or ']' in array")
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
	p.advance()
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

	if p.current() == '-' {
		p.advance()
	}

	if p.current() == '0' {
		p.advance()
		if p.current() >= '0' && p.current() <= '9' {
			return 0, fmt.Errorf("ERR_INVALID_NUMBER: leading zero")
		}
	} else if p.current() >= '1' && p.current() <= '9' {
		for p.pos < len(p.input) && p.current() >= '0' && p.current() <= '9' {
			p.advance()
		}
	}

	if p.current() == '.' {
		p.advance()
		for p.pos < len(p.input) && p.current() >= '0' && p.current() <= '9' {
			p.advance()
		}
	}

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
		return 0, fmt.Errorf("ERR_INVALID_NUMBER: %s (trailing dot)", numStr)
	}
	return strconv.ParseFloat(numStr, 64)
}

func (p *Parser) parseConstructor() (STFValue, error) {
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
		return nil, fmt.Errorf("ERR_SYNTAX: expected '(' after constructor name at position %d", p.pos)
	}
	p.advance()

	payloadStart := p.pos
	for p.pos < len(p.input) && p.current() != ')' {
		if p.current() == '(' {
			return nil, fmt.Errorf("ERR_NESTED_CONSTRUCTOR: invalid constructor nesting")
		}
		p.advance()
	}
	if p.pos >= len(p.input) {
		return nil, fmt.Errorf("ERR_UNTERMINATED: constructor payload")
	}
	payload := string(p.input[payloadStart:p.pos])
	p.advance() // skip ')'

	switch typeName {
	case "DATE":
		matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}$`, payload)
		if !matched {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: DATE must be YYYY-MM-DD format")
		}
		return fmt.Sprintf("$date:%s", payload), nil
	case "TIMESTAMP":
		matched, _ := regexp.MatchString(`^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`, payload)
		if !matched {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: TIMESTAMP requires explicit offset")
		}
		return fmt.Sprintf("$timestamp:%s", payload), nil
	case "BIGINT":
		if len(payload) == 0 || strings.ContainsAny(payload, " \t\r\n+") {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: invalid BIGINT payload")
		}
		matched, _ := regexp.MatchString(`^-?\d+$`, payload)
		if !matched {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: invalid BIGINT format")
		}
		sign := ""
		pStr := payload
		if strings.HasPrefix(payload, "-") {
			sign = "-"
			pStr = payload[1:]
		}
		pStr = strings.TrimLeft(pStr, "0")
		if pStr == "" {
			return "$bigint:0", nil
		}
		return fmt.Sprintf("$bigint:%s%s", sign, pStr), nil
	case "DECIMAL":
		// Note in each ref-impl: native == is wrong (e.g. shopspring/decimal compares numerically).
		// Hand-roll digits+scale string match for exact scale preservation!
		if len(payload) == 0 || strings.HasPrefix(payload, "+") {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: invalid DECIMAL payload")
		}
		matched, _ := regexp.MatchString(`^-?(?:0|[1-9]\d*)(?:\.\d+)?$`, payload)
		if !matched {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: invalid DECIMAL format")
		}
		clean := strings.TrimPrefix(payload, "-")
		clean = strings.TrimLeft(clean, "0")
		clean = strings.ReplaceAll(clean, ".", "")
		if len(clean) > 34 {
			return nil, fmt.Errorf("ERR_DECIMAL_OVERFLOW: DECIMAL exceeds 34 significant digits")
		}
		return fmt.Sprintf("$decimal:%s", payload), nil
	case "BINARY":
		// RFC 4648 standard base64 alphabet
		if len(payload) == 0 || len(payload)%4 != 0 {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY base64 length must be multiple of 4")
		}
		matched, _ := regexp.MatchString(`^[A-Za-z0-9+/]+={0,2}$`, payload)
		if !matched {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY invalid base64 alphabet")
		}
		_, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: invalid base64")
		}
		if strings.HasSuffix(payload, "==") {
			b64Table := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
			val := strings.IndexByte(b64Table, payload[len(payload)-3])
			if val&15 != 0 {
				return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY non-canonical trailing bits")
			}
		} else if strings.HasSuffix(payload, "=") {
			b64Table := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
			val := strings.IndexByte(b64Table, payload[len(payload)-2])
			if val&3 != 0 {
				return nil, fmt.Errorf("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY non-canonical trailing bits")
			}
		}
		return fmt.Sprintf("$binary:%s", payload), nil
	default:
		return nil, fmt.Errorf("ERR_UNKNOWN_CONSTRUCTOR: unknown constructor: %s", typeName)
	}
}

// Parse is a convenience function to parse STF strings
func Parse(input string) (map[string]STFValue, error) {
	parser := NewParser(input)
	return parser.Parse()
}

// Stringify converts a STF value to a string
func Stringify(value STFValue, indent string) string {
	var sb strings.Builder
	stringifyValue(value, &sb, indent, 0)
	return sb.String()
}

func stringifyValue(value STFValue, sb *strings.Builder, indent string, level int) {
	switch v := value.(type) {
	case string:
		if strings.HasPrefix(v, "$date:") {
			sb.WriteString("DATE(")
			sb.WriteString(v[6:])
			sb.WriteString(")")
		} else if strings.HasPrefix(v, "$timestamp:") {
			sb.WriteString("TIMESTAMP(")
			sb.WriteString(v[11:])
			sb.WriteString(")")
		} else if strings.HasPrefix(v, "$bigint:") {
			sb.WriteString("BIGINT(")
			sb.WriteString(v[8:])
			sb.WriteString(")")
		} else if strings.HasPrefix(v, "$decimal:") {
			sb.WriteString("DECIMAL(")
			sb.WriteString(v[9:])
			sb.WriteString(")")
		} else if strings.HasPrefix(v, "$binary:") {
			sb.WriteString("BINARY(")
			sb.WriteString(v[8:])
			sb.WriteString(")")
		} else if strings.Contains(v, "`") {
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
	case []STFValue:
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
	case map[string]STFValue:
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
