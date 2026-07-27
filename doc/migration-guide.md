# Migration Guide → STF 1.0

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

Non-normative. The normative rules are in [spec.md](spec.md) and [error-codes.md](error-codes.md).

| Migrating from | Section |
| :--- | :--- |
| JSON, JSONC, JSON5 | [§1](#1-from-json-jsonc-and-json5) |
| NDJSON, JSONL | [§2](#2-from-ndjson-and-jsonl) |
| Legacy DTXT | [§3](#3-from-legacy-dtxt) |
| Pre-1.0 STF drafts | [§4](#4-from-pre-10-stf-drafts) |

---

## 1. From JSON, JSONC, and JSON5

### 1.1 STF Is a Replacement, Not a Superset

STF is designed to **replace** JSON for new work, not to accept everything JSON accepts.
It deliberately does not inherit JSON's looseness. Some valid JSON therefore has **no STF
representation at all**, and conversion of those documents fails by design rather than
silently mangling them.

Read §1.4 before planning a bulk migration.

### 1.2 Quick Reference

| Concept | JSON | STF 1.0 |
| :--- | :--- | :--- |
| Root | any value | object `{}` only |
| Keys | `"key"` | `key` — unquoted identifier |
| True / False / Null | `true` / `false` / `null` | `T` / `F` / `N` |
| String | `"text"` | `` `text` `` (raw) or `"text"` (interpreted) |
| Multi-line string | `"a\nb"` | `` `a⏎b` `` — literal newline in a raw string |
| Comments | ✗ (JSONC/JSON5 only) | `# to end of line` |
| Trailing commas | ✗ (JSON5 only) | ✓ |
| Number | `1.5` | `1.5` — IEEE 754 binary64 |
| Exact integer | `"9007199254740993"` (as text) | `BIGINT(9007199254740993)` |
| Exact decimal | `1.50` (lossy) | `DECIMAL(1.50)` — scale preserved |
| Wall date | `"2026-01-15"` | `DATE(2026-01-15)` |
| Instant | `"2026-01-15T10:30:00Z"` | `TIMESTAMP(2026-01-15T10:30:00Z)` |
| Binary | `"SGVsbG8="` (as text) | `BINARY(SGVsbG8=)` |

```json
{
  "name": "Widget",
  "price": 19.99,
  "in_stock": true,
  "discontinued": null,
  "tags": ["a", "b"]
}
```

```stf
{
  name: `Widget`,
  price: DECIMAL(19.99),   # exact, unlike the JSON number
  in_stock: T,
  discontinued: N,
  tags: [`a`, `b`],
}
```

### 1.3 Gaining Type Precision

The main reason to migrate is that STF removes the string-encoding conventions JSON forces:

| JSON convention | STF |
| :--- | :--- |
| `"created": "2026-01-15"` — is it a date or a string? | `created: DATE(2026-01-15)` |
| `"id": "9007199254740993"` — string to survive `JSON.parse` | `id: BIGINT(9007199254740993)` |
| `"price": 19.99` — binary64, so `19.99` is not exactly 19.99 | `price: DECIMAL(19.99)` |
| `"blob": "SGVsbG8="` — base64, by convention only | `blob: BINARY(SGVsbG8=)` |

Note `DECIMAL(1.50)` ≠ `DECIMAL(1.5)`: scale is data (spec §10.2), which is what makes STF
usable for money without a separate schema.

### 1.4 JSON That Cannot Be Converted

Conversion **MUST** fail loudly on these rather than guess. There is no `--sanitize` mode; a
silent rename or reshape would reintroduce exactly the ambiguity STF exists to remove.

| JSON | Why | Workaround |
| :--- | :--- | :--- |
| `{"user.name": 1}` | Keys are identifiers: `[A-Za-z0-9_-]+` (§6.1) | Rename the key |
| `{"hello world": 1}` | space not permitted in a key | Rename the key |
| `{"@type": 1}`, `{"a/b": 1}` | `@`, `/` not permitted | Rename the key |
| `{"café": 1}`, `{"🔑": 1}` | keys are ASCII-only | Rename the key |
| `{"": 1}` | empty key | Rename the key |
| `[1, 2, 3]` | root must be an object (§5) | Wrap: `{items: [1,2,3]}` — a deliberate shape change |
| `{"a": NaN}` (JSON5) | `NaN`/`Infinity` are not STF values (§7.3) | Use `N`, or a string |
| `{"a": 1, "a": 2}` | duplicate keys are rejected (§11.2) | Decide which wins, explicitly |
| `1e400` | overflows binary64 → `ERR_NUMBER_OVERFLOW` (§7.3) | Use `DECIMAL(...)` or `BIGINT(...)` |

### 1.5 JSON5 Syntax STF Rejects

STF is stricter than JSON5 by design. Each of these is a parse error:

| JSON5 | STF |
| :--- | :--- |
| `0x1F` | `ERR_INVALID_NUMBER` — no hex |
| `+1`, `.5`, `1.` | `ERR_INVALID_NUMBER` |
| `1_000` | `ERR_INVALID_NUMBER` — no digit separators |
| `'single quoted'` | `ERR_SYNTAX` — use `` ` `` or `"` |
| `"line \`<br>`continued"` | `ERR_INVALID_STRING` — no line continuations |
| `Infinity`, `NaN` | `ERR_SYNTAX` |
| `{$key: 1}` | `ERR_INVALID_IDENTIFIER` — `$` not permitted |

JSONC's comments and JSON5's trailing commas both carry over unchanged — STF has `#` comments
(§4.2) and permits a trailing comma in objects and arrays (§11).

---

## 2. From NDJSON and JSONL

Use the [STF Stream](stream.md) profile (`.stfs`): one STF document per line.

```jsonl
{"ts":"2026-01-15T10:30:00Z","lvl":"info","msg":"started"}
{"ts":"2026-01-15T10:30:01Z","lvl":"warn","msg":"retrying"}
```

```stfs
{ts:TIMESTAMP(2026-01-15T10:30:00Z),lvl:`info`,msg:`started`}
{ts:TIMESTAMP(2026-01-15T10:30:01Z),lvl:`warn`,msg:`retrying`}
```

Two differences to plan for:

* **A record may not contain a raw newline** (stream §3.2), including inside a raw string. Write
  `"a\nb"` in the interpreted form instead. This is what keeps a stream splittable on LF without
  parsing.
* **Every §1.4 restriction applies per record.** A single record with an unconvertible key fails
  that record, reported with its line number.

An optional header line carries stream-wide directives:

```stfs
@schema(https://example.com/event.schema.stf)
{ts:TIMESTAMP(2026-01-15T10:30:00Z),lvl:`info`}
```

---

## 3. From Legacy DTXT

DTXT was renamed to STF, and constructor casing changed.

| Legacy DTXT | STF 1.0 |
| :--- | :--- |
| `Date(2026-01-15)` | `DATE(2026-01-15)` |
| `Date(2026-01-15T10:30:00Z)` | `TIMESTAMP(2026-01-15T10:30:00Z)` |
| `BigNumber(9007199254740993)` | `BIGINT(9007199254740993)` |
| `Binary(48656C6C6F)` — hex | `BINARY(SGVsbG8=)` — base64 |
| — | `DECIMAL(19.99)` — new |
| `// comment` | `# comment` |

Constructor names are matched byte-for-byte with no case folding, so `Date(...)` and
`date(...)` are `ERR_UNKNOWN_CONSTRUCTOR`, not aliases.

`Date` split into two types because a wall date and an instant are different things:
`DATE` rejects any time component, and `TIMESTAMP` requires an explicit UTC offset.

```dtxt
{
  created: Date(2026-01-15),
  updated: Date(2026-01-15T10:30:00Z),
  big: BigNumber(9007199254740993),
  hash: Binary(48656C6C6F),
}
```

```stf
{
  created: DATE(2026-01-15),
  updated: TIMESTAMP(2026-01-15T10:30:00Z),
  big: BIGINT(9007199254740993),
  hash: BINARY(SGVsbG8=),
  price: DECIMAL(19.99),
}
```

---

## 4. From Pre-1.0 STF Drafts

The 1.0 specification pinned six behaviours that earlier drafts left undefined, and
implementations had diverged on all of them. Documents that parsed before may now be rejected.

### 4.1 Documents That May Now Fail

| Was | Now | Rule |
| :--- | :--- | :--- |
| `{a: 1e400}` → `Infinity` | `ERR_NUMBER_OVERFLOW` | §7.3 |
| `BIGINT(007)` → `7` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | §10.3 — no silent rewriting |
| `BIGINT(-0)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | §10.3 — zero has one spelling |
| `DECIMAL(1.5e3)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | §10.2 — plain notation only |
| `DECIMAL(1.)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | §10.2 |
| `DATE(2026-02-31)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | §10.4 — full calendar validity |
| `TIMESTAMP(...T99:30:00Z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | §10.4 — field ranges |
| `TIMESTAMP(...T23:59:60Z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | §10.4 — no leap seconds |
| `TIMESTAMP(2026-01-15 10:30:00Z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | §10.4 — `T` separator only |
| `"\uD800"` | `ERR_INVALID_STRING` | §8.3 — unpaired surrogate |
| `<BOM>{a:1}` | `ERR_SYNTAX` | §2 — BOM is not whitespace |
| `@schema(a) @schema(b)` | `ERR_SYNTAX` | §5.1 — one directive per name |

### 4.2 Documents That Now Parse Differently

| Input | Was | Now |
| :--- | :--- | :--- |
| `{a: 9007199254740993}` | exact integer in Python, `…992` elsewhere | `…992` everywhere (§7.2) |
| `DECIMAL(0.0…01)`, 38 fraction digits | `ERR_DECIMAL_OVERFLOW` in most impls | **valid** — 1 significant digit (§10.2) |
| `BINARY()` | rejected | **valid** — the empty octet sequence (§10.5) |
| `{ a : 1 }` with spaces | rejected by the published EBNF | **valid** — the grammar was wrong (§12) |

### 4.3 Typed Values Are No Longer Strings

Earlier implementations returned constructor values as strings with a marker prefix, so
`DECIMAL(1.5)` parsed to the string `"$decimal:1.5"`. Spec §3.1 forbids this.

```js
// before
parse('{a: DECIMAL(1.5)}').a === '$decimal:1.5'   // a String

// after
parse('{a: DECIMAL(1.5)}').a                       // a Decimal value, not a String
```

Any code branching on those prefixes must be rewritten to branch on type. The old
representation could not distinguish `DECIMAL(1.5)` from the user string `` `$decimal:1.5` ``,
and made serialization emit unparseable documents for ordinary strings beginning `$decimal:`.

### 4.4 Error Codes Are Now Exact

Codes are normative per condition ([error-codes.md](error-codes.md) §2). Code that matched
loosely — or test suites with alias tables — must be updated:

| Input | Was, varying by implementation | Now |
| :--- | :--- | :--- |
| `{a: 0x10}` | `ERR_MISSING_COMMA` / `ERR_MISSING_COLON` | `ERR_INVALID_NUMBER` |
| `{a: 1` | `ERR_MISSING_COMMA` | `ERR_UNTERMINATED` |
| `{a:1}{b:2}` | `ERR_SYNTAX` / `ERR_TRAILING_CONTENT` | `ERR_TRAILING_CONTENT` |
| `42` | `ERR_MISSING_COLON` / `ERR_ROOT_NOT_OBJECT` | `ERR_ROOT_NOT_OBJECT` |
