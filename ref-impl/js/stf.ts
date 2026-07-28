/**
 * Reference implementation of **STF 1.0** — the Structured Text Format.
 *
 * The normative documents are `doc/spec.md` and `doc/error-codes.md`; section references
 * throughout this package point at them. The executable contract is the corpus under
 * `tests/conformance/`.
 *
 * ```ts
 * import { parse, serialize, CANONICAL } from "./stf.ts";
 *
 * const value = parse("{ price: DECIMAL(19.99), tags: [`a`, `b`] }");
 * serialize(value, CANONICAL); // {price:DECIMAL(19.99),tags:["a","b"]}
 * ```
 */

import { Parser, type Limits, type Mode } from "./parser.ts";
import { STFError } from "./errors.ts";
import {
  pretty as prettyImpl,
  serializeDocument as serializeDocumentImpl,
} from "./serialize.ts";
import type { STFDocument, STFObject, STFValue } from "./value.ts";

export { ERROR_CODES, STFError, type STFErrorCode } from "./errors.ts";
export { DEFAULT_MAX_DEPTH, type Limits } from "./parser.ts";
export {
  binaryToBase64,
  CONSTRUCTOR_NAMES,
  parseBigInt,
  parseBinary,
  parseDate,
  parseDecimal,
  parseTimestamp,
} from "./constructors.ts";
export {
  CANONICAL,
  COMPACT,
  formatNumber,
  pretty,
  serialize,
  serializeDocument,
  singleLine,
  type Format,
} from "./serialize.ts";
export {
  parseStream,
  readStream,
  serializeStream,
  streamDirectives,
  type STFRecord,
  type STFStream,
} from "./stream.ts";
export {
  equals,
  keysOf,
  kindOf,
  makeObject,
  ORDER,
  STFDate,
  STFDecimal,
  STFTimestamp,
  type STFDirective,
  type STFDocument,
  type STFKind,
  type STFObject,
  type STFOffset,
} from "./value.ts";
export {
  fromJSON,
  fromJSONText,
  toJSON,
  toTaggedJSON,
  type TypedValuePolicy,
} from "./json.ts";

/** Parses a document and returns its root object. */
export function parse(text: string, limits: Limits = {}): STFObject {
  return parseDocument(text, limits).root;
}

/** Parses a document, keeping its directives (spec §5.1), which are metadata rather than data. */
export function parseDocument(text: string, limits: Limits = {}): STFDocument {
  const mode: Mode = { kind: "document" };
  return new Parser(text, limits, mode).parseDocument();
}

/**
 * Parses raw bytes, enforcing the UTF-8 requirement of spec §2.
 *
 * Substituting `U+FFFD` is prohibited, so malformed input is rejected outright.
 */
export function parseBytes(bytes: Uint8Array, limits: Limits = {}): STFObject {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new STFError("ERR_INVALID_UTF8", "input is not well-formed UTF-8");
  }
  return parse(text, limits);
}

/** Parses then reserializes, with two-space indentation. */
export function format(text: string, limits: Limits = {}): string {
  return serializeDocumentImpl(parseDocument(text, limits), prettyImpl());
}

export type { STFValue };
