import re
import json
import base64

class STFError(Exception):
    pass

class STFLexer:
    TOKEN_SPEC = [
        ('DIRECTIVE',   r'@[A-Za-z0-9_-]+\([^()]*\)'),
        ('COMMENT',     r'#.*'),
        ('STRING',      r'`[^`]*`'),
        ('DSTRING',     r'"(?:[^"\\]|\\.)*"'),
        ('CONSTRUCTOR', r'[A-Za-z0-9_-]+\([^()]*\)'),
        ('BRACE_OPEN',  r'\{'),
        ('BRACE_CLOSE', r'\}'),
        ('BRACKET_OPEN',r'\['),
        ('BRACKET_CLOSE',r'\]'),
        ('COLON',       r':'),
        ('COMMA',       r','),
        ('NUMBER',      r'-?(?:0(?!\d)|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![A-Za-z0-9_-])'),
        ('BOOL_T',      r'T'),
        ('BOOL_F',      r'F'),
        ('NULL_N',      r'N'),
        ('KEY',         r'[A-Za-z0-9_-]+'),
        ('WHITESPACE',  r'[ \t\r\n]+'),
        ('MISMATCH',    r'.'),
    ]
    
    def __init__(self, text):
        self.tokens = []
        self.pos = 0
        self.text = text
        regex = '|'.join('(?P<%s>%s)' % pair for pair in self.TOKEN_SPEC)
        for mo in re.finditer(regex, text):
            kind = mo.lastgroup
            value = mo.group()
            if kind == 'WHITESPACE' or kind == 'COMMENT' or kind == 'DIRECTIVE':
                continue
            elif kind == 'MISMATCH':
                raise STFError(f"ERR_SYNTAX: Unexpected character: {value!r}")
            self.tokens.append((kind, value))
        self.tokens.append(('EOF', None))

class STFParser:
    MAX_DEPTH = 64
    
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0
        self.depth = 0

    def peek(self):
        return self.tokens[self.pos]

    def consume(self, expected_kind=None):
        kind, value = self.tokens[self.pos]
        if expected_kind and kind != expected_kind:
            raise STFError(f"Expected {expected_kind}, got {kind}")
        self.pos += 1
        return value

    def parse(self):
        result = self.parse_object()
        if self.peek()[0] != 'EOF':
            raise STFError(f"ERR_TRAILING_CONTENT: Trailing data after root object: {self.peek()[0]}")
        return result

    def parse_value(self):
        kind, value = self.peek()
        if kind == 'BRACE_OPEN':
            return self.parse_object()
        elif kind == 'BRACKET_OPEN':
            return self.parse_array()
        elif kind == 'STRING':
            self.consume()
            return value[1:-1]
        elif kind == 'DSTRING':
            self.consume()
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                raise STFError(f"ERR_INVALID_STRING: Invalid string escape sequence: {value}")
        elif kind == 'NUMBER':
            self.consume()
            if re.match(r'^-?0\d+', value):
                raise STFError(f"ERR_INVALID_NUMBER: {value} (leading zero)")
            if value.endswith('.'):
                raise STFError(f"ERR_INVALID_NUMBER: {value} (trailing dot)")
            if '.' in value or 'e' in value or 'E' in value:
                return float(value)
            return int(value)
        elif kind == 'BOOL_T':
            self.consume()
            return True
        elif kind == 'BOOL_F':
            self.consume()
            return False
        elif kind == 'NULL_N':
            self.consume()
            return None
        elif kind == 'CONSTRUCTOR':
            self.consume()
            return self.parse_constructor(value)
        else:
            raise STFError(f"ERR_SYNTAX: Unexpected token in value position: {kind} ({value})")

    def parse_object(self):
        if self.peek()[0] != 'BRACE_OPEN':
            raise STFError("ERR_ROOT_NOT_OBJECT: Root must be object")
        self.consume('BRACE_OPEN')
        self.depth += 1
        if self.depth > self.MAX_DEPTH:
            raise STFError("ERR_NESTING_DEPTH: exceeded 64 levels")
            
        obj = {}
        while self.peek()[0] != 'BRACE_CLOSE':
            kind, key = self.peek()
            if kind not in ('KEY', 'BOOL_T', 'BOOL_F', 'NULL_N'):
                raise STFError(f"ERR_INVALID_IDENTIFIER: Expected key, got {kind}")
            self.consume()
            
            if key in obj:
                raise STFError(f"ERR_DUPLICATE_KEY: Duplicate key: {key}")
            
            self.consume('COLON')
            value = self.parse_value()
            obj[key] = value
            
            if self.peek()[0] == 'COMMA':
                self.consume('COMMA')
            elif self.peek()[0] != 'BRACE_CLOSE':
                raise STFError(f"ERR_MISSING_COMMA: Expected ',' or '}}' in object, got {self.peek()[0]}")
        
        self.consume('BRACE_CLOSE')
        self.depth -= 1
        return obj

    def parse_array(self):
        self.consume('BRACKET_OPEN')
        self.depth += 1
        if self.depth > self.MAX_DEPTH:
            raise STFError("ERR_NESTING_DEPTH: exceeded 64 levels")
            
        arr = []
        while self.peek()[0] != 'BRACKET_CLOSE':
            value = self.parse_value()
            arr.append(value)
            
            if self.peek()[0] == 'COMMA':
                self.consume('COMMA')
            elif self.peek()[0] != 'BRACKET_CLOSE':
                raise STFError(f"ERR_MISSING_COMMA: Expected ',' or ']' in array, got {self.peek()[0]}")
                
        self.consume('BRACKET_CLOSE')
        self.depth -= 1
        return arr

    def parse_constructor(self, full_value):
        match = re.match(r'([A-Za-z0-9_-]+)\((.*)\)', full_value)
        if not match:
             raise STFError(f"ERR_SYNTAX: Invalid constructor format: {full_value}")
        type_name, payload = match.groups()

        if type_name == 'DATE':
            if not re.match(r'^\d{4}-\d{2}-\d{2}$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: DATE must be YYYY-MM-DD format")
            year, month, day = map(int, payload.split('-'))
            if month < 1 or month > 12 or day < 1 or day > 31:
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DATE values")
            return f"$date:{payload}"
        elif type_name == 'TIMESTAMP':
            # ISO 8601 instant with mandatory timezone offset
            if not re.match(r'^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: TIMESTAMP requires explicit timezone offset")
            return f"$timestamp:{payload}"
        elif type_name == 'BIGINT':
            if len(payload) == 0 or any(c.isspace() for c in payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid BIGINT payload")
            if payload.startswith('+'):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Leading '+' not allowed in BIGINT")
            if not re.match(r'^-?\d+$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Non-digit characters in BIGINT")
            idx = 1 if payload.startswith('-') else 0
            digits = payload[idx:].lstrip('0') or '0'
            if digits == '0':
                return "$bigint:0"
            return f"$bigint:-{digits}" if payload.startswith('-') else f"$bigint:{digits}"
        elif type_name == 'DECIMAL':
            # Note: native Python Decimal == is WRONG because Decimal('1.5') == Decimal('1.50') evaluates to True.
            # Hand-roll digits+scale comparison by preserving string format in representation.
            if len(payload) == 0 or payload.startswith('+'):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DECIMAL payload")
            if not re.match(r'^-?(?:0|[1-9]\d*)(?:\.\d+)?$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DECIMAL format")
            
            # Count significant digits
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
            # RFC 4648 standard base64: A-Z, a-z, 0-9, +, /, mandatory padding
            if len(payload) == 0 or len(payload) % 4 != 0:
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY base64 length must be multiple of 4")
            if not re.match(r'^[A-Za-z0-9+/]+={0,2}$', payload):
                raise STFError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY invalid base64 alphabet")
            
            # Canonical trailing bits check
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

def loads(stf_text):
    lexer = STFLexer(stf_text)
    parser = STFParser(lexer.tokens)
    return parser.parse()

def dumps(obj):
    if isinstance(obj, dict):
        items = []
        for k in sorted(obj.keys()):
            v = obj[k]
            items.append(f"{k}: {dumps(v)}")
        return "{" + ", ".join(items) + "}"
    elif isinstance(obj, list):
        items = [dumps(element) for element in obj]
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
