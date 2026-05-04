export class DTXTError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DTXTError';
    }
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

// Fast character scanning parser
export class DTXTParser {
    private input: string;
    private pos: number = 0;
    private depth: number = 0;
    private readonly MAX_DEPTH = 64;

    constructor(text: string) {
        this.input = text;
    }

    parse(): { [key: string]: DTXTValue } {
        this.skipWhitespaceAndComments();
        const result = this.parseObject();
        this.skipWhitespaceAndComments();
        if (this.pos < this.input.length) {
            throw new DTXTError(`Trailing data after root object: ${this.input[this.pos]}`);
        }
        return result;
    }

    private current(): string | null {
        return this.pos < this.input.length ? this.input[this.pos] : null;
    }

    private advance(): void {
        this.pos++;
    }

    private skipWhitespaceAndComments(): void {
        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];
            if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
                this.advance();
            } else if (ch === '#') {
                while (this.pos < this.input.length && this.input[this.pos] !== '\n') {
                    this.advance();
                }
            } else {
                break;
            }
        }
    }

    private parseObject(): { [key: string]: DTXTValue } {
        if (this.current() !== '{') {
            throw new DTXTError("Expected '{'");
        }
        this.advance(); // skip {
        this.depth++;
        if (this.depth > this.MAX_DEPTH) {
            throw new DTXTError("ERR_NESTING_DEPTH: exceeded 64 levels");
        }

        const obj: { [key: string]: DTXTValue } = {};

        this.skipWhitespaceAndComments();
        while (this.current() !== '}') {
            const key = this.parseKey();

            // Check for duplicate key
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                throw new DTXTError(`Duplicate key: ${key}`);
            }

            this.skipWhitespaceAndComments();
            if (this.current() !== ':') {
                throw new DTXTError(`Expected ':' after key '${key}'`);
            }
            this.advance(); // skip :

            const value = this.parseValue();
            obj[key] = value;

            this.skipWhitespaceAndComments();
            if (this.current() === ',') {
                this.advance(); // skip ,
                this.skipWhitespaceAndComments();
            } else if (this.current() !== '}') {
                throw new DTXTError(`Expected ',' or '}' after value for key '${key}'`);
            }
        }

        this.advance(); // skip }
        this.depth--;
        return obj;
    }

    private parseArray(): DTXTValue[] {
        if (this.current() !== '[') {
            throw new DTXTError("Expected '['");
        }
        this.advance(); // skip [
        this.depth++;
        if (this.depth > this.MAX_DEPTH) {
            throw new DTXTError("ERR_NESTING_DEPTH: exceeded 64 levels");
        }

        const arr: DTXTValue[] = [];

        this.skipWhitespaceAndComments();
        while (this.current() !== ']') {
            arr.push(this.parseValue());

            this.skipWhitespaceAndComments();
            if (this.current() === ',') {
                this.advance(); // skip ,
                this.skipWhitespaceAndComments();
            } else if (this.current() !== ']') {
                throw new DTXTError(`Expected ',' or ']'`);
            }
        }

        this.advance(); // skip ]
        this.depth--;
        return arr;
    }

    private parseKey(): string {
        const start = this.pos;

        // Parse key: alphanumeric, underscore, hyphen
        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];
            if (ch === 'T' && (this.pos === start || !this.isKeyChar(this.input[this.pos - 1]))) {
                // Check if it's just 'T' (true)
                if (this.pos === start && (this.pos + 1 >= this.input.length || !this.isKeyChar(this.input[this.pos + 1]))) {
                    // Just 'T' as a key
                } else {
                    this.advance();
                    continue;
                }
            } else if (ch === 'F' && (this.pos === start || !this.isKeyChar(this.input[this.pos - 1]))) {
                if (this.pos === start && (this.pos + 1 >= this.input.length || !this.isKeyChar(this.input[this.pos + 1]))) {
                    // Just 'F' as a key
                } else {
                    this.advance();
                    continue;
                }
            } else if (ch === 'N' && (this.pos === start || !this.isKeyChar(this.input[this.pos - 1]))) {
                if (this.pos === start && (this.pos + 1 >= this.input.length || !this.isKeyChar(this.input[this.pos + 1]))) {
                    // Just 'N' as a key
                } else {
                    this.advance();
                    continue;
                }
            }

            if (this.isKeyChar(ch)) {
                this.advance();
            } else {
                break;
            }
        }

        if (start === this.pos) {
            throw new DTXTError(`Expected key, got ${this.current()}`);
        }

        return this.input.slice(start, this.pos);
    }

    private isKeyChar(ch: string): boolean {
        return (ch >= 'a' && ch <= 'z') ||
               (ch >= 'A' && ch <= 'Z') ||
               (ch >= '0' && ch <= '9') ||
               ch === '_' || ch === '-';
    }

    private parseValue(): DTXTValue {
        this.skipWhitespaceAndComments();
        const ch = this.current();

        if (ch === '{') return this.parseObject();
        if (ch === '[') return this.parseArray();
        if (ch === '`') return this.parseString();
        if (ch === '"') return this.parseInterpretedString();
        if (ch === '-' || (ch >= '0' && ch <= '9')) return this.parseNumber();
        if (ch === 'T' && this.input.slice(this.pos, this.pos + 1) === 'T') {
            this.advance();
            return true;
        }
        if (ch === 'F' && this.input.slice(this.pos, this.pos + 1) === 'F') {
            this.advance();
            return false;
        }
        if (ch === 'N' && this.input.slice(this.pos, this.pos + 1) === 'N') {
            this.advance();
            return null;
        }
        if (ch && this.isAlpha(ch)) return this.parseConstructor();
        throw new DTXTError(`Unexpected character: ${ch}`);
    }

    private parseString(): string {
        this.advance(); // skip `
        const start = this.pos;
        while (this.pos < this.input.length && this.input[this.pos] !== '`') {
            this.advance();
        }
        if (this.pos >= this.input.length) {
            throw new DTXTError("Unterminated string");
        }
        const result = this.input.slice(start, this.pos);
        this.advance(); // skip closing `
        return result;
    }

    private parseInterpretedString(): string {
        this.advance(); // skip "
        const start = this.pos;
        while (this.pos < this.input.length && this.input[this.pos] !== '"') {
            if (this.input[this.pos] === '\\') {
                this.advance(); // skip \
            }
            this.advance();
        }
        if (this.pos >= this.input.length) {
            throw new DTXTError("Unterminated string");
        }
        const result = this.input.slice(start, this.pos);
        this.advance(); // skip closing "
        try {
            return JSON.parse(`"${result}"`);
        } catch (e) {
            throw new DTXTError(`Invalid string escape sequence: ${result}`);
        }
    }

    private parseNumber(): number {
        const start = this.pos;
        // Check for leading zero (invalid)
        if (this.input[this.pos] === '0' && this.pos + 1 < this.input.length && this.input[this.pos + 1] >= '0' && this.input[this.pos + 1] <= '9') {
            throw new DTXTError(`ERR_INVALID_NUMBER: ${this.input.slice(this.pos, this.pos + 4)} (leading zero)`);
        }

        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];
            if (ch === '.' || ch === '-' || ch === 'e' || ch === 'E' || (ch >= '0' && ch <= '9')) {
                this.advance();
            } else {
                break;
            }
        }

        const numStr = this.input.slice(start, this.pos);

        // Check for trailing dot
        if (numStr.endsWith('.')) {
            throw new DTXTError(`ERR_INVALID_NUMBER: ${numStr} (trailing dot)`);
        }

        const num = parseFloat(numStr);
        return num === 0 && numStr[0] === '-' ? -0 : num;
    }

    private isAlpha(ch: string): boolean {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '-';
    }

    private parseConstructor(): DTXTValue {
        const start = this.pos;
        while (this.pos < this.input.length && this.isAlpha(this.input[this.pos])) {
            this.advance();
        }
        const typeName = this.input.slice(start, this.pos);

        if (this.current() !== '(') {
            throw new DTXTError(`Expected '(' after constructor name at position ${this.pos}`);
        }
        this.advance(); // skip (

        const payloadStart = this.pos;
        while (this.pos < this.input.length && this.input[this.pos] !== ')') {
            if (this.input[this.pos] === '(') {
                throw new DTXTError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid ${typeName}() payload`);
            }
            this.advance();
        }
        const payload = this.input.slice(payloadStart, this.pos);

        if (this.current() !== ')') {
            throw new DTXTError("Unterminated constructor");
        }
        this.advance(); // skip )

        if (typeName === 'Date') {
            if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(payload)) {
                throw new DTXTError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid Date() payload`);
            }
            return new Date(payload);
        } else if (typeName === 'BigNumber') {
            const cleaned = payload.replace(/\s/g, '');
            if (!/^-?\d+$/.test(cleaned)) {
                throw new DTXTError(`Invalid BigNumber payload: ${payload}`);
            }
            return BigInt(cleaned);
        } else if (typeName === 'Binary') {
            const cleaned = payload.replace(/\s/g, '');
            if (cleaned.length % 2 !== 0) {
                throw new DTXTError(`Invalid Binary(hex) payload: ${payload}`);
            }
            const bytes = new Uint8Array(cleaned.length / 2);
            for (let i = 0; i < cleaned.length; i += 2) {
                bytes[i / 2] = parseInt(cleaned.slice(i, i + 2), 16);
            }
            return bytes;
        } else {
            throw new DTXTError(`Unknown constructor: ${typeName}`);
        }
    }
}

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
            if (o.includes('`')) {
                parts.push(JSON.stringify(o));
            } else {
                parts.push('`', o, '`');
            }
        } else if (typeof o === 'object') {
            const keys = Object.keys(o as object).sort();
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
    const parser = new DTXTParser(text);
    return parser.parse();
}

export function format(text: string): string {
    return stringify(parse(text), '  ');
}
