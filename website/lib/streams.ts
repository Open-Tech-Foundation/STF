// Stream (`.stfs`) mode: one record per line, each parsed independently.
//
// The property worth showing is that a stream does not fail as a unit. A malformed line is a
// malformed *line* — the records around it still parse, still have positions, and are still
// usable. That is what makes the format viable for logs and for append-only files, and it is the
// same guarantee NDJSON offers, which is why NDJSON conversion reads from here.
//
// The reference implementation's `readStream` already yields exactly this, tagged with line
// numbers, so this module presents that result rather than re-deriving it.

import {
  readStream,
  serialize,
  singleLine,
  streamDirectives,
  toJSON,
  COMPACT,
  type STFDirective,
  type STFObject,
} from "@open-tech-foundation/stf";

export interface RecordResult {
  /** 1-based line number, as the reader sees it in the editor. */
  line: number;
  value: STFObject | null;
  /** The record re-serialized on one line, for display; null when the record failed. */
  text: string | null;
  error: { code: string; message: string } | null;
}

export interface StreamResult {
  directives: STFDirective[];
  records: RecordResult[];
  ok: number;
  failed: number;
}

/** Reads `input` as a stream, keeping per-record diagnostics instead of failing at the first one. */
export function readRecords(input: string): StreamResult {
  const records: RecordResult[] = [];

  for (const record of readStream(input)) {
    if (record.error) {
      const error = record.error as { code?: string; message: string };
      records.push({
        line: record.line,
        value: null,
        text: null,
        error: { code: error.code ?? "ERR_SYNTAX", message: error.message },
      });
      continue;
    }
    records.push({
      line: record.line,
      value: record.value,
      text: serialize(record.value!, singleLine(COMPACT)),
      error: null,
    });
  }

  let directives: STFDirective[] = [];
  try {
    directives = streamDirectives(input);
  } catch {
    // A malformed header is already reported as a failed record by readStream; surfacing the
    // same error twice would only make the diagnostics list misleading.
  }

  return {
    directives,
    records,
    ok: records.filter((r) => r.error === null).length,
    failed: records.filter((r) => r.error !== null).length,
  };
}

/**
 * Writes the readable records as NDJSON under the *continue* policy.
 *
 * Whether to continue past a bad record or abort is caller policy, not a format rule, and
 * stream §5 requires readers to offer both while defaulting to **abort** so that corruption is
 * not silently skipped. This picks continue deliberately, because recovering the good records is
 * the property being demonstrated — and returns the skipped count so the UI states the cost
 * rather than quietly producing a shorter file.
 */
export function toNDJSON(result: StreamResult): { text: string; skipped: number } {
  const lines: string[] = [];
  for (const record of result.records) {
    if (record.error || !record.value) continue;
    lines.push(JSON.stringify(toJSON(record.value, "payload-as-string")));
  }
  return { text: lines.join("\n"), skipped: result.failed };
}

export const STREAM_SAMPLE = `@version(1.0)
{event: \`login\`, user: 41, at: TIMESTAMP(2026-01-15T10:30:00Z)}
{event: \`purchase\`, user: 41, total: DECIMAL(19.99)}
{event: \`logout\`, user: 41, at: TIMESTAMP(2026-01-15T11:02:13Z)}
{event: \`login\`, user: 0x2A}
{event: \`login\`, user: 42, at: TIMESTAMP(2026-01-15T11:40:00Z)}`;
