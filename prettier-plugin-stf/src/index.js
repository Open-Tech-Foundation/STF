// STF Parser (embedded for Prettier plugin)
class STFError extends Error {
  constructor(message) {
    super(message);
    this.name = 'STFError';
  }
}

class STFParser {
  constructor(text) {
    this.input = text;
    this.pos = 0;
    this.depth = 0;
    this.MAX_DEPTH = 64;
  }

  parse() {
    this.skipWhitespaceAndComments();
    while (this.current() === '@') {
      this.parseDirective();
      this.skipWhitespaceAndComments();
    }
    const result = this.parseObject();
    this.skipWhitespaceAndComments();
    if (this.pos < this.input.length) {
      throw new STFError(`Trailing data: ${this.input[this.pos]}`);
    }
    return result;
  }

  current() { return this.pos < this.input.length ? this.input[this.pos] : null; }
  advance() { this.pos++; }

  skipWhitespaceAndComments() {
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { this.advance(); }
      else if (ch === '#') { while (this.pos < this.input.length && this.input[this.pos] !== '\n') { this.advance(); } }
      else { break; }
    }
  }

  parseObject() {
    if (this.current() !== '{') throw new STFError("Expected '{'");
    this.advance(); this.depth++;
    if (this.depth > this.MAX_DEPTH) throw new STFError('ERR_NESTING_DEPTH');
    const obj = {};
    this.skipWhitespaceAndComments();
    while (this.current() !== '}') {
      const key = this.parseKey();
      if (Object.prototype.hasOwnProperty.call(obj, key)) throw new STFError(`Duplicate key: ${key}`);
      this.skipWhitespaceAndComments();
      if (this.current() !== ':') throw new STFError(`Expected ':'`);
      this.advance();
      obj[key] = this.parseValue();
      this.skipWhitespaceAndComments();
      if (this.current() === ',') { this.advance(); this.skipWhitespaceAndComments(); }
      else if (this.current() !== '}') throw new STFError("Expected ',' or '}'");
    }
    this.advance(); this.depth--;
    return obj;
  }

  parseKey() {
    const start = this.pos;
    while (this.pos < this.input.length && this.isKeyChar(this.input[this.pos])) { this.advance(); }
    if (start === this.pos) throw new STFError('Expected key');
    return this.input.slice(start, this.pos);
  }

  isKeyChar(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_' || ch === '-';
  }

  parseValue() {
    this.skipWhitespaceAndComments();
    const ch = this.current();
    if (ch === '{') return this.parseObject();
    if (ch === '[') return this.parseArray();
    if (ch === '`') return this.parseString();
    if (ch === '"') return this.parseInterpretedString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();
    if (ch === 'T') { this.advance(); return true; }
    if (ch === 'F') { this.advance(); return false; }
    if (ch === 'N') { this.advance(); return null; }
    if (ch && this.isAlpha(ch)) return this.parseConstructor();
    throw new STFError(`Unexpected: ${ch}`);
  }

  parseArray() {
    this.advance(); this.depth++;
    const arr = [];
    this.skipWhitespaceAndComments();
    while (this.current() !== ']') {
      arr.push(this.parseValue());
      this.skipWhitespaceAndComments();
      if (this.current() === ',') { this.advance(); this.skipWhitespaceAndComments(); }
      else if (this.current() !== ']') throw new STFError("Expected ',' or ']'");
    }
    this.advance(); this.depth--;
    return arr;
  }

  parseString() {
    this.advance(); const start = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== '`') { this.advance(); }
    if (this.pos >= this.input.length) throw new STFError('Unterminated string');
    const result = this.input.slice(start, this.pos); this.advance();
    return result;
  }

  parseInterpretedString() {
    this.advance(); const start = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== '"') {
      if (this.input[this.pos] === '\n') throw new STFError('Newline in string');
      if (this.input[this.pos] === '\\') this.advance();
      this.advance();
    }
    const result = this.input.slice(start, this.pos); this.advance();
    return JSON.parse(`"${result}"`);
  }

  parseNumber() {
    const start = this.pos;
    if (this.input[this.pos] === '0' && this.pos + 1 < this.input.length && this.input[this.pos + 1] >= '0' && this.input[this.pos + 1] <= '9') {
      throw new STFError('ERR_INVALID_NUMBER: leading zero');
    }
    while (this.pos < this.input.length) {
      const ch = this.input[this.pos];
      if (ch === '.' || ch === '-' || ch === 'e' || ch === 'E' || (ch >= '0' && ch <= '9')) { this.advance(); }
      else break;
    }
    const numStr = this.input.slice(start, this.pos);
    if (numStr.endsWith('.')) throw new STFError('ERR_INVALID_NUMBER: trailing dot');
    return parseFloat(numStr);
  }

  isAlpha(ch) { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '-'; }

  parseConstructor() {
    const start = this.pos;
    while (this.pos < this.input.length && this.isAlpha(this.input[this.pos])) { this.advance(); }
    const typeName = this.input.slice(start, this.pos);
    if (this.current() !== '(') throw new STFError(`Expected '('`);
    this.advance();
    const payloadStart = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== ')') {
      if (this.input[this.pos] === '(') throw new STFError('Invalid payload');
      this.advance();
    }
    const payload = this.input.slice(payloadStart, this.pos);
    if (this.current() !== ')') throw new STFError('Unterminated constructor');
    this.advance();
    if (!['BIGINT', 'DECIMAL', 'DATE', 'TIMESTAMP', 'BINARY'].includes(typeName)) throw new STFError(`Unknown: ${typeName}`);
    return { type: typeName, payload };
  }
}

function parse(text) { return new STFParser(text).parse(); }

function stringify(obj, indent = null) {
  const parts = [];
  const space = indent ? ' ' : '';
  const newline = indent ? '\n' : '';

  function _stringify(o, level) {
    if (Array.isArray(o)) {
      if (o.length === 0) { parts.push('[]'); return; }
      parts.push('[', newline);
      const sp = indent ? indent.repeat(level + 1) : '';
      for (let i = 0; i < o.length; i++) {
        parts.push(sp); _stringify(o[i], level + 1);
        parts.push(',', newline);
      }
      if (indent) parts.push(indent.repeat(level));
      parts.push(']');
    } else if (o === null) { parts.push('N'); }
    else if (typeof o === 'boolean') { parts.push(o ? 'T' : 'F'); }
    else if (typeof o === 'number') { parts.push(o.toString()); }
    else if (typeof o === 'string') {
      if (o.startsWith('$date:')) { parts.push('DATE(', o.slice(6), ')'); }
      else if (o.startsWith('$timestamp:')) { parts.push('TIMESTAMP(', o.slice(11), ')'); }
      else if (o.startsWith('$bigint:')) { parts.push('BIGINT(', o.slice(8), ')'); }
      else if (o.startsWith('$decimal:')) { parts.push('DECIMAL(', o.slice(9), ')'); }
      else if (o.startsWith('$binary:')) { parts.push('BINARY(', o.slice(8), ')'); }
      else if (o.includes('`')) { parts.push(JSON.stringify(o)); }
      else { parts.push('`', o, '`'); }
    } else if (typeof o === 'object') {
      if (o.type === 'DATE') { parts.push('DATE(', o.payload, ')'); return; }
      if (o.type === 'TIMESTAMP') { parts.push('TIMESTAMP(', o.payload, ')'); return; }
      if (o.type === 'BIGINT') { parts.push('BIGINT(', o.payload, ')'); return; }
      if (o.type === 'DECIMAL') { parts.push('DECIMAL(', o.payload, ')'); return; }
      if (o.type === 'BINARY') { parts.push('BINARY(', o.payload, ')'); return; }
      const keys = Object.keys(o).sort();
      if (keys.length === 0) { parts.push('{}'); return; }
      parts.push('{', newline);
      const sp = indent ? indent.repeat(level + 1) : '';
      for (let i = 0; i < keys.length; i++) {
        parts.push(sp, keys[i], ':', space);
        _stringify(o[keys[i]], level + 1);
        parts.push(',', newline);
      }
      if (indent) parts.push(indent.repeat(level));
      parts.push('}');
    }
  }

  _stringify(obj, 0);
  return parts.join('');
}

const parser = {
  parse(text) {
    try { return parse(text); }
    catch (e) { throw new Error(`STF parse error: ${e.message}`); }
  },
  astFormat: 'stf',
  locStart: () => 0,
  locEnd: () => 0
};

const printer = {
  print(path, opts, print) {
    const node = path.getValue();
    return stringify(node, opts.tabWidth ? ' '.repeat(opts.tabWidth) : '  ');
  }
};

export const parsers = { stf: parser };
export const printers = { stf: printer };
export const languages = [{ name: 'STF', extensions: ['.stf'], parsers: ['stf'] }];
