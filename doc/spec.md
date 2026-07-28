# STF 1.0 — Structured Text Format Specification

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

> [!WARNING]
> This specification is in a **draft state** and is subject to change.

---

## 1. Overview

**STF (Structured Text Format)** is a human-readable, structured data format designed for
configuration and high-performance data interchange.

An STF document represents a **single object**, explicitly delimited by `{}`.
STF emphasizes:

* strict and predictable syntax
* fast parsing
* minimal token noise
* explicit typing via uppercase constructor literals
* human readability without implicit semantics

### 1.1 Conformance Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** are to be interpreted as described
in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174).

A **conformant parser** implements §2–§12 and rejects every input this specification requires
to be rejected, with the exact error code given in §16.
A **conformant serializer** implements §13.
An implementation MAY be a parser only.

### 1.2 Media Type and File Extension

* **Media type (interim)**: `application/vnd.stf`
* **Media type (post-registration)**: `application/stf`
* **File extension**: `.stf`
* **Schema file extension**: `.schema.stf`
* **Stream file extension**: `.stfs` — see [STF Stream](stream.md)

### 1.3 Non-Goals

To maintain simplicity and predictability, the following are **NOT** goals of the core STF format:

* **Programming Logic**: STF has no execution semantics, variables, or functions.
* **Schema Validation**: Schema validation is defined in a separate specification
  ([STF Schema](schema.md)) and is decoupled from core parsing for performance.
* **Resource Referencing**: STF does not support internal references (anchors) or external imports.
* **Streaming Framing**: The core format is a discrete document, not a framing protocol.
  Append-only record streams are served by the separate [STF Stream](stream.md) profile, which
  layers on this specification without altering it.
* **Comments as Data**: Comments are purely for documentation and MUST be ignored by processors.

### 1.4 Supplementary Documentation

* [Standardized Error Codes](error-codes.md) — normative
* [STF Schema Specification](schema.md) — normative, separate layer
* [STF Stream Profile](stream.md) — normative, optional profile for record streams
* [Migration Guide (JSON → STF)](migration-guide.md) — non-normative
* [Comparison with Other Formats](comparison.md) — non-normative

---

## 2. Character Encoding

* STF documents **MUST** be encoded in **UTF-8**.
* Parsers **MUST** reject input that is not well-formed UTF-8 with `ERR_INVALID_UTF8`.
* Parsers **MUST NOT** substitute `U+FFFD` for malformed sequences.
* A **byte order mark** (`U+FEFF`) at the start of a document is **NOT** whitespace and
  **MUST** be rejected with `ERR_SYNTAX`. Tools that write STF **SHOULD NOT** emit a BOM.
* `U+FEFF` appearing inside a string literal is an ordinary character.

---

## 3. Data Model

This section is **normative**. It defines what a parsed STF document *is*, independently
of any host language.

An STF **value** is exactly one of eleven kinds:

| Kind | Description |
| :--- | :--- |
| **Null** | The absence of a value. |
| **Boolean** | `true` or `false`. |
| **Number** | An IEEE 754 `binary64` value. See §7. |
| **String** | A finite sequence of Unicode scalar values. |
| **Array** | An ordered sequence of values. |
| **Object** | An ordered sequence of unique key/value members. |
| **BigInt** | An arbitrary-precision integer. |
| **Decimal** | An exact signed decimal: a coefficient and a scale. See §10.2. |
| **Date** | A wall date with no time and no offset. |
| **Timestamp** | An absolute instant with a mandatory UTC offset. |
| **Binary** | A finite sequence of octets, possibly empty. |

### 3.1 Type Distinctness (Critical)

These eleven kinds are **mutually distinct**. In particular:

* A **String MUST NOT be represented as, or be indistinguishable from, any other kind**,
  and no other kind may be represented as a String.
* Implementations **MUST NOT** encode `BigInt`, `Decimal`, `Date`, `Timestamp`, or `Binary`
  as strings carrying a marker prefix or any other in-band sentinel.

> **Rationale.** An in-band sentinel (for example representing `DECIMAL(1.5)` as the string
> `"$decimal:1.5"`) makes a user-authored string indistinguishable from a typed value, causes
> a plain string to be silently promoted to a constructor on serialization, and can produce
> unparseable output. Constructors exist precisely to remove this ambiguity; encoding them as
> strings reintroduces it. Implementations MUST provide distinct host types (a wrapper struct,
> class, tagged union, or the language's native equivalent).

Given values `a` and `b` of different kinds, `a ≠ b`. Cross-kind numeric coercion is **NOT**
performed: `Number(1)`, `BigInt(1)`, and `Decimal(1)` are three distinct values.

### 3.2 Equality

* **Null**, **Boolean**: identity.
* **Number**: IEEE 754 equality, except that `NaN` cannot occur (§7.3) and `+0.0 ≠ -0.0`
  for the purposes of round-tripping (§13.4).
* **String**: equality of the Unicode scalar sequence.
* **BigInt**: mathematical integer equality.
* **Decimal**: **scale-sensitive** — equal only if both coefficient *and* scale are equal.
  `DECIMAL(1.5) ≠ DECIMAL(1.50)`. See §10.2.
* **Date**, **Timestamp**: equality of the written field values. `TIMESTAMP(2026-01-15T10:00:00Z)`
  and `TIMESTAMP(2026-01-15T15:30:00+05:30)` denote the same instant but are **not equal** as
  STF values, because the offset is preserved data.
* **Binary**: equality of the octet sequence. The base64 spelling is not data (§10.5).
* **Array**: equal length and pairwise-equal elements, in order.
* **Object**: equal key sets with pairwise-equal values. **Member order does not affect equality**
  (but is preserved — see §11.2).

---

## 4. Whitespace and Comments

### 4.1 Whitespace

The whitespace characters are exactly:

| Character | Code point |
| :--- | :--- |
| Space | `U+0020` |
| Horizontal tab | `U+0009` |
| Line feed | `U+000A` |
| Carriage return | `U+000D` |

Carriage return is whitespace **on its own**, not only as part of `\r\n`. No other Unicode
character (including `U+00A0`, `U+2028`, `U+2029`, and `U+FEFF`) is whitespace.

Whitespace may appear between any two tokens and has **no semantic meaning**.

### 4.2 Comments

* STF supports **single-line comments** only.
* A comment begins with `#` and continues to the next line feed (`U+000A`) or carriage
  return (`U+000D`), or to end of input.
* A comment is equivalent to whitespace and MUST be discarded.
* `#` inside a string literal is an ordinary character and does **not** start a comment.

```stf
# This is a comment
{
  key: 123, # trailing comment
  note: `this # is not a comment`,
}
```

---

## 5. Document Structure

```ebnf
document = ws { directive ws } object ws EOF ;
```

A document consists of zero or more **directives**, followed by exactly one **root object**.

* The root **MUST** be an object. A root array, string, number, boolean, null, or constructor
  **MUST** be rejected with `ERR_ROOT_NOT_OBJECT`.
* Empty input, or input containing only whitespace, comments, and directives, **MUST** be
  rejected with `ERR_ROOT_NOT_OBJECT`.
* Any non-whitespace, non-comment content after the root object **MUST** be rejected with
  `ERR_TRAILING_CONTENT`. This includes a second object and a directive placed after the root.

```stf
@schema(https://example.com/config.schema.stf)
{
  name: `example`,
  count: 10,
}
```

### 5.1 Directives

```ebnf
directive = "@" identifier "(" payload ")" ;
```

* Directives **MUST** appear before the root object.
* No whitespace is permitted between `@` and the name, or between the name and `(`.
  Whitespace there **MUST** be rejected with `ERR_SYNTAX`.
* The payload is the raw character sequence up to the matching `)`; it MUST NOT contain
  `(` or `)` (§10.1).
* Directive names are case-sensitive.
* A parser **MUST** accept an unknown directive and **MUST NOT** fail on it. It **SHOULD**
  surface a warning. Unknown directives carry no semantics.
* Directives are **document metadata**, not data. They **MUST NOT** appear in the parsed
  data model of §3. Implementations SHOULD expose them through a separate accessor.

| Directive | Payload | Meaning |
| :--- | :--- | :--- |
| `@schema` | URI or relative path | Associates the document with an STF Schema. |
| `@version` | Version string | Declares the authoring STF version. |

A document MUST NOT contain the same directive name twice; a repeat **MUST** be rejected
with `ERR_SYNTAX`.

---

## 6. Keys

### 6.1 Key Syntax

* Keys are **unquoted identifiers**.
* Allowed characters:
  * ASCII letters `A–Z`, `a–z`
  * ASCII digits `0–9`
  * underscore `_`
  * hyphen `-`
* Keys are **case-sensitive** and **MUST NOT** be empty.
* Leading digits **ARE** allowed.
* Hyphens **ARE** allowed anywhere, including as the entire key.

```stf
{
  a: 1,
  user_id: 2,
  123key: 3,
  content-type: 4,
}
```

### 6.2 Disallowed in Keys

The following **MUST** be rejected with `ERR_INVALID_IDENTIFIER`:

* Dot (`.`), and any other character outside the set in §6.1
* Whitespace within a key
* Non-ASCII characters, including accented Latin letters and emoji
* Quoted keys (`"key":` or `` `key`: ``) — these are `ERR_SYNTAX`
* The empty key (`{ : 1 }`)

```stf
{
  user.name: 1,   # ERR_INVALID_IDENTIFIER
  café: 2,        # ERR_INVALID_IDENTIFIER
  "user": 3,      # ERR_SYNTAX
}
```

**Whitespace inside a key versus a missing colon.** Both `{ a b: 1 }` and `{ a 1 }` are a key
followed by whitespace and then an unexpected token. They are distinguished by what follows:
if the text after the whitespace is an identifier that is itself followed by `:`, the input is
one key containing whitespace and **MUST** be rejected with `ERR_INVALID_IDENTIFIER`.
Otherwise the key is complete and its `:` is missing, which is `ERR_MISSING_COLON`.

> **Note.** Because keys cannot be quoted, not every host-language map is representable in
> STF. Serializers MUST fail rather than emit an invalid key — see §13.6.

### 6.3 Key Disambiguation vs Constructors

A bare uppercase word in **key position** is an ordinary key identifier. The parser
disambiguates constructors from identifiers by the `(` immediately following an identifier
in **value position**.

```stf
{
  DATE: 1,      # VALID key
  BIGINT: 2,    # VALID key
  DECIMAL: 3,   # VALID key
}
```

---

## 7. Numbers

A `number` literal denotes a **Number** (§3): an IEEE 754 `binary64` value.

### 7.1 Grammar

```ebnf
number   = [ "-" ] integer [ fraction ] [ exponent ] ;
integer  = "0" | digit1_9 { digit } ;
fraction = "." digit { digit } ;
exponent = ( "e" | "E" ) [ "+" | "-" ] digit { digit } ;
```

Accepted:

```stf
0    123    -42    3.14    1e9    1E+9    -2.5E-3    -0
```

Rejected with `ERR_INVALID_NUMBER`:

| Input | Reason |
| :--- | :--- |
| `+1` | leading `+` |
| `01`, `-01` | leading zero |
| `.5` | missing integer part |
| `1.` | missing fraction digits |
| `1e`, `1e+` | missing exponent digits |
| `-` | no digits |

Hexadecimal, binary, and octal literals, digit separators (`1_000`), `NaN`, and `Infinity`
are not part of the number grammar and are rejected by §7.4.

### 7.2 Value Domain and Precision

A number literal **MUST** be converted to the nearest `binary64` value using round-to-nearest,
ties-to-even.

**Precision loss is expected and conformant.** `{ a: 9007199254740993 }` yields `9007199254740992`
in every conformant implementation. Implementations **MUST NOT** widen the domain — for example,
returning an arbitrary-precision integer for a large literal is **non-conformant**, because it
makes the same document mean different things in different languages.

Use `BIGINT(...)` for exact integers and `DECIMAL(...)` for exact decimals.

### 7.3 Overflow and Non-Finite Values

* A literal whose magnitude is too large to represent as a finite `binary64` (for example
  `1e400`) **MUST** be rejected with `ERR_NUMBER_OVERFLOW`. Implementations **MUST NOT**
  produce an infinity.
* A literal that underflows to zero (for example `1e-400`) **MUST** be accepted and yields
  `0.0` (or `-0.0`), consistent with IEEE 754 gradual underflow.
* `NaN` and the infinities are **not** members of the Number kind and can never result from
  parsing. A serializer given such a host value MUST fail — see §13.4.
* `-0` denotes negative zero and is a distinct bit pattern from `0`.

### 7.4 Token Boundaries

A number literal **MUST NOT** be immediately followed by an identifier character
(`A–Z`, `a–z`, `0–9`, `_`, `-`) or by `.`. Violation **MUST** be rejected with
`ERR_INVALID_NUMBER`.

This rule is what rejects `0x10`, `1_000`, and `1.2.3` at the offending character, rather
than letting a prefix parse as a complete value and reporting a misleading separator error.

The same boundary rule applies to the `T`, `F`, and `N` literals of §9, where violation is
`ERR_SYNTAX`. It is why `NaN`, `Infinity`, `true`, and `True` are rejected as literals rather
than parsed as `N` + `aN`, `T` + `rue`, and so on.

---

## 8. Strings

STF has two string forms. Both denote the same **String** kind (§3); the choice of form is
**not** data.

### 8.1 Raw Strings (Backticks)

```ebnf
raw_string = "`" { char_not_backtick } "`" ;
```

* Delimited by backticks (`` ` ``).
* A backtick **cannot** appear inside a raw string, and there is no escape for it. A string
  containing a backtick MUST use the interpreted form.
* Literal line feeds and carriage returns **ARE** allowed and are preserved verbatim.
* **No** escape processing occurs. `\n` inside a raw string is a backslash followed by `n`.
* An unterminated raw string **MUST** be rejected with `ERR_UNTERMINATED`.

### 8.2 Interpreted Strings (Double Quotes)

```ebnf
interpreted_string = '"' { interpreted_char | escape } '"' ;
interpreted_char   = ? any Unicode scalar except '"', "\", U+000A, U+000D ? ;
escape             = "\" ( '"' | "\" | "/" | "b" | "f" | "n" | "r" | "t" | "u" hex hex hex hex ) ;
```

* Delimited by double quotes (`"`).
* Supports exactly the JSON escape set: `\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`.
* Any other escape (`\x41`, `\U0041`, `\'`) **MUST** be rejected with `ERR_INVALID_STRING`.
  `\u` not followed by exactly four hexadecimal digits is likewise `ERR_INVALID_STRING`.
* A literal line feed or carriage return inside an interpreted string **MUST** be rejected with
  `ERR_INVALID_STRING`.
* An unterminated interpreted string **MUST** be rejected with `ERR_UNTERMINATED`.

### 8.3 Surrogates

`\uXXXX` escapes designate UTF-16 code units.

* A high surrogate (`U+D800`–`U+DBFF`) **MUST** be immediately followed by a `\uXXXX` escape
  denoting a low surrogate (`U+DC00`–`U+DFFF`); the pair denotes the corresponding supplementary
  scalar value.
* An **unpaired** surrogate — high without a following low, or a lone low surrogate —
  **MUST** be rejected with `ERR_INVALID_STRING`.
* Implementations **MUST NOT** substitute `U+FFFD`.

> **Rationale.** §2 requires documents to be valid UTF-8, and an unpaired surrogate has no
> UTF-8 encoding. Permitting it would make some parsed strings unserializable.

```stf
{
  ok:  "\uD83D\uDE00",  # 😀 — valid surrogate pair
  ok2: `😀`,             # 😀 — literal UTF-8, also valid
  bad: "\uD800",         # ERR_INVALID_STRING
}
```

### 8.4 Control Characters

Unescaped C0 control characters (`U+0000`–`U+001F`) other than the whitespace characters of
§4.1 **SHOULD** be avoided in raw strings. They are permitted for compatibility, but serializers
MUST escape them in interpreted output (§13.5). `U+0000` is a legal string content character
and MUST NOT terminate a string.

---

## 9. Boolean and Null Literals

| Literal | Kind | Value |
| :--- | :--- | :--- |
| `T` | Boolean | true |
| `F` | Boolean | false |
| `N` | Null | null |

Literals are strictly **case-sensitive** and MUST be uppercase. `t`, `true`, `True`, `null`,
and `n` in value position are **NOT** literals and MUST be rejected with `ERR_SYNTAX`.

A literal MUST NOT be immediately followed by an identifier character (§7.4). This is why
`NaN` and `Infinity` are `ERR_SYNTAX` rather than being read as `N` followed by stray text.

---

## 10. Constructor Literals

Constructor literals provide **explicit typed values**.

### 10.1 General Syntax

```ebnf
constructor = constructor_name "(" payload ")" ;
payload     = { char_not_paren } ;
```

* There **MUST NOT** be whitespace between the name and `(`. `DATE (…)` is `ERR_SYNTAX`.
* The payload is the raw character sequence between the parentheses. It is **not** tokenized:
  whitespace, `#`, and quotes within it are ordinary characters.
* The payload **MUST NOT** contain `(` or `)`. Encountering `(` while scanning a payload
  **MUST** be rejected with `ERR_NESTED_CONSTRUCTOR` (this is what makes `DATE(DATE(x))`
  invalid). Reaching end of input before `)` is `ERR_UNTERMINATED`.
* The payload **MAY** be empty. Whether an empty payload is valid is defined per constructor;
  only `BINARY()` accepts it.
* Each constructor validates its payload against the grammar in §10.2–§10.5. A payload that
  fails validation **MUST** be rejected with `ERR_INVALID_CONSTRUCTOR_PAYLOAD`, except where
  a more specific code is named.

**Constructor names and the reserved namespace.**

The five names defined by STF 1.0 are `BIGINT`, `DECIMAL`, `DATE`, `TIMESTAMP`, `BINARY`.

* Names are matched **byte-for-byte**. Parsers **MUST NOT** case-fold. `Date(…)`, `date(…)`,
  `BigNumber(…)`, and `Binary(…)` are **not** aliases.
* An identifier immediately followed by `(` in value position is in the **reserved namespace**
  if either:
  1. it begins with an ASCII uppercase letter (`A–Z`), or
  2. it is an ASCII case-insensitive match of one of the five names above.

  A reserved name that is not a byte-for-byte match of one of the five **MUST** be rejected with
  `ERR_UNKNOWN_CONSTRUCTOR`. Rule 1 covers `CUSTOM(…)`, `MY_TYPE(…)`, `Date(…)`, and
  `BigNumber(…)`; rule 2 additionally covers `date(…)` and `binary(…)`, so a near-miss of
  spelling is reported as a wrong constructor rather than as generic syntax.
* Any other identifier immediately followed by `(` in value position is `ERR_SYNTAX`
  (for example `foo(1)`).

### 10.2 `DECIMAL(...)` — Exact Decimal

An exact signed decimal number in plain notation.

```ebnf
decimal_payload = [ "-" ] ( "0" | digit1_9 { digit } ) [ "." digit { digit } ] ;
```

```stf
DECIMAL(1.5)      DECIMAL(1.50)      DECIMAL(15)      DECIMAL(-0.001)
```

**Scale is data.** The **scale** of a decimal is the number of digits after the decimal point
(0 if there is no point). `DECIMAL(1.5)` has scale 1; `DECIMAL(1.50)` has scale 2; these are
**distinct values** that MUST NOT compare equal and MUST NOT be normalized.

**Significant digits** are defined as: take the payload, remove the sign and the decimal point,
and strip leading zeros. If the result is empty (the value is zero), the count is 1; otherwise
it is the length of the result. Trailing zeros **are** significant; leading zeros are **not**.

* Significant digits **MUST NOT** exceed **34** (decimal128 coefficient precision). Exceeding
  this **MUST** be rejected with `ERR_DECIMAL_OVERFLOW`.
* Scale **MUST NOT** exceed **6143** (decimal128 exponent range); exceeding it is
  `ERR_DECIMAL_OVERFLOW`.
* `DECIMAL(0.00000000000000000000000000000000000001)` has **1** significant digit and scale 38.
  It is **valid**.

Rejected with `ERR_INVALID_CONSTRUCTOR_PAYLOAD`: exponent notation (`1.5e3`), leading `+`,
leading zeros (`01.5`), a trailing point (`1.`), `NaN`, `Infinity`, hexadecimal, underscores,
whitespace, and the empty payload.

> **Implementation note.** Native `==` on Python `Decimal`, Go `shopspring/decimal`, and Rust
> `rust_decimal` compares **numerically**, so `1.5 == 1.50` is true in those libraries. STF
> equality is scale-sensitive; implementations MUST compare coefficient and scale explicitly.

Arithmetic on decimals is out of scope for this specification.

### 10.3 `BIGINT(...)` — Arbitrary-Precision Integer

```ebnf
bigint_payload = "0" | [ "-" ] digit1_9 { digit } ;
```

```stf
BIGINT(9007199254740993)      BIGINT(-123456789012345678901234567890)      BIGINT(0)
```

* There is no magnitude limit.
* Leading zeros (`BIGINT(007)`) are **rejected** with `ERR_INVALID_CONSTRUCTOR_PAYLOAD`.
  A parser MUST NOT silently rewrite them; the payload spelling is canonical and unique.
* Negative zero (`BIGINT(-0)`) is rejected — zero has exactly one spelling.
* Fractional components, exponents, leading `+`, and the empty payload are rejected.

### 10.4 Temporal Constructors

Both temporal constructors use the **proleptic Gregorian calendar** and **MUST** be validated
for full calendar correctness, including month lengths and leap years. A syntactically
well-formed but nonexistent date **MUST** be rejected with `ERR_INVALID_CONSTRUCTOR_PAYLOAD`.

#### `DATE(...)` — Wall Date

```ebnf
date_payload = digit digit digit digit "-" digit digit "-" digit digit ;
```

```stf
DATE(2026-01-15)      DATE(2024-02-29)   # valid: 2024 is a leap year
```

* Format is exactly `YYYY-MM-DD`, zero-padded. `DATE(2026-1-5)` is rejected.
* Year range is `0000`–`9999`. Month `01`–`12`. Day `01` through the length of that month.
* `DATE(2026-02-31)`, `DATE(2026-13-01)`, `DATE(2026-01-00)`, and `DATE(2025-02-29)` are
  **rejected**.
* Any time, offset, or `T` component is rejected.

#### `TIMESTAMP(...)` — Instant

```ebnf
timestamp_payload = date_payload "T" hh ":" mm ":" ss [ "." digit { digit } ] offset ;
offset            = "Z" | ( "+" | "-" ) hh ":" mm ;
```

```stf
TIMESTAMP(2026-01-15T10:30:00Z)
TIMESTAMP(2026-01-15T10:30:00.123456789+05:30)
```

* The date/time separator is an uppercase `T`. A space separator is **rejected**.
* The zone designator is an uppercase `Z`, or a numeric offset `±HH:MM`.
* A **UTC offset is mandatory**. `TIMESTAMP(2026-01-15T10:30:00)` is rejected, to prevent
  ambiguity.
* Field ranges: hour `00`–`23`, minute `00`–`59`, second `00`–`59`. Offset hour `00`–`23`,
  offset minute `00`–`59`.
* **Leap seconds are not supported**: a seconds field of `60` is **rejected**. Most host
  time libraries cannot represent it, and admitting it would make round-tripping
  implementation-dependent.
* The fractional part, if present, MUST have 1–9 digits. Trailing zeros in the fraction are
  preserved (`.100` ≠ `.1`), as is the offset spelling (`+00:00` ≠ `Z`).
* The date part is subject to the same calendar validation as `DATE`.

> `TIME`, `DURATION`, and naive (offset-less) date-times have no constructor in STF 1.0. Use a
> string with an ISO 8601 convention. Note that `TIME(...)` is in the reserved namespace and
> currently raises `ERR_UNKNOWN_CONSTRUCTOR`.

### 10.5 `BINARY(...)` — Octet Sequence

Binary data encoded with the standard Base64 alphabet, RFC 4648 §4.

```stf
BINARY(SGVsbG8=)      BINARY(SGVsbG9X)      BINARY()   # empty octet sequence
```

* Alphabet is `A–Z`, `a–z`, `0–9`, `+`, `/`, plus `=` for padding. The URL-safe alphabet
  (`-`, `_`) is **rejected**.
* Encoding **MUST** be canonical:
  * Total length **MUST** be a multiple of 4, achieved with `=` padding.
    Padding is therefore present only when the octet count is not a multiple of 3 — a payload
    such as `BINARY(SGVsbG9X)` correctly carries **no** `=`.
  * `=` **MUST NOT** appear anywhere except as the final one or two characters.
  * Non-canonical trailing bits **MUST** be rejected. In a payload ending `X=`, the unused
    low 2 bits of `X` MUST be zero; ending `X==`, the unused low 4 bits of `X` MUST be zero.
    `BINARY(Zh==)` is rejected.
  * Internal whitespace and line breaks are rejected.
* The **empty payload is valid** and denotes the empty octet sequence.
* **Encoding is not data.** The value is the decoded octet sequence; base64 is only its
  text serialization. Two payloads that decode to the same octets are equal — but note that
  canonicality means each octet sequence has exactly one legal spelling.

---

## 11. Arrays and Objects

### 11.1 Arrays

```ebnf
array = "[" ws [ value ws { "," ws value ws } [ "," ws ] ] "]" ;
```

* Elements may be of mixed kinds.
* A **trailing comma is permitted** after the last element.
* Consecutive commas (`[1,,2]`), a leading comma (`[,1]`), and a missing separator are
  rejected with `ERR_MISSING_COMMA`.
* An unterminated array is `ERR_UNTERMINATED`.

### 11.2 Objects

```ebnf
object = "{" ws [ member ws { "," ws member ws } [ "," ws ] ] "}" ;
member = key ws ":" ws value ;
```

* A **trailing comma is permitted** after the last member.
* A missing `:` after a key is `ERR_MISSING_COLON`. A missing `,` between members is
  `ERR_MISSING_COMMA`. A missing value after `:` is `ERR_SYNTAX`.
* **Duplicate keys are forbidden.** An object containing the same key twice **MUST** be
  rejected with `ERR_DUPLICATE_KEY`, at any depth. Implementations MUST NOT silently
  last-write-wins.
* **Member order MUST be preserved** by parsers and serializers, so that documents round-trip
  as authored. Order does not affect value equality (§3.2).

### 11.3 Nesting Depth

Implementations **MUST** enforce a maximum nesting depth and reject deeper input with
`ERR_NESTING_DEPTH`. The **default limit is 64**, counting the root object as depth 1.
The limit MAY be configurable; the default MUST be 64 so that a document accepted by one
conformant parser is accepted by all.

---

## 12. Grammar Summary

```ebnf
(* STF 1.0 Grammar *)

document           = ws { directive ws } object ws EOF ;
directive          = "@" identifier "(" payload ")" ;

object             = "{" ws [ member ws { "," ws member ws } [ "," ws ] ] "}" ;
member             = key ws ":" ws value ;
key                = identifier ;

array              = "[" ws [ value ws { "," ws value ws } [ "," ws ] ] "]" ;

value              = number | boolean | null | raw_string | interpreted_string
                   | array | object | constructor ;

constructor        = constructor_name "(" payload ")" ;
constructor_name   = "BIGINT" | "DECIMAL" | "DATE" | "TIMESTAMP" | "BINARY" ;
payload            = { char_not_paren } ;

raw_string         = "`" { char_not_backtick } "`" ;
interpreted_string = '"' { interpreted_char | escape } '"' ;
interpreted_char   = ? any Unicode scalar except '"', "\", U+000A, U+000D ? ;
escape             = "\" ( '"' | "\" | "/" | "b" | "f" | "n" | "r" | "t"
                         | "u" hex hex hex hex ) ;

boolean            = "T" | "F" ;
null               = "N" ;

number             = [ "-" ] integer [ fraction ] [ exponent ] ;
integer            = "0" | digit1_9 { digit } ;
fraction           = "." digit { digit } ;
exponent           = ( "e" | "E" ) [ "+" | "-" ] digit { digit } ;

identifier         = id_char { id_char } ;
id_char            = letter | digit | "_" | "-" ;

ws                 = { whitespace | comment } ;
whitespace         = " " | "\t" | "\n" | "\r" ;
comment            = "#" { char_not_line_terminator } ;

letter             = "A" … "Z" | "a" … "z" ;
digit              = "0" … "9" ;
digit1_9           = "1" … "9" ;
hex                = digit | "A" … "F" | "a" … "f" ;

char_not_paren            = ? any Unicode scalar except "(" and ")" ? ;
char_not_backtick         = ? any Unicode scalar except "`" ? ;
char_not_line_terminator  = ? any Unicode scalar except U+000A and U+000D ? ;
```

The grammar alone is not sufficient for conformance: constructor payloads are further
constrained by §10.2–§10.5, and the rules in §5, §8.3, and §11.2–§11.3 are context-sensitive.

---

## 13. Serialization

A **conformant serializer** maps a §3 data model value to STF text. Implementations that only
parse MAY omit this section.

### 13.1 Round-Trip (Critical)

For every value `v` expressible in the data model:

```
parse(serialize(v)) ≡ v
```

Serializers **MUST NOT** emit text that a conformant parser rejects. Where a value cannot be
represented, the serializer **MUST** fail with `ERR_UNREPRESENTABLE` rather than emit
invalid output.

### 13.2 Strings Are Never Constructors

A **String** value **MUST** be serialized as a string literal, whatever its content. A
serializer **MUST NOT** inspect string content to decide to emit `DECIMAL(...)`, `BIGINT(...)`,
`DATE(...)`, `TIMESTAMP(...)`, or `BINARY(...)`. This follows from §3.1 and is called out
separately because violating it silently corrupts data and can produce unparseable documents.

### 13.3 Choice of String Form

* If the string contains no backtick, a serializer **SHOULD** emit the raw form.
* If the string contains a backtick, the serializer **MUST** emit the interpreted form.
* The choice is never observable in the data model.

### 13.4 Numbers

* A Number **MUST** be emitted in the shortest decimal form that parses back to the identical
  `binary64` value (for example via Ryū or Grisu).
* Negative zero **MUST** be emitted as `-0`.
* A host value that is `NaN` or infinite is not in the data model; the serializer **MUST**
  fail with `ERR_UNREPRESENTABLE`.

### 13.5 Escaping

In interpreted strings, `"` and `\` **MUST** be escaped, and C0 controls (`U+0000`–`U+001F`)
**MUST** be escaped using `\b`, `\f`, `\n`, `\r`, `\t` where defined and `\uXXXX` otherwise.
`/` **SHOULD NOT** be escaped. Non-ASCII scalars **SHOULD** be emitted literally as UTF-8
rather than as `\uXXXX`.

### 13.6 Keys

Every key **MUST** match `identifier` (§6.1). A host map key that is empty or contains any
other character is not representable; the serializer **MUST** fail with `ERR_UNREPRESENTABLE`.

### 13.7 Typed Values

`Decimal` **MUST** be emitted with its exact coefficient and scale — normalizing `1.50` to
`1.5` is **non-conformant**. `Date` and `Timestamp` MUST preserve the recorded fields,
including fractional-second trailing zeros and the offset spelling. `Binary` MUST be emitted
in canonical base64 (§10.5).

---

## 14. Canonical Form

**STF Canonical Form** is an OPTIONAL profile producing exactly one byte sequence for a given
value, for hashing, signing, and byte-level diffing. It is not required for general use, and
default serialization (§13) preserves authored order and spacing instead.

Every canonical document is a valid STF document. A canonical serializer **MUST**:

1. Emit UTF-8 with **no** BOM, and use `U+000A` as the only line terminator (canonical output
   contains no line terminators at all under rule 3).
2. Omit all comments. Directives are preserved, in their original order, before the root object.
3. Emit no whitespace except where required to separate tokens — none is ever required, so
   canonical output is `{a:1,b:[1,2]}`.
4. Emit **no trailing commas**.
5. Order object members by **ascending lexicographic order of their UTF-8 key bytes**.
6. Emit every string in the **interpreted** form, escaping only `"`, `\`, and C0 controls
   per §13.5, and emitting all other scalars literally.
7. Emit numbers per §13.4.
8. Emit constructors in the canonical payload spelling of §10, preserving decimal scale.

Canonicalization operates on the data model, so it **does not** preserve the input's key order,
string form, or spacing. Two documents that are equal under §3.2 have identical canonical forms.

---

## 15. Resource Limits

Parsers process untrusted input and **MUST** be able to reject oversized documents rather than
exhaust memory.

| Limit | Requirement | Error |
| :--- | :--- | :--- |
| Nesting depth | **MUST** enforce; default **64** | `ERR_NESTING_DEPTH` |
| Document size | **MAY** enforce; no default | `ERR_DOCUMENT_SIZE` |
| Constructor payload size | **MAY** enforce; no default | `ERR_PAYLOAD_SIZE` |

An implementation that enforces an optional limit **MUST** document its default and **SHOULD**
make it configurable.

---

## 16. Error Reporting

Every rejection defined by this specification maps to exactly one code from
[Standardized Error Codes](error-codes.md), which is normative and includes a condition → code
table. Conformant parsers **MUST** report the specified code — approximate or substituted codes
are non-conformant.

Implementations **SHOULD** additionally report a byte offset and a human-readable message. The
message text is not normative.
