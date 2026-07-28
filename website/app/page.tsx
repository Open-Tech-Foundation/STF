// The landing page for a specification, not a product page.
//
// The claims here are load-bearing: every capability in the comparison table is one a reader
// can check against `doc/spec.md`, and every "Varies" is a case where implementations
// genuinely disagree. Overclaiming against JSON, YAML, or TOML would be the fastest way to
// lose the audience this format is for.

export default function Home() {
  return (
    <main class="landing">
      <section class="hero">
        <p class="status">
          <span class="status-dot" aria-hidden="true" />
          STF 1.0 · Draft specification
        </p>
        <h1>A replacement for JSON, not a superset of it.</h1>
        <p class="lead">
          STF is a specification for a text format whose dates, timestamps, decimals, big
          integers, and binary values are part of the grammar rather than conventions layered
          on strings. It defines the data model, the canonical byte encoding, and the exact
          error code for every rejection — so parsers in Rust, JavaScript, Python, and Go
          accept the same documents and refuse the same documents, case for case.
        </p>
        <div class="actions">
          <a href="/docs" class="btn primary">
            Read the specification
          </a>
          <a href="/playground" class="btn secondary">
            Playground
          </a>
        </div>
      </section>

      <section class="sample" aria-label="An STF document">
        <pre>
          <code>{SAMPLE}</code>
        </pre>
        <p class="caption">
          A reader recovers the author's intent from the document alone. No schema is consulted,
          and no key name is inspected to decide what a value means.
        </p>
      </section>

      <section class="normative" aria-labelledby="defines">
        <h2 id="defines">What the specification defines</h2>
        <dl>
          {NORMATIVE.map((item) => (
            <div class="normative-item">
              <dt>
                {item.title} <span class="ref">{item.ref}</span>
              </dt>
              <dd>{item.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section class="compare" aria-labelledby="compare-heading">
        <h2 id="compare-heading">Against the alternatives</h2>
        <p class="section-lead">
          Where a cell reads <em>Varies</em>, the format permits the capability but
          implementations disagree on it, which is the failure mode STF exists to remove.
        </p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                <th scope="col">STF</th>
                <th scope="col">JSON</th>
                <th scope="col">JSON5</th>
                <th scope="col">YAML</th>
                <th scope="col">TOML</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr>
                  <th scope="row">{row.capability}</th>
                  {row.cells.map((cell) => (
                    <td class={cellClass(cell)}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="conformance" aria-labelledby="conformance-heading">
        <h2 id="conformance-heading">Implementations</h2>
        <p class="section-lead">
          A document written by one of these is read identically by the others: the same eleven
          value kinds, the same error code for every rejection, and the same canonical bytes.
          That is checked, not asserted — 258 shared cases, each traced to a rule in the
          specification, compared on error code and value kind rather than on message text.
        </p>
        <ul class="impls">
          {IMPLEMENTATIONS.map((impl) => (
            <li>
              <span class="impl-name">{impl.name}</span>
              <span class="impl-score">{impl.score}</span>
              <span class="impl-note">{impl.note}</span>
            </li>
          ))}
        </ul>
      </section>

      <section class="tooling" aria-labelledby="tooling-heading">
        <h2 id="tooling-heading">Tooling</h2>
        <pre>
          <code>{TOOLING}</code>
        </pre>
        <p class="caption">
          <code>stf lsp</code> serves the Language Server Protocol from the same parser, so an
          editor reports the error code that continuous integration will report.
        </p>
      </section>

      <section class="status-note" aria-labelledby="status-heading">
        <h2 id="status-heading">Stability</h2>
        <p>
          STF is pre-release. The 1.0 draft is complete and every implementation passes the
          corpus, but the specification may still change incompatibly, and no compatibility
          guarantee is offered until 1.0 is tagged. It is published for review and feedback.
        </p>
      </section>
    </main>
  );
}

function cellClass(value: string): string {
  if (value === "No") return "cell-no";
  if (value === "Varies") return "cell-varies";
  return "cell-yes";
}

const SAMPLE = `# A configuration file
{
  service: \`checkout-api\`,
  port: 8080,
  enabled: T,
  deploy_after: TIMESTAMP(2026-01-15T10:30:00Z),
  price_cap: DECIMAL(199.00),        # exact — scale is preserved
  account_id: BIGINT(9007199254740993),
  signing_key: BINARY(SGVsbG8=),
  regions: [\`eu-west-1\`, \`us-east-1\`],
}`;

const TOOLING = `stf check config.stf              # verify, with normative error codes
stf fmt --write config.stf        # format in place
stf lint config.stf               # flag stringly-typed values
stf canon config.stf | sha256sum  # canonical form, for hashing and signing
stf convert data.json --to stf    # refuses what STF cannot represent`;

const NORMATIVE = [
  {
    title: "Data model",
    ref: "§3",
    body:
      "Eleven value kinds, defined independently of any host language, with equality specified per kind. Representing a typed value as a string sentinel is explicitly non-conformant.",
  },
  {
    title: "Serialization",
    ref: "§13",
    body:
      "parse(serialize(v)) ≡ v is a MUST. A serializer may not inspect string content to decide to emit a constructor, and must fail rather than emit output it cannot parse back.",
  },
  {
    title: "Canonical form",
    ref: "§14",
    body:
      "An optional profile giving every value exactly one byte encoding, so a document can be hashed, signed, and diffed byte-for-byte. Default serialization preserves authored order and spacing.",
  },
  {
    title: "Resource limits",
    ref: "§15",
    body:
      "A nesting depth limit is mandatory and defaults to 64, so a document accepted by one conformant parser is accepted by all. Document and payload size limits are optional.",
  },
  {
    title: "Error codes",
    ref: "normative",
    body:
      "A condition-to-code table covering every rejection the specification requires. Exactly one code per condition, compared exactly; message text is explicitly not normative.",
  },
  {
    title: "Stream profile",
    ref: ".stfs",
    body:
      "One document per line for append-only logs and telemetry. A record cannot contain a raw line terminator, so a reader splits on LF before parsing, and one malformed record does not invalidate the stream.",
  },
];

const COMPARISON = [
  { capability: "Dates and timestamps as a distinct type", cells: ["Yes", "No", "No", "Varies", "Yes"] },
  { capability: "Exact decimals, scale preserved", cells: ["Yes", "No", "No", "No", "No"] },
  { capability: "Integers beyond 2⁵³ without loss", cells: ["Yes", "No", "No", "Varies", "Varies"] },
  { capability: "Binary data as a distinct type", cells: ["Yes", "No", "No", "Varies", "No"] },
  { capability: "Comments", cells: ["Yes", "No", "Yes", "Yes", "Yes"] },
  { capability: "Duplicate keys rejected", cells: ["Yes", "No", "No", "Varies", "Yes"] },
  { capability: "One documented code per rejection", cells: ["Yes", "No", "No", "No", "No"] },
  { capability: "Canonical form in the same specification", cells: ["Yes", "No", "No", "Varies", "No"] },
];

// The note is the reason a reader would pick one: what it costs to adopt, and what it gives
// beyond parsing.
const IMPLEMENTATIONS = [
  {
    name: "Rust",
    score: "258/258",
    note: "The normative reference. Ships the stf command-line tool and the language server.",
  },
  { name: "JavaScript", score: "258/258", note: "TypeScript sources. No runtime dependencies." },
  { name: "Python", score: "258/258", note: "Pure Python. No extension module to build." },
  { name: "Go", score: "258/258", note: "No module dependencies." },
];
