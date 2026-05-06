import re
import json

class DTXTError(Exception):
    pass

class DTXTLexer:
    TOKEN_SPEC = [
        ('DIRECTIVE',   r'@[A-Za-z0-9_-]+\([^()]*\)'),
        ('COMMENT',   r'#.*'),
        ('STRING',    r'`[^`]*`'),
        ('DSTRING',   r'"(?:[^"\\]|\\.)*"'),
        ('CONSTRUCTOR', r'[A-Za-z0-9_-]+\([^()]*\)'),
        ('BRACE_OPEN', r'\{'),
        ('BRACE_CLOSE', r'\}'),
        ('BRACKET_OPEN', r'\['),
        ('BRACKET_CLOSE', r'\]'),
        ('COLON',     r':'),
        ('COMMA',     r','),
        ('NUMBER',    r'-?(?:0(?!\d)|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![A-Za-z0-9_-])'),
        ('BOOL_T',    r'T'),
        ('BOOL_F',    r'F'),
        ('NULL_N',    r'N'),
        ('KEY',       r'[A-Za-z0-9_-]+'),
        ('WHITESPACE', r'[ \t\r\n]+'),
        ('MISMATCH',  r'.'),
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
                raise DTXTError(f"Unexpected character: {value!r}")
            self.tokens.append((kind, value))
        self.tokens.append(('EOF', None))

class DTXTParser:
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
            raise DTXTError(f"Expected {expected_kind}, got {kind}")
        self.pos += 1
        return value

    def parse(self):
        # Root must be an object
        result = self.parse_object()
        if self.peek()[0] != 'EOF':
            raise DTXTError(f"Trailing data after root object: {self.peek()[0]}")
        return result

    def parse_value(self):
        kind, value = self.peek()
        if kind == 'BRACE_OPEN':
            return self.parse_object()
        elif kind == 'BRACKET_OPEN':
            return self.parse_array()
        elif kind == 'STRING':
            self.consume()
            return value[1:-1] # Remove backticks
        elif kind == 'DSTRING':
            self.consume()
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                raise DTXTError(f"Invalid string escape sequence: {value}")
        elif kind == 'NUMBER':
            self.consume()
            # Check for leading zero (invalid in DTXT)
            if re.match(r'^-?0\d+', value):
                raise DTXTError(f"invalid number: {value} (leading zero)")
            # Check for trailing dot (invalid in DTXT)
            if value.endswith('.'):
                raise DTXTError(f"invalid number: {value} (trailing dot)")
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
            raise DTXTError(f"Unexpected token in value position: {kind} ({value})")

    def parse_object(self):
        self.consume('BRACE_OPEN')
        self.depth += 1
        if self.depth > self.MAX_DEPTH:
            raise DTXTError("ERR_NESTING_DEPTH: exceeded 32 levels")
            
        obj = {}
        while self.peek()[0] != 'BRACE_CLOSE':
            # Keys are identifiers (KEY)
            # They could also be T, F, N if used as keys
            kind, key = self.peek()
            if kind not in ('KEY', 'BOOL_T', 'BOOL_F', 'NULL_N'):
                raise DTXTError(f"Expected key, got {kind}")
            self.consume()
            
            if key in obj:
                raise DTXTError(f"Duplicate key: {key}")
            
            self.consume('COLON')
            value = self.parse_value()
            obj[key] = value
            
            if self.peek()[0] == 'COMMA':
                self.consume('COMMA')
            elif self.peek()[0] != 'BRACE_CLOSE':
                raise DTXTError(f"Expected ',' or '}}' in object, got {self.peek()[0]}")
        
        self.consume('BRACE_CLOSE')
        self.depth -= 1
        return obj

    def parse_array(self):
        self.consume('BRACKET_OPEN')
        self.depth += 1
        if self.depth > self.MAX_DEPTH:
            raise DTXTError("ERR_NESTING_DEPTH: exceeded 32 levels")
            
        arr = []
        while self.peek()[0] != 'BRACKET_CLOSE':
            value = self.parse_value()
            arr.append(value)
            
            if self.peek()[0] == 'COMMA':
                self.consume('COMMA')
            elif self.peek()[0] != 'BRACKET_CLOSE':
                raise DTXTError(f"Expected ',' or ']' in array, got {self.peek()[0]}")
                
        self.consume('BRACKET_CLOSE')
        self.depth -= 1
        return arr

    def parse_constructor(self, full_value):
        match = re.match(r'([A-Za-z0-9_-]+)\((.*)\)', full_value)
        if not match:
             raise DTXTError(f"Invalid constructor format: {full_value}")
        type_name, payload = match.groups()

        if type_name == 'Date':
            if len(payload) == 0:
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")

            i = 0
            def match_digit(count):
                nonlocal i
                result = ''
                for _ in range(count):
                    if i >= len(payload) or not payload[i].isdigit():
                        return None
                    result += payload[i]
                    i += 1
                return result

            def match_char(ch):
                nonlocal i
                if i >= len(payload) or payload[i] != ch:
                    return False
                i += 1
                return True

            year = match_digit(4)
            if not year or not match_char('-'):
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")
            month = match_digit(2)
            if not month or not match_char('-'):
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")
            day = match_digit(2)
            if not day:
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")

            m = int(month)
            d = int(day)
            if m < 1 or m > 12:
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")
            if d < 1 or d > 31:
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")

            if i < len(payload) and payload[i] in ('T', ' '):
                i += 1
                if not match_digit(2) or not match_char(':'):
                    raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")
                if not match_digit(2) or not match_char(':'):
                    raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")
                if not match_digit(2):
                    raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")
                if i < len(payload) and payload[i] == '.':
                    i += 1
                    while i < len(payload) and payload[i].isdigit():
                        i += 1
                if i < len(payload) and payload[i] == 'Z':
                    i += 1
                elif i < len(payload) and payload[i] in ('+', '-'):
                    i += 1
                    if not match_digit(2) or not match_char(':'):
                        raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")
                    if not match_digit(2):
                        raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")

            if i != len(payload):
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload")

            return f"$date:{payload}"
        elif type_name == 'BigNumber':
            if len(payload) == 0:
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid BigNumber() payload")
            for ch in payload:
                if ch in (' ', '\t', '\r', '\n'):
                    raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid BigNumber() payload")
            idx = 0
            negative = payload[0] == '-'
            if payload[0] in ('+', '-'):
                idx = 1
            if idx >= len(payload):
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid BigNumber() payload")
            for j in range(idx, len(payload)):
                if not payload[j].isdigit():
                    raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid BigNumber() payload")
            cleaned = payload[idx:]
            while len(cleaned) > 1 and cleaned[0] == '0':
                cleaned = cleaned[1:]
            if cleaned == '0':
                return "$bigint:0"
            if negative:
                return f"$bigint:-{cleaned}"
            return f"$bigint:{cleaned}"
        elif type_name == 'Binary':
            if len(payload) == 0:
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Binary() payload")
            for ch in payload:
                if ch in (' ', '\t', '\r', '\n'):
                    raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Binary() payload")
            cleaned = payload.upper()
            if len(cleaned) % 2 != 0:
                raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Binary() payload")
            for ch in cleaned:
                if ch not in '0123456789ABCDEF':
                    raise DTXTError("ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Binary() payload")
            return f"$binary:{cleaned}"
        else:
            raise DTXTError(f"Unknown constructor: {type_name}")

try:
    import dtxt_rs
except ImportError:
    dtxt_rs = None

def load(dtxt_text):
    if dtxt_rs:
        try:
            return dtxt_rs.loads(dtxt_text)
        except Exception:
            # Fallback to pure Python on error or nested constructors not handled by simplified Rust PyO3 bridge
            pass
            
    lexer = DTXTLexer(dtxt_text)
    parser = DTXTParser(lexer.tokens)
    return parser.parse()

def loads(dtxt_text):
    return load(dtxt_text)

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
            return f"Date({obj[6:]})"
        elif obj.startswith('$bigint:'):
            return f"BigNumber({obj[8:]})"
        elif obj.startswith('$binary:'):
            return f"Binary({obj[8:]})"
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
        raise DTXTError(f"Unsupported type for serialization: {type(obj)}")

def dumps_canonical(obj, indent=None):
    if indent is None:
        return dumps(obj)

    def _dump(o, level):
        sp = "  " * level
        if isinstance(o, dict):
            if not o: return "{}"
            items = []
            for k in sorted(o.keys()):
                v = o[k]
                items.append(f"{sp}  {k}: {_dump(v, level + 1)}")
            return "{\n" + ",\n".join(items) + ",\n" + sp + "}"
        elif isinstance(o, list):
            if not o: return "[]"
            items = []
            for item in o:
                items.append(f"{sp}  {_dump(item, level + 1)}")
            return "[\n" + ",\n".join(items) + ",\n" + sp + "]"
        else:
            return dumps(o)

    return _dump(obj, 0)
