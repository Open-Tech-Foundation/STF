/**
 * JSON interchange.
 *
 * STF replaces JSON rather than extending it, so conversion is lossy in both directions and
 * this module fails loudly instead of guessing. Silently writing `DECIMAL(1.5)` as the string
 * `"1.5"` is the in-band sentinel spec §3.1 forbids.
 */

import { binaryToBase64, parseGeometry } from "./constructors.ts";
import { STFError } from "./errors.ts";
import { formatNumber } from "./serialize.ts";
import {
  keysOf,
  kindOf,
  makeObject,
  STFDate,
  STFDecimal,
  STFDuration,
  STFGeometry,
  STFTime,
  STFTimestamp,
  type STFObject,
  type STFValue,
} from "./value.ts";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function unrepresentable(detail: string): never {
  throw new STFError("ERR_UNREPRESENTABLE", detail);
}

const IDENTIFIER = /^[A-Za-z0-9_-]+$/;

/** Converts a JSON document to STF. The root must be a JSON object. */
export function fromJSON(json: Json, opts: { infer?: boolean } = {}): STFObject {
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    unrepresentable(
      `an STF document root must be an object, but this JSON root is ${jsonKind(json)}`,
    );
  }
  return convertFrom(json, "$", opts) as STFObject;
}

function jsonKind(json: Json): string {
  if (json === null) return "null";
  if (Array.isArray(json)) return "an array";
  switch (typeof json) {
    case "boolean": return "a boolean";
    case "number": return "a number";
    case "string": return "a string";
    default: return "an object";
  }
}

const GEO_TYPES = new Set(["Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon"]);

function isGeoJSONGeometry(obj: Record<string, Json>): boolean {
  if (typeof obj.type !== "string" || !GEO_TYPES.has(obj.type)) return false;
  if (!Array.isArray(obj.coordinates)) return false;
  return true;
}

function convertFrom(json: Json, path: string, opts: { infer?: boolean } = {}): STFValue {
  if (json === null) return null;
  if (typeof json === "boolean" || typeof json === "string") return json;
  if (typeof json === "number") {
    if (!Number.isFinite(json)) unrepresentable(`${path}: ${json} is not an STF Number`);
    return json;
  }
  if (Array.isArray(json)) return json.map((item, i) => convertFrom(item, `${path}[${i}]`, opts));

  const obj = json as Record<string, Json>;
  // Inference: GeoJSON geometry objects become STF Geometry (new.txt §11)
  if (opts.infer && isGeoJSONGeometry(obj) && Object.keys(obj).length === 2) {
    const type = obj.type as string;
    const coords = obj.coordinates as unknown;
    try {
      const payload = `"${type}", ${JSON.stringify(coords)}`;
      return parseGeometry(payload);
    } catch { /* fall through to plain object if validation fails */ }
  }

  const entries: Array<[string, STFValue]> = [];
  for (const key of Object.keys(json)) {
    if (key.length === 0) unrepresentable(`${path}: an STF key must not be empty`);
    if (!IDENTIFIER.test(key)) {
      unrepresentable(`${path}: key \`${key}\` is not a valid STF identifier ([A-Za-z0-9_-]+)`);
    }
    entries.push([key, convertFrom(json[key], `${path}.${key}`, opts)]);
  }
  return makeObject(entries);
}

/**
 * Parses JSON text and converts it, rejecting integers that `binary64` cannot hold exactly.
 *
 * `JSON.parse` silently rounds `9007199254740993` to `…992`, which would change the
 * document's meaning, so the raw text is checked first.
 */
export function fromJSONText(text: string): STFObject {
  const oversized = findOversizedInteger(text);
  if (oversized !== null) {
    unrepresentable(
      `integer ${oversized} is not exactly representable as binary64; ` +
        `write it as BIGINT(${oversized}) instead`,
    );
  }
  return fromJSON(JSON.parse(text) as Json);
}

/** Finds the first integer literal outside the exactly-representable range, if any. */
function findOversizedInteger(text: string): string | null {
  // Scan outside strings so a digit run inside a string value is never mistaken for a number.
  let inString = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 2;
      else {
        if (ch === '"') inString = false;
        i++;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      i++;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "-") i++;
      while (i < text.length && text[i] >= "0" && text[i] <= "9") i++;
      const isInteger = text[i] !== "." && text[i] !== "e" && text[i] !== "E";
      const literal = text.slice(start, i);
      if (isInteger && literal.length > 0) {
        const asBig = BigInt(literal);
        if (asBig > 9007199254740992n || asBig < -9007199254740992n) return literal;
      }
      continue;
    }
    i++;
  }
  return null;
}

/** How to handle STF kinds that JSON has no equivalent for. */
export type TypedValuePolicy = "reject" | "payload-as-string";

/** Converts an STF value to JSON. */
export function toJSON(value: STFValue, policy: TypedValuePolicy = "reject"): Json {
  return convertTo(value, "$", policy);
}

function convertTo(value: STFValue, path: string, policy: TypedValuePolicy): Json {
  const typed = (payload: string, what: string): Json => {
    if (policy === "payload-as-string") return payload;
    unrepresentable(
      `${path}: JSON has no ${what} type. Convert with the lossy policy to write the ` +
        `payload as a string, accepting that the type is lost.`,
    );
  };

  switch (kindOf(value)) {
    case "Null": return null;
    case "Boolean": return value as boolean;
    case "Number": return value as number;
    case "String": return value as string;
    case "Array":
      return (value as STFValue[]).map((item, i) => convertTo(item, `${path}[${i}]`, policy));
    case "Object": {
      const object = value as STFObject;
      const out: { [key: string]: Json } = {};
      for (const key of keysOf(object)) {
        out[key] = convertTo(object[key], `${path}.${key}`, policy);
      }
      return out;
    }
    case "BigInt": return typed((value as bigint).toString(), "arbitrary-precision integer");
    case "Decimal": return typed((value as STFDecimal).payload, "exact decimal");
    case "Date": return typed((value as STFDate).payload, "date");
    case "Timestamp": return typed((value as STFTimestamp).payload, "timestamp");
    case "Binary": return typed(binaryToBase64(value as Uint8Array), "binary");
    case "Geometry": {
      const g = value as STFGeometry;
      // GeoJSON-compatible output for interoperability (new.txt §7)
      return { type: g.type, coordinates: g.coordinates } as unknown as Json;
    }
    case "Time": return typed((value as STFTime).payload, "time");
    case "Duration": return typed((value as STFDuration).payload, "duration");
  }
}

/**
 * Encodes a value in the conformance corpus's **tagged JSON**, which is lossless where plain
 * JSON is not.
 *
 * `$` is safe as an escape key because it is not a legal STF key character (spec §6.1), so a
 * tag can never collide with a real parsed object.
 */
export function toTaggedJSON(value: STFValue): Json {
  const tag = (name: string, v: string): Json => ({ $: name, v });
  const tagGeo = (type: string, coords: unknown): Json => ({ $: "geo", v: JSON.stringify({ type, coordinates: coords }) });
  switch (kindOf(value)) {
    case "Null": return null;
    case "Boolean": return value as boolean;
    case "String": return value as string;
    case "Array": return (value as STFValue[]).map(toTaggedJSON);
    case "Object": {
      const object = value as STFObject;
      const out: { [key: string]: Json } = {};
      for (const key of keysOf(object)) out[key] = toTaggedJSON(object[key]);
      return out;
    }
    // Numbers are tagged with a string too: JSON numbers cannot express -0 and give no
    // binary64 round-trip guarantee, both of which §7.2 and §7.3 make observable.
    case "Number": return tag("num", formatNumber(value as number));
    case "BigInt": return tag("bigint", (value as bigint).toString());
    case "Decimal": return tag("dec", (value as STFDecimal).payload);
    case "Date": return tag("date", (value as STFDate).payload);
    case "Timestamp": return tag("ts", (value as STFTimestamp).payload);
    case "Binary": return tag("bin", binaryToBase64(value as Uint8Array));
    case "Geometry": {
      const g = value as STFGeometry;
      return tagGeo(g.type, g.coordinates);
    }
    case "Time": return tag("time", (value as STFTime).payload);
    case "Duration": return tag("dur", (value as STFDuration).payload);
  }
}
