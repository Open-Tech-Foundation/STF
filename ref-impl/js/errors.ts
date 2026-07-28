/**
 * Error codes and the error type.
 *
 * Every rejection required by the specification maps to exactly one code from
 * `doc/error-codes.md`. Only the code is normative; message text is not (spec §16).
 */

export const ERROR_CODES = [
  // Encoding
  "ERR_INVALID_UTF8",
  // General syntax
  "ERR_SYNTAX",
  "ERR_UNTERMINATED",
  "ERR_TRAILING_CONTENT",
  // Structure
  "ERR_ROOT_NOT_OBJECT",
  "ERR_DUPLICATE_KEY",
  "ERR_MISSING_COLON",
  "ERR_MISSING_COMMA",
  // Identifiers
  "ERR_INVALID_IDENTIFIER",
  // Primitive values
  "ERR_INVALID_NUMBER",
  "ERR_NUMBER_OVERFLOW",
  "ERR_INVALID_STRING",
  // Constructors
  "ERR_UNKNOWN_CONSTRUCTOR",
  "ERR_INVALID_CONSTRUCTOR_PAYLOAD",
  "ERR_NESTED_CONSTRUCTOR",
  "ERR_DECIMAL_OVERFLOW",
  // Resource limits
  "ERR_NESTING_DEPTH",
  "ERR_DOCUMENT_SIZE",
  "ERR_PAYLOAD_SIZE",
  // Serialization
  "ERR_UNREPRESENTABLE",
  // Stream profile
  "ERR_STREAM_RAW_NEWLINE",
  "ERR_STREAM_DIRECTIVE_IN_RECORD",
] as const;

export type STFErrorCode = (typeof ERROR_CODES)[number];

/**
 * A rejection. `code` is the normative part; callers branch on it rather than on `message`.
 */
export class STFError extends Error {
  readonly code: STFErrorCode;
  /** Byte-independent offset into the input, in UTF-16 code units. `-1` when detached. */
  readonly offset: number;
  /** 1-based line number, or 0 when the error has no input position. */
  readonly line: number;
  /** 1-based column, counted in Unicode code points. */
  readonly column: number;

  constructor(
    code: STFErrorCode,
    detail: string,
    position?: { offset: number; line: number; column: number },
  ) {
    const where = position && position.line > 0 ? ` at ${position.line}:${position.column}` : "";
    super(`${code}${where}: ${detail}`);
    this.name = "STFError";
    this.code = code;
    this.offset = position ? position.offset : -1;
    this.line = position ? position.line : 0;
    this.column = position ? position.column : 0;
  }
}

/** Resolves an offset to a 1-based line and column, counting columns in code points. */
export function locate(
  input: string,
  offset: number,
): { offset: number; line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, input.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (input.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  // Count code points, so an astral character advances the column by one.
  const column = [...input.slice(lineStart, clamped)].length + 1;
  return { offset: clamped, line, column };
}
