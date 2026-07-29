// How large the same document is in each format, raw and gzipped.
//
// Raw size is an honest headline because it is a property of the format: STF drops the quotes
// around keys and spells the literals `T`, `F` and `N`, so it is smaller before anything is
// compressed. Gzipped size is what actually crosses a wire, and it is the number that tests
// whether the raw advantage means anything — a format's redundancy is exactly what gzip is good
// at removing, so a raw win can shrink to nothing after compression.
//
// Both are measured rather than asserted. Whatever the gzip column says, it says on the reader's
// own document, and if the advantage mostly vanishes there then that is the true answer and
// worth more than the headline.

import { CANONICAL, COMPACT, serialize, type STFObject } from "@open-tech-foundation/stf";

import { FORMATS, write, type FormatId } from "./formats.ts";

export interface Measurement {
  label: string;
  /** UTF-8 bytes, which is what a file on disk and a body on a wire both cost. */
  bytes: number;
  /** Bytes after gzip, or null where the browser has no CompressionStream. */
  gzipped: number | null;
  /** Percent smaller than the JSON baseline; negative means larger. Null for JSON itself. */
  versusJson: number | null;
  versusJsonGzipped: number | null;
  /** Set when this format cannot hold the document, in place of a size. */
  refused: string | null;
}

const encoder = new TextEncoder();

/** Gzips with the platform's own compressor; null when the browser does not provide one. */
async function gzip(text: string): Promise<number | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).arrayBuffer();
  return compressed.byteLength;
}

/**
 * Measures the document in STF and in every target format.
 *
 * Formats that refuse the document are reported as refusals rather than omitted: a format being
 * unable to hold the data at all is more informative than its hypothetical size, and silently
 * dropping the row would flatter whichever formats remain.
 *
 * The lossy policy is used for sizing so that every format that *can* produce bytes does, which
 * keeps the comparison about encoding overhead rather than about which formats refused.
 */
export async function measure(source: string, root: STFObject): Promise<Measurement[]> {
  const candidates: { label: string; text: string | null; error: string | null }[] = [
    { label: "STF (as written)", text: source, error: null },
    { label: "STF (compact)", text: serialize(root, COMPACT), error: null },
    { label: "STF (canonical)", text: serialize(root, CANONICAL), error: null },
  ];

  for (const format of FORMATS) {
    try {
      candidates.push({ label: format.label, text: write(root, format.id, "lossy"), error: null });
    } catch (error) {
      candidates.push({ label: format.label, text: null, error: (error as Error).message });
    }
  }

  const measured = await Promise.all(
    candidates.map(async ({ label, text, error }) => ({
      label,
      bytes: text === null ? 0 : encoder.encode(text).byteLength,
      gzipped: text === null ? null : await gzip(text),
      refused: error,
      versusJson: null as number | null,
      versusJsonGzipped: null as number | null,
    })),
  );

  // JSON is the baseline because it is what a reader is almost certainly coming from.
  const baseline = measured.find((m) => m.label === "JSON" && m.refused === null);
  if (baseline && baseline.bytes > 0) {
    for (const row of measured) {
      if (row.refused !== null || row.label === "JSON") continue;
      row.versusJson = ((baseline.bytes - row.bytes) / baseline.bytes) * 100;
      if (row.gzipped !== null && baseline.gzipped !== null && baseline.gzipped > 0) {
        row.versusJsonGzipped = ((baseline.gzipped - row.gzipped) / baseline.gzipped) * 100;
      }
    }
  }

  return measured;
}

/** `1,234 B` / `12.3 KB` — thousands separated, because these numbers get compared by eye. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** A signed percentage, where positive means smaller than JSON. */
export function formatDelta(percent: number | null): string {
  if (percent === null) return "—";
  const rounded = Math.abs(percent) < 0.05 ? 0 : percent;
  if (rounded === 0) return "same";
  return rounded > 0 ? `${rounded.toFixed(1)}% smaller` : `${Math.abs(rounded).toFixed(1)}% larger`;
}

/** The same measure split into figure and unit, for a card that sets the number and its unit apart. */
export function bytesParts(bytes: number): { figure: string; unit: string } {
  if (bytes < 1024) return { figure: bytes.toLocaleString(), unit: "bytes" };
  return { figure: (bytes / 1024).toFixed(1), unit: "KB" };
}
