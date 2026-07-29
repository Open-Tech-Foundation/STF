// Conversion between STF and the six formats a visitor is most likely to be migrating from.
//
// Two rules hold throughout:
//
//   1. STF → X refuses by default. A conversion that cannot round-trip is a decision, so the
//      reader makes it: the strict policy reports what is in the way, and the lossy policy
//      writes it anyway with the loss spelled out. This mirrors `stf convert`.
//   2. X → STF never invents a kind. JSON has no dates, so a JSON string that looks like a date
//      becomes an STF String, not a Timestamp. Guessing here would be the one thing STF exists
//      to stop.
//
// Where a library corrupts a value silently rather than refusing it — and two of them do — the
// projection below refuses on the library's behalf. See lossiness.ts for the specifics.

import {
  binaryToBase64,
  fromJSON,
  keysOf,
  kindOf,
  parseDate,
  parseTimestamp,
  pretty,
  serialize,
  type STFDate,
  type STFDecimal,
  type STFObject,
  type STFTimestamp,
  type STFValue,
  toJSON,
} from "@open-tech-foundation/stf";
import { CORE_SCHEMA, binaryTag, dump, load, timestampTag } from "js-yaml";
import { parse as tomlParse, stringify as tomlStringify, TomlDate } from "smol-toml";
import JSON5 from "json5";

import { analyze } from "./lossiness.ts";

export type FormatId = "json" | "json5" | "jsonc" | "yaml" | "toml" | "ndjson";

/** Strict refuses anything that cannot read back as the same STF value; lossy writes it anyway. */
export type Policy = "strict" | "lossy";

export interface FormatSpec {
  id: FormatId;
  label: string;
  extension: string;
  /** What this format buys and what it costs, in one line, for the picker. */
  note: string;
}

export const FORMATS: FormatSpec[] = [
  {
    id: "json",
    label: "JSON",
    extension: ".json",
    note: "Six kinds. None of STF's five constructors survive.",
  },
  {
    id: "json5",
    label: "JSON5",
    extension: ".json5",
    note: "Comments and unquoted keys — but JSON's data model, unchanged.",
  },
  {
    id: "jsonc",
    label: "JSONC",
    extension: ".jsonc",
    note: "JSON with comments. The same six kinds.",
  },
  {
    id: "yaml",
    label: "YAML",
    extension: ".yaml",
    note: "Binary and timestamps exist as 1.1 tags, and support varies.",
  },
  {
    id: "toml",
    label: "TOML",
    extension: ".toml",
    note: "First-class dates and times, but no null and no binary.",
  },
  {
    id: "ndjson",
    label: "NDJSON",
    extension: ".ndjson",
    note: "One JSON value per line. JSON's data model, once per record.",
  },
];

/**
 * The YAML schema used for reading.
 *
 * js-yaml's default is the YAML 1.2 core schema, which has neither `!!binary` nor `!!timestamp`.
 * That produces a genuine asymmetry inside one library: `dump` writes `!!binary` by default and
 * the default `load` then rejects the tag it just wrote. Reading with both tags registered is the
 * charitable choice — it lets YAML do as well as YAML can, so the lossiness report is not
 * measuring a library's default settings and calling it a property of the format.
 */
const YAML_READ_SCHEMA = CORE_SCHEMA.withTags(binaryTag, timestampTag);

export class ConversionRefused extends Error {
  readonly findings: string[];
  constructor(message: string, findings: string[]) {
    super(message);
    this.name = "ConversionRefused";
    this.findings = findings;
  }
}

// ---------------------------------------------------------------------------------------------
// STF → X
// ---------------------------------------------------------------------------------------------

/**
 * Projects an STF value into the host representation a given writer expects.
 *
 * Only reached in lossy mode, or for values the format genuinely holds. The `format` argument
 * decides how a typed kind degrades — a Timestamp is a real `Date` for TOML and YAML, and an ISO
 * string for the JSON family — so each writer gets the best representation it can actually store.
 */
function project(value: STFValue, format: FormatId): unknown {
  switch (kindOf(value)) {
    case "Null":
      return null;
    case "Boolean":
    case "Number":
    case "String":
      return value;
    case "Array":
      return (value as STFValue[]).map((item) => project(item, format));
    case "Object": {
      const object = value as STFObject;
      const out: Record<string, unknown> = {};
      for (const key of keysOf(object)) {
        // TOML has no null, and smol-toml expresses that by omitting the key with no error at
        // all. Dropping it here instead makes the behaviour ours and deliberate rather than a
        // library detail that could change underneath us — the lossiness report names every key
        // this removes.
        if (format === "toml" && object[key] === null) continue;
        out[key] = project(object[key], format);
      }
      return out;
    }
    case "BigInt": {
      const n = value as bigint;
      // smol-toml writes a bigint as digits; js-yaml throws on one, and JSON.stringify does too.
      if (format === "toml") return n;
      return Number(n);
    }
    case "Decimal":
      // No target has an exact decimal. A float would silently discard the scale that makes
      // DECIMAL(1.50) distinct, so the payload travels verbatim as a string and stays readable.
      return (value as STFDecimal).payload;
    case "Date": {
      const payload = (value as STFDate).payload;
      if (format === "toml") return new TomlDate(payload);
      if (format === "yaml") return new Date(`${payload}T00:00:00Z`);
      return payload;
    }
    case "Timestamp": {
      const payload = (value as STFTimestamp).payload;
      if (format === "toml") return new TomlDate(payload);
      if (format === "yaml") return new Date(payload);
      return payload;
    }
    case "Binary": {
      const bytes = value as Uint8Array;
      if (format === "yaml") return bytes; // js-yaml writes `!!binary`.
      return binaryToBase64(bytes);
    }
  }
}

/** Writes the document as `format`, refusing under the strict policy what cannot round-trip. */
export function write(root: STFObject, format: FormatId, policy: Policy): string {
  if (policy === "strict") {
    const report = analyze(root, format);
    const blocking = report.findings.filter((f) => f.verdict === "unrepresentable");
    if (blocking.length > 0) {
      throw new ConversionRefused(
        `${blocking.length} value${blocking.length === 1 ? "" : "s"} cannot be represented in ${
          FORMATS.find((f) => f.id === format)!.label
        }.`,
        blocking.map((f) => `${f.path} — ${f.note}`),
      );
    }
  }

  switch (format) {
    case "json":
      // The reference implementation's own conversion, refusals included, rather than a
      // reimplementation of it.
      return JSON.stringify(toJSON(root, policy === "strict" ? "reject" : "payload-as-string"), null, 2);

    case "jsonc":
      // Byte-for-byte JSON, and deliberately so. JSONC permits comments, it does not require
      // them, and STF comments are not data — the parser discards them, so there is nothing to
      // carry across. Emitting a synthetic banner here would only inflate the size comparison
      // with bytes this conversion invented.
      return JSON.stringify(toJSON(root, policy === "strict" ? "reject" : "payload-as-string"), null, 2);

    case "json5":
      // JSON5 buys syntax, not kinds: its data model is JSON's. Going through the reference
      // implementation's JSON conversion — rather than projecting separately — is what keeps the
      // family consistent, and it stops a BigInt being quietly rounded to a double on the way out
      // when JSON's own lossy policy would have preserved every digit as text.
      return JSON5.stringify(toJSON(root, policy === "strict" ? "reject" : "payload-as-string"), null, 2);

    case "yaml":
      return dump(project(root, "yaml"), { schema: YAML_READ_SCHEMA, noRefs: true, lineWidth: 100 });

    case "toml":
      return tomlStringify(project(root, "toml") as Record<string, unknown>);

    case "ndjson": {
      // A document is one record; a document whose root holds a single array is that array's
      // members, one per line, which is what a reader converting a JSON array to NDJSON expects.
      const projected = toJSON(root, policy === "strict" ? "reject" : "payload-as-string") as Record<
        string,
        unknown
      >;
      const keys = Object.keys(projected);
      const only = keys.length === 1 ? projected[keys[0]] : undefined;
      const records = Array.isArray(only) ? only : [projected];
      return records.map((record) => JSON.stringify(record)).join("\n");
    }
  }
}

// ---------------------------------------------------------------------------------------------
// X → STF
// ---------------------------------------------------------------------------------------------

/**
 * Lifts a host value parsed from another format into STF.
 *
 * Deliberately conservative: only kinds the source format actually distinguishes become typed STF
 * values. A `Date` object from TOML or YAML is a real temporal value in the source, so it becomes
 * a Date or Timestamp; a *string* that happens to look like a date stays a String, because in the
 * source it was one. Sniffing strings here would manufacture types the input never carried.
 */
function lift(value: unknown): STFValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "bigint") {
    // TOML has a single integer type, and it has to be read as a bigint to survive values above
    // 2^53 (see `read`). Handing every `port = 8080` back as `BIGINT(8080)` would be a poor
    // reading of the source, so the narrowest STF kind that holds the value exactly wins: a
    // Number when the integer is exact as a double, a BigInt only when it genuinely needs one.
    return value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      // JSON5 and YAML both admit these; STF has neither (spec §7.3).
      throw new Error(
        `${value} is not an STF Number — NaN and the infinities are not in the data model (spec §7.3).`,
      );
    }
    return value;
  }
  if (value instanceof Uint8Array) return value;
  if (value instanceof TomlDate) {
    // TOML distinguishes a local date from an offset date-time, and so does STF. `toISOString`
    // already narrows to `YYYY-MM-DD` for a date-only value, so the two cases stay apart.
    // The reference implementation's own payload parsers do the lifting, so an input TOML
    // accepts but STF does not is rejected here rather than constructed into an invalid value.
    return value.isDate() ? parseDate(value.toISOString()) : parseTimestamp(value.toISOString());
  }
  if (value instanceof Date) return parseTimestamp(value.toISOString());
  if (Array.isArray(value)) return value.map(lift);
  if (typeof value === "object") {
    const out: STFObject = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = lift(item);
    return out;
  }
  throw new Error(`${typeof value} has no STF equivalent.`);
}

function asRoot(value: STFValue): STFObject {
  if (kindOf(value) !== "Object") {
    // An STF document's root is always an object (spec §5), so a bare array or scalar has to be
    // named. Wrapping silently would hide that the shape changed.
    throw new Error(
      "An STF document's root must be an object (spec §5). Wrap this value in a key before converting.",
    );
  }
  return value as STFObject;
}

/** Reads `text` as `format` and returns it as an STF document. */
export function read(text: string, format: FormatId): string {
  switch (format) {
    case "json":
      // The reference implementation's JSON reader, so the rules are its rules.
      return serialize(fromJSON(JSON.parse(text)), pretty("  "));

    case "jsonc":
    case "json5":
      // JSON5's parser accepts JSONC too: comments, trailing commas and unquoted keys are all
      // within JSON5, so one parser covers both without stripping comments by hand.
      return serialize(asRoot(lift(JSON5.parse(text))), pretty("  "));

    case "yaml":
      return serialize(asRoot(lift(load(text, { schema: YAML_READ_SCHEMA }))), pretty("  "));

    case "toml":
      // Without `integersAsBigInt` smol-toml throws on any integer above 2^53 rather than
      // rounding it. Opting in is what lets a large TOML integer arrive as an STF BigInt.
      return serialize(asRoot(lift(tomlParse(text, { integersAsBigInt: true }))), pretty("  "));

    case "ndjson": {
      const lines = text.split("\n").filter((line) => line.trim() !== "");
      const records = lines.map((line, i) => {
        try {
          return lift(JSON.parse(line));
        } catch (error) {
          throw new Error(`line ${i + 1}: ${(error as Error).message}`);
        }
      });
      return serialize({ records } as STFObject, pretty("  "));
    }
  }
}
