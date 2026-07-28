// The playground.
//
// It runs `@open-tech-foundation/stf` — the JavaScript reference implementation — in the
// browser, so the diagnostics here are the ones `stf check` reports and the conversions are the
// ones `stf convert` performs, refusals included. Nothing in this page decides what is valid.
//
// Monaco is loaded on mount, never during the static build: the editor touches `window` and
// `self`, and the page is pre-rendered.

import { onMount, RawHtml } from "@opentf/web";

import { canonicalDigest, convert, SAMPLES, TARGETS, type Target } from "../../lib/convert.ts";
import { highlightToHtml, type TokenKind } from "../../lib/highlight.ts";
import { LANGUAGE_ID, registerStf, THEME_ID } from "../../lib/monaco-stf.ts";

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
  let editor: import("monaco-editor").editor.IStandaloneCodeEditor | undefined;
  let monaco: typeof import("monaco-editor") | undefined;

  const outcome = $derived(convert(source, target));
  const targetNote = $derived(TARGETS.find((t) => t.id === target)?.note ?? "");
  const outputIsStf = $derived(target === "canonical" || target === "formatted");

  onMount(() => {
    let disposed = false;

    // Monaco is bundled separately by `bun run monaco` and served from /monaco/. It cannot go
    // through the site's bundler: Monaco's modules import CSS, and Rolldown has removed CSS
    // bundling. The specifier is held in a variable so the bundler leaves it alone and it
    // stays a runtime import of a static file — the approach the docs theme's search uses for
    // its pagefind index.
    const url = "/monaco/editor.api.js";
    if (!document.querySelector("link[data-monaco]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/monaco/editor.api.css";
      link.dataset.monaco = "";
      document.head.appendChild(link);
    }

    import(/* @vite-ignore */ url).then((m) => {
      if (disposed) return;
      monaco = m as typeof import("monaco-editor");

      // Monaco asks for a worker for features this page does not use (diffing, links). A
      // no-op worker satisfies the call without shipping a worker bundle; Monarch
      // tokenization and the markers below both run on the main thread regardless.
      (self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
        getWorker: () => new Worker(URL.createObjectURL(new Blob([""], { type: "text/javascript" }))),
      };

      registerStf(monaco);
      editor = monaco.editor.create(editorHost, {
        value: source,
        language: LANGUAGE_ID,
        theme: THEME_ID,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        lineNumbersMinChars: 3,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: "line",
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      });

      editor.onDidChangeModelContent(() => {
        source = editor!.getValue();
      });

      applyMarkers();
    });

    return () => {
      disposed = true;
      editor?.dispose();
    };
  });

  // The editor's red squiggle is the reference parser's error, positioned by its own
  // line/column — not a guess made from the Monarch grammar.
  function applyMarkers() {
    if (!monaco || !editor) return;
    const model = editor.getModel();
    if (!model) return;
    const error = outcome.parseError;
    monaco.editor.setModelMarkers(model, "stf", error
      ? [
          {
            severity: monaco.MarkerSeverity.Error,
            message: error.message,
            code: error.code,
            startLineNumber: error.line,
            startColumn: error.column,
            endLineNumber: error.line,
            endColumn: error.column + 1,
          },
        ]
      : []);
  }

  $effect(() => {
    // Depend on the outcome so markers follow every edit.
    void outcome;
    applyMarkers();
  });

  $effect(() => {
    const current = source;
    canonicalDigest(current).then((value) => {
      if (current === source) digest = value;
    });
  });

  function loadSample(index: number) {
    source = SAMPLES[index].source;
    editor?.setValue(source);
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

