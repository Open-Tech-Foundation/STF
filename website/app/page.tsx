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
            {/* "A structured text format for configuration and data" put STF in the most crowded
              * category there is, in the same words TOML and YAML already use. What is actually
              * true of STF and not of them is that the kind is in the text, so that is the
              * headline; the lede names the two shapes the panel beside it now shows. */}
            <h1 class="title">
              Every value says <span class="grad">what it is</span>.
            </h1>
            <p class="lede">
              Dates, timestamps, decimals, big integers, binary, geometry, time-of-day, and
              durations are part of the grammar — not conventions agreed in a README. The same
              rules hold for a single document and for a record stream.
            </p>
            <div class="cta-row">
              <a href="/spec" class="btn btn-primary">
                Read the specification
              </a>
              <a href="/playground" class="btn btn-ghost">
                Playground
              </a>
            </div>
          </div>

          <HeroPanel />
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
                  <a class="norm-ref" href={item.href}>
                    <code>{item.ref}</code>
                  </a>{" "}
                  — {item.body}
                </li>
              ))}
            </ul>
            <div class="cta-row">
              <a href="/spec" class="btn btn-ghost">
                Specification
              </a>
              <a href="/docs" class="btn btn-ghost">
                Guides
              </a>
            </div>
          </div>

          <StfCode name="stf canon config.stf" source={CANONICAL_SAMPLE} />
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

/**
 * The hero panel, as two tabs.
 *
 * A document and a stream are the two shapes STF comes in, and the page used to show only the
 * first — so the record stream, which is the thing STF does that no other text format specifies,
 * appeared for the first time three sections down. Two tabs put both at the front without the
 * headline having to choose one and abandon the other.
 *
 * The caption changes with the tab because the tabs are not two views of the same thing: a
 * document has exactly one root object (spec §5), and a stream is a sequence of them with a rule
 * about line terminators that makes splitting safe (stream §3.2). Without the caption the second
 * tab is just the first one with more braces.
 */
function HeroPanel() {
  let active = $state<"document" | "stream">("document");

  const name = $derived(active === "document" ? "config.stf" : "events.stfs");

  // Written out as strings. `aria-selected={boolean}` serialises the way HTML boolean attributes
  // do — bare when true, absent when false — but ARIA has no boolean attributes, so the tab would
  // have announced itself as neither selected nor unselected.
  const documentSelected = $derived(active === "document" ? "true" : "false");
  const streamSelected = $derived(active === "stream" ? "true" : "false");
  // Both panels are in the markup and the inactive one is hidden, rather than one panel whose
  // contents are swapped. A swap renders only the open tab into the pre-rendered HTML, which would
  // have deleted the stream example from the static page — off the site without JavaScript, out of
  // the search index, and out of /llms-full.txt. Tabs are a way to spend less of the reader's
  // attention, not less of the document.
  const documentHtml = highlightToHtml(SAMPLE, TOKEN_CLASS);
  const streamHtml = highlightToHtml(STREAM, TOKEN_CLASS);

  // A class rather than the `hidden` attribute, because `hidden` means `display: none` and the two
  // panes have to keep occupying the same grid cell for the panel to hold one height across a
  // switch. `visibility: hidden` leaves the pane in the layout — and out of the accessibility
  // tree, which is the part `hidden` was doing usefully.
  const documentPane = $derived(
    active === "document" ? "codeblock-pane" : "codeblock-pane codeblock-pane-off",
  );
  const streamPane = $derived(
    active === "stream" ? "codeblock-pane" : "codeblock-pane codeblock-pane-off",
  );

  return (
    <div class="codeblock">
      <div class="codeblock-bar codeblock-bar-tabs">
        <div class="code-tabs" role="tablist" aria-label="Example">
          <button
            type="button"
            role="tab"
            id="hero-tab-document"
            aria-selected={documentSelected}
            aria-controls="hero-pane-document"
            class={active === "document" ? "code-tab code-tab-on" : "code-tab"}
            onclick={() => (active = "document")}
          >
            Document
          </button>
          <button
            type="button"
            role="tab"
            id="hero-tab-stream"
            aria-selected={streamSelected}
            aria-controls="hero-pane-stream"
            class={active === "stream" ? "code-tab code-tab-on" : "code-tab"}
            onclick={() => (active = "stream")}
          >
            Stream
          </button>
        </div>
        <span class="codeblock-name">{name}</span>
      </div>

      {/* Both panes share one grid cell, so the panel is always as tall as the taller of them and
        * switching moves nothing. Each pane is a column with its `pre` flexing, which keeps the
        * caption — and the rule above it — on the same line of the page in both tabs; equal outer
        * height alone would still have let that divider jump by seven lines. */}
      <div class="codeblock-panes">
        <div
          class={documentPane}
          id="hero-pane-document"
          role="tabpanel"
          aria-labelledby="hero-tab-document"
        >
          <pre>
            <RawHtml html={documentHtml} />
          </pre>
          <p class="codeblock-caption">One root object. Every value carries its own kind.</p>
        </div>

        <div
          class={streamPane}
          id="hero-pane-stream"
          role="tabpanel"
          aria-labelledby="hero-tab-stream"
        >
          <pre>
            <RawHtml html={streamHtml} />
          </pre>
          <p class="codeblock-caption">
            One document per line. No record may contain a raw newline, so a reader may split the
            file before parsing any of it.
          </p>
        </div>
      </div>
    </div>
  );
}

// All five constructors appear, because the lede and the meta description both promise five and
// the panel used to show four — `port: 8080` stood where a DATE should have been, so the one kind
// named first in the copy was the one kind missing from the evidence. Number loses its seat and is
// not missed: it is the kind nobody needs convincing about.
//
// DATE beside TIMESTAMP is also the pair worth teaching. A wall date with no time and no offset is
// a different kind from an absolute instant (spec §3), and conflating the two is the mistake every
// format without a DATE forces on its users.
const SAMPLE = `# comments are part of the format
{
  service: \`checkout-api\`,
  enabled: T,
  launch_on: DATE(2026-02-01),
  deploy_after: TIMESTAMP(2026-01-15T10:30:00Z),
  price_cap: DECIMAL(199.00),   # scale is data
  account_id: BIGINT(9007199254740993),
  signing_key: BINARY(SGVsbG8=),
  boundary: Geometry("Polygon", [[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]]]),
  opens: Time("09:30"),
  ttl: Duration("PT45M"),
  regions: [\`eu-west-1\`, \`us-east-1\`],
}`;

// Kept narrow so the panel never clips at the hero's column width.
const STREAM = `@version(1.0)
{at: TIMESTAMP(2026-01-15T10:30:00Z), level: \`warn\`}
{at: TIMESTAMP(2026-01-15T10:30:04Z), level: \`info\`}`;

// SAMPLE through `serialize(parse(src), CANONICAL)`, pasted rather than described: members sorted
// by UTF-8 key bytes, comments gone, strings in the interpreted form, and no line terminator
// anywhere (spec §14). It sits beside the normative list because §14 is one of the entries, and
// it replaced a second copy of STREAM — the hero panel shows that now, and the same three lines
// twice on one page taught nothing the second time.
//
// The line is deliberately left to scroll. Canonical form *is* one long line, and wrapping it for
// presentation would misrepresent the one property the panel is there to show.
const CANONICAL_SAMPLE = `{account_id:BIGINT(9007199254740993),boundary:Geometry("Polygon", [[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]]]),deploy_after:TIMESTAMP(2026-01-15T10:30:00Z),enabled:T,launch_on:DATE(2026-02-01),opens:Time("09:30"),price_cap:DECIMAL(199.00),regions:["eu-west-1","us-east-1"],service:"checkout-api",signing_key:BINARY(SGVsbG8=),ttl:Duration("PT45M")}`;

// A glyph on its own is not an answer to a screen reader, hence the label. The middle label tracks
// the legend: Ion's canonical form is a sibling specification rather than an implementation
// disagreement, so "varies by implementation" would have described it wrongly to the one reader
// who cannot see the legend to correct it.
const MARKS: Record<string, { glyph: string; label: string }> = {
  y: { glyph: "✅", label: "yes" },
  p: { glyph: "🟡", label: "varies, or holds with a caveat" },
  n: { glyph: "❌", label: "no" },
};

const FORMATS = ["STF", "JSON", "JSON5", "YAML", "TOML", "Ion"];

const REASONS = [
  {
    icon: "🏷️",
    title: "Types in the syntax",
    body: "DATE, TIMESTAMP, DECIMAL, BIGINT, BINARY, Geometry, Time, and Duration are grammar, so a reader never infers a type from a key name.",
  },
  {
    // Promoted from sixth. It is the one capability no other text format specifies, so burying it
    // below canonical form was ordering the list by how proud we are rather than by what is sharp.
    icon: "🧾",
    title: "Record streams",
    // Was: "a malformed record never invalidates the rest of the stream". That is not what the
    // profile says. Stream §5 makes continuing a *caller policy* and tells readers to default to
    // aborting, precisely so corruption is not skipped in silence — so the guarantee is that
    // recovery is always available, not that it happens by itself.
    body: "A .stfs file is one document per line. Records parse independently, so a reader can report a bad one and carry on — though it stops by default, so corruption is never skipped in silence.",
  },
  {
    icon: "🎯",
    title: "Exact decimals",
    body: "DECIMAL(1.5) and DECIMAL(1.50) are different values. Scale survives the round trip, so money is representable.",
  },
  {
    icon: "🧱",
    title: "Strict by design",
    body: "Every rejection maps to exactly one documented code, and a conversion that would lose a type fails unless you ask for it in writing.",
  },
  {
    icon: "🔏",
    title: "Canonical form",
    body: "One byte encoding per value, so a document can be hashed, signed, and diffed byte-for-byte.",
  },
  {
    icon: "🛠️",
    title: "Editor and CLI",
    body: "stf check, fmt, lint, canon, and convert, plus a language server that reports the same codes as CI.",
  },
];

// Each reference links to the section it cites. A specification reference that a reader cannot
// follow in one click is a citation, and the point of publishing the text was to stop it being one.
const NORMATIVE = [
  {
    ref: "§3",
    href: "/spec#3-data-model",
    body: "fourteen value kinds, defined independently of any host language.",
  },
  {
    ref: "§13",
    href: "/spec#13-serialization",
    body: "parse(serialize(v)) ≡ v, and no constructor inferred from string content.",
  },
  {
    ref: "§14",
    href: "/spec#14-canonical-form",
    body: "canonical form: one byte encoding per value.",
  },
  {
    ref: "§15",
    href: "/spec#15-resource-limits",
    body: "a mandatory nesting depth limit, defaulting to 64.",
  },
  {
    ref: "codes",
    href: "/spec#errors",
    body: "one documented code per rejection; message text is not normative.",
  },
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

