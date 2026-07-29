// What each target format cannot hold, computed from the document in the editor.
//
// This is the one screen the other formats cannot produce for themselves. A JSON schema tool
// tells you whether your JSON is valid JSON; nothing tells you which of *your* values stop
// being themselves when you write them as TOML. STF knows, because it has eleven kinds to lose
// and the other formats have six.
//
// Every verdict here is a claim about a real library at a pinned version, checked against that
// library rather than against its documentation. Where the two disagreed the library won, and
// the disagreements are recorded in comments — they are the findings most worth reading.

import { keysOf, kindOf, type STFKind, type STFObject, type STFValue } from "@open-tech-foundation/stf";

import type { FormatId } from "./formats.ts";

/** How a value fares in a target format.
 *
 * The distinction that matters is between losing a *value* and losing a *kind*. `19.99` written
 * to TOML comes back as `19.99` — nothing is lost. `DECIMAL(19.99)` written to TOML comes back
 * as the float `19.99`, which is a different STF value, because scale is data (spec §3.2). The
 * first is `ok`, the second is `degraded`, and only the reader can say whether that matters. */
export type Verdict = "ok" | "degraded" | "unrepresentable";

export interface Finding {
  /** Where the value is, as a path a reader can find in the editor: `regions[0]`, `db.port`. */
  path: string;
  kind: STFKind;
  verdict: Verdict;
  /** What happens to this value, in one sentence, in terms of this document. */
  note: string;
  /**
   * True when the format's usual writer produces *something* and reports no error — the value
   * is corrupted quietly rather than refused. These are the dangerous ones: a refusal is a
   * problem you fix, a silent corruption is a problem you ship.
   */
  silent: boolean;
}

export interface Report {
  format: FormatId;
  findings: Finding[];
  /** Values examined, the root object included — the denominator for "11 of 14 survive". */
  total: number;
  degraded: number;
  unrepresentable: number;
  /** True when nothing is lost and the document can be written to this format as-is. */
  clean: boolean;
}

/** The largest integer JavaScript — and so every JSON reader built on it — represents exactly. */
const MAX_SAFE = 9007199254740991n;

/** TOML integers are signed 64-bit (TOML 1.0.0 §Integer); outside that range is out of spec. */
const TOML_MIN = -(2n ** 63n);
const TOML_MAX = 2n ** 63n - 1n;

/**
 * The verdict for one value in one format.
 *
 * Written as a function rather than a table because the interesting answers depend on the value,
 * not just the kind: a `BigInt` is fine in JSON until it exceeds 2^53, and fine in TOML until it
 * exceeds 2^63. Computing it per value is what makes the report about the reader's document
 * instead of about the format in the abstract.
 */
function verdict(format: FormatId, kind: STFKind, value: STFValue): Omit<Finding, "path"> | null {
  const finding = (verdict: Verdict, note: string, silent = false): Omit<Finding, "path"> => ({
    kind,
    verdict,
    note,
    silent,
  });

  switch (kind) {
    case "Null":
      // TOML has no null of any kind. smol-toml does not refuse it: a null-valued key is simply
      // absent from the output, and `stringify({n: null})` returns "\n". A key that vanishes is
      // worse than an error, so this is reported as unrepresentable and flagged silent.
      if (format === "toml") {
        return finding(
          "unrepresentable",
          "TOML has no null. The key is dropped from the output entirely, with no error.",
          true,
        );
      }
      return null;

    case "Boolean":
    case "String":
    case "Array":
    case "Object":
      // Every target has these four. Object *keys* are a separate question, handled by the
      // structural checks below.
      return null;

    case "Number": {
      // STF Numbers exclude NaN and the infinities (spec §7.3), so the only Number that travels
      // badly is negative zero — which STF holds as distinct from `0` (spec §3.2).
      if (Object.is(value, -0)) {
        if (format === "yaml") return null; // js-yaml writes `-0.0`, which reads back as -0.
        return finding(
          "degraded",
          `Negative zero is a distinct STF Number, but ${LABEL[format]} writes it as \`0\`. It reads back as positive zero.`,
          true,
        );
      }
      return null;
    }

    case "BigInt": {
      const n = value as bigint;
      const magnitude = n < 0n ? -n : n;

      if (format === "toml") {
        // smol-toml writes arbitrary digits happily, but reading them back throws
        // "integer value cannot be represented losslessly" unless the reader opts into
        // `integersAsBigInt`. Beyond 2^63 the value is outside TOML itself, not just this library.
        if (n < TOML_MIN || n > TOML_MAX) {
          return finding(
            "unrepresentable",
            "TOML integers are signed 64-bit. This value is outside that range and no conformant reader will return it unchanged.",
          );
        }
        return finding(
          "degraded",
          "TOML has one integer type, so this reads back as an integer rather than a BigInt. Readers that decode into a double lose precision above 2^53.",
        );
      }

      if (format === "yaml") {
        // Verified: js-yaml v5 refuses to dump a JavaScript bigint outright —
        // "unacceptable kind of an object to dump [object BigInt]". The YAML *spec* permits
        // arbitrary-precision integers; this widely-used implementation will not write one.
        return finding(
          "unrepresentable",
          "YAML integers are arbitrary-precision on paper, but js-yaml cannot write a BigInt at all. The lossy policy writes it as a plain number.",
        );
      }

      // The JSON family. The grammar permits arbitrary digits, and RFC 8259 §6 warns that
      // interoperability depends on the reader — every reader built on a double stops at 2^53.
      //
      // This is `unrepresentable` even below 2^53, which is stricter than it may look. It is the
      // reference implementation's own stance: `toJSON` refuses every typed kind rather than
      // quietly handing back a Number, because the kind is part of the value. Losing BigInt-ness
      // is a loss even when every digit survives.
      if (magnitude > MAX_SAFE) {
        return finding(
          "unrepresentable",
          "This integer exceeds 2^53, so JSON loses the digits as well as the kind — a conformant reader returns a different number.",
        );
      }
      return finding(
        "unrepresentable",
        "The digits fit in a double, but JSON has no integer kind distinct from Number, so this cannot read back as a BigInt.",
      );
    }

    case "Decimal":
      // The strongest single argument on the page, and it holds against all six targets.
      // DECIMAL(1.5) and DECIMAL(1.50) are different STF values (spec §3.2); no target format
      // has an exact decimal, so both arrive as the same binary float.
      return finding(
        "unrepresentable",
        `${LABEL[format]} has no exact decimal. Scale is data in STF — DECIMAL(1.50) and DECIMAL(1.5) are different values, and both become the same binary float here.`,
      );

    case "Date":
      if (format === "toml") {
        // TOML is the one target with a first-class date. smol-toml reads `2026-01-15` back as a
        // TomlDate carrying no time, so the round-trip is genuinely clean.
        return null;
      }
      if (format === "yaml") {
        // `!!timestamp` is a YAML 1.1 tag. It is absent from the 1.2 core schema, and js-yaml's
        // default load schema rejects it — verified: a bare `2026-01-15` loads as a *string*
        // unless the reader opts into the timestamp tag.
        return finding(
          "degraded",
          "YAML 1.2's core schema has no timestamp — that tag is from 1.1. Readers that do resolve it return a datetime, so a date acquires a midnight time it never had.",
        );
      }
      return finding(
        "unrepresentable",
        "JSON has no temporal type. A date can only travel as a string, and nothing marks it as a date on the way back.",
      );

    case "Timestamp":
      if (format === "toml") return null; // TOML offset date-times carry the instant and its offset.
      if (format === "yaml") {
        return finding(
          "degraded",
          "YAML 1.2's core schema has no timestamp — that tag is from 1.1, and support varies by implementation. js-yaml's default loader returns a plain string.",
        );
      }
      return finding(
        "unrepresentable",
        "JSON has no temporal type. The instant can travel as an ISO string, but it reads back as a String.",
      );

    case "Binary":
      if (format === "yaml") {
        // Verified asymmetry, and a good one: js-yaml *writes* `!!binary` by default but its
        // default load schema *rejects* the tag it just wrote. The round-trip fails inside a
        // single library unless the reader opts in.
        return finding(
          "degraded",
          "YAML has !!binary, but it is a 1.1 tag: js-yaml writes it by default and then refuses to read it back without an extended schema.",
        );
      }
      if (format === "toml") {
        // smol-toml does not refuse a Uint8Array — it walks it as an object and emits a table of
        // numeric keys (`[u]` / `0 = 1` / `1 = 2`), silently and unrecoverably. The lossy policy
        // here writes base64 instead, which at least keeps the octets, but nothing in TOML marks
        // the result as bytes rather than text.
        return finding(
          "unrepresentable",
          "TOML has no byte string, and its usual writer turns the octets into a table of numeric keys without erroring. The lossy policy writes base64, which reads back as a String.",
          true,
        );
      }
      return finding(
        "unrepresentable",
        "JSON has no byte string. The octets can travel as base64, but they read back as a String with nothing marking them as bytes.",
      );
  }
}

const LABEL: Record<FormatId, string> = {
  json: "JSON",
  json5: "JSON5",
  jsonc: "JSONC",
  yaml: "YAML",
  toml: "TOML",
  ndjson: "NDJSON",
};

/** Renders a member access the way a reader would type it, so paths stay copy-pasteable. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;
function member(path: string, key: string): string {
  if (IDENTIFIER.test(key)) return path ? `${path}.${key}` : key;
  return `${path}[${JSON.stringify(key)}]`;
}

/**
 * Visits every value in the document, the root included, depth-first in authored order.
 *
 * The walk is over the parsed tree rather than the text, so a value is examined once no matter
 * how it was spelled, and `kindOf` decides what each node is — a Decimal is not two members of
 * an object just because it is an instance with fields.
 */
function walk(root: STFObject, visit: (value: STFValue, kind: STFKind, path: string) => void): void {
  const step = (value: STFValue, path: string): void => {
    const kind = kindOf(value);
    visit(value, kind, path);

    if (kind === "Array") {
      (value as STFValue[]).forEach((item, i) => step(item, `${path}[${i}]`));
    } else if (kind === "Object") {
      const object = value as STFObject;
      for (const key of keysOf(object)) step(object[key], member(path, key));
    }
  };
  step(root, "");
}

/** How many values of each kind the document holds — the document's own shape, before any target. */
export function kindCensus(root: STFObject): Map<STFKind, number> {
  const census = new Map<STFKind, number>();
  walk(root, (_value, kind) => census.set(kind, (census.get(kind) ?? 0) + 1));
  return census;
}

/**
 * Collects every value the target cannot hold as itself.
 *
 * Callers reading `total - findings.length` get the count that survives *intact* — values with no
 * finding at all, not merely those that avoid an outright refusal. A value that survives as the
 * wrong kind has not survived intact, and collapsing that distinction is exactly the flattery
 * this page exists to avoid.
 */
export function analyze(root: STFObject, format: FormatId): Report {
  const findings: Finding[] = [];
  let total = 0;

  walk(root, (value, kind, path) => {
    total += 1;
    const result = verdict(format, kind, value);
    if (result) findings.push({ path: path || "(root)", ...result });
  });

  const degraded = findings.filter((f) => f.verdict === "degraded").length;
  const unrepresentable = findings.filter((f) => f.verdict === "unrepresentable").length;
  return {
    format,
    findings,
    total,
    degraded,
    unrepresentable,
    clean: findings.length === 0,
  };
}

/** A one-line verdict for the format picker, so the cost of each target is visible before it is chosen. */
export function summarize(report: Report): string {
  if (report.clean) return `all ${report.total} values survive`;
  const parts: string[] = [];
  if (report.unrepresentable > 0) parts.push(`${report.unrepresentable} cannot be represented`);
  if (report.degraded > 0) parts.push(`${report.degraded} lose their kind`);
  return parts.join(", ");
}
