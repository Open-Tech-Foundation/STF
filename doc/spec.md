# STF 1.0 — Structured Text Format Specification

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

> [!WARNING]
> This specification is in a **draft state** and is subject to change.

---

## 1. Overview

**STF (Structured Text Format)** is a human-readable, structured data format designed for configuration and high-performance data interchange.

An STF document represents a **single object**, explicitly delimited by `{}`.
STF emphasizes:

* strict and predictable syntax
* fast parsing
* minimal token noise
* explicit typing via uppercase constructor literals
* human readability without implicit semantics

### 1.1 Media Type
The formal media types for STF are:
* **Interim**: `application/vnd.stf`
* **Post-Registration**: `application/stf`

### 1.2 Non-Goals
To maintain simplicity and predictability, the following are **NOT** goals of the core STF format:
* **Programming Logic**: STF has no execution semantics, variables, or functions.
* **Schema Validation**: Schema validation is defined in a separate specification ([STF Schema](schema.md)) and is decoupled from core parsing for performance.
* **Resource Referencing**: STF does not support internal references (anchors) or external imports.
* **Streaming Framing**: STF is designed as a discrete document format, not a framing protocol.
* **Comments as Data**: Comments are purely for documentation and MUST be ignored by processors.

### 1.3 Supplementary Documentation
For detailed guidance on implementation and migration, see:
* [Migration Guide (JSON → STF)](migration-guide.md)
* [Edge Cases & Constraints](edge-cases.md)
* [Standardized Error Codes](error-codes.md)
* [Comparison with Other Formats](comparison.md)

---

## 2. Character Encoding

* STF documents **MUST** be encoded in **UTF-8**.
* Parsers **MUST** reject invalid UTF-8 input.

---

## 3. Whitespace

* Whitespace characters:
  * space (`U+0020`)
  * horizontal tab (`U+0009`)
  * line feed (`\n`)
  * carriage return + line feed (`\r\n`)
* Whitespace may appear between tokens and has **no semantic meaning**.

Canonical output **SHOULD** normalize line endings to `\n`.

---

## 4. Comments

* STF supports **single-line comments** only.
* A comment begins with `#` and continues until the end of the line.

```stf
# This is a comment
key: 123, # trailing comment
```

---

## 5. Document Structure (Root Object)

An STF document **MUST** consist of a single object enclosed in `{}`.

```stf
{
  name: `example`,
  count: 10,
}
```

* Root arrays or scalar roots are **not allowed**.
* The root object follows the same rules as any nested object.

---

## 6. Keys (Identifiers)

### 6.1 Key Syntax

* Keys are **unquoted identifiers**.
* Allowed characters:
  * ASCII letters `A–Z a–z`
  * digits `0–9`
  * underscore `_`
  * hyphen `-`
* No spaces allowed.
* Leading digits **ARE allowed**.
* Hyphens **ARE allowed** anywhere in the key.

```stf
{
  a: 1,
  user_id: 2,
  123key: 3,
  content-type: 4,
}
```

---

### 6.2 Disallowed in Keys

* Dot (`.`)
* Whitespace
* Unicode characters
* Quoted keys

```stf
{
  user.name: 1,   # ❌ invalid
  "user": 2,      # ❌ invalid
}
```

---

### 6.3 Key Disambiguation vs Constructors

A bare uppercase word in key position (e.g. `{ DATE: 1, DECIMAL: 2 }`) is a **valid key identifier**.
The parser disambiguates constructors from keys by the opening parenthesis `(` immediately following the identifier (without whitespace).

```stf
{
  DATE: 1,      # VALID key identifier
  BIGINT: 2,    # VALID key identifier
}
```

---

## 7. Values

A value may be one of the following:

* Number
* Boolean (`T`, `F`)
* Null (`N`)
* String (Raw or Interpreted)
* Array
* Object
* Constructor literal (`BIGINT`, `DECIMAL`, `DATE`, `TIMESTAMP`, `BINARY`)

---

## 8. Numbers

### 8.1 Number Grammar

STF numbers follow **JSON number grammar**.

Supported:

```stf
0
123
-42
3.14
1e9
-2.5E-3
```

Not supported:

* Leading `+`
* Leading zeroes (`01`)
* Hex, binary, octal
* `NaN`, `Infinity`
* Digit separators (`_`)

---

## 9. Strings (Raw and Interpreted)

STF supports two types of strings: **Raw** and **Interpreted**.

### 9.1 Raw Strings (Backticks)
* **Delimiter**: Raw strings **MUST** be enclosed in backticks (`` ` ``).
* **Backticks within Strings**: The backtick character is **NOT** allowed inside a raw string.
* **Newlines**: Literal newlines are **ALLOWED** and preserved.
* **Escaping**: Raw strings do **NOT** support escape sequences. All characters are treated literally.

### 9.2 Interpreted Strings (Double Quotes)
* **Delimiter**: Interpreted strings **MUST** be enclosed in double quotes (`"`).
* **Escaping**: Supports standard JSON escape sequences (`\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`).
* **Newlines**: Literal newlines are **NOT ALLOWED** inside interpreted strings.

---

## 10. Boolean and Null Literals

| Literal | Meaning |
| ------- | ------- |
| `T`     | true    |
| `F`     | false   |
| `N`     | null    |

Literals are strictly **case-sensitive** and MUST be uppercase.

---

## 11. Builtin Constructor Literals

Constructor literals provide **explicit typed values**.

### General Syntax & Reserved Namespace

```
UPPERCASE_NAME(payload)
```

Rules:
* No whitespace between `TypeName` and `(`
* Constructor names MUST be **strictly uppercase** (`BIGINT`, `DECIMAL`, `DATE`, `TIMESTAMP`, `BINARY`).
* `Date()`, `date()`, `BigNumber()`, `Binary()` are **errors** (`ERR_UNKNOWN_CONSTRUCTOR`), not aliases. Parsers do NOT perform case folding.
* **Reserved Namespace**: Any all-uppercase ASCII identifier immediately followed by `(` (e.g. `CUSTOM(...)`) is reserved for future standard builtins and MUST be rejected with `ERR_UNKNOWN_CONSTRUCTOR` by standard STF 1.0 parsers.

---

### 11.1 BIGINT — `BIGINT(...)`

Arbitrary-precision **integer** values.

```stf
BIGINT(9007199254740993)
BIGINT(-123456789012345678901234567890)
```

* Payload MUST match: `^-?[0-9]+$`
* Fractional components/decimal points are strictly rejected (`ERR_INVALID_CONSTRUCTOR_PAYLOAD`).

---

### 11.2 DECIMAL — `DECIMAL(...)`

Scale-sensitive decimal floating-point number.

```stf
DECIMAL(1.5)
DECIMAL(1.50)
```

* **Scale is data**: `1.5` ≢ `1.50`. Scale is part of the data representation.
* Serializers **MUST** emit input bytes exactly without normalizing scale. Normalizing serializers are non-conformant.
* **Cap**: 34 significant digits (decimal128). Exceeding 34 significant digits raises `ERR_DECIMAL_OVERFLOW`.
* **Disallowed**: Leading `+`, leading zeros (`01.5`), `NaN`, `Infinity`, hex, underscores.
* **Reference Implementation Equality Note**: Native `==` in Python `Decimal`, Go `shopspring/decimal`, or Rust `rust_decimal` compares numerically (`1.5 == 1.50` is true). Implementations MUST compare exact digits and scale.
* Arithmetic is out of scope for the STF data format specification.

---

### 11.3 Temporal — `DATE(...)` and `TIMESTAMP(...)`

#### `DATE(...)` — Wall Date Only
```stf
DATE(2026-01-15)
```
* **MUST** reject any time component (`ERR_INVALID_CONSTRUCTOR_PAYLOAD`).

#### `TIMESTAMP(...)` — Instant in Time
```stf
TIMESTAMP(2026-01-15T10:30:00Z)
TIMESTAMP(2026-01-15T10:30:00.123456789+05:30)
```
* Timezone offset (`Z` or `+HH:MM` / `-HH:MM`) is **MANDATORY**.
* Timestamps without offset are strictly rejected to prevent ambiguity.
* Supports nanosecond precision.

*Note*: TIME, DURATION, and naive datetime use string conventions (ISO 8601 recommended).

---

### 11.4 BINARY — `BINARY(...)`

Binary data encoded in Base64 (RFC 4648 §4 standard alphabet).

```stf
BINARY(SGVsbG8=)
```

* Standard Base64 alphabet only (`A-Z`, `a-z`, `0-9`, `+`, `/`).
* URL-safe alphabet (`-`, `_`) is rejected.
* Padding (`=`) is **mandatory**.
* No internal whitespace.
* Non-canonical trailing bits (e.g. `BINARY(Zh==)`) MUST be rejected.
* **Encoding is not data**: The underlying byte array represents the data value; base64 is solely the text serialization format.

---

## 12. Formal EBNF Grammar

```ebnf
(* STF 1.0 Grammar *)

document        = { directive } ws object ws ;
directive       = "@" identifier "(" directive-value ")" ws ;
directive-value = { char_not_paren } ;

object          = "{" [ member { "," member } [ "," ] ] "}" ;
member          = key ws ":" ws value ;
key             = identifier ;

array           = "[" [ value { "," value } [ "," ] ] "]" ;

value           = ( number | boolean | null | string | interpreted_string | array | object | constructor ) ;

constructor     = ( "BIGINT" | "DECIMAL" | "DATE" | "TIMESTAMP" | "BINARY" ) "(" payload ")" ;
payload         = char_not_paren { char_not_paren } ;

string             = "`" { char_not_backtick } "`" ;
interpreted_string = '"' { char_not_quote_or_newline | escape_seq } '"' ;
escape_seq         = "\" ( '"' | "\" | "/" | "b" | "f" | "n" | "r" | "t" | "u" hex hex hex hex ) ;

boolean         = "T" | "F" ;
null            = "N" ;

number          = [ "-" ] ( "0" | ( digit1_9 { digit } ) ) [ "." fraction ] [ exponent ] ;
fraction        = digit { digit } ;
exponent        = ( "e" | "E" ) [ "-" | "+" ] digit { digit } ;

identifier      = id_char { id_char } ;
id_char         = letter | digit | "_" | "-" ;

ws              = { whitespace | comment } ;
whitespace      = " " | "\t" | "\n" | "\r" ;
comment         = "#" { char_not_newline } ( "\n" | EOF ) ;

letter          = "A" | ... | "Z" | "a" | ... | "z" ;
digit           = "0" | ... | "9" ;
digit1_9        = "1" | ... | "9" ;
hex             = digit | "A" | ... | "F" | "a" | ... | "f" ;
char_not_paren  = ? all UTF-8 except "(" and ")" ? ;
char_not_backtick = ? all UTF-8 except "`" ? ;
char_not_quote_or_newline = ? all UTF-8 except '"', "\" and "\n" ? ;
char_not_newline = ? all UTF-8 except "\n" ? ;
```
