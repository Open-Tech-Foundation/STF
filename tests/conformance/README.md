# STF Conformance Corpus

The corpus is the **executable contract** for [STF 1.0](../../doc/spec.md). Every case is
derived from a normative rule in the specification or from the condition → code tables in
[error-codes.md](../../doc/error-codes.md).

| File | Role |
| :--- | :--- |
| `build_corpus.py` | Source of truth. Authors the cases. |
| `corpus.json` | Generated. What runners read. Do not edit by hand. |
| `tests.json` | **Superseded.** Pre-1.0 corpus, retained only until every implementation migrates. |

Regenerate after editing the builder:

```sh
python3 tests/conformance/build_corpus.py
```

---

## 1. Case Format

```json
{
  "name":  "numbers/exponent-plus",
  "group": "numbers",
  "input": "{ a: 1e+9 }",
  "value": { "a": { "$": "num", "v": "1000000000" } }
}
```

Every case has `name`, `group`, `input`, and **exactly one** of:

| Field | Meaning |
| :--- | :--- |
| `value` | Input MUST parse, and the result MUST equal this value. |
| `error` | Input MUST be rejected with **exactly** this error code. |

Optional fields:

| Field | Meaning |
| :--- | :--- |
| `canonical` | Expected [STF Canonical Form](../../doc/spec.md#14-canonical-form) output. Only meaningful with `value`. |
| `profile` | `"stream"` marks a case for the [STF Stream](../../doc/stream.md) profile. Absent means core. |
| `note` | Non-normative explanation of why the case exists. |

---

## 2. Value Encoding

Expected values are encoded in JSON. Because JSON cannot distinguish STF's eleven kinds
(§3) on its own, non-obvious kinds are **tagged**:

| STF kind | JSON encoding |
| :--- | :--- |
| Null | `null` |
| Boolean | `true` / `false` |
| String | a JSON string |
| Array | a JSON array |
| Object | a JSON object **without** a `$` key |
| Number | `{"$": "num", "v": "<shortest round-trip decimal>"}` |
| BigInt | `{"$": "bigint", "v": "<decimal digits>"}` |
| Decimal | `{"$": "dec", "v": "<exact payload text>"}` |
| Date | `{"$": "date", "v": "YYYY-MM-DD"}` |
| Timestamp | `{"$": "ts", "v": "<exact payload text>"}` |
| Binary | `{"$": "bin", "v": "<canonical base64>"}` |

`$` is a safe escape key because **`$` is not a legal STF key character** (§6.1), so a tagged
object can never collide with a real parsed object.

Bare JSON numbers are **never** used. Numbers are always tagged with a string `v`, because JSON
numbers cannot express `-0` and give no guarantee about `binary64` round-tripping — both of
which §7.2 and §7.3 make observable.

> **Why tags rather than string prefixes.** A previous corpus encoded typed values as strings
> such as `"$decimal:1.5"`. That is the exact anti-pattern §3.1 now forbids: it cannot
> distinguish `DECIMAL(1.5)` from the user string `` `$decimal:1.5` ``, so a corpus using it
> cannot detect the bug. Tagged objects are unambiguous by construction.

---

## 3. Runner Requirements

A conformant runner **MUST**:

1. **Compare error codes exactly.** No alias tables, no substitution, no "any error passes".
   A case expecting `ERR_INVALID_NUMBER` fails if the implementation raises `ERR_SYNTAX`.
   This is the requirement the pre-1.0 runners did not meet, which is why four
   implementations reported 93/93 while disagreeing on 25 of 80 edge cases.
2. **Compare values by kind, not by coincidence.** A String result MUST NOT satisfy a
   `dec`/`date`/`ts`/`bin`/`bigint` expectation, even if the text matches.
3. **Compare Numbers as `binary64` bit patterns**, so `-0` ≠ `0`.
4. **Compare Decimals on coefficient *and* scale**, so `1.5` ≠ `1.50`. Native `==` in Python
   `Decimal`, Go `shopspring/decimal`, and Rust `rust_decimal` compares numerically and is
   therefore **not** sufficient.
5. **Compare Binary as octets**, after decoding.
6. **Preserve and check object member order** where a case's `canonical` field is present.
7. Report a case with neither `value` nor `error` satisfied as a **failure**, never skip it.
8. Exit non-zero if any case fails.

A runner **SHOULD** also verify round-tripping for every `value` case:
`parse(serialize(parse(input))) == parse(input)` (§13.1).

---

## 4. Groups

| Group | Covers |
| :--- | :--- |
| `structure` | Root object rule, trailing content, empty input |
| `directives` | Placement, uniqueness, unknown-directive tolerance |
| `objects` | Members, separators, duplicates, trailing commas |
| `arrays` | Elements, separators, trailing commas |
| `keys` | Identifier grammar and rejections |
| `numbers` | Grammar, `binary64` domain, overflow, token boundaries |
| `literals` | `T` / `F` / `N` and their boundaries |
| `strings` | Both string forms, escapes, surrogates |
| `ctor` | Constructor syntax, reserved namespace |
| `decimal` `bigint` `temporal` `binary` | Per-constructor payload rules |
| `comments` | Comment handling and whitespace |
| `depth` | Nesting limit |
| `canonical` | Canonical Form output |
| `stream` | STF Stream profile (`profile: "stream"`) |
