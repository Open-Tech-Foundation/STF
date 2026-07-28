/**
 * The STF Stream profile: line-delimited record streams (`.stfs`).
 *
 * The profile's central property is that a record can never contain a raw line terminator,
 * so the reader splits on `U+000A` *before* parsing anything.
 */

import { STFError } from "./errors.ts";
import { Parser, type Limits } from "./parser.ts";
import { serializeDocument, singleLine, type Format } from "./serialize.ts";
import type { STFDirective, STFObject } from "./value.ts";

export interface STFStream {
  directives: STFDirective[];
  records: STFObject[];
}

/** One item from {@link readStream}, tagged with its 1-based line number (stream §2.1). */
export interface STFRecord {
  line: number;
  value: STFObject | null;
  error: STFError | null;
}

interface Line {
  no: number;
  text: string;
  /** Whether a line terminator actually followed, which an open string reads differently. */
  terminated: boolean;
}

/** Splits on LF, discarding a single CR before each terminator (stream §2). */
function splitLines(input: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  let no = 1;
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) === 10) {
      let end = i;
      if (end > start && input.charCodeAt(end - 1) === 13) end--;
      out.push({ no, text: input.slice(start, end), terminated: true });
      no++;
      start = i + 1;
    }
  }
  if (start < input.length) out.push({ no, text: input.slice(start), terminated: false });
  return out;
}

/** A line holding only horizontal whitespace and/or a comment (stream §2). */
function isIgnorable(text: string): boolean {
  const trimmed = text.replace(/^[ \t]+|[ \t]+$/g, "");
  return trimmed.length === 0 || trimmed.startsWith("#");
}

/**
 * Reads a stream lazily, yielding one item per non-ignorable line whether or not it parsed.
 *
 * This is the continue-on-error policy; {@link parseStream} is the aborting one. Stream §5
 * requires implementations to offer both.
 */
export function* readStream(input: string, limits: Limits = {}): Generator<STFRecord> {
  if (input.charCodeAt(0) === 0xfeff) {
    yield {
      line: 1,
      value: null,
      error: new STFError("ERR_SYNTAX", "leading byte order mark", { offset: 0, line: 1, column: 1 }),
    };
    return;
  }

  const lines = splitLines(input);
  let index = 0;

  // The header, if present, is the first non-ignorable line and holds only directives.
  while (index < lines.length && isIgnorable(lines[index].text)) index++;
  if (index < lines.length && lines[index].text.trimStart().startsWith("@")) {
    const line = lines[index];
    index++;
    try {
      // Parsed in document mode, where directives are legal.
      new Parser(line.text, limits, { kind: "document" }).parseHeaderLine();
    } catch (e) {
      yield { line: line.no, value: null, error: e as STFError };
      return;
    }
  }

  for (; index < lines.length; index++) {
    const line = lines[index];
    if (isIgnorable(line.text)) continue;
    // Splitting only on LF leaves any interior CR in place; it is a raw line terminator
    // inside the record either way (stream §3.2).
    if (line.text.includes("\r")) {
      yield {
        line: line.no,
        value: null,
        error: new STFError(
          "ERR_STREAM_RAW_NEWLINE",
          "a stream record must not contain a raw carriage return",
          { offset: 0, line: line.no, column: 1 },
        ),
      };
      continue;
    }
    try {
      const parser = new Parser(line.text, limits, {
        kind: "record",
        newlineFollows: line.terminated,
      });
      yield { line: line.no, value: parser.parseRecord(), error: null };
    } catch (e) {
      yield { line: line.no, value: null, error: e as STFError };
    }
  }
}

/** The header directives of a stream, which apply to every record (stream §4). */
export function streamDirectives(input: string, limits: Limits = {}): STFDirective[] {
  if (input.charCodeAt(0) === 0xfeff) return [];
  const lines = splitLines(input);
  let index = 0;
  while (index < lines.length && isIgnorable(lines[index].text)) index++;
  if (index >= lines.length || !lines[index].text.trimStart().startsWith("@")) return [];
  return new Parser(lines[index].text, limits, { kind: "document" }).parseHeaderLine();
}

/**
 * Reads a whole stream, aborting at the first malformed record — the default policy stream §5
 * requires.
 */
export function parseStream(input: string, limits: Limits = {}): STFStream {
  const records: STFObject[] = [];
  for (const record of readStream(input, limits)) {
    if (record.error) throw record.error;
    records.push(record.value!);
  }
  return { directives: streamDirectives(input, limits), records };
}

/**
 * Writes a stream: an optional header line, then one record per line.
 *
 * Stream §3.2 requires a string containing a line terminator to be escaped automatically
 * rather than to fail, which the interpreted form already does.
 */
export function serializeStream(stream: STFStream, format: Format): string {
  // A record must occupy exactly one line, so an indented format is not expressible.
  const recordFormat = singleLine(format);
  let out = "";
  if (stream.directives.length > 0) {
    const header = serializeDocument({ directives: stream.directives, root: {} }, recordFormat);
    // serializeDocument appends the (empty) root object; a header line carries no object.
    out += header.replace(/\{\}$/, "").replace(/\n/g, " ").trimEnd() + "\n";
  }
  for (const record of stream.records) {
    const line = serializeDocument({ directives: [], root: record }, recordFormat);
    if (line.includes("\n") || line.includes("\r")) {
      throw new STFError(
        "ERR_STREAM_RAW_NEWLINE",
        "a serialized record must not contain a raw line terminator",
      );
    }
    out += line + "\n";
  }
  return out;
}
