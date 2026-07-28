// The playground's conversions, kept out of the component so they can be tested directly.
//
// Everything here runs the reference implementation. Nothing re-implements a rule, and no
// conversion guesses: where a target format cannot represent a value, the reference
// implementation raises `ERR_UNREPRESENTABLE` and that is what the reader sees.

import {
  CANONICAL,
  fromJSONText,
  parse,
  pretty,
  serialize,
  STFError,
  toJSON,
  toTaggedJSON,
  keysOf,
  kindOf,
  type STFObject,
  type STFValue,
} from "@open-tech-foundation/stf";

export type Target = "json" | "json-lossy" | "kinds" | "canonical" | "formatted";

export const TARGETS: { id: Target; label: string; note: string }[] = [
  { id: "json", label: "JSON", note: "Refuses values JSON cannot represent." },
  { id: "json-lossy", label: "JSON (lossy)", note: "Typed payloads become strings; the type is lost." },
  { id: "kinds", label: "Tagged kinds", note: "Each value's kind, as the conformance corpus writes it." },
  { id: "canonical", label: "Canonical form", note: "One byte encoding per value, for hashing." },
  { id: "formatted", label: "Formatted STF", note: "What `stf fmt` produces." },
];

export interface Diagnostic {
  code: string;
  message: string;
  line: number;
  column: number;
}

export interface Outcome {
  /** The converted text, or null when the input or the conversion was rejected. */
  output: string | null;
  /** Present when the *document* failed to parse — the editor marks it. */
  parseError: Diagnostic | null;
  /** Present when the document is valid but the target cannot represent it. */
  convertError: string | null;
  /** Number of values in the parsed document, for the status line. */
  valueCount: number;
}

/** Reads the message and position off a thrown error without assuming it is an STFError. */
function toDiagnostic(error: unknown): Diagnostic {
  const e = error as Partial<STFError> & { line?: number; column?: number; message?: string };
  return {
    code: e.code ?? "ERR_SYNTAX",
    message: e.message ?? String(error),
    line: e.line && e.line > 0 ? e.line : 1,
    column: e.column && e.column > 0 ? e.column : 1,
  };
}

/** An STFError's message already begins with its code, so it is not prefixed again. */
function describe(error: unknown): string {
  const message = (error as Error).message ?? String(error);
  const code = (error as Partial<STFError>).code;
  return code && !message.startsWith(code) ? `${code}: ${message}` : message;
}

/** Counts every value in the tree, the root included.
 *
 * An STF object is a plain object with its key order recorded on a symbol, and the typed
 * kinds (`STFDecimal`, `STFDate`, …) are class instances — so a plain object is a container to
 * walk only when `kindOf` says it is one. Asking the implementation is what keeps this from
 * mistaking a `Decimal` for a two-member object. */
function countValues(value: STFValue): number {
  const kind = kindOf(value);
  if (kind === "Array") return 1 + (value as STFValue[]).reduce<number>((n, v) => n + countValues(v), 0);
  if (kind === "Object") {
    const object = value as STFObject;
    return keysOf(object).reduce<number>((n, key) => n + countValues(object[key]), 1);
  }
  return 1;
}

/** The parse error for `source`, or null when it parses — what the editor's linter shows. */
export function parseError(source: string): { code: string; message: string; offset: number } | null {
  try {
    parse(source);
    return null;
  } catch (error) {
    const e = error as Partial<STFError>;
    return {
      code: e.code ?? "ERR_SYNTAX",
      message: (error as Error).message,
      // Offsets are UTF-16 code units, the same coordinates the editor uses. `-1` means the
      // error has no position, and the caller clamps it.
      offset: typeof e.offset === "number" ? e.offset : -1,
    };
  }
}

/** Parses `source` and renders it into `target`. */
export function convert(source: string, target: Target): Outcome {
  let root: STFObject;
  try {
    root = parse(source);
  } catch (error) {
    return { output: null, parseError: toDiagnostic(error), convertError: null, valueCount: 0 };
  }

  const valueCount = countValues(root);
  try {
    return { output: render(root, target), parseError: null, convertError: null, valueCount };
  } catch (error) {
    const e = error as Partial<STFError>;
    return {
      output: null,
      parseError: null,
      convertError: describe(error),
      valueCount,
    };
  }
}

function render(root: STFObject, target: Target): string {
  switch (target) {
    case "json":
      return JSON.stringify(toJSON(root), null, 2);
    case "json-lossy":
      return JSON.stringify(toJSON(root, "payload-as-string"), null, 2);
    case "kinds":
      return JSON.stringify(toTaggedJSON(root), null, 2);
    case "canonical":
      return serialize(root, CANONICAL);
    case "formatted":
      return serialize(root, pretty("  "));
  }
}

/** Converts JSON text into STF, refusing what STF cannot represent. */
export function jsonToStf(text: string): { output: string | null; error: string | null } {
  try {
    return { output: serialize(fromJSONText(text), pretty("  ")), error: null };
  } catch (error) {
    const e = error as Partial<STFError>;
    return { output: null, error: describe(error) };
  }
}

/** SHA-256 of the canonical bytes — what `stf canon | sha256sum` prints. */
export async function canonicalDigest(source: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(serialize(parse(source), CANONICAL));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export const SAMPLES: { label: string; source: string }[] = [
  {
    label: "Configuration",
    source: `# A configuration file
{
  service: \`checkout-api\`,
  port: 8080,
  enabled: T,
  deploy_after: TIMESTAMP(2026-01-15T10:30:00Z),
  price_cap: DECIMAL(199.00),   # scale is data
  account_id: BIGINT(9007199254740993),
  signing_key: BINARY(SGVsbG8=),
  regions: [\`eu-west-1\`, \`us-east-1\`],
}`,
  },
  {
    label: "Every kind",
    source: `{
  nothing: N,
  yes: T,
  no: F,
  number: 19.99,
  text: \`raw\`,
  escaped: "line\\nbreak",
  list: [1, 2, 3],
  nested: { a: 1 },
  big: BIGINT(9007199254740993),
  exact: DECIMAL(1.50),
  day: DATE(2026-01-15),
  instant: TIMESTAMP(2026-01-15T10:30:00+05:30),
  bytes: BINARY(SGVsbG8=),
}`,
  },
  {
    label: "Scale is data",
    source: `# DECIMAL(1.5) and DECIMAL(1.50) are different values.
# Convert to JSON and the conversion is refused, because JSON
# has no exact decimal to convert them into.
{
  half: DECIMAL(1.5),
  half_again: DECIMAL(1.50),
  price: DECIMAL(19.99),
}`,
  },
  {
    label: "A rejected document",
    source: `# Every rejection has exactly one documented code.
{
  hex: 0x10,
}`,
  },
];
