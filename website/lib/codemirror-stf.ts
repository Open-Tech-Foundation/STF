// STF support for CodeMirror: a stream language, a highlight style, an editor theme, and a
// linter that reports the reference parser's errors.
//
// The grammar is for appearance only. What counts as an error is decided by the parser, whose
// diagnostics carry their normative `ERR_*` code — the tokenizer never gets a vote.
//
// CodeMirror is used rather than Monaco because it ships its styles as JavaScript, so nothing
// imports a `.css` file and the site's bundler can build it directly. It is the same editor
// obj-diff's site uses.

import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// The constructor list comes from the implementation, not a copy: if the specification ever
// gains one, the editor colours it without a second edit here.
import { CONSTRUCTOR_NAMES } from "@open-tech-foundation/stf";

interface State {
  /** The delimiter of the string being scanned, when one is still open across lines. */
  inString: '"' | "`" | null;
  /** Where the scanner is inside `NAME(payload)`. A payload is opaque text (spec §10), so it
   * is one token rather than whatever its characters would otherwise tokenize as. */
  ctor: "open" | "payload" | null;
}

/** Continues a string that is still open, which a raw string may be across lines. */
function scanString(stream: Parameters<NonNullable<StreamParser<State>["token"]>>[0], state: State) {
  const quote = state.inString!;
  while (!stream.eol()) {
    const ch = stream.next();
    if (quote === '"' && ch === "\\") {
      stream.next();
      continue;
    }
    if (ch === quote) {
      state.inString = null;
      break;
    }
  }
  return quote === "`" ? "rawString" : "string";
}

/** Token names map onto the tags styled below.
 *
 * `token` is a plain function, not a method: CodeMirror calls it unbound, so `this` is
 * undefined inside it. */
function token(stream: Parameters<NonNullable<StreamParser<State>["token"]>>[0], state: State) {
  {
    // A raw string may run across lines, so an open one is resumed here.
    if (state.inString) {
      return scanString(stream, state);
    }

    // The payload of the constructor whose name was just returned.
    if (state.ctor === "open") {
      state.ctor = "payload";
      stream.next(); // "("
      return "punctuation";
    }
    if (state.ctor === "payload") {
      if (stream.peek() === ")") {
        state.ctor = null;
        stream.next();
        return "punctuation";
      }
      while (!stream.eol() && stream.peek() !== ")") stream.next();
      return "payload";
    }

    if (stream.eatSpace()) return null;

    // Comments run to the end of the line (spec §4).
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }

    // Directives: @name(payload), before the root object (spec §5.1).
    if (stream.match(/^@[A-Za-z0-9_-]+/)) return "directive";

    if (stream.peek() === "`" || stream.peek() === '"') {
      state.inString = stream.next() as '"' | "`";
      return scanString(stream, state);
    }

    // A constructor is a known name immediately followed by `(`; the payload is opaque text,
    // never a nested value (spec §10).
    const ctor = stream.match(/^([A-Z][A-Za-z0-9_]*)(?=\()/) as RegExpMatchArray | null;
    if (ctor) {
      const known = (CONSTRUCTOR_NAMES as readonly string[]).includes(ctor[1]);
      state.ctor = "open";
      return known ? "constructor" : "invalid";
    }

    if (stream.match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/)) return "number";

    const word = stream.match(/^[A-Za-z0-9_-]+/) as RegExpMatchArray | null;
    if (word) {
      if (/^[TFN]$/.test(word[0])) return "literal";
      // A key is an identifier followed by a colon.
      return /^\s*:/.test(stream.string.slice(stream.pos)) ? "key" : null;
    }

    stream.next();
    return "punctuation";
  }
}

const stfParser: StreamParser<State> = {
  name: "stf",
  startState: () => ({ inString: null, ctor: null }),
  token,
  languageData: { commentTokens: { line: "#" } },
};

/** The colours the landing page's code panels use. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "#5b6478", fontStyle: "italic" },
  { tag: tags.meta, color: "#c084fc" },
  { tag: tags.propertyName, color: "#e2e8f0" },
  { tag: tags.string, color: "#7dd3fc" },
  { tag: tags.special(tags.string), color: "#7dd3fc" },
  { tag: tags.typeName, color: "#a5b4fc", fontWeight: "600" },
  { tag: tags.number, color: "#fbbf24" },
  { tag: tags.bool, color: "#f472b6" },
  { tag: tags.punctuation, color: "#64748b" },
  { tag: tags.invalid, color: "#f87171" },
]);

/** Maps this parser's token names onto the tags above. */
const tokenTable = {
  comment: tags.comment,
  directive: tags.meta,
  key: tags.propertyName,
  string: tags.string,
  rawString: tags.special(tags.string),
  constructor: tags.typeName,
  payload: tags.number,
  number: tags.number,
  literal: tags.bool,
  punctuation: tags.punctuation,
  invalid: tags.invalid,
};

const theme = EditorView.theme(
  {
    "&": { color: "#cbd5e1", backgroundColor: "#0b1020", fontSize: "13px" },
    ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", padding: "12px 0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#8b93ff" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#26315c",
    },
    ".cm-gutters": { backgroundColor: "#0b1020", color: "#3b4463", border: "none" },
    ".cm-activeLine": { backgroundColor: "#131a3355" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#8b93ff" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px" },
    ".cm-scroller": { lineHeight: "1.7" },
    ".cm-tooltip": { backgroundColor: "#131a33", border: "1px solid #2a3255", color: "#cbd5e1" },
    ".cm-diagnostic-error": { borderLeftColor: "#f87171" },
  },
  { dark: true },
);

/** Diagnostics as CodeMirror sees them, from a parse of the current document. */
export type Parse = (text: string) => { code: string; message: string; offset: number } | null;

/** Everything the playground needs: language, colours, theme, and parser-backed diagnostics. */
export function stfExtensions(parse: Parse) {
  return [
    StreamLanguage.define({ ...stfParser, tokenTable }),
    syntaxHighlighting(highlightStyle),
    theme,
    linter((view): Diagnostic[] => {
      const text = view.state.doc.toString();
      const error = parse(text);
      if (!error) return [];
      // `offset` is in UTF-16 code units — the same coordinates as the document.
      const from = Math.max(0, Math.min(error.offset < 0 ? 0 : error.offset, text.length));
      return [
        {
          from,
          to: Math.min(from + 1, text.length),
          severity: "error",
          source: error.code,
          message: error.message,
        },
      ];
    }),
  ];
}
