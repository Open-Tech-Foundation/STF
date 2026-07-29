// Builds /spec from the normative Markdown in `doc/`.
//
// The published specification is generated rather than transcribed, because a specification that
// says one thing in the repository and another on the website is worse than one that is only in
// the repository. `doc/spec.md` stays the single source of truth and this script is the only way
// its text reaches the site; there is no hand-maintained copy to fall out of step.
//
// Everything normative lands on one page. STF is one specification — the optional profiles and the
// error registry are separate *documents*, not separate specs, and putting each on its own route
// would have made the reader click to find out whether a rule exists. One page also means one
// Ctrl-F over the whole normative corpus, which is how specifications are actually read.
//
// Run deliberately, not on every build: `tsr spec` from the repository root. The outputs are
// committed, because the specification is the most stable thing here — it is what everything else
// is checked against — and putting a code generator on the critical path of every deploy earned
// nothing. Committing them also puts the rendered change in the diff, where a change to normative
// text belongs.
//
// The cost of committed generated output is drift, so `tsr spec-check` (this script with `--check`)
// re-derives them and exits non-zero if the working copy differs. Run it after editing doc/.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const outDir = join(here, "..", "app", "spec");

interface Source {
  /** File under `doc/`. */
  file: string;
  /** Anchor prefix. The core specification takes none, so `/spec#14-canonical-form` is the
   *  same anchor the repository's own cross-references already use. */
  prefix: string;
  /** Heading shown in the contents rail above this document's sections. */
  group: string;
  /** One line under that heading, saying what the document is and whether it is optional. */
  note: string;
}

const SOURCES: Source[] = [
  {
    file: "spec.md",
    prefix: "",
    group: "STF 1.0",
    note: "The format itself. Required of every implementation.",
  },
  {
    file: "stream.md",
    prefix: "stream",
    group: "STF Stream 1.0",
    note: "Optional profile — .stfs record streams.",
  },
  {
    file: "schema.md",
    prefix: "schema",
    group: "STF Schema 1.0",
    note: "Optional profile — validation.",
  },
  {
    file: "error-codes.md",
    prefix: "errors",
    group: "Error codes",
    note: "The normative registry referenced by §16.",
  },
];

/**
 * The MDX pipeline's own heading slug, reproduced so the contents rail and the headings agree.
 *
 * Verified against the compiler rather than assumed: `14. Canonical Form` becomes
 * `14-canonical-form` and `3.1 Type Distinctness (Critical)` becomes
 * `3-1-type-distinctness-critical` — note that the dot inside `3.1` becomes a separator here,
 * where GitHub would drop it. A rail built on a guess would have produced links that resolve to
 * nothing on exactly the subsections a reader is most likely to cite.
 */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Splits a document into fenced code blocks and everything else, so rewrites skip the code. */
function mapProse(markdown: string, fn: (prose: string) => string): string {
  return markdown
    .split(/(```[\s\S]*?```)/g)
    .map((part) => (part.startsWith("```") ? part : fn(part)))
    .join("");
}

/**
 * Points a cross-document link at its section of the single page.
 *
 * `[STF Stream](stream.md)` becomes `#stream`, and `spec.md#14-canonical-form` becomes
 * `#14-canonical-form`. Links to documents that are *not* published here — the migration guide
 * and the comparison, both of which are guides rather than normative text — keep pointing at the
 * repository, because a link into a page that does not exist is worse than a link that leaves.
 */
const REPO_URL = "https://github.com/Open-Tech-Foundation/STF/blob/main/doc";

/** Anchor prefix and section id for each published document, keyed by its filename. */
const PUBLISHED = new Map(SOURCES.map((s) => [s.file, { prefix: s.prefix, id: groupIdOf(s) }]));

/** The id of the heading that opens a document on the page. */
function groupIdOf(source: Source): string {
  return source.prefix || "stf-1-0";
}

function rewriteLinks(prose: string): string {
  return prose.replace(/\]\((?!https?:)([a-z-]+\.md)(#[^)]*)?\)/g, (_whole, file: string, hash) => {
    const target = PUBLISHED.get(file);
    if (!target) return `](${REPO_URL}/${file}${hash ?? ""})`;
    // A bare document link lands on that document's own heading, not on a slug derived from its
    // filename — `](spec.md)` pointed at `#spec`, which is nothing.
    if (!hash) return `](#${target.id})`;
    const anchor = hash.slice(1);
    return `](#${target.prefix ? `${target.prefix}-${anchor}` : anchor})`;
  });
}

/**
 * Turns a GitHub alert into something this pipeline renders.
 *
 * `> [!WARNING]` is GitHub's syntax and nothing else implements it, so the published page showed a
 * blockquote whose first characters were the literal `[!WARNING]` — on the paragraph that tells a
 * reader the specification is a draft, which is the one line on the page that must not look like a
 * typo. The marker becomes a labelled block instead.
 */
function rewriteAlerts(prose: string): string {
  return prose.replace(
    /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:^>.*\n)+)/gm,
    (_whole, kind: string, rest: string) => {
      const text = rest
        .split("\n")
        .map((line) => line.replace(/^>\s?/, ""))
        .join(" ")
        .trim();
      const label = kind.charAt(0) + kind.slice(1).toLowerCase();
      return `<div class="spec-alert spec-alert-${kind.toLowerCase()}">\n\n**${label}** — ${text}\n\n</div>\n\n`;
    },
  );
}

/**
 * Escapes the braces MDX would read as an expression.
 *
 * Only eight exist across all four documents and every one is prose about STF's own syntax — the
 * kind of thing a specification says a lot — so this is cheap insurance rather than a workaround.
 * Code fences are already excluded by `mapProse`, and inline code spans are left alone because MDX
 * does not evaluate them.
 */
function escapeBraces(prose: string): string {
  return prose
    .split(/(`[^`\n]*`)/g)
    .map((part) => (part.startsWith("`") ? part : part.replace(/([{}])/g, "\\$1")))
    .join("");
}

interface Entry {
  id: string;
  text: string;
  sub: boolean;
}

interface Group {
  group: string;
  note: string;
  id: string;
  entries: Entry[];
}

/**
 * Rewrites one document's headings and collects its contents.
 *
 * The core specification keeps Markdown headings and the slugs they generate. Every other document
 * gets raw HTML headings with prefixed ids, because both `spec.md` and `stream.md` open on a
 * section called Overview — on one page those collapse to the same anchor, and the loser is
 * silently unreachable. (The `{#id}` syntax would have been tidier and is not supported: the
 * compiler reads the brace as an expression and fails the build.)
 */
function transform(source: Source, markdown: string): { body: string; group: Group } {
  const entries: Entry[] = [];
  const groupId = groupIdOf(source);

  // The document's own H1 becomes the group heading; the page supplies its own title.
  const withoutTitle = markdown.replace(/^#\s+.*\n/, "");

  const body = mapProse(withoutTitle, (prose) =>
    escapeBraces(rewriteAlerts(rewriteLinks(prose))).replace(
      // `[ \t]*` rather than `\s*`: with the `m` flag `\s` matches a newline, so a greedy trailing
      // `\s*` swallowed the blank line after every heading and glued the first paragraph to it.
      /^(##{1,2})[ \t]+(.+?)[ \t]*$/gm,
      (_whole, hashes: string, text: string) => {
        // `##` is an h2. An earlier `+ 1` here pushed every heading down a level, which turned
        // each profile's top-level sections into h3s and inverted the rail's indentation.
        const level = hashes.length;
        const base = slug(text);
        const id = source.prefix ? `${source.prefix}-${base}` : base;
        entries.push({ id, text, sub: level === 3 });
        if (!source.prefix) return `${hashes} ${text}`;
        return `<h${level} id="${id}">${text}</h${level}>`;
      },
    ),
  );

  return { body, group: { group: source.group, note: source.note, id: groupId, entries } };
}

const groups: Group[] = [];
const parts: string[] = [];

for (const source of SOURCES) {
  const markdown = readFileSync(join(repo, "doc", source.file), "utf8");
  const { body, group } = transform(source, markdown);
  groups.push(group);
  parts.push(
    `<h2 class="spec-doc-title" id="${group.id}">${source.group}</h2>\n\n` +
      `<p class="spec-doc-note">${source.note}</p>\n\n${body.trim()}\n`,
  );
  group.entries.unshift({ id: group.id, text: source.group, sub: false });
}

// The banner is inside the file because the file is committed now, so it is reachable by anyone
// grepping the repository and editable by anyone who does not know better.
//
// An MDX expression comment, not an HTML one. `<!-- ... -->` is a parse error here — markdown-rs
// rejects it outright and says so, recommending exactly this form. (Raw HTML *elements* are fine,
// which is what the prefixed headings rely on; it is only the comment syntax that is refused.)
const BANNER =
  "{/* GENERATED from doc/*.md by website/scripts/gen-spec.ts. Do not edit.\n" +
  "    Edit the Markdown under doc/, then run `tsr spec` from the repository root. */}";

const page = `---
title: STF 1.0 Specification
description: The normative text — the format, its optional profiles, and the error registry, on one page.
---

${BANNER}

${parts.join("\n\n<hr class=\"spec-rule\" />\n\n")}
`;

const contents = `// GENERATED from doc/*.md by scripts/gen-spec.ts. Do not edit.
// Edit the Markdown under doc/, then run \`tsr spec\` from the repository root.
export interface SpecEntry { id: string; text: string; sub: boolean }
export interface SpecGroup { group: string; note: string; id: string; entries: SpecEntry[] }
export const CONTENTS: SpecGroup[] = ${JSON.stringify(groups, null, 2)};
`;

const OUTPUTS: [string, string][] = [
  ["page.mdx", page],
  ["contents.ts", contents],
];

const sections = groups.reduce((n, g) => n + g.entries.length, 0);
const summary = `${SOURCES.length} documents, ${sections} sections, ${page.length.toLocaleString()} chars`;

if (process.argv.includes("--check")) {
  const stale = OUTPUTS.filter(([name, want]) => {
    const path = join(outDir, name);
    return !existsSync(path) || readFileSync(path, "utf8") !== want;
  }).map(([name]) => name);

  if (stale.length > 0) {
    console.error(
      `app/spec is stale: ${stale.join(", ")}\n` +
        "doc/*.md has changed since the published specification was generated.\n" +
        "Run `tsr spec` from the repository root and commit the result.",
    );
    process.exit(1);
  }
  console.log(`  spec is up to date · ${summary}`);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, contents] of OUTPUTS) writeFileSync(join(outDir, name), contents);
  console.log(`  spec → app/spec/page.mdx · ${summary}`);
}
