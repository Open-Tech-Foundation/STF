# STF — Structured Text Format

A project of the [Open Tech Foundation](https://github.com/Open-Tech-Foundation).

**[🚀 Try the STF Playground](https://open-tech-foundation.github.io/DTXT/)**

> [!CAUTION]
> **EXPERIMENTAL PRE-RELEASE**
>
> STF is in an experimental, pre-release state, for research and feedback only.
> The specification and the reference implementations may change incompatibly at any time.
>
> The 1.0 draft specification is complete and all four reference implementations pass the
> conformance corpus — see [Conformance Status](#conformance-status).

## Overview

**STF (Structured Text Format)** is a human-readable, structured data format for configuration
and data interchange. It is designed to **replace** JSON, JSONC, JSON5, NDJSON, and JSONL for
new work — not to be a superset of them. STF deliberately does not inherit their looseness, so
some valid JSON has no STF representation; conversion fails loudly rather than guessing.

```stf
# A configuration file
{
  service: `checkout-api`,
  port: 8080,
  enabled: T,
  deploy_after: TIMESTAMP(2026-01-15T10:30:00Z),
  price_cap: DECIMAL(199.00),        # exact — scale is preserved
  account_id: BIGINT(9007199254740993),
  signing_key: BINARY(SGVsbG8=),
  regions: [`eu-west-1`, `us-east-1`],
}
```

### The problem it solves

JSON forces every non-primitive type through strings, so a reader cannot tell a date from a
string that looks like one, and `19.99` is never exactly 19.99. STF makes the type explicit at
the point of use, with no schema or convention required:

| JSON | STF |
| :--- | :--- |
| `"created": "2026-01-15"` — date, or string? | `created: DATE(2026-01-15)` |
| `"id": "9007199254740993"` — string to survive `JSON.parse` | `id: BIGINT(9007199254740993)` |
| `"price": 19.99` — binary64, not exact | `price: DECIMAL(19.99)` |
| `"blob": "SGVsbG8="` — base64 by convention | `blob: BINARY(SGVsbG8=)` |

### Key features

- **Unquoted keys** — `[A-Za-z0-9_-]+`, no quotes, no ambiguity.
- **Two string forms** — `` `raw` `` preserves everything literally; `"interpreted"` supports
  JSON escapes.
- **One-character literals** — `T`, `F`, `N` for true, false, null.
- **Explicit typed constructors** — `BIGINT`, `DECIMAL`, `DATE`, `TIMESTAMP`, `BINARY`.
- **Scale-sensitive decimals** — `DECIMAL(1.5)` ≠ `DECIMAL(1.50)`. Usable for money.
- **Comments** — `#` to end of line.
- **Trailing commas** — permitted in objects and arrays.
- **Canonical form** — one byte encoding per value, for hashing and signing.
- **Normative error codes** — every rejection maps to exactly one documented code.
- **Record streams** — [`.stfs`](doc/stream.md) for append-only event logs.

## Documentation

**Normative**

- [STF 1.0 Specification](doc/spec.md) — the format
- [Standardized Error Codes](doc/error-codes.md) — condition → code, exact
- [STF Stream Profile](doc/stream.md) — `.stfs` line-delimited record streams
- [STF Schema Specification](doc/schema.md) — optional validation layer

**Non-normative**

- [`stf` Command-Line Tool](doc/cli.md) — check, format, lint, canonicalize, convert
- [Migration Guide](doc/migration-guide.md) — from JSON, JSON5, NDJSON, DTXT, and pre-1.0 drafts
- [Comparison with Other Formats](doc/comparison.md)

## Conformance

The [conformance corpus](tests/conformance/) is the executable contract: 258 cases, each traced
to a normative rule. Runners must compare error codes **exactly** and check value **kinds**, so
a string can never satisfy a `DECIMAL` expectation.

```sh
./scripts/check_conformance.sh
```

### Conformance Status

| Implementation | Corpus | Notes |
| :--- | :--- | :--- |
| **Rust** | **258/258** | The reference implementation; also ships the `stf` CLI |
| **JavaScript** | **258/258** | |
| **Python** | **258/258** | |
| **Go** | **258/258** | |

All four implement the same eleven-kind data model, exact error codes, Canonical Form, and the
stream profile, and all four verify `parse(serialize(parse(input)))` on every value case.

## Command-Line Tool

```sh
cargo install --path ref-impl/rust

stf check config.stf                  # verify, with normative error codes
stf fmt --write config.stf            # format in place
stf lint config.stf                   # flag stringly-typed values
stf canon config.stf | sha256sum      # canonical form, for hashing and signing
stf convert data.json --to stf        # refuses what STF cannot represent
stf lsp                               # language server, for editors
```

Full reference: [doc/cli.md](doc/cli.md).

## Editor Support

`stf lsp` serves the Language Server Protocol over stdio, so any LSP-capable editor gets
diagnostics and formatting from the reference parser itself — the same normative error codes
`stf check` reports in CI, and the same warnings as `stf lint`, never a second approximate
implementation. `.stf` documents and `.stfs` streams are both served.

Configuration is per editor; see [doc/cli.md §8](doc/cli.md#8-lsp--editor-integration). VS Code
has no built-in client for a new language, so it uses the extension in
[`vscode-stf/`](vscode-stf/), which launches the same server.

## Reference Implementations

All four are conformant with STF 1.0.

- [Rust](ref-impl/rust/) — the reference; also the `stf` CLI
- [JavaScript / TypeScript](ref-impl/js/)
- [Python](ref-impl/python/)
- [Go](ref-impl/go/)

## Performance

**Payload size: STF is 18.3% smaller than JSON** on the same data, from unquoted keys and
one-character literals. Every implementation now generates the same fixed-seed dataset and
measures against a minified JSON baseline, so this figure is reproducible.

Parse speed depends far more on the implementation than on the format:

| | STF | Native JSON | |
| :--- | ---: | ---: | :--- |
| Rust | 70 ms | 113 ms (`serde_json`) | STF ~38% faster |
| Go | 73 ms | 95 ms (`encoding/json`) | STF ~23% faster |
| JS (Node) | 164 ms | 33 ms (`JSON.parse`) | native parser is C++ |
| Python | 1837 ms | 79 ms (`json.loads`) | pure-Python scanner vs C |

The honest summary: **STF's grammar is cheap to parse, but a reference implementation written
in the host language does not beat a native JSON parser written in C.** The Rust and Go rows
compare two parsers in the same language and are the meaningful ones; the JS and Python rows
compare an STF parser in the language against a JSON parser in C, and are not a property of
the format.

> Figures are within-language only — each implementation benchmarks its own dataset on its own
> machine. Full numbers: [benchmarks/RESULTS.md](benchmarks/RESULTS.md).

## License

Dedicated to the public domain under the
[CC0 1.0 Universal Public Domain Dedication](LICENSE).
