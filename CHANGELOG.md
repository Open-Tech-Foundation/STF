# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

STF is an experimental pre-release format. Until 1.0 is tagged, the specification and
the reference implementations may change incompatibly at any time.

## [Unreleased]

### Added

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

### Changed

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

### Fixed

- The EBNF grammar now threads `ws` through objects and arrays. The previous grammar rejected
  `{ a: 1 }` with spaces around the braces and commas, contradicting the prose and every example.
- Carriage return is defined as whitespace on its own. The prose previously described it only
  as part of `\r\n` while the grammar admitted a lone `\r`.
- `interpreted_char` correctly excludes `"`, `\`, LF, and CR. The previous rule excluded the
  backslash without saying so and admitted a literal CR.
- Constructor payloads may be empty, so the empty octet sequence is now expressible.
- Spec cross-references and section numbering corrected throughout.
