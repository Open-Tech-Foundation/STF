import re
import json
import base64

class STFError(Exception):
    pass

class STFParser:
    MAX_DEPTH = 64

    def __init__(self, text):
        self.input = text
        self.len = len(text)
        self.pos = 0
        self.depth = 0

    def current(self):
        return self.input[self.pos] if self.pos < self.len else None

    def peek(self, offset=1):
        idx = self.pos + offset
        return self.input[idx] if idx < self.len else None

    def advance(self):
        self.pos += 1

    def skip_whitespace_and_comments(self):
        while self.pos < self.len:
            ch = self.input[self.pos]
            if ch in (' ', '\t', '\r', '\n'):
                self.advance()
            elif ch == '#':
                while self.pos < self.len and self.input[self.pos] != '\n':
                    self.advance()
            else:
                break

    def parse(self):
        self.skip_whitespace_and_comments()
        while self.current() == '@':
            self.parse_directive()
            self.skip_whitespace_and_comments()

        if self.current() != '{':
            raise STFError("ERR_ROOT_NOT_OBJECT: Root must be object")

        result = self.parse_object()
        self.skip_whitespace_and_comments()
        if self.pos < self.len:
            raise STFError(f"ERR_TRAILING_CONTENT: Trailing data after root object: {self.input[self.pos]}")
        return result

    def parse_directive(self):
        self.advance() # skip '@'
        start = self.pos
        while self.pos < self.len and self.is_key_char(self.input[self.pos]):
            self.advance()
        if self.current() != '(':
            raise STFError("ERR_SYNTAX: Expected '(' after directive name")
        self.advance()
        while self.pos < self.len and self.input[self.pos] != ')':
            self.advance()
        if self.current() != ')':
            raise STFError("ERR_UNTERMINATED: Unterminated directive")
        self.advance()

    def parse_object(self):
        if self.current() != '{':
            raise STFError("ERR_ROOT_NOT_OBJECT: Expected '{'")
        self.advance()
        self.depth += 1
        if self.depth > self.MAX_DEPTH:
            raise STFError("ERR_NESTING_DEPTH: Exceeded maximum nesting depth")

        obj = {}
        self.skip_whitespace_and_comments()

        while self.current() != '}':
            if self.pos >= self.len:
                raise STFError("ERR_UNTERMINATED: Unclosed object")

            key = self.parse_key()
            if key in obj:
                raise STFError(f"ERR_DUPLICATE_KEY: Duplicate key: {key}")

            self.skip_whitespace_and_comments()
            if self.current() != ':':
                raise STFError(f"ERR_MISSING_COLON: Expected ':' after key '{key}'")
            self.advance()

            val = self.parse_value()
            obj[key] = val

            self.skip_whitespace_and_comments()
            if self.current() == ',':
                self.advance()
                self.skip_whitespace_and_comments()
            elif self.current() != '}':
                raise STFError(f"ERR_MISSING_COMMA: Expected ',' or '}}' after value for key '{key}'")

        self.advance() # skip '}'
        self.depth -= 1
        return obj

    def parse_array(self):
        self.advance() # skip '['
        self.depth += 1
        if self.depth > self.MAX_DEPTH:
            raise STFError("ERR_NESTING_DEPTH: Exceeded maximum nesting depth")

        arr = []
        self.skip_whitespace_and_comments()

        while self.current() != ']':
            if self.pos >= self.len:
                raise STFError("ERR_UNTERMINATED: Unclosed array")

            val = self.parse_value()
            arr.append(val)

            self.skip_whitespace_and_comments()
            if self.current() == ',':
                self.advance()
                self.skip_whitespace_and_comments()
            elif self.current() != ']':
                raise STFError("ERR_MISSING_COMMA: Expected ',' or ']'")

        self.advance() # skip ']'
        self.depth -= 1
        return arr

    def parse_key(self):
        start = self.pos
        ch = self.current()
        if ch == '"' or ch == '`':
            raise STFError(f"ERR_INVALID_IDENTIFIER: Expected key, got {ch}")
        
        while self.pos < self.len and self.is_key_char(self.input[self.pos]):
            self.advance()

        if self.pos == start:
            raise STFError("ERR_INVALID_IDENTIFIER: Empty or invalid key")

        return self.input[start:self.pos]

    def is_key_char(self, ch):
        return (ch >= 'a' and ch <= 'z') or (ch >= 'A' and ch <= 'Z') or (ch >= '0' and ch <= '9') or ch == '_' or ch == '-'

    def parse_value(self):
        self.skip_whitespace_and_comments()
        ch = self.current()

        if ch == '{':
            return self.parse_object()
        elif ch == '[':
            return self.parse_array()
        elif ch == '`':
            return self.parse_raw_string()
        elif ch == '"':
            return self.parse_interpreted_string()
        elif ch == '-' or (ch >= '0' and ch <= '9'):
            return self.parse_number()
        elif ch == 'T' and not (self.peek() and self.is_key_char(self.peek())):
            self.advance()
            return True
        elif ch == 'F' and not (self.peek() and self.is_key_char(self.peek())):
            self.advance()
            return False
        elif ch == 'N' and not (self.peek() and self.is_key_char(self.peek())):
            self.advance()
            return None
        elif ch and self.is_alpha(ch):
            return self.parse_constructor()
        else:
            raise STFError(f"ERR_SYNTAX: Unexpected character: {ch}")

    def parse_raw_string(self):
        self.advance() # skip '`'
        start = self.pos
        while self.pos < self.len and self.input[self.pos] != '`':
            self.advance()
        if self.pos >= self.len:
            raise STFError("ERR_UNTERMINATED: Unterminated string")
        res = self.input[start:self.pos]
        self.advance() # skip '`'
        return res

    def parse_interpreted_string(self):
        self.advance() # skip '"'
        start = self.pos
        buf = []
        while self.pos < self.len:
            ch = self.input[self.pos]
            if ch == '"':
                self.advance()
                return "".join(buf)
            if ch in ('\r', '\n'):
                raise STFError("ERR_INVALID_STRING: Literal newline in interpreted string")
            if ch == '\\':
                self.advance()
                if self.pos >= self.len:
                    raise STFError("ERR_INVALID_STRING: Unterminated escape sequence")
                esc = self.input[self.pos]
                if esc == '"': buf.append('"')
                elif esc == '\\': buf.append('\\')
                elif esc == '/': buf.append('/')
                elif esc == 'b': buf.append('\b')
                elif esc == 'f': buf.append('\f')
                elif esc == 'n': buf.append('\n')
                elif esc == 'r': buf.append('\r')
                elif esc == 't': buf.append('\t')
                elif esc == 'u':
                    if self.pos + 4 >= self.len:
                        raise STFError("ERR_INVALID_STRING: Incomplete unicode escape")
                    hex_str = self.input[self.pos+1:self.pos+5]
                    try:
                        code = int(hex_str, 16)
                        buf.append(chr(code))
                    except ValueError:
                        raise STFError("ERR_INVALID_STRING: Invalid unicode escape")
                    self.pos += 4
                else:
                    raise STFError("ERR_INVALID_STRING: Invalid escape sequence")
                self.advance()
                continue
            buf.append(ch)
            self.advance()

        raise STFError("ERR_UNTERMINATED: Unterminated string")

    def parse_number(self):
        start = self.pos
        if self.input[self.pos] == '0' and self.pos + 1 < self.len and self.input[self.pos + 1].isdigit():
            raise STFError(f"ERR_INVALID_NUMBER: Leading zero: {self.input[start:self.pos+2]}")

        if self.input[self.pos] == '-':
            self.advance()

        if self.current() == '0':
            self.advance()
            if self.current() and self.current().isdigit():
                raise STFError(f"ERR_INVALID_NUMBER: Leading zero")
        else:
            while self.pos < self.len and self.input[self.pos].isdigit():
                self.advance()

        if self.current() == '.':
            self.advance()
            if not self.current() or not self.current().isdigit():
                raise STFError(f"ERR_INVALID_NUMBER: Trailing dot")
            while self.pos < self.len and self.input[self.pos].isdigit():
                self.advance()

        if self.current() in ('e', 'E'):
            self.advance()
            if self.current() in ('+', '-'):
                self.advance()
            if not self.current() or not self.current().isdigit():
                raise STFError("ERR_INVALID_NUMBER: Invalid exponent")
            while self.pos < self.len and self.input[self.pos].isdigit():
                self.advance()

        num_str = self.input[start:self.pos]
        if '.' in num_str or 'e' in num_str or 'E' in num_str:
            return float(num_str)
        return int(num_str)

    def is_alpha(self, ch):
        return (ch >= 'a' and ch <= 'z') or (ch >= 'A' and ch <= 'Z') or ch == '_' or ch == '-'

    def parse_constructor(self):
        start = self.pos
        while self.pos < self.len and self.is_alpha(self.input[self.pos]):
            self.advance()

        type_name = self.input[start:self.pos]
        if self.current() != '(':
            raise STFError(f"ERR_SYNTAX: Expected '(' after constructor name at position {self.pos}")

        self.advance() # skip '('
        payload_start = self.pos

        while self.pos < self.len and self.input[self.pos] != ')':
            if self.input[self.pos] == '(':
                raise STFError(f"ERR_NESTED_CONSTRUCTOR: Invalid constructor nesting in {type_name}()")
            self.advance()

        if self.pos >= self.len:
            raise STFError("ERR_UNTERMINATED: Unterminated constructor payload")

        payload = self.input[payload_start:self.pos]
        self.advance() # skip ')'

        if type_name == 'DATE':
            if not re.match(r'^\d{4}-\d{2}-\d{2}$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: DATE must be YYYY-MM-DD format")
            year, month, day = map(int, payload.split('-'))
            if month < 1 or month > 12 or day < 1 or day > 31:
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DATE values")
            return f"$date:{payload}"
        elif type_name == 'TIMESTAMP':
            if not re.match(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: TIMESTAMP requires explicit timezone offset (e.g. Z or +HH:MM)")
            return f"$timestamp:{payload}"
        elif type_name == 'BIGINT':
            if len(payload) == 0:
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Empty BIGINT payload")
            if any(c.isspace() for c in payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Whitespace in BIGINT payload")
            if payload.startswith('+'):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Leading '+' not allowed in BIGINT")
            if not re.match(r'^-?\d+$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Non-digit character in BIGINT payload")
            idx = 1 if payload.startswith('-') else 0
            digits = payload[idx:].lstrip('0') or '0'
            if digits == '0':
                return "$bigint:0"
            return f"$bigint:-{digits}" if payload.startswith('-') else f"$bigint:{digits}"
        elif type_name == 'DECIMAL':
            if len(payload) == 0:
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Empty DECIMAL payload")
            if payload.startswith('+'):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Leading '+' in DECIMAL payload")
            if re.match(r'^-?0\d', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Leading zero in DECIMAL payload")
            if not re.match(r'^-?(?:0|[1-9]\d*)(?:\.\d+)?$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DECIMAL format")
            
            clean = payload.lstrip('-').lstrip('0')
            if '.' in clean:
                parts = clean.split('.')
                sig_str = parts[0] + parts[1]
            else:
                sig_str = clean
            sig_digits = len(sig_str)
            if sig_digits > 34:
                raise STFError(f"ERR_DECIMAL_OVERFLOW: DECIMAL exceeds 34 significant digits: {sig_digits}")
            return f"$decimal:{payload}"
        elif type_name == 'BINARY':
            if len(payload) == 0 or len(payload) % 4 != 0:
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY base64 payload length must be a multiple of 4")
            if not re.match(r'^[A-Za-z0-9+/]+={0,2}$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY invalid base64 character")
            
            pad_count = payload.count('=')
            b64_table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
            if pad_count == 1:
                val = b64_table.find(payload[-2])
                if val & 3 != 0:
                    raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY non-canonical trailing bits")
            elif pad_count == 2:
                val = b64_table.find(payload[-3])
                if val & 15 != 0:
                    raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY non-canonical trailing bits")
            return f"$binary:{payload}"
        else:
            raise STFError(f"ERR_UNKNOWN_CONSTRUCTOR: Unknown constructor: {type_name}")

def parse(stf_text):
    return STFParser(stf_text).parse()

def loads(stf_text):
    return parse(stf_text)

def stringify(obj, indent=None):
    if isinstance(obj, dict):
        items = []
        for k in sorted(obj.keys()):
            v = obj[k]
            items.append(f"{k}: {stringify(v, indent)}")
        return "{" + ", ".join(items) + "}"
    elif isinstance(obj, list):
        items = [stringify(element, indent) for element in obj]
        return "[" + ", ".join(items) + "]"
    elif isinstance(obj, str):
        if obj.startswith('$date:'):
            return f"DATE({obj[6:]})"
        elif obj.startswith('$timestamp:'):
            return f"TIMESTAMP({obj[11:]})"
        elif obj.startswith('$bigint:'):
            return f"BIGINT({obj[8:]})"
        elif obj.startswith('$decimal:'):
            return f"DECIMAL({obj[9:]})"
        elif obj.startswith('$binary:'):
            return f"BINARY({obj[8:]})"
        elif '`' in obj:
            return json.dumps(obj)
        else:
            return f"`{obj}`"
    elif isinstance(obj, bool):
        return "T" if obj else "F"
    elif isinstance(obj, type(None)):
        return "N"
    elif isinstance(obj, (int, float)):
        return str(obj)
    else:
        raise STFError(f"Unsupported type for serialization: {type(obj)}")

def dumps(obj):
    return stringify(obj)
