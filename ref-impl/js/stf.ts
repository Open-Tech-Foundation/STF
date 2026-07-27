export class STFError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'STFError';
    }
}

export type STFValue =
    | string
    | number
    | boolean
    | null
    | STFValue[]
    | { [key: string]: STFValue };

export class STFParser {
    private input: string;
    private pos: number = 0;
    private len: number;
    private depth: number = 0;
    private readonly MAX_DEPTH = 64;

    constructor(text: string) {
        this.input = text;
        this.len = text.length;
    }

    parse(): { [key: string]: STFValue } {
        this.skipWhitespace();
        const input = this.input;
        const len = this.len;
        while (this.pos < len && input.charCodeAt(this.pos) === 64) { // '@'
            this.parseDirective();
            this.skipWhitespace();
        }
        const result = this.parseObject();
        this.skipWhitespace();
        if (this.pos < len) {
            throw new STFError(`ERR_TRAILING_CONTENT: Trailing data after root object: ${input[this.pos]}`);
        }
        return result;
    }

    private parseDirective(): void {
        const input = this.input;
        const len = this.len;
        this.pos++; // '@'
        let pos = this.pos;
        while (pos < len) {
            const code = input.charCodeAt(pos);
            if (
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122) ||
                (code >= 48 && code <= 57) ||
                code === 95 || code === 45
            ) {
                pos++;
            } else {
                break;
            }
        }
        this.pos = pos;
        if (pos >= len || input.charCodeAt(pos) !== 40) { // '('
            throw new STFError("ERR_SYNTAX: Expected '(' after directive name");
        }
        this.pos = pos + 1;
        const endParen = input.indexOf(')', this.pos);
        if (endParen === -1) {
            throw new STFError("ERR_UNTERMINATED: Unterminated directive");
        }
        this.pos = endParen + 1;
    }

    private skipWhitespace(): void {
        const input = this.input;
        const len = this.len;
        let pos = this.pos;
        while (pos < len) {
            const code = input.charCodeAt(pos);
            if (code === 32 || code === 9 || code === 10 || code === 13) {
                pos++;
            } else if (code === 35) { // '#'
                pos++;
                while (pos < len && input.charCodeAt(pos) !== 10) {
                    pos++;
                }
            } else {
                break;
            }
        }
        this.pos = pos;
    }

    private parseObject(): { [key: string]: STFValue } {
        const input = this.input;
        const len = this.len;
        let pos = this.pos;

        if (pos >= len || input.charCodeAt(pos) !== 123) { // '{'
            throw new STFError("ERR_ROOT_NOT_OBJECT: Expected '{'");
        }
        pos++;
        this.depth++;
        if (this.depth > this.MAX_DEPTH) {
            throw new STFError("ERR_NESTING_DEPTH: exceeded 64 levels");
        }

        const obj: { [key: string]: STFValue } = {};

        while (pos < len) {
            // Fast inline whitespace & comment skip
            let code = input.charCodeAt(pos);
            while (code === 32 || code === 9 || code === 10 || code === 13 || code === 35) {
                if (code === 35) {
                    pos++;
                    while (pos < len && input.charCodeAt(pos) !== 10) pos++;
                } else {
                    pos++;
                }
                if (pos >= len) break;
                code = input.charCodeAt(pos);
            }

            if (pos >= len) break;
            if (code === 125) break; // '}'

            // Fast inline key parse
            const keyStart = pos;
            while (pos < len) {
                const c = input.charCodeAt(pos);
                if (
                    (c >= 97 && c <= 122) ||
                    (c >= 48 && c <= 57) ||
                    (c >= 65 && c <= 90) ||
                    c === 95 || c === 45
                ) {
                    pos++;
                } else {
                    break;
                }
            }

            if (keyStart === pos) {
                throw new STFError(`ERR_INVALID_IDENTIFIER: Expected key, got ${input[pos] || 'EOF'}`);
            }

            const key = input.slice(keyStart, pos);

            if (key in obj) {
                throw new STFError(`ERR_DUPLICATE_KEY: Duplicate key: ${key}`);
            }

            // Fast inline colon skip
            while (pos < len) {
                code = input.charCodeAt(pos);
                if (code === 32 || code === 9 || code === 10 || code === 13 || code === 35) {
                    if (code === 35) { pos++; while (pos < len && input.charCodeAt(pos) !== 10) pos++; }
                    else pos++;
                } else break;
            }

            if (pos >= len || input.charCodeAt(pos) !== 58) { // ':'
                throw new STFError(`ERR_MISSING_COLON: Expected ':' after key '${key}'`);
            }
            pos++;
            this.pos = pos;

            const value = this.parseValue();
            obj[key] = value;
            pos = this.pos;

            // Fast inline comma or closing brace skip
            while (pos < len) {
                code = input.charCodeAt(pos);
                if (code === 32 || code === 9 || code === 10 || code === 13 || code === 35) {
                    if (code === 35) { pos++; while (pos < len && input.charCodeAt(pos) !== 10) pos++; }
                    else pos++;
                } else break;
            }

            if (pos < len && input.charCodeAt(pos) === 44) { // ','
                pos++;
            } else if (pos >= len || input.charCodeAt(pos) !== 125) { // '}'
                throw new STFError(`ERR_MISSING_COMMA: Expected ',' or '}' after value for key '${key}'`);
            }
        }

        if (pos >= len || input.charCodeAt(pos) !== 125) {
            throw new STFError("ERR_UNTERMINATED: Unclosed object");
        }
        this.pos = pos + 1;
        this.depth--;
        return obj;
    }

    private parseArray(): STFValue[] {
        const input = this.input;
        const len = this.len;
        let pos = this.pos + 1; // skip [
        this.depth++;
        if (this.depth > this.MAX_DEPTH) {
            throw new STFError("ERR_NESTING_DEPTH: exceeded 64 levels");
        }

        const arr: STFValue[] = [];

        while (pos < len) {
            let code = input.charCodeAt(pos);
            while (code === 32 || code === 9 || code === 10 || code === 13 || code === 35) {
                if (code === 35) { pos++; while (pos < len && input.charCodeAt(pos) !== 10) pos++; }
                else pos++;
                if (pos >= len) break;
                code = input.charCodeAt(pos);
            }

            if (pos >= len || code === 93) break; // ']'

            this.pos = pos;
            arr.push(this.parseValue());
            pos = this.pos;

            while (pos < len) {
                code = input.charCodeAt(pos);
                if (code === 32 || code === 9 || code === 10 || code === 13 || code === 35) {
                    if (code === 35) { pos++; while (pos < len && input.charCodeAt(pos) !== 10) pos++; }
                    else pos++;
                } else break;
            }

            if (pos < len && input.charCodeAt(pos) === 44) { // ','
                pos++;
            } else if (pos >= len || input.charCodeAt(pos) !== 93) { // ']'
                throw new STFError("ERR_MISSING_COMMA: Expected ',' or ']'");
            }
        }

        if (pos >= len || input.charCodeAt(pos) !== 93) {
            throw new STFError("ERR_UNTERMINATED: Unclosed array");
        }
        this.pos = pos + 1;
        this.depth--;
        return arr;
    }

    private parseValue(): STFValue {
        const input = this.input;
        const len = this.len;
        let pos = this.pos;

        // Skip whitespace
        while (pos < len) {
            const code = input.charCodeAt(pos);
            if (code === 32 || code === 9 || code === 10 || code === 13 || code === 35) {
                if (code === 35) { pos++; while (pos < len && input.charCodeAt(pos) !== 10) pos++; }
                else pos++;
            } else break;
        }

        if (pos >= len) {
            throw new STFError("ERR_UNTERMINATED: Unexpected end of input");
        }
        this.pos = pos;
        const code = input.charCodeAt(pos);

        if (code === 123) return this.parseObject(); // '{'
        if (code === 91) return this.parseArray();   // '['
        if (code === 96) return this.parseString();  // '`'
        if (code === 34) return this.parseInterpretedString(); // '"'
        if (code === 45 || (code >= 48 && code <= 57)) return this.parseNumber(); // '-' or 0-9

        if (code === 84) { // 'T'
            if (pos + 1 < len && input.charCodeAt(pos + 1) === 40) {
                return this.parseConstructor();
            }
            if (this.isIdentifierTerminator(pos + 1)) {
                this.pos = pos + 1;
                return true;
            }
        }
        if (code === 70) { // 'F'
            if (pos + 1 < len && input.charCodeAt(pos + 1) === 40) {
                return this.parseConstructor();
            }
            if (this.isIdentifierTerminator(pos + 1)) {
                this.pos = pos + 1;
                return false;
            }
        }
        if (code === 78) { // 'N'
            if (pos + 1 < len && input.charCodeAt(pos + 1) === 40) {
                return this.parseConstructor();
            }
            if (this.isIdentifierTerminator(pos + 1)) {
                this.pos = pos + 1;
                return null;
            }
        }

        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95) {
            return this.parseConstructor();
        }

        throw new STFError(`ERR_SYNTAX: Unexpected character: ${input[pos]}`);
    }

    private isIdentifierTerminator(index: number): boolean {
        if (index >= this.len) return true;
        const c = this.input.charCodeAt(index);
        return !(
            (c >= 65 && c <= 90) ||
            (c >= 97 && c <= 122) ||
            (c >= 48 && c <= 57) ||
            c === 95 || c === 45
        );
    }

    private parseString(): string {
        const input = this.input;
        const start = this.pos + 1;
        const end = input.indexOf('`', start);
        if (end === -1) {
            throw new STFError("ERR_UNTERMINATED: Unterminated string");
        }
        this.pos = end + 1;
        return input.slice(start, end);
    }

    private parseInterpretedString(): string {
        const input = this.input;
        const len = this.len;
        let pos = this.pos + 1;
        const start = pos;
        let hasEscape = false;
        while (pos < len) {
            const code = input.charCodeAt(pos);
            if (code === 34) break;
            if (code === 10 || code === 13) {
                throw new STFError("ERR_INVALID_STRING: Literal newline in interpreted string");
            }
            if (code === 92) {
                hasEscape = true;
                pos++;
            }
            pos++;
        }
        if (pos >= len) {
            throw new STFError("ERR_UNTERMINATED: Unterminated string");
        }
        const slice = input.slice(start, pos);
        this.pos = pos + 1;

        if (!hasEscape) return slice;

        try {
            return JSON.parse(`"${slice}"`);
        } catch {
            throw new STFError(`ERR_INVALID_STRING: Invalid string escape sequence: ${slice}`);
        }
    }

    private parseNumber(): number {
        const input = this.input;
        const len = this.len;
        let pos = this.pos;
        const start = pos;

        if (input.charCodeAt(pos) === 45) pos++;

        if (pos < len && input.charCodeAt(pos) === 48) {
            pos++;
            if (pos < len) {
                const nextCode = input.charCodeAt(pos);
                if (nextCode >= 48 && nextCode <= 57) {
                    throw new STFError(`ERR_INVALID_NUMBER: Leading zero: ${input.slice(start, pos + 1)}`);
                }
            }
        } else if (pos < len && input.charCodeAt(pos) >= 49 && input.charCodeAt(pos) <= 57) {
            while (pos < len) {
                const c = input.charCodeAt(pos);
                if (c >= 48 && c <= 57) pos++;
                else break;
            }
        } else {
            throw new STFError(`ERR_INVALID_NUMBER: Expected digit after minus`);
        }

        if (pos < len && input.charCodeAt(pos) === 46) {
            pos++;
            const fracStart = pos;
            while (pos < len) {
                const c = input.charCodeAt(pos);
                if (c >= 48 && c <= 57) pos++;
                else break;
            }
            if (pos === fracStart) {
                throw new STFError(`ERR_INVALID_NUMBER: Trailing dot: ${input.slice(start, pos)}`);
            }
        }

        if (pos < len) {
            const e = input.charCodeAt(pos);
            if (e === 101 || e === 69) {
                pos++;
                if (pos < len) {
                    const sign = input.charCodeAt(pos);
                    if (sign === 43 || sign === 45) pos++;
                }
                const expStart = pos;
                while (pos < len) {
                    const c = input.charCodeAt(pos);
                    if (c >= 48 && c <= 57) pos++;
                    else break;
                }
                if (pos === expStart) {
                    throw new STFError(`ERR_INVALID_NUMBER: Missing exponent digits`);
                }
            }
        }

        this.pos = pos;
        const numStr = input.slice(start, pos);
        const num = Number(numStr);
        return num === 0 && numStr.charCodeAt(0) === 45 ? -0 : num;
    }

    private parseConstructor(): STFValue {
        const input = this.input;
        const len = this.len;
        const start = this.pos;
        let pos = start;

        while (pos < len) {
            const code = input.charCodeAt(pos);
            if (
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122) ||
                (code >= 48 && code <= 57) ||
                code === 95 || code === 45
            ) {
                pos++;
            } else {
                break;
            }
        }
        const typeName = input.slice(start, pos);

        if (pos >= len || input.charCodeAt(pos) !== 40) {
            throw new STFError(`ERR_SYNTAX: Expected '(' after constructor name at position ${pos}`);
        }
        pos++;

        const payloadStart = pos;
        while (pos < len) {
            const code = input.charCodeAt(pos);
            if (code === 41) break;
            if (code === 40) {
                throw new STFError(`ERR_NESTED_CONSTRUCTOR: Invalid constructor nesting in ${typeName}()`);
            }
            pos++;
        }

        if (pos >= len) {
            throw new STFError("ERR_UNTERMINATED: Unterminated constructor");
        }
        const payload = input.slice(payloadStart, pos);
        this.pos = pos + 1; // skip ')'

        switch (typeName) {
            case 'BIGINT':
                return this.parseBigInt(payload);
            case 'DECIMAL':
                return this.parseDecimal(payload);
            case 'DATE':
                return this.parseDate(payload);
            case 'TIMESTAMP':
                return this.parseTimestamp(payload);
            case 'BINARY':
                return this.parseBinary(payload);
            default:
                throw new STFError(`ERR_UNKNOWN_CONSTRUCTOR: Unknown constructor: ${typeName}`);
        }
    }

    private parseBigInt(payload: string): string {
        if (payload.length === 0) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Empty BIGINT payload`);
        }
        for (let i = 0; i < payload.length; i++) {
            const c = payload.charCodeAt(i);
            if (c === 32 || c === 9 || c === 13 || c === 10) {
                throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Whitespace in BIGINT payload`);
            }
        }
        let idx = 0;
        const negative = payload.charCodeAt(0) === 45;
        if (payload.charCodeAt(0) === 43 || negative) idx = 1;
        if (payload.charCodeAt(0) === 43) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Leading '+' in BIGINT payload`);
        }
        if (idx >= payload.length) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid BIGINT payload`);
        }
        for (let j = idx; j < payload.length; j++) {
            const c = payload.charCodeAt(j);
            if (c < 48 || c > 57) {
                throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Non-digit character in BIGINT payload`);
            }
        }
        let cleaned = payload.slice(idx);
        while (cleaned.length > 1 && cleaned.charCodeAt(0) === 48) {
            cleaned = cleaned.slice(1);
        }
        if (cleaned === '0') return `$bigint:0`;
        return negative ? `$bigint:-${cleaned}` : `$bigint:${cleaned}`;
    }

    private parseDecimal(payload: string): string {
        if (payload.length === 0) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Empty DECIMAL payload`);
        }
        if (payload.charCodeAt(0) === 43) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Leading '+' in DECIMAL payload`);
        }
        let idx = 0;
        if (payload.charCodeAt(0) === 45) idx = 1;
        if (idx >= payload.length) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DECIMAL payload`);
        }
        const intStart = idx;
        while (idx < payload.length && payload.charCodeAt(idx) >= 48 && payload.charCodeAt(idx) <= 57) {
            idx++;
        }
        const intLen = idx - intStart;
        if (intLen === 0) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Missing integer part in DECIMAL payload`);
        }
        if (intLen > 1 && payload.charCodeAt(intStart) === 48) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Leading zero in DECIMAL payload`);
        }

        let sigDigits = 0;
        let foundNonZero = false;
        for (let k = intStart; k < intStart + intLen; k++) {
            const d = payload.charCodeAt(k);
            if (d !== 48 || foundNonZero) {
                foundNonZero = true;
                sigDigits++;
            }
        }

        if (idx < payload.length && payload.charCodeAt(idx) === 46) {
            idx++;
            const fracStart = idx;
            while (idx < payload.length && payload.charCodeAt(idx) >= 48 && payload.charCodeAt(idx) <= 57) {
                const d = payload.charCodeAt(idx);
                if (d !== 48 || foundNonZero) {
                    foundNonZero = true;
                    sigDigits++;
                }
                idx++;
            }
            if (idx === fracStart) {
                throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Trailing dot in DECIMAL payload`);
            }
        }

        if (idx !== payload.length) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid characters in DECIMAL payload`);
        }

        if (sigDigits > 34) {
            throw new STFError(`ERR_DECIMAL_OVERFLOW: DECIMAL exceeds 34 significant digits: ${sigDigits}`);
        }

        return `$decimal:${payload}`;
    }

    private parseDate(payload: string): string {
        if (payload.length !== 10) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: DATE must be YYYY-MM-DD format`);
        }
        for (let i = 0; i < 10; i++) {
            if (i === 4 || i === 7) {
                if (payload.charCodeAt(i) !== 45) {
                    throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DATE payload`);
                }
            } else {
                const c = payload.charCodeAt(i);
                if (c < 48 || c > 57) {
                    throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DATE payload`);
                }
            }
        }
        const month = parseInt(payload.slice(5, 7), 10);
        const day = parseInt(payload.slice(8, 10), 10);
        if (month < 1 || month > 12 || day < 1 || day > 31) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid DATE values`);
        }
        return `$date:${payload}`;
    }

    private parseTimestamp(payload: string): string {
        if (payload.length < 19) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: TIMESTAMP too short`);
        }
        let i = 0;
        const matchDigit = (count: number): boolean => {
            for (let j = 0; j < count; j++) {
                if (i >= payload.length) return false;
                const c = payload.charCodeAt(i);
                if (c < 48 || c > 57) return false;
                i++;
            }
            return true;
        };
        const matchChar = (ch: string): boolean => {
            if (i >= payload.length || payload[i] !== ch) return false;
            i++;
            return true;
        };

        if (!matchDigit(4) || !matchChar('-') || !matchDigit(2) || !matchChar('-') || !matchDigit(2)) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid TIMESTAMP date component`);
        }

        if (i >= payload.length || (payload[i] !== 'T' && payload[i] !== ' ')) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: TIMESTAMP missing time separator`);
        }
        i++;

        if (!matchDigit(2) || !matchChar(':') || !matchDigit(2) || !matchChar(':') || !matchDigit(2)) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid TIMESTAMP time component`);
        }

        if (i < payload.length && payload[i] === '.') {
            i++;
            const fracStart = i;
            while (i < payload.length && payload.charCodeAt(i) >= 48 && payload.charCodeAt(i) <= 57) {
                i++;
            }
            if (i === fracStart) {
                throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Invalid TIMESTAMP fraction`);
            }
        }

        let hasOffset = false;
        if (i < payload.length && payload[i] === 'Z') {
            i++;
            hasOffset = true;
        } else if (i < payload.length && (payload[i] === '+' || payload[i] === '-')) {
            i++;
            if (matchDigit(2) && matchChar(':') && matchDigit(2)) {
                hasOffset = true;
            }
        }

        if (!hasOffset || i !== payload.length) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: TIMESTAMP requires explicit timezone offset (e.g. Z or +HH:MM)`);
        }

        return `$timestamp:${payload}`;
    }

    private parseBinary(payload: string): string {
        if (payload.length === 0) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: Empty BINARY payload`);
        }
        if (payload.length % 4 !== 0) {
            throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY base64 payload length must be a multiple of 4`);
        }

        let padCount = 0;
        if (payload.endsWith('==')) padCount = 2;
        else if (payload.endsWith('=')) padCount = 1;

        const b64Val = (c: number): number => {
            if (c >= 65 && c <= 90) return c - 65;
            if (c >= 97 && c <= 122) return c - 97 + 26;
            if (c >= 48 && c <= 57) return c - 48 + 52;
            if (c === 43) return 62;
            if (c === 47) return 63;
            return -1;
        };

        for (let i = 0; i < payload.length - padCount; i++) {
            const val = b64Val(payload.charCodeAt(i));
            if (val === -1) {
                throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY invalid base64 character`);
            }
        }

        if (padCount === 1) {
            const lastVal = b64Val(payload.charCodeAt(payload.length - 2));
            if ((lastVal & 3) !== 0) {
                throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY non-canonical trailing bits`);
            }
        } else if (padCount === 2) {
            const lastVal = b64Val(payload.charCodeAt(payload.length - 3));
            if ((lastVal & 15) !== 0) {
                throw new STFError(`ERR_INVALID_CONSTRUCTOR_PAYLOAD: BINARY non-canonical trailing bits`);
            }
        }

        return `$binary:${payload}`;
    }
}

export function stringify(obj: STFValue, indent: string | null = null): string {
    const parts: string[] = [];
    const space = indent ? ' ' : '';
    const newline = indent ? '\n' : '';

    function build(o: STFValue, level: number) {
        if (typeof o === 'object' && o !== null) {
            if (Array.isArray(o)) {
                const len = o.length;
                if (len === 0) { parts.push('[]'); return; }
                parts.push('[');
                if (newline) parts.push(newline);
                const sp = indent ? indent.repeat(level + 1) : '';
                for (let i = 0; i < len; i++) {
                    if (sp) parts.push(sp);
                    build(o[i], level + 1);
                    parts.push(',');
                    if (newline) parts.push(newline);
                }
                if (indent && level > 0) parts.push(indent.repeat(level));
                parts.push(']');
            } else {
                const keys = Object.keys(o).sort();
                const len = keys.length;
                if (len === 0) { parts.push('{}'); return; }
                parts.push('{');
                if (newline) parts.push(newline);
                const sp = indent ? indent.repeat(level + 1) : '';
                for (let i = 0; i < len; i++) {
                    const k = keys[i];
                    if (sp) parts.push(sp);
                    parts.push(k, ':');
                    if (space) parts.push(space);
                    build(o[k], level + 1);
                    parts.push(',');
                    if (newline) parts.push(newline);
                }
                if (indent && level > 0) parts.push(indent.repeat(level));
                parts.push('}');
            }
        } else if (typeof o === 'string') {
            if (o.charCodeAt(0) === 36) { // '$'
                if (o.startsWith('$date:')) { parts.push('DATE(', o.slice(6), ')'); return; }
                if (o.startsWith('$timestamp:')) { parts.push('TIMESTAMP(', o.slice(11), ')'); return; }
                if (o.startsWith('$bigint:')) { parts.push('BIGINT(', o.slice(8), ')'); return; }
                if (o.startsWith('$decimal:')) { parts.push('DECIMAL(', o.slice(9), ')'); return; }
                if (o.startsWith('$binary:')) { parts.push('BINARY(', o.slice(8), ')'); return; }
            }
            if (o.indexOf('`') !== -1) { parts.push(JSON.stringify(o)); return; }
            parts.push('`', o, '`');
        } else if (typeof o === 'number') {
            parts.push(String(o));
        } else if (typeof o === 'boolean') {
            parts.push(o ? 'T' : 'F');
        } else if (o === null) {
            parts.push('N');
        }
    }

    build(obj, 0);
    return parts.join('');
}

export function parse(text: string): { [key: string]: STFValue } {
    const parser = new STFParser(text);
    return parser.parse();
}

export function format(text: string): string {
    return stringify(parse(text), '  ');
}
