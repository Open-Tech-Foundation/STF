/**
 * Serialization (spec §13) and Canonical Form (spec §14).
 *
 * The contract is `parse(serialize(v))` equals `v`. Where a host value cannot be represented,
 * this module throws `ERR_UNREPRESENTABLE` rather than emit text a parser would reject.
 */

import { binaryToBase64 } from "./constructors.ts";
import { STFError } from "./errors.ts";
import {
  keysOf,
  kindOf,
  STFDate,
  STFDecimal,
  STFTimestamp,
  type STFDocument,
  type STFObject,
  type STFValue,
} from "./value.ts";

export interface Format {
  /** Indent string. `null` emits everything on one line. */
  indent: string | null;
  /** Canonical Form (spec §14): sorted keys, no spacing, all strings interpreted. */
  canonical: boolean;
  /**
   * Force the interpreted form for strings containing LF or CR, keeping output on one line.
   * Required by stream §3.2; off for discrete documents, where §8.1 permits a raw newline.
   */
  escapeLineTerminators: boolean;
}

export const COMPACT: Format = { indent: null, canonical: false, escapeLineTerminators: false };
export const CANONICAL: Format = { indent: null, canonical: true, escapeLineTerminators: false };

export function pretty(indent = "  "): Format {
  return { indent, canonical: false, escapeLineTerminators: false };
}

export function singleLine(format: Format): Format {
  return { ...format, indent: null, escapeLineTerminators: true };
}

function unrepresentable(detail: string): never {
  throw new STFError("ERR_UNREPRESENTABLE", detail);
}

const IDENTIFIER = /^[A-Za-z0-9_-]+$/;

/** Serializes a value. The root must be an object (spec §5). */
export function serialize(value: STFValue, format: Format = pretty()): string {
  if (kindOf(value) !== "Object") {
    unrepresentable(`an STF document root must be an object, not ${kindOf(value)}`);
  }
  const out: string[] = [];
  writeObject(value as STFObject, format, 0, out);
  return out.join("");
}

/** Serializes a document, emitting its directives before the root object. */
export function serializeDocument(doc: STFDocument, format: Format = pretty()): string {
  const out: string[] = [];
  for (const d of doc.directives) {
    if (!IDENTIFIER.test(d.name)) unrepresentable(`\`${d.name}\` is not a valid directive name`);
    if (d.payload.includes("(") || d.payload.includes(")")) {
      unrepresentable("a directive payload must not contain parentheses");
    }
    out.push("@", d.name, "(", d.payload, ")\n");
  }
  writeObject(doc.root, format, 0, out);
  return out.join("");
}

function writeValue(value: STFValue, format: Format, level: number, out: string[]): void {
  const kind = kindOf(value);
  switch (kind) {
    case "Null":
      out.push("N");
      return;
    case "Boolean":
      out.push(value ? "T" : "F");
      return;
    case "Number":
      out.push(formatNumber(value as number));
      return;
    case "String":
      writeString(value as string, format, out);
      return;
    case "Array":
      writeArray(value as STFValue[], format, level, out);
      return;
    case "Object":
      writeObject(value as STFObject, format, level, out);
      return;
    case "BigInt":
      out.push("BIGINT(", (value as bigint).toString(), ")");
      return;
    case "Decimal":
      out.push("DECIMAL(", (value as STFDecimal).payload, ")");
      return;
    case "Date":
      out.push("DATE(", (value as STFDate).payload, ")");
      return;
    case "Timestamp":
      out.push("TIMESTAMP(", (value as STFTimestamp).payload, ")");
      return;
    case "Binary":
      out.push("BINARY(", binaryToBase64(value as Uint8Array), ")");
      return;
  }
}

function writeArray(items: STFValue[], format: Format, level: number, out: string[]): void {
  if (items.length === 0) {
    out.push("[]");
    return;
  }
  out.push("[");
  if (format.indent === null) {
    for (let i = 0; i < items.length; i++) {
      if (i > 0) out.push(",");
      writeValue(items[i], format, level + 1, out);
    }
  } else {
    for (const item of items) {
      out.push("\n", format.indent.repeat(level + 1));
      writeValue(item, format, level + 1, out);
      out.push(",");
    }
    out.push("\n", format.indent.repeat(level));
  }
  out.push("]");
}

function writeObject(object: STFObject, format: Format, level: number, out: string[]): void {
  let keys = keysOf(object);
  for (const key of keys) {
    // §13.6: a key outside the identifier grammar has no STF spelling.
    if (key.length === 0) unrepresentable("an STF key must not be empty");
    if (!IDENTIFIER.test(key)) {
      unrepresentable(`key \`${key}\` is not a valid STF identifier ([A-Za-z0-9_-]+)`);
    }
  }

  if (keys.length === 0) {
    out.push("{}");
    return;
  }

  // §14 rule 5: canonical output orders members by ascending UTF-8 key bytes. Key characters
  // are ASCII (§6.1), so a code-unit comparison is already a byte comparison.
  if (format.canonical) keys = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  out.push("{");
  if (format.indent === null) {
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) out.push(",");
      out.push(keys[i], ":");
      writeValue(object[keys[i]], format, level + 1, out);
    }
  } else {
    for (const key of keys) {
      out.push("\n", format.indent.repeat(level + 1), key, ": ");
      writeValue(object[key], format, level + 1, out);
      out.push(",");
    }
    out.push("\n", format.indent.repeat(level));
  }
  out.push("}");
}

/**
 * §13.3: prefer the raw form, but a backtick has no raw escape. §14 rule 6 forces the
 * interpreted form for canonical output.
 *
 * §13.2 is what this function does *not* do: the content of a string never causes a
 * constructor to be emitted.
 */
function writeString(s: string, format: Format, out: string[]): void {
  let needsInterpreted = format.canonical || s.includes("`");
  if (!needsInterpreted) {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x20 && c !== 10 && c !== 13 && c !== 9) {
        needsInterpreted = true;
        break;
      }
      if (format.escapeLineTerminators && (c === 10 || c === 13)) {
        needsInterpreted = true;
        break;
      }
    }
  }
  if (!needsInterpreted) {
    out.push("`", s, "`");
    return;
  }

  let body = '"';
  for (const ch of s) {
    switch (ch) {
      case '"': body += '\\"'; break;
      case "\\": body += "\\\\"; break;
      case "\b": body += "\\b"; break;
      case "\f": body += "\\f"; break;
      case "\n": body += "\\n"; break;
      case "\r": body += "\\r"; break;
      case "\t": body += "\\t"; break;
      default: {
        const c = ch.codePointAt(0)!;
        // §13.5: escape C0 controls; emit every other scalar literally as UTF-8.
        body += c < 0x20 ? `\\u${c.toString(16).toUpperCase().padStart(4, "0")}` : ch;
      }
    }
  }
  out.push(body, '"');
}

/**
 * §13.4: the shortest decimal form that parses back to the identical `binary64`.
 *
 * `String(n)` is already defined to produce that form, so the only special case is negative
 * zero, which `String` renders as `"0"`.
 */
export function formatNumber(n: number): string {
  if (Number.isNaN(n)) unrepresentable("NaN is not an STF Number");
  if (!Number.isFinite(n)) unrepresentable("an infinity is not an STF Number");
  if (n === 0) return Object.is(n, -0) ? "-0" : "0";
  return String(n);
}
