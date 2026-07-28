/**
 * The STF 1.0 parser.
 *
 * Scans UTF-16 code units. The identifier and structural grammar is entirely ASCII, so a
 * non-ASCII code unit always ends a token and is reported where the specification requires.
 */

import {
  buildConstructor,
  isKnownConstructor,
  isReservedConstructor,
  PayloadError,
} from "./constructors.ts";
import { locate, STFError, type STFErrorCode } from "./errors.ts";
import { makeObject, type STFDirective, type STFDocument, type STFValue } from "./value.ts";

/** Spec §11.3. The default MUST be 64 so documents port between conformant parsers. */
export const DEFAULT_MAX_DEPTH = 64;

/** Optional resource limits (spec §15). `null` means unlimited, the specified default. */
export interface Limits {
  maxDepth?: number;
  maxDocumentBytes?: number | null;
  maxPayloadBytes?: number | null;
}

/** How the parser frames its input. */
export type Mode =
  | { kind: "document" }
  /** One record of a stream. A newline actually following changes how an open string reads. */
  | { kind: "record"; newlineFollows: boolean }
  | { kind: "header" };

const SPACE = 32;
const TAB = 9;
const LF = 10;
const CR = 13;
const HASH = 35;

function isIdent(c: number): boolean {
  return (
    (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95 || c === 45
  );
}

export class Parser {
  private pos = 0;
  private depth = 0;
  private readonly maxDepth: number;
  private readonly maxPayloadBytes: number | null;
  private readonly src: string;
  private readonly mode: Mode;

  constructor(src: string, limits: Limits = {}, mode: Mode = { kind: "document" }) {
    this.src = src;
    this.mode = mode;
    this.maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxPayloadBytes = limits.maxPayloadBytes ?? null;
    if (limits.maxDocumentBytes != null && src.length > limits.maxDocumentBytes) {
      throw this.error("ERR_DOCUMENT_SIZE", `document exceeds ${limits.maxDocumentBytes}`, 0);
    }
  }

  private error(code: STFErrorCode, detail: string, offset = this.pos): STFError {
    return new STFError(code, detail, locate(this.src, offset));
  }

  private peek(at = 0): number {
    return this.pos + at < this.src.length ? this.src.charCodeAt(this.pos + at) : -1;
  }

  /** Skips whitespace and comments (spec §4). A comment ends at LF *or* CR. */
  private skipWs(): void {
    while (this.pos < this.src.length) {
      const c = this.src.charCodeAt(this.pos);
      if (c === SPACE || c === TAB || c === LF || c === CR) {
        this.pos++;
      } else if (c === HASH) {
        this.pos++;
        while (this.pos < this.src.length) {
          const d = this.src.charCodeAt(this.pos);
          if (d === LF || d === CR) break;
          this.pos++;
        }
      } else {
        break;
      }
    }
  }

  /** Parses a whole document: directives, one root object, then end of input. */
  parseDocument(): STFDocument {
    // A BOM is not whitespace (spec §2) and must not read as a missing root.
    if (this.src.charCodeAt(0) === 0xfeff) {
      throw this.error("ERR_SYNTAX", "leading byte order mark", 0);
    }

    const directives: STFDirective[] = [];
    this.skipWs();
    while (this.peek() === 64) {
      const d = this.parseDirective();
      if (directives.some((e) => e.name === d.name)) {
        throw this.error("ERR_SYNTAX", `directive \`@${d.name}\` appears more than once`);
      }
      directives.push(d);
      this.skipWs();
    }

    if (this.peek() !== 123) {
      throw this.error(
        "ERR_ROOT_NOT_OBJECT",
        this.pos >= this.src.length
          ? "document contains no root object"
          : "document root must be an object",
      );
    }

    const root = this.parseObject();
    this.skipWs();
    if (this.pos < this.src.length) {
      throw this.error("ERR_TRAILING_CONTENT", "content follows the root object");
    }
    return { directives, root };
  }

  /** `@name(payload)` with no whitespace around `@` or before `(` (spec §5.1). */
  private parseDirective(): STFDirective {
    const at = this.pos;
    if (this.mode.kind === "record") {
      throw this.error(
        "ERR_STREAM_DIRECTIVE_IN_RECORD",
        "a stream record must not contain a directive",
        at,
      );
    }
    this.pos++; // '@'
    const nameStart = this.pos;
    while (isIdent(this.peek())) this.pos++;
    if (this.pos === nameStart) throw this.error("ERR_SYNTAX", "directive name is empty");
    const name = this.src.slice(nameStart, this.pos);
    if (this.peek() !== 40) {
      throw this.error("ERR_SYNTAX", "expected `(` immediately after the directive name");
    }
    this.pos++;
    const payloadStart = this.pos;
    for (;;) {
      const c = this.peek();
      if (c === -1) throw this.error("ERR_UNTERMINATED", "unterminated directive");
      if (c === 41) break;
      if (c === 40) throw this.error("ERR_NESTED_CONSTRUCTOR", "`(` inside a directive payload");
      this.pos++;
    }
    const payload = this.src.slice(payloadStart, this.pos);
    this.pos++; // ')'
    return { name, payload };
  }

  private enter(at: number): void {
    this.depth++;
    if (this.depth > this.maxDepth) {
      throw this.error("ERR_NESTING_DEPTH", `nesting exceeds the maximum depth of ${this.maxDepth}`, at);
    }
  }

  private parseObject(): Record<string, STFValue> {
    const open = this.pos;
    this.pos++; // '{'
    this.enter(open);
    const entries: Array<[string, STFValue]> = [];
    const seen = new Set<string>();

    this.skipWs();
    if (this.peek() === 44) throw this.error("ERR_MISSING_COMMA", "leading comma");
    while (this.peek() !== 125) {
      if (this.peek() === -1) throw this.error("ERR_UNTERMINATED", "unterminated object");

      const keyAt = this.pos;
      const key = this.parseKey();
      this.skipWs();
      if (this.peek() !== 58) {
        // `{a b: 1}` is a key containing whitespace (§6.2); `{a 1}` is a missing colon.
        if (this.looksLikeSplitKey()) {
          throw this.error("ERR_INVALID_IDENTIFIER", "whitespace is not permitted within a key");
        }
        throw this.error("ERR_MISSING_COLON", "expected `:` after the key");
      }
      this.pos++;

      const value = this.parseValue();
      if (seen.has(key)) throw this.error("ERR_DUPLICATE_KEY", `duplicate key \`${key}\``, keyAt);
      seen.add(key);
      entries.push([key, value]);

      this.skipWs();
      const c = this.peek();
      if (c === 44) {
        this.pos++;
        this.skipWs();
        if (this.peek() === 44) throw this.error("ERR_MISSING_COMMA", "consecutive commas");
      } else if (c === 125) {
        break;
      } else if (c === -1) {
        throw this.error("ERR_UNTERMINATED", "unterminated object");
      } else {
        throw this.error("ERR_MISSING_COMMA", "expected `,` between members");
      }
    }
    this.pos++; // '}'
    this.depth--;
    return makeObject(entries);
  }

  private parseArray(): STFValue[] {
    const open = this.pos;
    this.pos++; // '['
    this.enter(open);
    const items: STFValue[] = [];

    this.skipWs();
    if (this.peek() === 44) throw this.error("ERR_MISSING_COMMA", "leading comma");
    while (this.peek() !== 93) {
      if (this.peek() === -1) throw this.error("ERR_UNTERMINATED", "unterminated array");
      items.push(this.parseValue());
      this.skipWs();
      const c = this.peek();
      if (c === 44) {
        this.pos++;
        this.skipWs();
        if (this.peek() === 44) throw this.error("ERR_MISSING_COMMA", "consecutive commas");
      } else if (c === 93) {
        break;
      } else if (c === -1) {
        throw this.error("ERR_UNTERMINATED", "unterminated array");
      } else {
        throw this.error("ERR_MISSING_COMMA", "expected `,` between elements");
      }
    }
    this.pos++; // ']'
    this.depth--;
    return items;
  }

  /** Keys are unquoted identifiers (spec §6.1). A quoted key is `ERR_SYNTAX`. */
  private parseKey(): string {
    const c = this.peek();
    if (c === 34 || c === 96) throw this.error("ERR_SYNTAX", "keys must not be quoted");
    const start = this.pos;
    while (isIdent(this.peek())) this.pos++;
    if (this.pos === start) {
      throw this.error("ERR_INVALID_IDENTIFIER", "expected a key matching [A-Za-z0-9_-]+", start);
    }
    // A character that is neither whitespace, a comment, nor `:` straight after the
    // identifier is a bad key character (`a.b`), not a missing colon.
    const next = this.peek();
    if (next !== -1 && next !== SPACE && next !== TAB && next !== LF && next !== CR && next !== HASH && next !== 58) {
      throw this.error("ERR_INVALID_IDENTIFIER", "character is not permitted in a key");
    }
    return this.src.slice(start, this.pos);
  }

  /** True when the cursor holds a second identifier that is itself followed by `:`. */
  private looksLikeSplitKey(): boolean {
    let i = this.pos;
    const start = i;
    while (i < this.src.length && isIdent(this.src.charCodeAt(i))) i++;
    if (i === start) return false;
    while (i < this.src.length) {
      const c = this.src.charCodeAt(i);
      if (c === SPACE || c === TAB || c === LF || c === CR) i++;
      else break;
    }
    return i < this.src.length && this.src.charCodeAt(i) === 58;
  }

  private parseValue(): STFValue {
    this.skipWs();
    const c = this.peek();
    if (c === -1) throw this.error("ERR_UNTERMINATED", "expected a value");
    if (c === 123) return this.parseObject();
    if (c === 91) return this.parseArray();
    if (c === 96) return this.parseRawString();
    if (c === 34) return this.parseInterpretedString();
    // `+` and `.` cannot start a valid number, but dispatching them here yields the specific
    // ERR_INVALID_NUMBER that §7.1 requires rather than generic syntax.
    if (c === 43 || c === 45 || c === 46 || (c >= 48 && c <= 57)) return this.parseNumber();
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) return this.parseWord();
    throw this.error("ERR_SYNTAX", "expected a value");
  }

  /** A bare word in value position: a `T`/`F`/`N` literal, or a constructor when `(` follows. */
  private parseWord(): STFValue {
    const start = this.pos;
    while (isIdent(this.peek())) this.pos++;
    const word = this.src.slice(start, this.pos);

    if (this.peek() !== 40) {
      // Scanning greedily is what enforces the §7.4 boundary rule: `NaN` never reaches here
      // as `N` followed by `aN`.
      if (word === "T") return true;
      if (word === "F") return false;
      if (word === "N") return null;
      throw this.error(
        "ERR_SYNTAX",
        `\`${word}\` is not a value; literals are \`T\`, \`F\`, and \`N\``,
        start,
      );
    }

    if (!isKnownConstructor(word)) {
      if (isReservedConstructor(word)) {
        throw this.error(
          "ERR_UNKNOWN_CONSTRUCTOR",
          `\`${word}\` is not an STF 1.0 constructor`,
          start,
        );
      }
      throw this.error("ERR_SYNTAX", `\`${word}\` is not valid in value position`, start);
    }

    this.pos++; // '('
    const payloadStart = this.pos;
    for (;;) {
      const c = this.peek();
      if (c === -1) throw this.error("ERR_UNTERMINATED", "unterminated constructor");
      if (c === 41) break;
      if (c === 40) throw this.error("ERR_NESTED_CONSTRUCTOR", "`(` inside a constructor payload");
      this.pos++;
    }
    const payload = this.src.slice(payloadStart, this.pos);
    if (this.maxPayloadBytes != null && payload.length > this.maxPayloadBytes) {
      throw this.error("ERR_PAYLOAD_SIZE", `payload exceeds ${this.maxPayloadBytes}`, payloadStart);
    }
    let value: STFValue;
    try {
      value = buildConstructor(word, payload);
    } catch (e) {
      if (e instanceof PayloadError) {
        throw this.error(e.failure.code, e.failure.detail, payloadStart);
      }
      throw e;
    }
    this.pos++; // ')'
    return value;
  }

  /** Spec §8.1. No escape processing; a backtick cannot appear inside. */
  private parseRawString(): string {
    const open = this.pos;
    this.pos++;
    const start = this.pos;
    const end = this.src.indexOf("`", start);
    if (end === -1) throw this.unterminatedString(open, "unterminated raw string");
    this.pos = end + 1;
    return this.src.slice(start, end);
  }

  /** Spec §8.2 and §8.3. The JSON escape set exactly, with surrogate pairing enforced. */
  private parseInterpretedString(): string {
    const open = this.pos;
    this.pos++;
    let out = "";
    for (;;) {
      const c = this.peek();
      if (c === -1) throw this.unterminatedString(open, "unterminated interpreted string");
      if (c === 34) {
        this.pos++;
        return out;
      }
      if (c === LF || c === CR) {
        throw this.error("ERR_INVALID_STRING", "literal line terminator in an interpreted string");
      }
      if (c !== 92) {
        out += this.src[this.pos];
        this.pos++;
        continue;
      }

      const escAt = this.pos;
      this.pos++;
      const esc = this.peek();
      if (esc === -1) throw this.unterminatedString(open, "unterminated interpreted string");
      this.pos++;
      switch (esc) {
        case 34: out += '"'; break;
        case 92: out += "\\"; break;
        case 47: out += "/"; break;
        case 98: out += "\b"; break;
        case 102: out += "\f"; break;
        case 110: out += "\n"; break;
        case 114: out += "\r"; break;
        case 116: out += "\t"; break;
        case 117: {
          const unit = this.parseHex4(escAt);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            if (this.peek() !== 92 || this.peek(1) !== 117) {
              throw this.error(
                "ERR_INVALID_STRING",
                "high surrogate is not followed by a low surrogate",
                escAt,
              );
            }
            this.pos += 2;
            const low = this.parseHex4(escAt);
            if (low < 0xdc00 || low > 0xdfff) {
              throw this.error(
                "ERR_INVALID_STRING",
                "high surrogate is not followed by a low surrogate",
                escAt,
              );
            }
            out += String.fromCharCode(unit, low);
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            throw this.error("ERR_INVALID_STRING", "lone low surrogate", escAt);
          } else {
            out += String.fromCharCode(unit);
          }
          break;
        }
        default:
          throw this.error("ERR_INVALID_STRING", "unrecognized escape sequence", escAt);
      }
    }
  }

  private parseHex4(at: number): number {
    if (this.pos + 4 > this.src.length) {
      throw this.error("ERR_INVALID_STRING", "`\\u` needs four hex digits", at);
    }
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const c = this.src.charCodeAt(this.pos + i);
      let digit: number;
      if (c >= 48 && c <= 57) digit = c - 48;
      else if (c >= 97 && c <= 102) digit = c - 97 + 10;
      else if (c >= 65 && c <= 70) digit = c - 65 + 10;
      else throw this.error("ERR_INVALID_STRING", "`\\u` needs four hex digits", at);
      value = value * 16 + digit;
    }
    this.pos += 4;
    return value;
  }

  /**
   * In a stream record, a string left open at end of line is a raw line terminator inside a
   * string (stream §3.2) — but only when a line terminator actually follows.
   */
  private unterminatedString(at: number, detail: string): STFError {
    if (this.mode.kind === "record" && this.mode.newlineFollows) {
      return this.error(
        "ERR_STREAM_RAW_NEWLINE",
        "a stream record must not contain a raw line terminator",
        at,
      );
    }
    return this.error("ERR_UNTERMINATED", detail, at);
  }

  /** Spec §7. Grammar, then the §7.4 boundary rule, then the `binary64` conversion. */
  private parseNumber(): number {
    const start = this.pos;
    if (this.peek() === 43) {
      throw this.error("ERR_INVALID_NUMBER", "leading `+` is not permitted", start);
    }
    if (this.peek() === 45) this.pos++;

    const c = this.peek();
    if (c === 48) {
      this.pos++;
    } else if (c >= 49 && c <= 57) {
      while (this.peek() >= 48 && this.peek() <= 57) this.pos++;
    } else {
      throw this.error("ERR_INVALID_NUMBER", "number has no integer part", start);
    }

    if (this.peek() === 46) {
      this.pos++;
      const fracStart = this.pos;
      while (this.peek() >= 48 && this.peek() <= 57) this.pos++;
      if (this.pos === fracStart) throw this.error("ERR_INVALID_NUMBER", "fraction has no digits");
    }

    if (this.peek() === 101 || this.peek() === 69) {
      this.pos++;
      if (this.peek() === 43 || this.peek() === 45) this.pos++;
      const expStart = this.pos;
      while (this.peek() >= 48 && this.peek() <= 57) this.pos++;
      if (this.pos === expStart) throw this.error("ERR_INVALID_NUMBER", "exponent has no digits");
    }

    // §7.4: rejects `0x10`, `1_000`, `0123`, and `1.2.3` at the offending character.
    const after = this.peek();
    if (after !== -1 && (isIdent(after) || after === 46)) {
      throw this.error(
        "ERR_INVALID_NUMBER",
        "number is immediately followed by an identifier character",
      );
    }

    const text = this.src.slice(start, this.pos);
    const n = Number(text);
    if (!Number.isFinite(n)) {
      throw this.error("ERR_NUMBER_OVERFLOW", "magnitude exceeds the finite binary64 range", start);
    }
    // Number("-0") is -0 already, but be explicit: §7.3 makes the sign observable.
    return n === 0 && text.charCodeAt(0) === 45 ? -0 : n;
  }

  /** Parses one stream record: a root object with no directives, then end of line. */
  parseRecord(): Record<string, STFValue> {
    this.skipWs();
    if (this.peek() === 64) this.parseDirective(); // always throws in record mode
    if (this.peek() !== 123) {
      throw this.error("ERR_ROOT_NOT_OBJECT", "a record root must be an object");
    }
    const root = this.parseObject();
    this.skipWs();
    if (this.pos < this.src.length) {
      throw this.error("ERR_TRAILING_CONTENT", "content follows the record");
    }
    return root;
  }

  /** Parses a stream header line: one or more directives and nothing else. */
  parseHeaderLine(): STFDirective[] {
    const out: STFDirective[] = [];
    this.skipWs();
    while (this.peek() === 64) {
      const d = this.parseDirective();
      if (out.some((e) => e.name === d.name)) {
        throw this.error("ERR_SYNTAX", `directive \`@${d.name}\` appears more than once`);
      }
      out.push(d);
      this.skipWs();
    }
    if (this.pos < this.src.length) {
      throw this.error(
        "ERR_STREAM_DIRECTIVE_IN_RECORD",
        "a header line must contain only directives",
      );
    }
    return out;
  }
}
