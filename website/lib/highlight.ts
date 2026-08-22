// A tokenizer for STF, for the code panels on this site.
//
// The framework's CodeBlock does not highlight runtime strings — highlighting is a build-time
// pass over Markdown fences — and no off-the-shelf highlighter knows STF. Writing one is
// cheap because the grammar is small and we own it: the token kinds below are the same ones
// `syntax/stf.tmLanguage.json` scopes.
//
// This is presentation only. It never decides whether a document is *valid* — that is the
// parser's job, and the playground will use the real one.

export type TokenKind =
  | "comment"
  | "directive"
  | "key"
  | "string"
  | "constructor"
  | "payload"
  | "number"
  | "literal"
  | "punct"
  | "plain";

export interface Token {
  text: string;
  kind: TokenKind;
}

const CONSTRUCTORS = ["BIGINT", "DECIMAL", "DATE", "TIMESTAMP", "BINARY", "Geometry", "GEOMETRY", "Time", "TIME", "Duration", "DURATION"];

const isIdent = (c: string) => /[A-Za-z0-9_-]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

export function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  const push = (text: string, kind: TokenKind) => {
    if (!text) return;
    // Runs of the same kind merge, which keeps the emitted DOM small.
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };

  while (i < source.length) {
    const c = source[i];

    // Comments run to the end of the line (spec §4).
    if (c === "#") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j++;
      push(source.slice(i, j), "comment");
      i = j;
      continue;
    }

    // Raw strings preserve everything literally; interpreted strings take JSON escapes.
    if (c === "`" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < source.length && source[j] !== quote) {
        if (quote === '"' && source[j] === "\\") j++;
        j++;
      }
      push(source.slice(i, Math.min(j + 1, source.length)), "string");
      i = j + 1;
      continue;
    }

    // Directives: `@name(payload)` before the root object (spec §5.1).
    if (c === "@") {
      let j = i + 1;
      while (j < source.length && isIdent(source[j])) j++;
      push(source.slice(i, j), "directive");
      i = j;
      continue;
    }

    if (isIdent(c)) {
      let j = i;
      while (j < source.length && isIdent(source[j])) j++;
      const word = source.slice(i, j);

      // A constructor is a known name followed immediately by `(`; its payload is opaque
      // text, not a nested value (spec §10).
      if (source[j] === "(" && CONSTRUCTORS.includes(word)) {
        push(word, "constructor");
        push("(", "punct");
        let k = j + 1;
        while (k < source.length && source[k] !== ")") k++;
        push(source.slice(j + 1, k), "payload");
        if (source[k] === ")") push(")", "punct");
        i = k + 1;
        continue;
      }

      // A number cannot start with an identifier character, so a bare word here is either a
      // literal or a key. Keys are what is followed by `:`.
      let k = j;
      while (k < source.length && (source[k] === " " || source[k] === "\t")) k++;
      if (source[k] === ":") {
        push(word, "key");
      } else if (word === "T" || word === "F" || word === "N") {
        push(word, "literal");
      } else {
        push(word, "plain");
      }
      i = j;
      continue;
    }

    if (isDigit(c) || ((c === "-" || c === "+") && isDigit(source[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < source.length && /[0-9.eE+-]/.test(source[j])) j++;
      push(source.slice(i, j), "number");
      i = j;
      continue;
    }

    if ("{}[],:".includes(c)) {
      push(c, "punct");
      i++;
      continue;
    }

    push(c, "plain");
    i++;
  }

  return out;
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ESCAPE[c]);
}

/**
 * Highlights `source` as an HTML fragment of `<span class="…">` tokens.
 *
 * Returned as markup rather than as elements because a mixed array of text nodes and
 * elements inside a `<pre>` does not survive hydration — the HTML parser merges adjacent
 * text, the hydrator's walk no longer lines up, and the render throws a DOMException that
 * empties the component. One node avoids the whole problem. Text is escaped here, so this
 * is safe for untrusted input.
 */
export function highlightToHtml(source: string, classOf: Record<TokenKind, string>): string {
  return tokenize(source)
    .map((token) => {
      const text = escapeHtml(token.text);
      const cls = classOf[token.kind];
      return cls ? `<span class="${cls}">${text}</span>` : text;
    })
    .join("");
}
