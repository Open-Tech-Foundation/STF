// The landing page for a specification, not a product page.
//
// Structure follows the org's other sites (tsr.opentechf.org, esrun.opentechf.org): a hero
// grid with copy beside a code panel, a "why" card grid, a comparison table with a legend,
// and a two-column split for the configuration example. Detail belongs in /docs.

import { RawHtml } from "@opentf/web";

import { highlightToHtml, type TokenKind } from "../lib/highlight.ts";

export default function Home() {
  return (
    <main class="landing">
      <section class="hero">
        <div class="container hero-grid">
          <div>
            <span class="eyebrow">
              <span class="dot" aria-hidden="true" />
              STF 1.0 · draft specification
            </span>
            <h1 class="title">
              A structured text format for <span class="grad">configuration and data</span>.
            </h1>
            <p class="lede">
              Every value carries its own type: dates, timestamps, decimals, big integers, and
              binary are part of the grammar.
            </p>
            <div class="cta-row">
              <a href="/docs" class="btn btn-primary">
                Read the specification
              </a>
              <a href="/playground" class="btn btn-ghost">
                Playground
              </a>
            </div>
          </div>

          <StfCode name="config.stf" source={SAMPLE} />
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2>Why STF</h2>
          <p class="sub">A format a reader can trust without a schema beside it.</p>
          <div class="grid">
            {REASONS.map((reason) => (
              <div class="card">
                <div class="ico" aria-hidden="true">
                  {reason.icon}
                </div>
                <h3>{reason.title}</h3>
                <p>{reason.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <h2>How it compares</h2>
          <p class="sub">
            What each specification requires, including the row STF loses.
          </p>
          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  {FORMATS.map((format) => (
                    <th scope="col">{format}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr>
                    <th scope="row">{row.capability}</th>
                    {row.cells.map((cell) => (
                      <td>
                        <span
                          class={`cmp-${cell}`}
                          title={MARKS[cell].label}
                          aria-label={MARKS[cell].label}
                        >
                          {MARKS[cell].glyph}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="cmp-legend-row">
            <div class="cmp-legend">
              <span>✅ yes</span>
              <span>🟡 varies, or holds with a caveat</span>
              <span>❌ no</span>
            </div>
            {/* Naming the bias rather than hoping it goes unnoticed. The last two rows are
              * criteria STF chose for itself, and a reader who spots that unaided discounts the
              * whole table; a reader who is told it up front can weigh those rows and keep the
              * rest. Throughput is missing because a tick cannot carry it — so it is linked
              * rather than silently dropped, since it is the other axis where Ion wins. */}
            <p class="cmp-caveat">
              The last two rows are criteria STF set for itself, so every other format scores ❌ or
              🟡 by construction — weigh them accordingly. Ion beats STF on payload size and parse
              throughput, which no column of ticks can show;{" "}
              <a href="https://github.com/Open-Tech-Foundation/STF/blob/main/doc/comparison.md">
                comparison.md
              </a>{" "}
              gives the long form, and{" "}
              <a href="https://github.com/Open-Tech-Foundation/STF/blob/main/benchmarks/RESULTS.md">
                the benchmarks
              </a>{" "}
              give the numbers.
            </p>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container two-col">
          <div class="split-copy">
            <h2>One specification, no dialects</h2>
            <p class="sub">
              Every rule below is normative, so two conformant parsers cannot disagree about a
              document.
            </p>
            <ul>
              {NORMATIVE.map((item) => (
                <li>
                  <code>{item.ref}</code> — {item.body}
                </li>
              ))}
            </ul>
            <div class="cta-row">
              <a href="/docs" class="btn btn-ghost">
                Specification
              </a>
            </div>
          </div>

          <StfCode name="events.stfs" source={STREAM} />
        </div>
      </section>

    </main>
  );
}

// The docs theme highlights fenced Markdown at build time with syntect, which never sees a
// runtime string and does not know STF — so, as tsr does for its tasks.toml, the panel emits
// its own token spans.
const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "cm",
  directive: "dir",
  key: "k",
  string: "s",
  constructor: "ctor",
  payload: "pl",
  number: "n",
  literal: "t",
  punct: "pn",
  plain: "",
};

function StfCode(props: { name: string; source: string }) {
  return (
    <div class="codeblock">
      <div class="codeblock-bar">
        <span class="codeblock-name">{props.name}</span>
      </div>
      <pre>
        <RawHtml html={highlightToHtml(props.source, TOKEN_CLASS)} />
      </pre>
    </div>
  );
}

const SAMPLE = `# comments are part of the format
{
  service: \`checkout-api\`,
  port: 8080,
  enabled: T,
  deploy_after: TIMESTAMP(2026-01-15T10:30:00Z),
  price_cap: DECIMAL(199.00),   # scale is data
  account_id: BIGINT(9007199254740993),
  signing_key: BINARY(SGVsbG8=),
  regions: [\`eu-west-1\`, \`us-east-1\`],
}`;

// Kept narrow so the panel never clips at the hero's column width.
const STREAM = `@version(1.0)
{at: TIMESTAMP(2026-01-15T10:30:00Z), level: \`warn\`}
{at: TIMESTAMP(2026-01-15T10:30:04Z), level: \`info\`}`;

// A glyph on its own is not an answer to a screen reader, hence the label.
const MARKS: Record<string, { glyph: string; label: string }> = {
  y: { glyph: "✅", label: "yes" },
  p: { glyph: "🟡", label: "varies by implementation" },
  n: { glyph: "❌", label: "no" },
};

const FORMATS = ["STF", "JSON", "JSON5", "YAML", "TOML", "Ion"];

const REASONS = [
  {
    icon: "🏷️",
    title: "Types in the syntax",
    body: "DATE, TIMESTAMP, DECIMAL, BIGINT, and BINARY are grammar, so a reader never infers a type from a key name.",
  },
  {
    icon: "🎯",
    title: "Exact decimals",
    body: "DECIMAL(1.5) and DECIMAL(1.50) are different values. Scale survives the round trip, so money is representable.",
  },
  {
    icon: "🧱",
    title: "Strict by design",
    body: "Every rejection maps to exactly one documented code, and a conversion that would lose a type fails instead.",
  },
  {
    icon: "🔏",
    title: "Canonical form",
    body: "One byte encoding per value, so a document can be hashed, signed, and diffed byte-for-byte.",
  },
  {
    icon: "🧾",
    title: "Record streams",
    body: "A .stfs file is one document per line, and a malformed record never invalidates the rest of the stream.",
  },
  {
    icon: "🛠️",
    title: "Editor and CLI",
    body: "stf check, fmt, lint, canon, and convert, plus a language server that reports the same codes as CI.",
  },
];

const NORMATIVE = [
  { ref: "§3", body: "eleven value kinds, defined independently of any host language." },
  { ref: "§13", body: "parse(serialize(v)) ≡ v, and no constructor inferred from string content." },
  { ref: "§14", body: "canonical form: one byte encoding per value." },
  { ref: "§15", body: "a mandatory nesting depth limit, defaulting to 64." },
  { ref: "codes", body: "one documented code per rejection; message text is not normative." },
];

const COMPARISON = [
  { capability: "Dates and timestamps as a distinct type", cells: ["y", "n", "n", "p", "y", "y"] },
  { capability: "Exact decimals, scale preserved", cells: ["y", "n", "n", "n", "n", "y"] },
  { capability: "Integers beyond 2⁵³ without loss", cells: ["y", "n", "n", "p", "p", "y"] },
  { capability: "Binary data as a distinct type", cells: ["y", "n", "n", "p", "n", "y"] },
  { capability: "Comments", cells: ["y", "n", "y", "y", "y", "y"] },
  { capability: "Duplicate keys rejected", cells: ["y", "n", "n", "p", "y", "n"] },
  // YAML has had document streams since 1.1 (`---`) and Ion is defined as a value stream, so this
  // row is not a win for STF and is not written as one. It was first written as "record streams in
  // the same specification", which was worse than useless: STF Stream is a sibling document to the
  // core spec, exactly as Ion Hash is to Ion's — so the qualifier that was about to deny Ion its
  // canonical form was one STF could not satisfy either. The qualifier is gone from both rows.
  { capability: "Record streams", cells: ["y", "n", "n", "y", "n", "y"] },
  // The property NDJSON relies on without ever stating. STF Stream §3.2 forbids a raw line
  // terminator anywhere inside a record, so splitting on U+000A before parsing is guaranteed
  // correct rather than conventional. JSON gets a "varies": it happens to hold, because RFC 8259
  // forbids raw control characters in strings, but NDJSON, JSON Lines and RFC 7464 are three
  // separate documents that disagree about framing. JSON5 loses it outright — a string may span
  // lines by escaping the newline, so the newline itself is raw in the source. TOML's multi-line
  // strings do the same, YAML's structure is the indentation, and Ion text is not line-delimited.
  { capability: "Splittable on newlines before parsing", cells: ["y", "p", "n", "n", "n", "n"] },
  // The row STF loses, and it sits with the others rather than at the end. A table whose every row
  // resolves in favour of the format that published it is read as advertising no matter how well
  // each row is sourced, and comparison.md §2.5 already concedes this one in prose — filtering it
  // out of the summary is how a fair document becomes an unfair one.
  { capability: "Compact binary encoding", cells: ["n", "n", "n", "n", "n", "y"] },
  { capability: "One documented code per rejection", cells: ["y", "n", "n", "n", "n", "n"] },
  // Ion is "varies", not "no". Ion Hash defines a canonicalization over the Ion data model with a
  // stated equivalence relation, so the capability exists — but as an algorithm for feeding a hash
  // function, in a sibling specification, rather than as a byte form you can write out and store.
  // STF §14 emits a canonical document that is itself valid STF. A flat ❌ here would be wrong,
  // and wrong in the direction that suits us, which is the kind a reader is right to punish.
  { capability: "Canonical form", cells: ["y", "n", "n", "p", "n", "p"] },
];

