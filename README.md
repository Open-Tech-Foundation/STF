# STF — Structured Text Format

A project of the [Open Tech Foundation](https://github.com/Open-Tech-Foundation).

**[🚀 Try the STF Playground](https://open-tech-foundation.github.io/DTXT/)**

> [!CAUTION]
> **EXPERIMENTAL PRE-RELEASE**
>
> STF is in an experimental, pre-release state, for research and feedback only.
> The specification and the reference implementations may change incompatibly at any time.
>
> The 1.0 draft specification is complete, but **the reference implementations have not yet
> caught up to it** — see [Conformance Status](#conformance-status).

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
| **Rust** | **258/258** | Conformant. The reference implementation. |
| **JavaScript** | **258/258** | Conformant. |
| Python | not yet run | Returns exact integers past 2^53 (spec §7.2 requires binary64) |
| Go | not yet run | Drops non-BMP characters in interpreted strings |

The remaining gap in Python and Go is spec §3.1: typed values are represented as strings with a
marker prefix (`"$decimal:1.5"`), which cannot be distinguished from a user string of the same
text and causes serialization to emit unparseable documents.

## Command-Line Tool

```sh
cargo install --path ref-impl/rust

stf check config.stf                  # verify, with normative error codes
stf fmt --write config.stf            # format in place
stf lint config.stf                   # flag stringly-typed values
stf canon config.stf | sha256sum      # canonical form, for hashing and signing
stf convert data.json --to stf        # refuses what STF cannot represent
```

Full reference: [doc/cli.md](doc/cli.md).

## Reference Implementations

- [Rust](ref-impl/rust/) — conformant; the reference
- [JavaScript / TypeScript](ref-impl/js/) — conformant
- [Python](ref-impl/python/)
- [Go](ref-impl/go/)

## Performance

**Payload size: STF is 15–18% smaller than JSON** on equivalent data, from unquoted keys and
one-character literals.

Parse speed depends far more on the implementation than on the format. Go's STF parser is
~21% faster than `encoding/json`; the JavaScript and Python implementations are slower than
their native JSON parsers, which are written in C++ and C respectively.

> These figures are not comparable across languages — each implementation benchmarks its own
> randomly-seeded dataset, and the Python baseline includes default `json.dumps` separator
> spacing. Treat them as within-language comparisons pending a benchmark rework. Full numbers:
> [benchmarks/RESULTS.md](benchmarks/RESULTS.md).

## License

Dedicated to the public domain under the
[CC0 1.0 Universal Public Domain Dedication](LICENSE).
