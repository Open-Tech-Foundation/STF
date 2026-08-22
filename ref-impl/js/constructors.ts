/**
 * Constructor payload validation (spec §10.2–§10.5).
 *
 * Payloads are not tokenized by the parser, so every rule is enforced against the raw
 * character sequence between the parentheses.
 */

import type { STFErrorCode } from "./errors.ts";
import {
  STFDate,
  STFDecimal,
  STFDuration,
  STFGeometry,
  type STFGeometryType,
  STFTime,
  STFTimestamp,
  type STFOffset,
  type STFValue,
} from "./value.ts";

/** The constructor names — original five plus Geometry/Time/Duration extensions. */
export const CONSTRUCTOR_NAMES = [
  "BIGINT",
  "DECIMAL",
  "DATE",
  "TIMESTAMP",
  "BINARY",
  "GEOMETRY",
  "TIME",
  "DURATION",
  "Geometry",
  "Time",
  "Duration",
] as const;

/** decimal128 coefficient precision (spec §10.2). */
const MAX_SIGNIFICANT_DIGITS = 34;
/** decimal128 exponent range (spec §10.2). */
const MAX_SCALE = 6143;

/** A validation failure: the normative code plus a non-normative explanation. */
export interface PayloadFailure {
  code: STFErrorCode;
  detail: string;
}

export class PayloadError extends Error {
  readonly failure: PayloadFailure;

  constructor(failure: PayloadFailure) {
    super(failure.detail);
    this.failure = failure;
  }
}

function bad(detail: string): never {
  throw new PayloadError({ code: "ERR_INVALID_CONSTRUCTOR_PAYLOAD", detail });
}

function overflow(detail: string): never {
  throw new PayloadError({ code: "ERR_DECIMAL_OVERFLOW", detail });
}

export function isKnownConstructor(name: string): boolean {
  return (CONSTRUCTOR_NAMES as readonly string[]).includes(name);
}

/**
 * Spec §10.1: the reserved namespace is any identifier beginning with an ASCII uppercase
 * letter, plus any ASCII case-insensitive match of a defined name. A reserved name that is
 * not an exact match is `ERR_UNKNOWN_CONSTRUCTOR`; anything else before `(` is `ERR_SYNTAX`.
 */
export function isReservedConstructor(name: string): boolean {
  const first = name.charCodeAt(0);
  if (first >= 65 && first <= 90) return true;
  const upper = name.toUpperCase();
  return (CONSTRUCTOR_NAMES as readonly string[]).includes(upper);
}

export function buildConstructor(name: string, payload: string): STFValue {
  const canonical = name.toUpperCase();
  switch (canonical) {
    case "DECIMAL":
      return parseDecimal(payload);
    case "BIGINT":
      return parseBigInt(payload);
    case "DATE":
      return parseDate(payload);
    case "TIMESTAMP":
      return parseTimestamp(payload);
    case "BINARY":
      return parseBinary(payload);
    case "GEOMETRY":
      return parseGeometry(payload);
    case "TIME":
      return parseTime(payload);
    case "DURATION":
      return parseDuration(payload);
    default:
      throw new PayloadError({
        code: "ERR_UNKNOWN_CONSTRUCTOR",
        detail: `\`${name}\` is not an STF constructor`,
      });
  }
}

const isDigit = (c: number) => c >= 48 && c <= 57;

/** `[ "-" ] ( "0" | digit1_9 { digit } ) [ "." digit { digit } ]` — plain notation only. */
export function parseDecimal(payload: string): STFDecimal {
  if (payload.length === 0) bad("DECIMAL payload is empty");

  let i = 0;
  const negative = payload.charCodeAt(0) === 45;
  if (negative) i = 1;

  const intStart = i;
  if (payload.charCodeAt(i) === 48) {
    i++;
  } else if (isDigit(payload.charCodeAt(i)) && payload.charCodeAt(i) !== 48) {
    while (i < payload.length && isDigit(payload.charCodeAt(i))) i++;
  } else {
    bad("DECIMAL integer part is missing");
  }
  // A `0` integer part may only be followed by `.`, which rules out `01.5`.
  if (payload.charCodeAt(intStart) === 48 && i - intStart > 1) bad("DECIMAL has a leading zero");
  const intPart = payload.slice(intStart, i);

  let fracPart = "";
  if (payload.charCodeAt(i) === 46) {
    i++;
    const fracStart = i;
    while (i < payload.length && isDigit(payload.charCodeAt(i))) i++;
    if (i === fracStart) bad("DECIMAL fraction has no digits");
    fracPart = payload.slice(fracStart, i);
  }
  if (i !== payload.length) {
    bad("DECIMAL payload must be plain notation: no exponent, sign, or trailing characters");
  }

  const scale = fracPart.length;
  if (scale > MAX_SCALE) overflow(`DECIMAL scale ${scale} exceeds the maximum of ${MAX_SCALE}`);

  const digits = intPart + fracPart;
  // §10.2: leading zeros are not significant, trailing zeros are, and zero counts as 1.
  const stripped = digits.replace(/^0+/, "");
  const significant = stripped.length === 0 ? 1 : stripped.length;
  if (significant > MAX_SIGNIFICANT_DIGITS) {
    overflow(
      `DECIMAL has ${significant} significant digits, exceeding the maximum of ${MAX_SIGNIFICANT_DIGITS}`,
    );
  }

  return new STFDecimal(negative, BigInt(digits), scale);
}

/** `"0" | [ "-" ] digit1_9 { digit }` — one spelling per value. */
export function parseBigInt(payload: string): bigint {
  if (payload.length === 0) bad("BIGINT payload is empty");
  if (payload === "0") return 0n;

  let i = 0;
  if (payload.charCodeAt(0) === 45) i = 1;
  const first = payload.charCodeAt(i);
  if (!(first >= 49 && first <= 57)) {
    bad("BIGINT must be `0` or an optionally-signed integer with no leading zero");
  }
  i++;
  while (i < payload.length && isDigit(payload.charCodeAt(i))) i++;
  if (i !== payload.length) bad("BIGINT payload contains a non-digit character");
  return BigInt(payload);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

function twoDigits(text: string, i: number): number | null {
  const a = text.charCodeAt(i);
  const b = text.charCodeAt(i + 1);
  if (!isDigit(a) || !isDigit(b)) return null;
  return (a - 48) * 10 + (b - 48);
}

/** `YYYY-MM-DD`, zero-padded, with full proleptic-Gregorian validation (spec §10.4). */
export function parseDate(payload: string): STFDate {
  if (payload.length !== 10) bad("DATE must be exactly `YYYY-MM-DD`");
  return parseDateAt(payload, 0);
}

function parseDateAt(text: string, off: number): STFDate {
  if (text.length < off + 10) bad("DATE must be exactly `YYYY-MM-DD`");
  for (const i of [off, off + 1, off + 2, off + 3, off + 5, off + 6, off + 8, off + 9]) {
    if (!isDigit(text.charCodeAt(i))) bad("DATE must be exactly `YYYY-MM-DD`");
  }
  if (text.charCodeAt(off + 4) !== 45 || text.charCodeAt(off + 7) !== 45) {
    bad("DATE must be exactly `YYYY-MM-DD`");
  }
  const year = Number(text.slice(off, off + 4));
  const month = twoDigits(text, off + 5)!;
  const day = twoDigits(text, off + 8)!;
  if (month < 1 || month > 12) bad(`month ${month} is out of range`);
  const max = daysInMonth(year, month);
  if (day < 1 || day > max) bad(`day ${day} is out of range for ${year}-${month}`);
  return new STFDate(year, month, day);
}

/** `date "T" hh:mm:ss [ "." digit{1,9} ] ( "Z" | ±hh:mm )` (spec §10.4). */
export function parseTimestamp(payload: string): STFTimestamp {
  const date = parseDateAt(payload, 0);
  if (payload[10] !== "T") bad("TIMESTAMP requires an uppercase `T` between date and time");
  if (payload[13] !== ":" || payload[16] !== ":") bad("TIMESTAMP time must be `hh:mm:ss`");

  const hour = twoDigits(payload, 11);
  const minute = twoDigits(payload, 14);
  const second = twoDigits(payload, 17);
  if (hour === null || minute === null || second === null) bad("TIMESTAMP time must be `hh:mm:ss`");
  if (hour > 23) bad(`hour ${hour} is out of range`);
  if (minute > 59) bad(`minute ${minute} is out of range`);
  // §10.4: leap seconds are not supported, so 60 is simply out of range.
  if (second > 59) bad(`second ${second} is out of range; leap seconds are not supported`);

  let i = 19;
  let fraction: string | null = null;
  if (payload[i] === ".") {
    i++;
    const start = i;
    while (i < payload.length && isDigit(payload.charCodeAt(i))) i++;
    const len = i - start;
    if (len < 1 || len > 9) bad("TIMESTAMP fraction must have 1 to 9 digits");
    fraction = payload.slice(start, i);
  }

  let offset: STFOffset;
  const zone = payload[i];
  if (zone === "Z") {
    offset = { kind: "utc" };
    i++;
  } else if (zone === "+" || zone === "-") {
    if (payload[i + 3] !== ":") bad("TIMESTAMP offset must be `±hh:mm`");
    const hours = twoDigits(payload, i + 1);
    const minutes = twoDigits(payload, i + 4);
    if (hours === null || minutes === null) bad("TIMESTAMP offset must be `±hh:mm`");
    if (hours > 23) bad(`offset hour ${hours} is out of range`);
    if (minutes > 59) bad(`offset minute ${minutes} is out of range`);
    offset = { kind: "fixed", negative: zone === "-", hours, minutes };
    i += 6;
  } else {
    bad("TIMESTAMP requires a UTC offset (`Z` or `±hh:mm`)");
  }

  if (i !== payload.length) bad("TIMESTAMP has trailing characters after the offset");
  return new STFTimestamp(date, hour, minute, second, fraction, offset);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64Index(c: number): number {
  if (c >= 65 && c <= 90) return c - 65;
  if (c >= 97 && c <= 122) return c - 97 + 26;
  if (c >= 48 && c <= 57) return c - 48 + 52;
  if (c === 43) return 62;
  if (c === 47) return 63;
  return -1;
}

/** Canonical RFC 4648 §4 base64 (spec §10.5). The empty payload is valid. */
export function parseBinary(payload: string): Uint8Array {
  if (payload.length === 0) return new Uint8Array(0);
  if (payload.length % 4 !== 0) bad("BINARY length must be a multiple of 4");

  let pad = 0;
  while (pad < payload.length && payload.charCodeAt(payload.length - 1 - pad) === 61) pad++;
  if (pad > 2) bad("BINARY has more than two padding characters");

  const dataLen = payload.length - pad;
  for (let i = 0; i < dataLen; i++) {
    if (b64Index(payload.charCodeAt(i)) === -1) {
      // Covers the URL-safe alphabet, internal whitespace, and a stray `=`.
      bad("BINARY contains a character outside the standard base64 alphabet");
    }
  }

  // Canonical encoding: the bits the padding discards must be zero.
  if (pad > 0) {
    if (dataLen === 0) bad("BINARY has only padding");
    const last = b64Index(payload.charCodeAt(dataLen - 1));
    const mask = pad === 1 ? 0b11 : 0b1111;
    if ((last & mask) !== 0) bad("BINARY has non-canonical trailing bits");
  }

  const out = new Uint8Array((dataLen * 6) >> 3);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < dataLen; i++) {
    acc = (acc << 6) | b64Index(payload.charCodeAt(i));
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/* ───────────────── Geometry / Time / Duration (extensions) ───────────────── */

const GEOMETRY_TYPES: STFGeometryType[] = [
  "Point",
  "LineString",
  "Polygon",
  "MultiPoint",
  "MultiLineString",
  "MultiPolygon",
];

function isValidPosition(p: unknown): boolean {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

function validateGeometry(type: string, coords: unknown): void {
  if (!GEOMETRY_TYPES.includes(type as STFGeometryType)) {
    bad(`Geometry type \`${type}\` is not supported`);
  }
  switch (type) {
    case "Point": {
      if (!isValidPosition(coords)) bad("Point coordinates must be [longitude, latitude]");
      break;
    }
    case "LineString": {
      if (!Array.isArray(coords) || coords.length < 2) bad("LineString requires at least 2 positions");
      for (const p of coords as unknown[]) if (!isValidPosition(p)) bad("LineString coordinates must be positions");
      break;
    }
    case "Polygon": {
      if (!Array.isArray(coords) || coords.length === 0) bad("Polygon requires at least one ring");
      for (const ring of coords as unknown[]) {
        if (!Array.isArray(ring) || ring.length < 4) bad("Polygon ring must have at least 4 positions");
        for (const p of ring as unknown[]) if (!isValidPosition(p)) bad("Polygon ring coordinates must be positions");
        const first = (ring as unknown[])[0] as number[];
        const last = (ring as unknown[])[(ring as unknown[]).length - 1] as number[];
        if (first[0] !== last[0] || first[1] !== last[1]) bad("Polygon ring must be closed (first == last)");
      }
      break;
    }
    case "MultiPoint": {
      if (!Array.isArray(coords) || coords.length === 0) bad("MultiPoint requires at least one position");
      for (const p of coords as unknown[]) if (!isValidPosition(p)) bad("MultiPoint coordinates must be positions");
      break;
    }
    case "MultiLineString": {
      if (!Array.isArray(coords) || coords.length === 0) bad("MultiLineString requires at least one line");
      for (const line of coords as unknown[]) {
        if (!Array.isArray(line) || line.length < 2) bad("MultiLineString line requires at least 2 positions");
        for (const p of line as unknown[]) if (!isValidPosition(p)) bad("MultiLineString coordinates must be positions");
      }
      break;
    }
    case "MultiPolygon": {
      if (!Array.isArray(coords) || coords.length === 0) bad("MultiPolygon requires at least one polygon");
      for (const poly of coords as unknown[]) {
        if (!Array.isArray(poly) || poly.length === 0) bad("MultiPolygon polygon requires at least one ring");
        for (const ring of poly as unknown[]) {
          if (!Array.isArray(ring) || ring.length < 4) bad("MultiPolygon ring must have at least 4 positions");
          for (const p of ring as unknown[]) if (!isValidPosition(p)) bad("MultiPolygon ring coordinates must be positions");
          const first = (ring as unknown[])[0] as number[];
          const last = (ring as unknown[])[(ring as unknown[]).length - 1] as number[];
          if (first[0] !== last[0] || first[1] !== last[1]) bad("MultiPolygon ring must be closed");
        }
      }
      break;
    }
  }
}

/**
 * Parses Geometry payload: `"Type", <coordinates_json>`
 * Example: `"Point", [80.27, 13.08]`
 */
export function parseGeometry(payload: string): STFGeometry {
  const trimmed = payload.trim();
  if (trimmed.length === 0) bad("Geometry payload is empty");
  // First char must be a quote for the type string.
  const quote = trimmed.charCodeAt(0);
  if (quote !== 34 && quote !== 39) bad("Geometry payload must start with quoted type string");
  const q = String.fromCharCode(quote);
  let end = -1;
  for (let i = 1; i < trimmed.length; i++) {
    if (trimmed[i] === q && trimmed[i - 1] !== "\\") { end = i; break; }
  }
  if (end === -1) bad("Geometry type string is unterminated");
  const typeStr = JSON.parse(trimmed.slice(0, end + 1) as string) as string;
  const rest = trimmed.slice(end + 1).trim();
  if (!rest.startsWith(",")) bad("Geometry payload requires a comma after the type");
  const coordText = rest.slice(1).trim();
  if (coordText.length === 0) bad("Geometry payload missing coordinates");
  let coords: unknown;
  try {
    coords = JSON.parse(coordText);
  } catch {
    bad("Geometry coordinates are not valid JSON");
  }
  validateGeometry(typeStr, coords);
  return new STFGeometry(typeStr as STFGeometryType, coords);
}

export function parseTime(payload: string): STFTime {
  const trimmed = payload.trim();
  if (trimmed.length === 0) bad("Time payload is empty");
  let inner = trimmed;
  // Support both quoted "09:30" and bare 09:30
  if ((inner[0] === '"' && inner[inner.length - 1] === '"') || (inner[0] === "'" && inner[inner.length - 1] === "'")) {
    try { inner = JSON.parse(inner) as string; } catch { bad("Time payload string is not valid"); }
  } else if (inner[0] === '"' || inner[0] === "'") {
    bad("Time payload string is unterminated");
  }
  const m = inner.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?$/);
  if (!m) bad(`Time "${inner}" is not valid (expected HH:mm[:ss[.fraction]])`);
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] !== undefined ? Number(m[3]) : null;
  const fraction = m[4] ?? null;
  return new STFTime(hour, minute, second, fraction);
}

const DURATION_RE = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

export function parseDuration(payload: string): STFDuration {
  const trimmed = payload.trim();
  if (trimmed.length === 0) bad("Duration payload is empty");
  let inner = trimmed;
  if ((inner[0] === '"' && inner[inner.length - 1] === '"') || (inner[0] === "'" && inner[inner.length - 1] === "'")) {
    try { inner = JSON.parse(inner) as string; } catch { bad("Duration payload string is not valid"); }
  } else if (inner[0] === '"' || inner[0] === "'") {
    bad("Duration payload string is unterminated");
  }
  if (inner === "P" || inner === "PT") bad(`Duration "${inner}" must contain at least one component`);
  const m = inner.match(DURATION_RE);
  if (!m) bad(`Duration "${inner}" is not valid ISO-8601`);
  // Must have at least one numeric component
  if (!m.slice(1).some((v) => v !== undefined)) bad(`Duration "${inner}" must contain at least one component`);
  // If T is present but no time component follows, it's invalid (e.g. "P1DT")
  if (inner.includes("T") && !/[0-9][HMS]/.test(inner.split("T")[1] ?? "")) {
    // Allow date-only durations without T; if T present, require at least one H/M/S.
    // The regex already allows empty T section, so we enforce here.
    const afterT = inner.split("T")[1];
    if (afterT === "" ) bad(`Duration "${inner}" has empty time section after T`);
  }
  return new STFDuration(inner);
}

/** Encodes octets as canonical base64, for serialization (spec §13.7). */
export function binaryToBase64(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += 3) {
    const remaining = data.length - i;
    const b0 = data[i];
    const b1 = remaining > 1 ? data[i + 1] : 0;
    const b2 = remaining > 2 ? data[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += remaining > 1 ? B64[(n >> 6) & 63] : "=";
    out += remaining > 2 ? B64[n & 63] : "=";
  }
  return out;
}
