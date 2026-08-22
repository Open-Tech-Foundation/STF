# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

STF is an experimental pre-release format. Until 1.0 is tagged, the specification and
the reference implementations may change incompatibly at any time.

## [Unreleased]

### Added

- **STF Primitive Extensions — Geometry, Time, Duration** (`new.txt`): three new native semantic primitives preserving human-readability, fast parsing, and GeoJSON/ISO-8601 interoperability. Each implementation (`ref-impl/js`, `ref-impl/python`, `ref-impl/rust`, `ref-impl/go`) now offers `Geometry("Point"|"LineString"|"Polygon"|"MultiPoint"|"MultiLineString"|"MultiPolygon", coordinates)` (WGS84 `[lon,lat]`, closed rings, validation for nesting/closure), `Time("HH:mm"[:ss[.fraction]])` (00-23/00-59, no zone) and `Duration("P…")` (ISO-8601 `P[nY][nM][nW][nD][T[nH][nM][nS]]`). Serialization round-trips (`parse(serialize(v))≡v`), `toJSON()` emits GeoJSON `{type,coordinates}` for Geometry and payload strings for Time/Duration, and `fromJSON(...,{infer:true})`/`from_json(...,infer=True)`/`from_json_with_infer(...,true)` opt-in discovers GeoJSON geometry objects without cost on the hot path. Tagged JSON adds `$geo/$time/$dur`.
- Coordinate handling documented as `[longitude,latitude]` WGS84/EPSG:4326; future CRS support explicitly deferred.
- **`stf lsp` — a Language Server Protocol server** (`ref-impl/rust/src/lsp.rs`), replacing the
  editor tooling the deleted ESLint and Prettier plugins used to provide, and doing it for every
  LSP-capable editor rather than only JavaScript projects. It speaks LSP 3.17 over stdio and is
  a layer over the reference parser, not a second approximate one: the diagnostics an author
  sees while typing carry the same normative `ERR_*` code `stf check` reports in CI.
  - `textDocument/publishDiagnostics` — one error per malformed document, or one per malformed
    record for a `.stfs` stream (stream §5), plus `stf lint`'s warnings. Recomputed on open,
    change, and save; cleared on close.
  - `textDocument/formatting` — what `stf fmt` produces, honouring the client's `tabSize` and
    `insertSpaces`. A document that does not parse yields no edit at all, because a formatter
    that guesses at malformed input is worse than one that declines.
  - Framing follows the document URI's extension, so a `.stfs` file is diagnosed per record
    rather than as a document with trailing content.
  - Positions are converted to UTF-16 code units, the protocol's default encoding, which is
    neither what `Error` carries (byte offsets) nor what it reports (Unicode scalar columns).
    The server advertises `positionEncoding` explicitly.
- **`website/` — the new site**, scaffolded with [OTF Web](https://github.com/Open-Tech-Foundation/Web-App-Framework),
  the Open Tech Foundation's own framework, using its documentation template (MDX pages,
  generated sidebar and table of contents, static output). It carries an STF landing page, a
  documentation section of nine pages, and a working playground. The
  normative documents under `doc/` are unchanged and remain the source of truth; migrating
  them onto the site, and building the playground on the JavaScript reference implementation,
  are still to do. `site.url` is provisional.
  - **Playground**: CodeMirror with an STF language and theme, wired to the JavaScript reference
    implementation through a `file:` dependency on `ref-impl/js`. Diagnostics are the parser's
    own errors, positioned by its line and column and shown as editor markers, so the
    playground reports exactly what `stf check` reports. Conversions cover JSON, lossy JSON,
    tagged kinds, canonical form (with its SHA-256), and formatted STF — and a conversion the
    target cannot represent is *refused*, with the reason, rather than approximated.
  - **Documentation**: introduction, syntax, data model, typed constructors, canonical form,
    error codes, record streams, command-line tool, and migrating from JSON — written from the
    normative documents in `doc/`, which remain the source of truth.
  - The landing page is written as a specification's front page rather than a product page:
    what the normative sections define, with their section numbers; a capability comparison
    against JSON, JSON5, YAML, and TOML that says *Varies* wherever implementations genuinely
    disagree rather than claiming a win; the conformance table; and an explicit statement that
    the format is pre-release and offers no compatibility guarantee yet.
  - STF's accent is indigo (`#4f46e5` light, `#8b93ff` dark), set by overriding the docs
    theme's own `--otfw-*` tokens so the documentation shell and the landing page share one
    palette. The theme ships the Open Tech Foundation orange already used by
    `web.opentechf.org` and `esrun.opentechf.org`, and `tsr.opentechf.org` is green, so STF
    needed a hue of its own. Both values clear WCAG AA against the theme's backgrounds.
- **Continuous integration** (`.github/workflows/ci.yml`), on every push to `main` and every
  pull request. Until now the repository's only workflow deployed the playground, so nothing
  checked that the four implementations still agreed — the conformance corpus was the
  executable contract and no machine ran it. Eight jobs: the full conformance script across
  all four implementations, a check that `corpus.json` is exactly what `build_corpus.py`
  emits, the Rust library/CLI/language-server tests plus a release-build smoke test, the
  JavaScript, Python, and Go unit tests, the website build, and the VS Code extension's tests.
- Root `package.json` scripts for each implementation's tests (`test:rust`, `test:python`,
  `test:go`, `test:vscode`), so the CI jobs can be reproduced locally one at a time.
- **Directive highlighting** in the TextMate grammar (`syntax/stf.tmLanguage.json`), which had
  no rule for `@name(payload)` at all, and `.stfs` added to its file types.
- **`stf::lint`** — the lint rules as a library module returning structured warnings anchored to
  byte ranges. `stf lint` and the language server now share it, so the two cannot drift apart.
- **Source spans in the parser**, opt-in via `parse_document_with_spans` and
  `parse_record_with_spans`. `Spans::values` is recorded in pre-order, so it zips with a
  pre-order walk of the parsed tree (`lint::walk`); a plain `parse` records nothing and pays
  nothing. Positions are not part of the data model (spec §3), which is why this is opt-in
  rather than carried on `Value`.
- `stream::header_line` and `stream::record_lines`, which expose the framing a reader applies,
  so a tool can re-read a record's own bytes without re-deriving the line rules.
- `error::line_column` is now public: the one place a byte offset becomes a 1-based line and
  column, which every printed position goes through.

- `CHANGELOG.md`.
- Contribution rules for coding agents in `AGENTS.md`: Conventional Commits, no AI
  attribution trailers, changelog updates, and test requirements.
- **Spec §3 Data Model** — a normative, host-language-independent definition of the eleven
  STF value kinds. §3.1 makes in-band type sentinels (for example representing `DECIMAL(1.5)`
  as the string `"$decimal:1.5"`) explicitly non-conformant, and §3.2 defines equality per kind.
- **Spec §13 Serialization** — `parse(serialize(v)) ≡ v` as a MUST; a prohibition on inspecting
  string content to emit a constructor; and a requirement to fail rather than emit invalid output.
- **Spec §14 Canonical Form** — an optional profile giving a value exactly one byte encoding,
  for hashing, signing, and byte-level diffing. Default serialization still preserves authored
  member order and spacing.
- **Spec §15 Resource Limits** — nesting depth (MUST, default 64) plus optional document and
  payload size limits.
- **Spec §7.4 Token Boundaries** — a number or `T`/`F`/`N` literal may not be immediately
  followed by an identifier character, making `0x10`, `1_000`, `NaN`, and `Infinity` reject
  deterministically at the offending character.
- **Spec §5.1 Directives** — directives previously appeared only in the grammar with no prose.
  Placement, uniqueness, unknown-directive handling, and their exclusion from the data model
  are now defined.
- A normative **condition → code table** in `error-codes.md` covering every rejection the
  specification requires.
- New error codes: `ERR_INVALID_UTF8`, `ERR_NUMBER_OVERFLOW`, `ERR_UNREPRESENTABLE`, and
  `ERR_TRAILING_CONTENT` (the last was already emitted by several implementations but
  undocumented).
- **STF Stream profile** (`doc/stream.md`, `.stfs`) — an optional, line-delimited record format
  for append-only event logs, audit trails, and telemetry, serving the use case NDJSON/JSONL
  address. One STF document per line; a record may not contain a raw line terminator, so a
  reader can split on LF without parsing. Records are parsed independently, so a malformed
  record does not invalidate the stream. An optional header line carries stream-wide
  directives. The core discrete-document format is unchanged.
- Stream error codes `ERR_STREAM_RAW_NEWLINE` and `ERR_STREAM_DIRECTIVE_IN_RECORD`.
- **STF 1.0 conformance corpus** (`tests/conformance/corpus.json`, 258 cases) authored by
  `build_corpus.py`, with every case traced to a normative rule. Covers the full condition →
  code table, the `binary64` number domain, calendar validation, canonical form, and the
  stream profile.
- Corpus format and runner contract in `tests/conformance/README.md`. Expected values use
  tagged JSON (`{"$": "dec", "v": "1.50"}`) keyed on `$`, which is safe because `$` is not a
  legal STF key character — so a tagged value can never collide with a real parsed object.
- Strict JavaScript runner `tests/conformance/run_js.mjs`, which compares error codes exactly,
  checks value kinds, compares numbers as `binary64` bit patterns, and compares decimals on
  coefficient *and* scale.

- `migration-guide.md` §1.4 — the JSON constructs that have **no** STF representation
  (non-identifier keys, non-object roots, `NaN`/`Infinity`, duplicate keys), stated up front so
  a bulk migration can be planned. §1.5 lists the JSON5 syntax STF rejects.
- `migration-guide.md` §2 — NDJSON/JSONL → STF Stream.
- `migration-guide.md` §4 — migrating from pre-1.0 STF drafts, covering documents that now fail,
  documents that now parse differently, the removal of string-encoded typed values, and the move
  to exact error codes.
- `comparison.md` — sections comparing STF with JSONC, JSON5, and NDJSON/JSONL, which are now
  explicitly in scope.
- `README.md` — a Conformance Status table recording that no reference implementation yet meets
  the 1.0 draft, so the corpus being red is not mistaken for a regression.
- Schema error codes `ERR_SCHEMA_INVALID`, `ERR_SCHEMA_REQUIRED`, `ERR_SCHEMA_RANGE`,
  `ERR_SCHEMA_ENUM`, and `ERR_SCHEMA_UNKNOWN_FIELD`.
- Schema keywords `optional`, `nullable`, `const`, `enum`, `integer`, `items`, `fields`, and
  `additional`, joining `type`, `min`, `max`, and `scale`.
- **Rust reference implementation rewritten for STF 1.0** — the first implementation to pass
  the corpus, **258/258**, plus 85 unit tests. It is now the normative reference.
  - A real data model: `Value` has all eleven kinds of spec §3, with `Decimal`, `Date`,
    `Timestamp`, `Binary`, and `BigInt` as distinct host types. No `$type:` string sentinels.
  - `Object` preserves member order (§11.2) while comparing order-independently (§3.2), which
    the previous `FxHashMap` could not do.
  - Full constructor payload validation: the `DECIMAL` plain-notation grammar with 34
    significant digits and scale 6143, `BIGINT` with one spelling per value, proleptic
    Gregorian calendar validation with leap years and no leap seconds, and canonical
    RFC 4648 §4 base64 including trailing-bit checks.
  - Serializer with `parse(serialize(v)) == v` enforced, `ERR_UNREPRESENTABLE` instead of
    invalid output, and STF Canonical Form (§14).
  - STF Stream support (`.stfs`): `parse_stream` aborts on the first bad record, and
    `StreamReader` continues, reporting 1-based line numbers — both policies that stream §5
    requires implementations to offer.
  - JSON interchange that fails loudly in both directions, including on integers that
    `binary64` cannot hold exactly.
  - Exact error codes throughout, as a `Code` enum with byte offset, line, and column.
- `stf-conformance` binary implementing the runner contract of `tests/conformance/README.md` §3,
  including the round-trip check across compact, pretty, and canonical output.
- Rust benchmark rewritten with a fixed-seed generator and, for the first time, a
  `serde_json` baseline, so the Rust figures are reproducible and actually comparative.
- **`stf` command-line tool** (`doc/cli.md`), built on the Rust library:
  - `stf check` — verify, reporting `FILE:LINE:COLUMN: ERR_CODE: message`. For a stream it
    reports every malformed record rather than stopping at the first, since stream §5 makes
    records independently recoverable.
  - `stf fmt` — format, with `--write`, `--check` for CI, `--indent`, and `--compact`.
    Idempotent, and the output always reparses to an equal value.
  - `stf lint` — warn about what conformance cannot catch: unknown directives, and strings
    that are exactly a `DATE`/`TIMESTAMP` payload or a long digit run. Warnings only; nothing
    is ever rewritten into a constructor, which spec §13.2 forbids.
  - `stf parse` — print the data model as the corpus's tagged JSON, so the eleven kinds stay
    distinguishable.
  - `stf canon` — STF Canonical Form, for hashing and signing.
  - `stf convert` — STF ↔ JSON and STF Stream ↔ NDJSON/JSONL, refusing anything the target
    cannot express: a non-object JSON root, a key outside `[A-Za-z0-9_-]+`, an integer outside
    the exact `binary64` range, or a typed value on the way to JSON. `--lossy` opts into
    degrading typed values to JSON strings.
  - Exit codes: `0` success, `1` rejected input, `2` usage error.
- 21 end-to-end CLI tests driving the real binary, covering exit codes, the stdout/stderr
  split, in-place rewriting, idempotence, and stream line numbering.
- **JavaScript reference implementation rewritten for STF 1.0** — **258/258**, up from 158/258,
  plus 39 unit tests. Split from one 778-line file into `errors`, `value`, `constructors`,
  `parser`, `serialize`, `stream`, and `json` modules, mirroring the Rust layout.
  - Typed values are distinct host types: `STFDecimal`, `STFDate`, and `STFTimestamp` classes,
    the native `bigint` primitive, and `Uint8Array` for `BINARY`. No `$decimal:` strings.
  - `STFError` carries the normative code as a `.code` property, plus line and column. Callers
    no longer have to regex the message.
  - Member order survives a round trip even for keys JavaScript hoists. A plain object reorders
    array-index-like keys, so `{b: 1, 123: 2}` would otherwise serialize with `123` first; the
    authored order is recorded on a symbol and honoured by the serializer.
  - Adds Canonical Form, the STF Stream profile with both read policies, and JSON interchange.
  - `fromJSONText` rejects an integer `JSON.parse` would silently round, by scanning the source
    text before parsing.
- Corpus and unit-test scripts in `package.json`: `npm run conformance`, `npm test`.
- **Python reference implementation rewritten for STF 1.0** — **258/258**, plus 35 unit tests.
  `stf.py` becomes a `stf/` package with the same module layout as Rust and JavaScript.
  - The type mapping now keeps every kind distinguishable: Number is **always** `float`,
    BigInt is `int`, Binary is `bytes`, and Decimal, Date, and Timestamp are frozen
    dataclasses. `bool` is tested before `int` throughout, since it subclasses `int`.
  - `decimal.Decimal` is deliberately not used: its `==` compares numerically, so
    `Decimal("1.5") == Decimal("1.50")`, which spec §3.2 forbids.
  - `STFError` carries `.code`, `.line`, and `.column`.
  - Adds Canonical Form, the STF Stream profile with both read policies, and JSON interchange.
- `tests/conformance/run_python.py`, implementing the runner contract of
  `tests/conformance/README.md` §3.
- Python benchmark rewritten with a seeded generator. Its JSON baseline now uses
  `separators=(",", ":")`; Python's `json.dumps` default inserts a space after every
  separator, which had been inflating the JSON side by roughly the margin being measured.
- **Go reference implementation rewritten for STF 1.0** — **258/258**, plus 30 unit tests.
  `stf.go` becomes seven files with the same layout as the other three.
  - `*Object` replaces `map[string]STFValue`, so member order survives a round trip as
    spec §11.2 requires. Go maps have no order at all, so the previous implementation could
    not have complied.
  - Typed values are distinct Go types: `*big.Int`, `*Decimal`, `Date`, `Timestamp`, `[]byte`.
  - Interpreted strings decode and re-encode runes explicitly, so supplementary characters
    survive. The previous implementation dropped every non-BMP character.
  - `ParseBinary` decodes base64 directly, because `base64.StdEncoding` accepts non-canonical
    trailing bits that spec §10.5 requires rejecting.
  - `Error` carries `Code`, `Line`, and `Column`; `CodeOf` extracts the normative code.
  - Adds Canonical Form, the STF Stream profile with both read policies, and JSON interchange.
- Go benchmark rewritten with a seeded generator, moved to `cmd/benchmark`.
- `benchmarks/RESULTS.md` rewritten from fresh measurements of all four implementations.

### Changed

- **BREAKING — the VS Code extension is now a launcher for `stf lsp`** and requires the `stf`
  binary on `PATH`, or `stf.server.path` pointed at it. All 193 lines of `src/extension.ts`
  were an approximation of the grammar — a bracket counter that could report only `ERR_SYNTAX`
  and `ERR_UNTERMINATED`, missed every other rejection the specification defines, and flagged
  valid documents. It is replaced by a client that starts the server and gets the real
  diagnostics, so the editor and CI can no longer disagree. Formatting, which the extension
  never implemented, comes with it, as does per-record diagnosis of `.stfs` files. Settings
  `stf.server.path`, `stf.server.args`, and `stf.trace.server`, and the command
  **STF: Restart Language Server**, are new.
- The extension's manifest was still pointing at the `DTXT` repository, declared only `.stf`
  (never `.stfs`), and claimed an ISC licence in a CC0 repository. Its `README` documented
  `Date()`, `BigNumber()`, and `Binary()` — constructors that have not existed since the 1.0
  rename — and a `.dtxt` file extension.
- `tsconfig.json` moved to `node16` module resolution, which `vscode-languageclient` requires.
- **`stf lint` warnings now carry a line and column** — `FILE:LINE:COLUMN: warning: …`, the form
  errors already used. Previously a document warning carried no position at all and a stream
  warning carried the record's index rather than its line number, so neither could be clicked
  through in an editor or matched by a problem matcher.
- **BREAKING — Number domain.** Bare numbers are now defined as IEEE 754 `binary64`
  (spec §7.2). Precision loss past 2^53 is conformant; returning an arbitrary-precision
  integer for a large literal is now explicitly non-conformant. Use `BIGINT`/`DECIMAL` for
  exact values.
- **BREAKING — Numeric overflow.** A literal exceeding finite `binary64` range (`1e400`) is
  rejected with `ERR_NUMBER_OVERFLOW` instead of yielding an infinity.
- **BREAKING — `DECIMAL` payload grammar.** Now a formal production permitting plain notation
  only. Exponent notation (`1.5e3`), a trailing point (`1.`), and `NaN` are rejected.
- **BREAKING — Temporal validation.** `DATE` and `TIMESTAMP` require full proleptic-Gregorian
  calendar validity, including month lengths and leap years. `DATE(2026-02-31)` and
  `TIMESTAMP(...T99:30:00Z)` are now rejected. Leap seconds (`:60`) are rejected.
- **BREAKING — `BIGINT` payload.** Leading zeros (`BIGINT(007)`) and negative zero
  (`BIGINT(-0)`) are rejected rather than silently rewritten.
- **BREAKING — Unpaired surrogates.** A `\uD800`-style escape without a valid pair is rejected
  with `ERR_INVALID_STRING`. Substituting `U+FFFD` is prohibited.
- **BREAKING — Byte order mark.** A leading `U+FEFF` is not whitespace and is rejected.
- **BREAKING — Error codes are exact.** Reporting a related-but-different code is
  non-conformant. Conformance runners may no longer accept substitutions.
- Object member order MUST be preserved by parsers and serializers, but does not affect
  value equality.
- Duplicate object keys, the maximum nesting depth of 64, and trailing-comma support are now
  stated normatively in the spec rather than implied by tests.
- `DECIMAL` significant digits are now precisely defined: leading zeros are not significant,
  trailing zeros are. The 34-digit cap applies to the coefficient; scale is capped separately
  at 6143 (decimal128 exponent range). `DECIMAL(0.0...01)` with 38 fraction digits is valid.
- `BINARY` padding is described correctly as canonical RFC 4648 §4 encoding. Padding appears
  only when the octet count is not a multiple of 3, so `BINARY(SGVsbG9X)` correctly carries
  no `=`. An empty payload, `BINARY()`, is now valid and denotes the empty octet sequence.
- `ERR_NESTED_CONSTRUCTOR` has a precise trigger: `(` encountered while scanning a payload.
- `ERR_DOCUMENT_SIZE` and `ERR_PAYLOAD_SIZE` are marked OPTIONAL with no default limit.
- **The website's framework packages move to `@opentf/web` 0.25.0, `@opentf/web-docs` 0.22.0, and
  `@opentf/web-cli` 1.23.1** (from 0.24.0, 0.21.0, and 1.22.0). The static build, the `lib` unit
  tests, `tsr spec-check`, and a `--frozen-lockfile` install all pass on the new versions, and
  `bun.lock` stays at `lockfileVersion: 1` so the deploy host can still read it. The update fixes
  nothing visible here: the three hydration errors in the pre-rendered output — a mismatched `<h3>`
  on `/spec`, a mismatched region marker and a null `output` read on `/playground` — reproduce
  byte-for-byte on both the old and new versions, and remain open.

### Removed

- **`eslint-plugin-stf` and `prettier-plugin-stf`**, along with the root `eslint.config.js`,
  `.prettierrc`, and `package-lock.json` that wired them up. Both plugins were broken and
  redundant. `prettier-plugin-stf` loaded `ref-impl/ts/dist/dtxt.cjs`, a path deleted with the
  TypeScript implementation, so it could not be loaded at all. `eslint-plugin-stf` hand-rolled
  a second STF parser whose keyword list was `Date`/`BigNumber`/`Binary` — pre-1.0 names that
  are not STF constructors — and its three rules only restated conformance failures that the
  real parser already rejects with exact error codes. Keeping a second, drifting parser to
  duplicate `stf fmt` and `stf lint` is not worth the maintenance. The root config files
  referenced `./prettier-plugin-dtxt/` and `./eslint-plugin-dtxt/`, directories that no longer
  existed under those names, and the root lockfile was still named `DTXT` and pinned an
  `@assemblyscript/loader` dependency that `package.json` had already dropped.
  Formatting and linting are now the `stf` CLI's job (`stf fmt`, `stf lint`), backed by the
  normative parser, with an LSP server serving editors. Migrating to Biome instead was considered
  and rejected: its plugin system queries the CST of languages Biome already parses and cannot
  register a new one, so STF cannot be supported there by a third party at all.
- **The `web/` playground and the GitHub Pages workflow that deployed it.** The playground
  imported a `stringify` binding that `ref-impl/js` stopped exporting in the 1.0 rewrite, so it
  had not built since — and because deploying it was the repository's only workflow, CI was
  red on every push while nothing else was checked at all. It is superseded by the new site,
  which will carry the playground and the format-conversion tool. The README's link to the old
  Pages deployment is gone with it.
- The VS Code extension's committed build output (`vscode-stf/out/`), now gitignored and
  produced by `npm run compile`, and a stray `package.json.tmp`. Its `.vscodeignore` no longer
  excludes `node_modules`, which would have packaged an extension whose runtime dependency was
  missing.
- `tests/conformance/tests.json`, the superseded pre-1.0 corpus. All four implementations now
  run `corpus.json`, so the 93-case suite that reported everyone passing while they disagreed
  on 25 of 80 edge cases has no remaining reader.
- The generated benchmark datasets (`benchmarks/*/bench_*.{stf,json}`) from version control —
  **81 MB** of regenerable output, including three orphaned copies under `benchmarks/rust/`
  from earlier naming. Every benchmark now generates its dataset from a fixed seed, so the
  files are reproducible on demand and are gitignored instead.
- The `bytedance/sonic` dependency from the Go module, which only the benchmark used. The Go
  module now has no dependencies at all, and its `go.sum` is gone with it.
- `ref-impl/python/run_conformance.py`, superseded by `tests/conformance/run_python.py`, and
  the checked-in `dtxt_rs.so` / `libdtxt_rs.so` build artifacts, which were outputs of the
  removed PyO3 bindings.
- `ref-impl/js/run_conformance.ts` and `test_stf.ts`, which ran the superseded pre-1.0
  `tests.json`, and `repro_format.ts`, a scratch file importing a `dtxt.ts` that no longer
  exists.
- `stf-convert.ts`, superseded by the `stf` binary. Nothing referenced it, and it did the
  silent repair the project now refuses: given JSON whose root is not an object it invented a
  wrapper key, and given ordinary JSON it could emit STF that no parser accepts.
- The non-functional PyO3 bindings from the Rust crate. Its `dumps` was a placeholder that
  returned `# Serialized from Rust\n{:?}`, its parser recognized `BigNumber`, `Binary`, and
  `Date` — none of which are STF constructors — and it contained a duplicated block of dead
  code. Nothing imported it. The Python reference implementation is pure Python.
- Dead test files: `tests/conformance/run_all.mjs`, `run_conformance.mjs`, and the stale
  `results_ts.json`, `results_python.json`, `results_zig.json` outputs (Zig was pruned
  earlier). Nothing referenced them.
- `doc/edge-cases.md`. Every rule it stated is now in the specification with more precision
  (§6.3, §10.2, §10.4, §10.5), and the duplicate had already drifted — it claimed `BINARY`
  padding was mandatory, which is wrong for payloads whose length is already a multiple of 4.

### Fixed

- **BREAKING — `schema.md` rewritten.** A schema is now expressed in plain STF, with constraints
  as objects: ``{ type: `String`, min: 1, max: 100 }``. The previous draft used a DSL
  (`String(min: 1, max: 100)`, `BINARY?`, `Array<String>`, bare `DATE`) that was **not valid
  STF** — every line of its own example failed to parse — while §1 claimed a schema document was
  itself a valid STF document. Plain STF honours that claim and means the core parser,
  formatter, linter, and editor tooling work on schema files with no second grammar to
  implement. Constraint bounds are real STF values, so `min: DECIMAL(0.00)` retains its scale.
- `schema.md` type names are TitleCase and map one-to-one onto the eleven data-model kinds of
  spec §3. The incoherent `Int` type ("floating-point or 64-bit integer") is replaced by
  `Number` with an `integer: T` constraint.
- `schema.md` corrected `scale ≤ 34` to the 0–6143 range of spec §10.2. Scale and significant
  digits are different quantities; the 34-digit cap applies to the coefficient.
- `comparison.md` no longer rates STF's parsing speed as "Extreme" against JSON's "Very Fast",
  and drops the claim of SIMD-accelerated parsing, which no implementation performs. Performance
  claims now match what the repository's benchmarks measure, including the cases where a native
  JSON parser is faster, and carry a caveat that the figures are not comparable across languages.
- `README.md` performance section rewritten on the same basis. It previously claimed compiled
  STF implementations "outperform standard JSON parsers and serializers" and labelled Rust
  "Overall Fastest" with no JSON baseline measured, while the same table showed Go's Sonic
  parsing faster.
- `ref-impl/rust/Cargo.toml` listed `cdylib` twice in `crate-type`, which made Cargo panic
  (`assertion failed: mtimes.insert(...).is_none()`) on every rebuild after a clean build.
- Spec §10.1 defined the reserved constructor namespace as `[A-Z][A-Z0-9_]*` while claiming
  it covered `Date(…)`, which it does not match. The rule is now stated as it must be
  implemented: an uppercase-initial identifier, or a case-insensitive match of a defined name.
- Spec §6.2 now says how to distinguish whitespace inside a key (`{a b: 1}`,
  `ERR_INVALID_IDENTIFIER`) from a missing colon (`{a 1}`, `ERR_MISSING_COLON`). Both are a
  key followed by whitespace and an unexpected token; only the following context separates them.
- `benchmarks/RESULTS.md` claimed all four implementations passed a "93-test STF 1.0
  conformance suite" at 100%, and reported per-language payload sizes that disagreed by three
  percentage points because each generated a differently-shaped dataset and Python measured
  against a non-minified JSON baseline. All four now agree at 18.3%.
- The Go module path said `dtxt`; it is now `github.com/Open-Tech-Foundation/stf/ref-impl/go`.
- The root `package.json` was not valid JSON — it carried a stray trailing `}`, so every tool
  that read it failed. It also declared an `@assemblyscript/loader` dependency that nothing
  imported. `ref-impl/js/package.json` pointed `main` at a non-existent `index.js` and ran a
  `test` script for a `test_dtxt.ts` that no longer exists.
- `scripts/check_conformance.sh` ran the superseded pre-1.0 per-implementation suites, stopped
  at the first failure because of `set -e`, and then printed "All reference implementations
  passed" regardless. It now runs the 1.0 corpus runners, reports every implementation, and
  exits non-zero when any of them fails.
- The EBNF grammar now threads `ws` through objects and arrays. The previous grammar rejected
  `{ a: 1 }` with spaces around the braces and commas, contradicting the prose and every example.
- Carriage return is defined as whitespace on its own. The prose previously described it only
  as part of `\r\n` while the grammar admitted a lone `\r`.
- `interpreted_char` correctly excludes `"`, `\`, LF, and CR. The previous rule excluded the
  backslash without saying so and admitted a literal CR.
- Constructor payloads may be empty, so the empty octet sequence is now expressible.
- Spec cross-references and section numbering corrected throughout.
