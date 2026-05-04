export class DTXTError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DTXTError';
    }
}

export type TokenKind =
    | 'COMMENT'
    | 'STRING'
    | 'CONSTRUCTOR'
    | 'BRACE_OPEN'
    | 'BRACE_CLOSE'
    | 'BRACKET_OPEN'
    | 'BRACKET_CLOSE'
    | 'COLON'
    | 'COMMA'
    | 'NUMBER'
    | 'BOOL_T'
    | 'BOOL_F'
    | 'NULL_N'
    | 'KEY'
    | 'WHITESPACE'
    | 'MISMATCH'
    | 'EOF';

export interface Token {
    kind: TokenKind;
    value: string | null;
}

export type DTXTValue =
    | string
    | number
    | boolean
    | null
    | bigint
    | Date
    | Uint8Array
    | DTXTValue[]
    | { [key: string]: DTXTValue };

// Optimized lexer with single-pass tokenization
export class DTXTLexer {
    private readonly regex = /#.*|"(?:[^"\\]|\\.)*"|`[^`]*`|[A-Za-z0-9_-]+\([^()]*\)|[{}[\]:,]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?(?![A-Za-z0-9_-])|\bT\b|\bF\b|\bN\b|[A-Za-z0-9_-]+|[ \t\r\n]+|./g;

    tokens: Token[] = [];

    constructor(text: string) {
        this.tokenize(text);
    }

    private tokenize(text: string): void {
        let match: RegExpExecArray | null;
        const regex = this.regex;
        regex.lastIndex = 0; // ensure we start from the beginning

        while ((match = regex.exec(text)) !== null) {
            const value = match[0];
            const ch = value[0];

            // Skip whitespace and comments
            if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') continue;
            if (ch === '#') continue;

            let kind: TokenKind;

            // Fast character-based dispatch
            switch (ch) {
                case '`':
                case '"':
                    kind = 'STRING';
                    break;
                case '{':
                    kind = 'BRACE_OPEN';
                    break;
                case '}':
                    kind = 'BRACE_CLOSE';
                    break;
                case '[':
                    kind = 'BRACKET_OPEN';
                    break;
                case ']':
                    kind = 'BRACKET_CLOSE';
                    break;
                case ':':
                    kind = 'COLON';
                    break;
                case ',':
                    kind = 'COMMA';
                    break;
                case '-':
                case '0':
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                case '6':
                case '7':
                case '8':
                case '9':
                    // Check if it's truly a number according to our regex
                    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
                        kind = 'NUMBER';
                    } else if (value.includes('(')) {
                        kind = 'CONSTRUCTOR';
                    } else {
                        kind = 'KEY';
                    }
                    break;
                case 'T':
                    kind = value === 'T' ? 'BOOL_T' : (value.includes('(') ? 'CONSTRUCTOR' : 'KEY');
                    break;
                case 'F':
                    kind = value === 'F' ? 'BOOL_F' : (value.includes('(') ? 'CONSTRUCTOR' : 'KEY');
                    break;
                case 'N':
                    kind = value === 'N' ? 'NULL_N' : (value.includes('(') ? 'CONSTRUCTOR' : 'KEY');
                    break;
                default:
                    if (value.includes('(')) {
                        kind = 'CONSTRUCTOR';
                    } else if (/[A-Za-z0-9_-]/.test(ch)) {
                        kind = 'KEY';
                    } else {
                        throw new DTXTError(`Unexpected character: ${ch} at ${match.index}`);
                    }
            }

            this.tokens.push({ kind, value });
        }

        this.tokens.push({ kind: 'EOF', value: null });
    }
}

// Optimized parser with direct token access and minimal function calls
export class DTXTParser {
    private tokens: Token[];
    private pos: number = 0;
    private depth: number = 0;
    private readonly MAX_DEPTH = 64;

    constructor(tokens: Token[]) {
        this.tokens = tokens;
    }

    parse(): { [key: string]: DTXTValue } {
        const result = this.parseObject();
        if (this.tokens[this.pos].kind !== 'EOF') {
            throw new DTXTError(`Trailing data after root object: ${this.tokens[this.pos].kind}`);
        }
        return result;
    }

    private parseValue(): DTXTValue {
        const token = this.tokens[this.pos];
        const kind = token.kind;

        switch (kind) {
            case 'BRACE_OPEN':
                return this.parseObject();
            case 'BRACKET_OPEN':
                return this.parseArray();
            case 'STRING':
                this.pos++;
                if (token.value![0] === '"') {
                    // Double-quoted string with escapes
                    try {
                        return JSON.parse(token.value!);
                    } catch (e) {
                        throw new DTXTError(`Invalid string escape sequence: ${token.value}`);
                    }
                }
                return token.value!.slice(1, -1);
            case 'NUMBER':
                this.pos++;
                const val = Number(token.value);
                return val === 0 ? 0 : val;
            case 'BOOL_T':
                this.pos++;
                return true;
            case 'BOOL_F':
                this.pos++;
                return false;
            case 'NULL_N':
                this.pos++;
                return null;
            case 'CONSTRUCTOR':
                this.pos++;
                return this.parseConstructor(token.value!);
            default:
                throw new DTXTError(`Unexpected token: ${kind} (${token.value})`);
        }
    }

    private parseObject(): { [key: string]: DTXTValue } {
        this.pos++; // skip {
        this.depth++;
        if (this.depth > this.MAX_DEPTH) {
            throw new DTXTError("ERR_NESTING_DEPTH: exceeded 32 levels");
        }

        const obj: { [key: string]: DTXTValue } = {};

        while (this.tokens[this.pos].kind !== 'BRACE_CLOSE') {
            const keyToken = this.tokens[this.pos];
            if (keyToken.kind !== 'KEY' && keyToken.kind !== 'BOOL_T' && keyToken.kind !== 'BOOL_F' && keyToken.kind !== 'NULL_N') {
                throw new DTXTError(`Expected key, got ${keyToken.kind}`);
            }
            const key = keyToken.value!;
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                throw new DTXTError(`Duplicate key: ${key}`);
            }
            this.pos++; // consume key
            if (this.tokens[this.pos].kind !== 'COLON') {
                throw new DTXTError(`Expected ':', got ${this.tokens[this.pos].kind} after key '${key}'`);
            }
            this.pos++; // consume ':'
            obj[key] = this.parseValue();

            if (this.tokens[this.pos].kind === 'COMMA') {
                this.pos++;
            } else if (this.tokens[this.pos].kind !== 'BRACE_CLOSE') {
                throw new DTXTError(`Expected ',' or '}', got ${this.tokens[this.pos].kind} after value for key '${key}'`);
            }
        }
        this.pos++; // skip }
        this.depth--;
        return obj;
    }

    private parseArray(): DTXTValue[] {
        this.pos++; // skip [
        this.depth++;
        if (this.depth > this.MAX_DEPTH) {
            throw new DTXTError("ERR_NESTING_DEPTH: exceeded 32 levels");
        }
        const arr: DTXTValue[] = [];

        while (this.tokens[this.pos].kind !== 'BRACKET_CLOSE') {
            arr.push(this.parseValue());

            if (this.tokens[this.pos].kind === 'COMMA') {
                this.pos++;
            } else if (this.tokens[this.pos].kind !== 'BRACKET_CLOSE') {
                throw new DTXTError(`Expected ',' or ']', got ${this.tokens[this.pos].kind}`);
            }
        }

        this.pos++; // consume ']'
        this.depth--;
        return arr;
    }

    private parseConstructor(fullValue: string): DTXTValue {
        const parenIdx = fullValue.indexOf('(');
        const typeName = fullValue.slice(0, parenIdx);
        const payload = fullValue.slice(parenIdx + 1, -1);

        if (typeName === 'Date') {
            const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
            if (!ISO_8601_REGEX.test(payload)) {
                throw new DTXTError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload`);
            }
            const date = new Date(payload);
            if (isNaN(date.getTime())) {
                throw new DTXTError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload`);
            }
            return date;
        } else if (typeName === 'BigNumber') {
            if (!payload || !/^-?[0-9]+$/.test(payload)) {
                throw new DTXTError(`Invalid BigNumber payload: ${payload}`);
            }
            return BigInt(payload);
        } else if (typeName === 'Binary') {
            if (!payload || !/^[0-9A-Fa-f]*$/.test(payload)) {
                throw new DTXTError(`Invalid Binary(hex) payload: ${payload}`);
            }
            const len = payload.length;
            const bytes = new Uint8Array(len >>> 1);
            for (let i = 0; i < len; i += 2) {
                bytes[i >>> 1] = parseInt(payload.slice(i, i + 2), 16);
            }
            return bytes;
        } else {
            throw new DTXTError(`Unknown constructor: ${typeName}`);
        }
    }
}

// Optimized stringifier with pre-allocated buffers where possible
export function stringify(obj: DTXTValue, indent: string | null = null): string {
    const parts: string[] = [];
    const space = indent ? ' ' : '';
    const newline = indent ? '\n' : '';

    const _stringify = (o: DTXTValue, level: number): void => {
        if (Array.isArray(o)) {
            if (o.length === 0) {
                parts.push('[]');
                return;
            }

            parts.push('[', newline);
            const sp = indent ? indent.repeat(level + 1) : '';

            for (let i = 0; i < o.length; i++) {
                parts.push(sp);
                _stringify(o[i], level + 1);
                parts.push(',', newline);
            }

            if (indent) parts.push(indent.repeat(level));
            parts.push(']');
        } else if (o instanceof Date) {
            let val = o.toISOString();
            if (val.includes('T00:00:00.000Z')) val = val.split('T')[0];
            else if (val.endsWith('.000Z')) val = val.slice(0, -5) + 'Z';
            parts.push('Date(', val, ')');
        } else if (o instanceof Uint8Array) {
            parts.push('Binary(');
            for (let i = 0; i < o.length; i++) {
                const hex = o[i].toString(16);
                if (hex.length === 1) parts.push('0');
                parts.push(hex.toUpperCase());
            }
            parts.push(')');
        } else if (typeof o === 'bigint') {
            parts.push('BigNumber(', o.toString(), ')');
        } else if (o === null) {
            parts.push('N');
        } else if (typeof o === 'boolean') {
            parts.push(o ? 'T' : 'F');
        } else if (typeof o === 'number') {
            parts.push(o.toString());
        } else if (typeof o === 'string') {
            parts.push('`', o, '`');
        } else if (typeof o === 'object') {
            const keys = Object.keys(o).sort();
            if (keys.length === 0) {
                parts.push('{}');
                return;
            }

            parts.push('{', newline);
            const sp = indent ? indent.repeat(level + 1) : '';

            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                parts.push(sp, k, ':', space);
                _stringify((o as any)[k], level + 1);
                parts.push(',', newline);
            }

            if (indent) parts.push(indent.repeat(level));
            parts.push('}');
        } else {
            throw new DTXTError(`Unsupported type: ${typeof o}`);
        }
    };

    _stringify(obj, 0);
    return parts.join('');
}

export function parse(text: string): { [key: string]: DTXTValue } {
    const lexer = new DTXTLexer(text);
    const parser = new DTXTParser(lexer.tokens);
    return parser.parse();
}
export function format(text: string): string {
    return stringify(parse(text), '  ');
}
