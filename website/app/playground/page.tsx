// The playground.
//
// It runs `@open-tech-foundation/stf` — the JavaScript reference implementation — in the
// browser, so the diagnostics here are the ones `stf check` reports and the conversions are the
// ones `stf convert` performs, refusals included. Nothing in this page decides what is valid.
//
// The editor is created on mount, never during the static build: it touches the DOM, and the
// page is pre-rendered.

import { onMount, RawHtml } from "@opentf/web";
import { EditorView, basicSetup } from "codemirror";

import { canonicalDigest, convert, parseError, SAMPLES, TARGETS, type Target } from "../../lib/convert.ts";
import { highlightToHtml, type TokenKind } from "../../lib/highlight.ts";
import { stfExtensions } from "../../lib/codemirror-stf.ts";

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

export default function Playground() {
  let source = $state(SAMPLES[0].source);
  let target = $state<Target>("json");
  let digest = $state<string | null>(null);
  let copied = $state(false);

  const editorHost = $ref();
  let view: EditorView | undefined;

  const outcome = $derived(convert(source, target));
  const targetNote = $derived(TARGETS.find((t) => t.id === target)?.note ?? "");
  const outputIsStf = $derived(target === "canonical" || target === "formatted");

  onMount(() => {
    view = new EditorView({
      doc: source,
      parent: editorHost,
      extensions: [
        basicSetup,
        // The squiggle is the reference parser's error at its own offset — the stream
        // grammar only decides colour.
        stfExtensions(parseError),
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

  function loadSample(index: number) {
    source = SAMPLES[index].source;
    view?.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
  }

  async function copyOutput() {
    if (!outcome.output) return;
    await navigator.clipboard.writeText(outcome.output);
    copied = true;
    setTimeout(() => (copied = false), 1200);
  }

  return (
    <main class="landing playground">
      <section class="section">
        <div class="container">
          <h1 class="pg-title">Playground</h1>
          <p class="sub">
            Running the JavaScript reference implementation — the same parser, the same error
            codes, the same refusals.
          </p>

          <div class="pg-grid">
            <div class="pg-pane">
              <div class="pg-bar">
                <span class="pg-name">document.stf</span>
                <div class="pg-samples">
                  {SAMPLES.map((sample, i) => (
                    <button type="button" class="pg-chip" onclick={() => loadSample(i)}>
                      {sample.label}
                    </button>
                  ))}
                </div>
              </div>
              <div class="pg-editor" ref={editorHost} />
              <div class="pg-status">
                {outcome.parseError ? (
                  <span class="pg-bad">
                    <code>{outcome.parseError.code}</code> at {outcome.parseError.line}:
                    {outcome.parseError.column} — {outcome.parseError.message}
                  </span>
                ) : (
                  <span class="pg-good">
                    valid · {outcome.valueCount} values
                    {digest ? <span class="pg-digest"> · sha256 {digest.slice(0, 16)}…</span> : null}
                  </span>
                )}
              </div>
            </div>

            <div class="pg-pane">
              <div class="pg-bar">
                <select
                  class="pg-select"
                  onchange={(e: Event) => (target = (e.currentTarget as HTMLSelectElement).value as Target)}
                >
                  {TARGETS.map((t) => (
                    <option value={t.id} selected={t.id === target}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <button type="button" class="pg-chip" disabled={!outcome.output} onclick={copyOutput}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              {outcome.parseError ? (
                <div class="pg-output pg-empty">
                  The document does not parse, so there is nothing to convert.
                </div>
              ) : outcome.convertError ? (
                <div class="pg-output pg-refused">
                  <strong>Refused.</strong> {outcome.convertError}
                </div>
              ) : outputIsStf ? (
                <pre class="pg-output">
                  <RawHtml html={highlightToHtml(outcome.output ?? "", TOKEN_CLASS)} />
                </pre>
              ) : (
                <pre class="pg-output">{outcome.output ?? ""}</pre>
              )}
              <div class="pg-status">
                <span class="pg-note">{targetNote}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

