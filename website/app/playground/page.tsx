// The playground.
//
// It runs `@open-tech-foundation/stf` — the JavaScript reference implementation — in the
// browser, so the diagnostics here are the ones `stf check` reports and the conversions are the
// ones `stf convert` performs, refusals included. Nothing in this page decides what is valid.
//
// The editor is created on mount, never during the static build: it touches the DOM, and the
// page is pre-rendered.
//
// Every value rendered inside a conditional branch is derived with a safe fallback rather than
// read inline. A text binding inside a ternary is still evaluated by its effect even when its
// branch is not shown, so `report.findings[0].path` in an unshown branch would still throw.

import { onMount, RawHtml } from "@opentf/web";
import { Compartment } from "@codemirror/state";
import { EditorView, basicSetup } from "codemirror";

import {
  canonicalDigest,
  convert,
  convertToStf,
  parseError,
  reportAll,
  SAMPLES,
  TARGETS,
  type Target,
} from "../../lib/convert.ts";
import { FORMATS, type FormatId, type Policy } from "../../lib/formats.ts";
import { formatBytes, formatDelta, measure, type Measurement } from "../../lib/size.ts";
import { kindCensus, summarize, type Report } from "../../lib/lossiness.ts";
import { readRecords, STREAM_SAMPLE, toNDJSON } from "../../lib/streams.ts";
import { highlightToHtml, type TokenKind } from "../../lib/highlight.ts";
import { stfBase, stfLinter, stfStreamLinter } from "../../lib/codemirror-stf.ts";

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

type Mode = "document" | "stream";
type Tab = "convert" | "lossiness" | "size" | "import";

/**
 * A segment of the survival bar.
 *
 * Three segments rather than one, because a single "survives" bar reads 64% for every format on a
 * typical document — the JSON-native values dilute the differences, and worse, it puts YAML's
 * *degrades* and JSON's *refuses* in the same bucket. Splitting them is what makes the shapes
 * differ, and the difference is the whole argument: JSON loses five values outright where YAML
 * keeps three of them in a weaker form.
 */
interface Segment {
  kind: "intact" | "degraded" | "lost";
  percent: number;
}

/**
 * One measurement of the current document against the current target.
 *
 * Four independent questions — how much survives, how big it gets, which kinds are dropped, and
 * how much is lost without an error — arranged as four equal cards rather than a title with a
 * facts line trailing after it. They are read by scanning and compared against each other, so
 * none of them is a footnote to the others, and the earlier layout implied otherwise: the sizes
 * were set in the same 0.72rem grey as the parse position, which is how `290 B → 251 B` ended up
 * looking like metadata about the header rather than one of the two numbers a reader came for.
 */
interface Card {
  /** What is being measured. Sits above the figure, at label size. */
  label: string;
  /** The measurement, large enough to read across the row. Empty on the size card, which is a
   *  comparison rather than a quantity and states both of its numbers in `rows`. */
  figure: string;
  /** Trails the figure at label size: `of 11`, `bytes`, `KB`. */
  unit: string;
  /** One line of support — where the number came from, or what it costs. */
  note: string;
  tone: "neutral" | "good" | "warn" | "bad";
  /** Only the survival card carries a stacked bar; on the others it would be decoration. */
  segments: Segment[] | null;
  /** The size card's two labelled bars. */
  rows: SizeRow[] | null;
  /** A parse failure has one thing to say, and says it across the whole row. */
  wide: boolean;
}

/**
 * One encoding on the size card.
 *
 * A single figure could not carry this measure honestly. "Size as JSON / 251 bytes / 290 B as STF"
 * asks a reader to work out which encoding each number belongs to, and to guess whose gzipped size
 * the note was quoting. Both encodings are named on their own row instead, each with its own bar,
 * so the question the card exists to answer — how big is this as STF, and how big as the target —
 * is answered by looking rather than by inference.
 */
interface SizeRow {
  /** `STF`, `JSON`, `canonical` — the encoding this row weighs. */
  name: string;
  /** `290 B`, and its gzipped size where the browser has a compressor. */
  raw: string;
  gzipped: string;
  /** Width against the larger of the two rows, so the ratio is visible before the digits are read. */
  percent: number;
  /** STF takes the accent; the target takes the neutral fill. Names carry the identity either way. */
  own: boolean;
}

/** Splits a format's report into the three bar segments, dropping any that would be zero-width. */
function segmentsOf(intact: number, degraded: number, lost: number, total: number): Segment[] {
  if (total === 0) return [];
  // Rounded: a width carried to fourteen decimal places is noise in the DOM and identical on screen.
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  return (
    [
      { kind: "intact" as const, percent: pct(intact) },
      { kind: "degraded" as const, percent: pct(degraded) },
      { kind: "lost" as const, percent: pct(lost) },
    ] satisfies Segment[]
  ).filter((segment) => segment.percent > 0);
}

const TABS: { id: Tab; label: string }[] = [
  { id: "convert", label: "Convert" },
  { id: "lossiness", label: "Lossiness" },
  { id: "size", label: "Size" },
  { id: "import", label: "Import" },
];

/** Links a diagnostic to its own entry in the error reference, turning a failure into a route. */
function errorHref(code: string): string {
  return `/docs/errors#${code.toLowerCase().replace(/_/g, "-")}`;
}

export default function Playground() {
  let source = $state(SAMPLES[0].source);
  let mode = $state<Mode>("document");
  let tab = $state<Tab>("convert");
  let target = $state<Target>("json");
  // Lossy by default, which is the opposite of `stf convert` — and the status line says so, so
  // nobody infers the CLI's behaviour from this page. The reason is that the two policies answer
  // different questions and only one of them is the question a first-time visitor is asking.
  // Strict answers "may I convert this?", and on any document worth demonstrating the answer is
  // no, so the page opened on a refusal and showed no output at all. Lossy answers "what would I
  // get?", which is the thing you came to look at — and the cards above are what stop that from
  // being flattery, since they count what the output silently threw away.
  let policy = $state<Policy>("lossy");
  let digest = $state<string | null>(null);
  let copied = $state(false);

  // The Import tab keeps its own buffer so the main editor stays STF-only — the linter, the
  // grammar and the digest all assume it, and swapping in YAML would make all three lie.
  let importFormat = $state<FormatId>("yaml");
  let importText = $state("");

  let sizes = $state<Measurement[] | null>(null);

  const editorHost = $ref();
  let view: EditorView | undefined;
  const linting = new Compartment();

  // ---- document mode -------------------------------------------------------------------------

  const outcome = $derived(convert(source, target, policy));
  const targetLabel = $derived(TARGETS.find((t) => t.id === target)?.label ?? "the target");
  const targetNote = $derived(TARGETS.find((t) => t.id === target)?.note ?? "");
  const outputIsStf = $derived(target === "canonical" || target === "formatted");
  const isFormatTarget = $derived(FORMATS.some((f) => f.id === target));

  const reports = $derived<Report[]>(outcome.root ? reportAll(outcome.root) : []);
  const blocking = $derived(outcome.blocking);

  // ---- stream mode ---------------------------------------------------------------------------

  const stream = $derived(readRecords(source));
  const ndjson = $derived(toNDJSON(stream));

  // ---- import --------------------------------------------------------------------------------

  const imported = $derived(convertToStf(importText, importFormat));
  const importOutput = $derived(imported.output ?? "");
  const importErrorText = $derived(imported.error ?? "");

  // ---- header cards ----------------------------------------------------------------------------
  //
  // Scoped to the target the reader has actually selected. Six meters at once answered a question
  // nobody had yet - a developer opening this page is converting to *one* format and wants to know
  // what that costs. The all-six comparison still exists, one click away, in the Lossiness tab.

  // Compact STF is the base row, not the document as written. The editor's text carries comments
  // and chosen line breaks; a target format's output carries neither, so weighing 290 B of
  // commented STF against 251 B of JSON scores STF for the comments it kept and calls the result
  // an encoding comparison. Compact STF holds the same information the target's output holds, and
  // is the only row that makes the difference a property of the encodings.
  const stfRow = $derived(sizes?.find((row) => row.label === "STF (as written)") ?? null);
  const compactRow = $derived(sizes?.find((row) => row.label === "STF (compact)") ?? null);
  const canonicalRow = $derived(sizes?.find((row) => row.label === "STF (canonical)") ?? null);

  const targetRow = $derived(
    isFormatTarget ? (sizes?.find((row) => row.label === targetLabel) ?? null) : null,
  );

  // Tagged kinds and Formatted STF are views of the document rather than encodings of it, so they
  // have no size to weigh. Those targets compare the document as written against canonical STF,
  // which is the comparison a reader on those tabs is already thinking about.
  const baseRow = $derived(isFormatTarget ? compactRow : stfRow);
  const baseName = $derived(isFormatTarget ? "STF" : "as written");
  const againstRow = $derived(
    isFormatTarget ? (targetRow && targetRow.refused === null ? targetRow : null) : canonicalRow,
  );
  const againstName = $derived(isFormatTarget ? targetLabel : "canonical");

  const sizeRows = $derived<SizeRow[]>(
    baseRow === null || againstRow === null
      ? []
      : [
          { row: baseRow, name: baseName, own: true },
          { row: againstRow, name: againstName, own: false },
        ].map(({ row, name, own }) => ({
          name,
          raw: formatBytes(row.bytes),
          gzipped: row.gzipped === null ? "—" : formatBytes(row.gzipped),
          percent:
            Math.round((row.bytes / Math.max(baseRow.bytes, againstRow.bytes, 1)) * 1000) / 10,
          own,
        })),
  );

  /** The difference, named in the target's own terms so no one has to work out the direction. */
  const sizeNote = $derived(
    baseRow === null || againstRow === null
      ? "measuring"
      : [
          againstRow.bytes === baseRow.bytes
            ? `${againstName} is the same size`
            : `${againstName} is ${formatBytes(Math.abs(againstRow.bytes - baseRow.bytes))} ${
                againstRow.bytes > baseRow.bytes ? "larger" : "smaller"
              }`,
          isFormatTarget ? "compact STF, so comments count in neither" : null,
        ]
          .filter(Boolean)
          .join(" · "),
  );

  const activeReport = $derived(reports.find((r) => r.format === target) ?? null);
  const intact = $derived(activeReport ? activeReport.total - activeReport.findings.length : 0);

  /** The kinds this target drops or weakens — the census entries a round-trip would not return. */
  const lostKinds = $derived(
    activeReport ? [...new Set(activeReport.findings.map((f) => f.kind))] : [],
  );
  const usedKinds = $derived(outcome.root ? kindCensus(outcome.root).size : 0);

  /** Losses the target's usual writer raises no error for — the ones that ship. */
  const silent = $derived(activeReport ? activeReport.findings.filter((f) => f.silent).length : 0);

  const firstFailure = $derived(stream.records.find((record) => record.error !== null) ?? null);

  const cards = $derived<Card[]>(
    mode === "stream"
      ? [
          {
            label: "Records usable",
            figure: `${stream.ok}`,
            unit: `of ${stream.ok + stream.failed}`,
            note:
              stream.failed === 0
                ? "every record parsed"
                : "one bad record does not condemn the file",
            tone: stream.failed === 0 ? "good" : "warn",
            segments: segmentsOf(stream.ok, 0, stream.failed, stream.ok + stream.failed),
            rows: null,
            wide: false,
          },
          {
            label: "Rejected",
            figure: `${stream.failed}`,
            unit: stream.failed === 1 ? "record" : "records",
            note:
              firstFailure && firstFailure.error
                ? `${firstFailure.error.code} on line ${firstFailure.line}`
                : "no record failed to parse",
            tone: stream.failed === 0 ? "good" : "bad",
            segments: null,
            rows: null,
            wide: false,
          },
          {
            label: "Directives",
            figure: `${stream.directives.length}`,
            unit: stream.directives.length === 1 ? "header" : "headers",
            note:
              stream.directives.length === 0
                ? "the stream declares no version"
                : stream.directives.map((d) => `@${d.name}(${d.payload})`).join(" · "),
            tone: "neutral",
            segments: null,
            rows: null,
            wide: false,
          },
        ]
      : outcome.parseError
        ? [
            {
              label: "Document",
              figure: outcome.parseError.code,
              unit: `line ${outcome.parseError.line}, column ${outcome.parseError.column}`,
              note: outcome.parseError.message,
              tone: "bad",
              segments: null,
              rows: null,
              wide: true,
            },
          ]
        : [
            {
              label: activeReport ? `Survives as ${targetLabel}` : "Values",
              figure: activeReport ? `${intact}` : `${outcome.valueCount}`,
              unit: activeReport ? `of ${activeReport.total}` : "values",
              note: activeReport
                ? activeReport.clean
                  ? "every value reads back as itself"
                  : summarize(activeReport)
                : "counted across the whole document",
              tone: activeReport ? (activeReport.clean ? "good" : "warn") : "neutral",
              segments: activeReport
                ? segmentsOf(
                    intact,
                    activeReport.degraded,
                    activeReport.unrepresentable,
                    activeReport.total,
                  )
                : null,
              rows: null,
              wide: false,
            },
            {
              // No headline percentage. The document in the editor carries comments, which no
              // target format can hold, so a single percentage was measuring the comments as much
              // as the format — and announcing "15.5% larger than JSON" on the strength of two `#`
              // lines. Both encodings are named and weighed instead, and the difference is stated
              // in bytes, where a reader can see what produced it.
              label: "Size, raw bytes",
              figure: "",
              unit: "",
              note: sizeNote,
              tone: "neutral",
              segments: null,
              rows: sizeRows,
              wide: false,
            },
            {
              label: "Kinds dropped",
              figure: activeReport ? `${lostKinds.length}` : `${usedKinds}`,
              unit: activeReport ? `of ${usedKinds}` : "kinds used",
              note: activeReport
                ? lostKinds.length === 0
                  ? `${targetLabel} has a home for every kind here`
                  : lostKinds.join(", ")
                : "of the eleven STF defines",
              tone: activeReport ? (lostKinds.length === 0 ? "good" : "warn") : "neutral",
              segments: null,
              rows: null,
              wide: false,
            },
            {
              label: "Silent losses",
              figure: activeReport ? `${silent}` : "0",
              unit: silent === 1 ? "value" : "values",
              note: !activeReport
                ? "nothing is being converted"
                : silent === 0
                  ? "every loss here raises an error"
                  : "corrupted with no error raised",
              tone: silent === 0 ? "good" : "bad",
              segments: null,
              rows: null,
              wide: false,
            },
          ],
  );

  /** The legend belongs to the survival bar, so it is drawn only when that bar is. */
  const showLegend = $derived(cards.some((card) => card.segments !== null));

  // ---- status line ---------------------------------------------------------------------------

  const statusClass = $derived(
    mode === "stream"
      ? stream.failed > 0
        ? "pg-bad"
        : "pg-good"
      : outcome.parseError
        ? "pg-bad"
        : "pg-good",
  );

  const statusText = $derived(
    mode === "stream"
      ? `${stream.ok} of ${stream.ok + stream.failed} records parsed${
          stream.failed > 0 ? ` · ${stream.failed} rejected` : ""
        }`
      : outcome.parseError
        ? `${outcome.parseError.code} at ${outcome.parseError.line}:${outcome.parseError.column} — ${outcome.parseError.message}`
        : `valid · ${outcome.valueCount} values${digest ? ` · sha256 ${digest.slice(0, 16)}…` : ""}`,
  );

  const statusHref = $derived(outcome.parseError ? errorHref(outcome.parseError.code) : "");
  const showStatusLink = $derived(mode === "document" && outcome.parseError !== null);

  onMount(() => {
    view = new EditorView({
      doc: source,
      parent: editorHost,
      extensions: [
        basicSetup,
        // The language, colours and theme are outside the compartment so they survive every mode
        // change. Only the linter is swapped: a stream is many documents, and linting it as one
        // would report line 2 as trailing content and mark the whole file bad.
        stfBase(),
        // The squiggle is the reference parser's error at its own offset — the stream grammar
        // only decides colour.
        linting.of(stfLinter(parseError)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) source = update.state.doc.toString();
        }),
      ],
    });

    return () => view?.destroy();
  });

  $effect(() => {
    const current = source;
    canonicalDigest(current).then((value) => {
      if (current === source) digest = value;
    });
  });

  // Sizes need a parsed document and a gzip round-trip, so they are computed off the render path
  // and guarded against a stale document landing after a newer one.
  $effect(() => {
    const current = source;
    const root = outcome.root;
    if (!root || mode !== "document") {
      sizes = null;
      return;
    }
    measure(current, root).then((rows) => {
      if (current === source) sizes = rows;
    });
  });

  function setMode(next: Mode) {
    if (next === mode) return;
    mode = next;
    if (next === "stream") {
      if (tab !== "import") tab = "convert";
      replaceDocument(STREAM_SAMPLE);
    } else {
      replaceDocument(SAMPLES[0].source);
    }
    view?.dispatch({
      effects: linting.reconfigure(
        next === "document" ? stfLinter(parseError) : stfStreamLinter(streamDiagnostics),
      ),
    });
  }

  /** The failing records of a stream, flattened for the editor's gutter. */
  function streamDiagnostics(text: string) {
    return readRecords(text)
      .records.filter((record) => record.error !== null)
      .map((record) => ({
        line: record.line,
        code: record.error!.code,
        message: record.error!.message,
      }));
  }

  function replaceDocument(text: string) {
    source = text;
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }

  async function copyOutput() {
    const text = mode === "stream" ? ndjson.text : (outcome.output ?? "");
    if (!text) return;
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  return (
    <main class="landing playground">
      <section class="section">
        <div class="container">
          <header class="pg-header">
            <div class="pg-cards">
              {cards.map((card) => (
                <div class={`pg-card pg-card-${card.tone}${card.wide ? " pg-card-wide" : ""}`}>
                  <span class="pg-card-label">{card.label}</span>
                  {card.figure ? (
                    <span class="pg-card-figure">
                      {card.figure}
                      {card.unit ? <span class="pg-card-unit">{card.unit}</span> : null}
                    </span>
                  ) : null}
                  {card.rows ? (
                    <span class="pg-rows">
                      {card.rows.map((row) => (
                        <span class={row.own ? "pg-row pg-row-own" : "pg-row"}>
                          <span class="pg-row-name">{row.name}</span>
                          <span class="pg-row-track">
                            <span class="pg-row-fill" style={`width:${row.percent}%`} />
                          </span>
                          <span class="pg-row-raw">{row.raw}</span>
                          <span class="pg-row-gz">{row.gzipped} gz</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {card.segments ? (
                    <span class="pg-card-track">
                      {card.segments.map((segment) => (
                        <span
                          class={`pg-seg pg-seg-${segment.kind}`}
                          style={`width:${segment.percent}%`}
                        />
                      ))}
                    </span>
                  ) : null}
                  <span class="pg-card-note">{card.note}</span>
                </div>
              ))}
            </div>

            {/* Three segments means a legend is not optional — identity is never colour alone. */}
            {showLegend ? (
              <div class="pg-legend">
                <span class="pg-legend-item">
                  <span class="pg-swatch pg-seg-intact" />
                  intact
                </span>
                <span class="pg-legend-item">
                  <span class="pg-swatch pg-seg-degraded" />
                  kind lost
                </span>
                <span class="pg-legend-item">
                  <span class="pg-swatch pg-seg-lost" />
                  cannot represent
                </span>
              </div>
            ) : null}
          </header>

          <div class="pg-grid">
            <div class="pg-pane">
              <div class="pg-bar">
                <span class="pg-name">{mode === "stream" ? "document.stfs" : "document.stf"}</span>
                <div class="pg-samples">
                  <button
                    type="button"
                    class={mode === "document" ? "pg-chip pg-chip-on" : "pg-chip"}
                    onclick={() => setMode("document")}
                  >
                    Document
                  </button>
                  <button
                    type="button"
                    class={mode === "stream" ? "pg-chip pg-chip-on" : "pg-chip"}
                    onclick={() => setMode("stream")}
                  >
                    Stream
                  </button>
                </div>
              </div>

              {mode === "document" ? (
                <div class="pg-bar pg-bar-sub">
                  <div class="pg-samples">
                    {SAMPLES.map((sample) => (
                      <button
                        type="button"
                        class="pg-chip"
                        onclick={() => replaceDocument(sample.source)}
                      >
                        {sample.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div class="pg-bar pg-bar-sub">
                  <span class="pg-note">
                    One record per line. A bad line is a bad line, not a bad file.
                  </span>
                </div>
              )}

              <div class="pg-editor" ref={editorHost} />

              <div class="pg-status">
                <span class={statusClass}>{statusText}</span>
                {showStatusLink ? (
                  <a class="pg-errlink" href={statusHref}>
                    what this means
                  </a>
                ) : null}
              </div>
            </div>

            <div class="pg-pane">
              <div class="pg-tabs">
                {TABS.map((t) => (
                  <button
                    type="button"
                    class={tab === t.id ? "pg-tab pg-tab-on" : "pg-tab"}
                    disabled={mode === "stream" && t.id !== "convert" && t.id !== "import"}
                    onclick={() => (tab = t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === "convert" && mode === "document" ? (
                <ConvertTab
                  outcome={outcome}
                  target={target}
                  targetLabel={targetLabel}
                  targetNote={targetNote}
                  outputIsStf={outputIsStf}
                  isFormatTarget={isFormatTarget}
                  policy={policy}
                  blocking={blocking}
                  copied={copied}
                  onTarget={(value: Target) => (target = value)}
                  onPolicy={(value: Policy) => (policy = value)}
                  onCopy={copyOutput}
                />
              ) : null}

              {tab === "convert" && mode === "stream" ? (
                <StreamTab stream={stream} ndjson={ndjson} copied={copied} onCopy={copyOutput} />
              ) : null}

              {tab === "lossiness" && mode === "document" ? (
                <LossinessTab reports={reports} valid={outcome.parseError === null} />
              ) : null}

              {tab === "size" && mode === "document" ? (
                <SizeTab sizes={sizes} valid={outcome.parseError === null} />
              ) : null}

              {tab === "import" ? (
                <ImportTab
                  format={importFormat}
                  text={importText}
                  output={importOutput}
                  error={importErrorText}
                  onFormat={(value: FormatId) => (importFormat = value)}
                  onText={(value: string) => (importText = value)}
                  onLoad={() => {
                    if (!imported.output) return;
                    mode = "document";
                    tab = "convert";
                    replaceDocument(imported.output);
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

// -----------------------------------------------------------------------------------------------
// Tabs
// -----------------------------------------------------------------------------------------------

function ConvertTab(props: any) {
  const refusedTitle = $derived(`Not representable in ${props.targetLabel}`);
  const errorText = $derived(props.outcome.convertError ?? "");
  const output = $derived(props.outcome.output ?? "");
  const highlighted = $derived(props.outputIsStf ? highlightToHtml(output, TOKEN_CLASS) : "");

  const policyGroupLabel = $derived(
    `What to do with values ${props.targetLabel} cannot hold`,
  );

  /**
   * What the chosen policy means, in this document's terms.
   *
   * The toggle governs one decision — what happens to a value the target has no home for — and
   * the two answers are worth stating rather than naming. Both notes end on the CLI flag, because
   * `stf convert` defaults to the *other* one and a reader should not have to discover that by
   * being refused at a terminal.
   */
  const policyNote = $derived(
    props.policy === "lossy"
      ? "Lossy: values the target cannot hold are written in the nearest form it has, so there is always output. The cards above count what that costs. Same as stf convert --lossy."
      : "Strict: the conversion is refused outright if any value would not read back as the same STF value. This is what stf convert does by default.",
  );

  return (
    <div class="pg-tabbody">
      <div class="pg-bar">
        <select
          class="pg-select"
          onchange={(e: Event) => props.onTarget((e.currentTarget as HTMLSelectElement).value)}
        >
          {TARGETS.map((t) => (
            <option value={t.id} selected={t.id === props.target}>
              {t.label}
            </option>
          ))}
        </select>

        {/* Labelled by what the button does, not by the policy's name. "Strict" and "Lossy" are
          * the names `stf convert` uses and they are worth learning, but they say nothing to
          * someone meeting them for the first time — so the name moves to the note below, where
          * there is room to say which CLI flag it corresponds to. */}
        {props.isFormatTarget ? (
          <div class="pg-toggle" role="group" aria-label={policyGroupLabel}>
            <button
              type="button"
              class={props.policy === "lossy" ? "pg-chip pg-chip-on" : "pg-chip"}
              onclick={() => props.onPolicy("lossy")}
            >
              Convert anyway
            </button>
            <button
              type="button"
              class={props.policy === "strict" ? "pg-chip pg-chip-on" : "pg-chip"}
              onclick={() => props.onPolicy("strict")}
            >
              Refuse
            </button>
          </div>
        ) : null}

        <button type="button" class="pg-chip" disabled={!props.outcome.output} onclick={props.onCopy}>
          {props.copied ? "Copied" : "Copy"}
        </button>
      </div>

      {props.outcome.parseError ? (
        <div class="pg-output pg-empty">
          The document does not parse, so there is nothing to convert.
        </div>
      ) : props.outcome.convertError ? (
        <div class="pg-output pg-refused">
          <p class="pg-refused-title">{refusedTitle}</p>
          <p class="pg-refused-body">{errorText}</p>
          <ul class="pg-blocking">
            {props.blocking.map((line: string) => (
              <li>{line}</li>
            ))}
          </ul>
          {/* The same name as the chip that gets you here, so the action reads as one thing. */}
          <button type="button" class="pg-chip" onclick={() => props.onPolicy("lossy")}>
            Convert anyway
          </button>
        </div>
      ) : props.outputIsStf ? (
        <pre class="pg-output">
          <RawHtml html={highlighted} />
        </pre>
      ) : (
        <pre class="pg-output">{output}</pre>
      )}

      <div class="pg-status">
        <span class="pg-note">{props.targetNote}</span>
        {props.isFormatTarget ? <span class="pg-note pg-note-policy">{policyNote}</span> : null}
      </div>
    </div>
  );
}

function LossinessTab(props: any) {
  return (
    <div class="pg-tabbody">
      {props.valid ? (
        <div class="pg-scroll">
          <p class="pg-lead">
            What each format cannot hold, computed from the document on the left — not from the
            format in the abstract.
          </p>
          {props.reports.map((report: Report) => (
            <div class={report.clean ? "pg-card pg-card-clean" : "pg-card"}>
              <div class="pg-card-head">
                <span class="pg-card-name">
                  {FORMATS.find((f) => f.id === report.format)?.label ?? report.format}
                </span>
                <span class={report.clean ? "pg-good" : "pg-warn"}>{summarize(report)}</span>
              </div>
              <ul class="pg-findings">
                {report.findings.map((finding) => (
                  <li class={`pg-finding pg-${finding.verdict}`}>
                    <code class="pg-path">{finding.path}</code>
                    <span class="pg-kindtag">{finding.kind}</span>
                    {finding.silent ? <span class="pg-silent">silent</span> : null}
                    <span class="pg-findnote">{finding.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <div class="pg-output pg-empty">
          The document does not parse, so there is nothing to analyse.
        </div>
      )}
    </div>
  );
}

function SizeTab(props: any) {
  const rows = $derived<Measurement[]>(props.sizes ?? []);
  const ready = $derived(props.valid && props.sizes !== null);

  return (
    <div class="pg-tabbody">
      {ready ? (
        <div class="pg-scroll">
          <table class="pg-table">
            <thead>
              <tr>
                <th>Format</th>
                <th class="pg-num">Raw</th>
                <th class="pg-num">Gzipped</th>
                <th class="pg-num">vs JSON</th>
                <th class="pg-num">vs JSON, gzipped</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr>
                  <td>{row.label}</td>
                  <td class="pg-num">{row.refused ? "—" : formatBytes(row.bytes)}</td>
                  <td class="pg-num">
                    {row.refused || row.gzipped === null ? "—" : formatBytes(row.gzipped)}
                  </td>
                  <td class="pg-num">{row.refused ? "refused" : formatDelta(row.versusJson)}</td>
                  <td class="pg-num">
                    {row.refused ? "refused" : formatDelta(row.versusJsonGzipped)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="pg-note pg-footnote">
            Raw size is a property of the format: STF drops the quotes around keys and spells the
            literals <code>T</code>, <code>F</code> and <code>N</code>. Gzipped size is what
            actually crosses a wire — and compression removes much of that advantage, because
            repeated quoting is exactly what gzip is good at. On a short document the gzip header
            dominates, so paste something realistic before trusting the second column. Sizes use
            the lossy policy so that every format produces bytes to compare.
          </p>
        </div>
      ) : (
        <div class="pg-output pg-empty">
          {props.valid ? "Measuring…" : "The document does not parse, so there is nothing to measure."}
        </div>
      )}
    </div>
  );
}

function StreamTab(props: any) {
  const skippedNote = $derived(
    props.ndjson.skipped > 0
      ? `${props.ndjson.skipped} malformed record${props.ndjson.skipped === 1 ? "" : "s"} skipped`
      : "every record converted",
  );

  return (
    <div class="pg-tabbody">
      <div class="pg-bar">
        <span class="pg-name">Records</span>
        <button type="button" class="pg-chip" onclick={props.onCopy}>
          {props.copied ? "Copied" : "Copy NDJSON"}
        </button>
      </div>

      <div class="pg-scroll">
        <ul class="pg-records">
          {props.stream.records.map((record: any) => (
            <li class={record.error ? "pg-record pg-record-bad" : "pg-record"}>
              <span class="pg-lineno">{record.line}</span>
              {record.error ? (
                <a class="pg-record-err" href={errorHref(record.error.code)}>
                  {record.error.code}
                </a>
              ) : null}
              <code class="pg-record-text">{record.text ?? record.error?.message ?? ""}</code>
            </li>
          ))}
        </ul>

        <p class="pg-lead">NDJSON — {skippedNote}.</p>
        <pre class="pg-output pg-output-inline">{props.ndjson.text}</pre>
      </div>
    </div>
  );
}

function ImportTab(props: any) {
  return (
    <div class="pg-tabbody">
      <div class="pg-bar">
        <select
          class="pg-select"
          onchange={(e: Event) => props.onFormat((e.currentTarget as HTMLSelectElement).value)}
        >
          {FORMATS.map((f) => (
            <option value={f.id} selected={f.id === props.format}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" class="pg-chip" disabled={!props.output} onclick={props.onLoad}>
          Load into editor
        </button>
      </div>

      <textarea
        class="pg-textarea"
        spellcheck={false}
        placeholder="Paste JSON, JSON5, JSONC, YAML, TOML or NDJSON here."
        oninput={(e: Event) => props.onText((e.currentTarget as HTMLTextAreaElement).value)}
      >
        {props.text}
      </textarea>

      {props.error ? (
        <div class="pg-output pg-refused pg-output-inline">
          <p class="pg-refused-body">{props.error}</p>
        </div>
      ) : (
        <pre class="pg-output pg-output-inline">{props.output}</pre>
      )}

      <div class="pg-status">
        <span class="pg-note">
          Nothing is inferred: a JSON string that looks like a date becomes an STF String, because
          in JSON that is what it was.
        </span>
      </div>
    </div>
  );
}
