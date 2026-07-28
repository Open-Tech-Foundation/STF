// STF support for Monaco: a Monarch grammar for colour, and a theme matching the site's
// code panels.
//
// The grammar here is for *appearance only*. Whether a document is valid is decided by the
// reference parser (`@open-tech-foundation/stf`), whose errors become editor markers — so the
// playground can never disagree with `stf check` about what is an error, no matter what the
// tokenizer thinks of a line.

import type * as MonacoNs from "monaco-editor";

export const LANGUAGE_ID = "stf";
export const THEME_ID = "stf-dark";

/** Mirrors the scopes in `syntax/stf.tmLanguage.json`. */
const MONARCH: MonacoNs.languages.IMonarchLanguage = {
  defaultToken: "",
  constructors: ["BIGINT", "DECIMAL", "DATE", "TIMESTAMP", "BINARY"],

  tokenizer: {
    root: [
      [/#.*$/, "comment"],

      // Directives lead the document: @name(payload)
      [/(@)([A-Za-z0-9_-]+)(\()([^)]*)(\))/, ["delimiter", "keyword.directive", "delimiter", "string.payload", "delimiter"]],

      // A known constructor followed immediately by its payload. The payload is opaque text,
      // never a nested value, so it is consumed whole.
      [
        /([A-Z][A-Za-z0-9_]*)(\()([^)]*)(\))/,
        [
          { cases: { "@constructors": "type.constructor", "@default": "invalid" } },
          "delimiter",
          "number.payload",
          "delimiter",
        ],
      ],

      // A key is an identifier followed by a colon.
      [/[A-Za-z0-9_-]+(?=\s*:)/, "key"],

      [/`/, { token: "string.raw", next: "@rawString" }],
      [/"/, { token: "string", next: "@interpretedString" }],

      [/\b[TFN]\b/, "constant.literal"],
      [/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?/, "number"],
      [/[{}[\],:]/, "delimiter"],
    ],

    rawString: [
      // Raw strings have no escapes at all: everything up to the next backtick is literal.
      [/[^`]+/, "string.raw"],
      [/`/, { token: "string.raw", next: "@pop" }],
    ],

    interpretedString: [
      [/[^\\"]+/, "string"],
      [/\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4})/, "string.escape"],
      [/\\./, "invalid"],
      [/"/, { token: "string", next: "@pop" }],
    ],
  },
};

/** Colours matching the landing page's panels, on the same background. */
const THEME: MonacoNs.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: true,
  colors: {
    "editor.background": "#0b1020",
    "editorLineNumber.foreground": "#3b4463",
    "editorLineNumber.activeForeground": "#8b93ff",
    "editor.lineHighlightBackground": "#131a33",
    "editorCursor.foreground": "#8b93ff",
    "editor.selectionBackground": "#26315c",
  },
  rules: [
    { token: "comment", foreground: "5b6478", fontStyle: "italic" },
    { token: "keyword.directive", foreground: "c084fc" },
    { token: "string.payload", foreground: "c084fc" },
    { token: "key", foreground: "e2e8f0" },
    { token: "string", foreground: "7dd3fc" },
    { token: "string.raw", foreground: "7dd3fc" },
    { token: "string.escape", foreground: "f472b6" },
    { token: "type.constructor", foreground: "a5b4fc", fontStyle: "bold" },
    { token: "number.payload", foreground: "fbbf24" },
    { token: "number", foreground: "fbbf24" },
    { token: "constant.literal", foreground: "f472b6" },
    { token: "delimiter", foreground: "64748b" },
    { token: "invalid", foreground: "f87171" },
  ],
};

let registered = false;

/** Registers the language and theme once per page. */
export function registerStf(monaco: typeof MonacoNs): void {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: LANGUAGE_ID, extensions: [".stf", ".stfs"] });
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, MONARCH);
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: "#" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
    ],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: "[", close: "]" },
      { open: "`", close: "`" },
      { open: '"', close: '"' },
    ],
  });
  monaco.editor.defineTheme(THEME_ID, THEME);
}
