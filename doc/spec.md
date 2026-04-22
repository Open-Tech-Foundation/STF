# DTXT 1.0 — Data Text Format (Experimental Draft)

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

> [!WARNING]
> This specification is in an **experimental draft** state and is subject to change. It is currently being shared for feedback and initial implementation testing.

---

## 1. Overview

**DTXT (Data Text Format)** is a human-readable, structured data format designed for configuration and data interchange.

A DTXT document represents a **single object**, explicitly delimited by `{}`.
DTXT emphasizes:

* strict and predictable syntax
* fast parsing
* minimal token noise
* explicit typing via constructor literals
* human readability without implicit semantics

### 1.1 Media Type
The formal media type for DTXT is:
`application/dtxt`

### 1.2 Non-Goals
To maintain simplicity and predictability, the following are **NOT** goals of DTXT:
* **Programming Logic**: DTXT has no execution semantics, variables, or functions.
* **Schema Validation**: DTXT provides explicit typing, but does not define a schema language.
* **Resource Referencing**: DTXT does not support internal references (anchors) or external imports.
* **Streaming Framing**: DTXT is designed as a discrete document format, not a framing protocol.
* **Comments as Data**: Comments are purely for documentation and SHOULD BE ignored by processors.

### 1.3 Supplementary Documentation
For detailed guidance on implementation and migration, see:
* [Migration Guide (JSON → DTXT)](migration-guide.md)
* [Edge Cases & Constraints](edge-cases.md)
* [Standardized Error Codes](error-codes.md)
* [Comparison with Other Formats](comparison.md)

---

## 2. Character Encoding

* DTXT documents **MUST** be encoded in **UTF-8**.
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

* DTXT supports **single-line comments** only.
* A comment begins with `#` and continues until the end of the line.

```dtxt
# This is a comment
key: 123, # trailing comment
```

---

## 5. Document Structure (Root Object)

A DTXT document **MUST** consist of a single object enclosed in `{}`.

```dtxt
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

* Keys are **unquoted identifiers**
* Allowed characters:

  * ASCII letters `A–Z a–z`
  * digits `0–9`
  * underscore `_`
* No spaces allowed
* Leading digits **ARE allowed**

```dtxt
{
  a: 1,
  user_id: 2,
  123key: 3,
}
```

---

### 6.2 Disallowed in Keys

* Dot (`.`)
* Whitespace
* Unicode characters
* Quoted keys

```dtxt
{
  user.name: 1,   # ❌ invalid
  "user": 2,      # ❌ invalid
}
```

#### Rationale

Dots are commonly interpreted as hierarchical path separators in other systems.
DTXT enforces **explicit structure only**, avoiding implied nesting.

---

### 6.3 Keywords and Keys

`T`, `F`, and `N` are **value literals** when used in value position.

They have **no special meaning when used as keys**.

```dtxt
{
  T: 1,
  F: 2,
  N: 3,
}
```

---

## 7. Values

A value may be one of the following:

* Number
* Boolean (`T`, `F`)
* Null (`N`)
* String
* Array
* Object
* Constructor literal

---

## 8. Numbers

### 8.1 Number Grammar

DTXT numbers follow **JSON number grammar**.

Supported:

```dtxt
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

### 8.2 Numeric Semantics

* Precision is implementation-defined.
* DTXT does not guarantee arbitrary precision for normal numbers.
* Use `BN(...)` for exact large integers.

---

## 9. Strings

Strings are used for arbitrary textual data.

```dtxt
{
  name: `Sample`,
  message: `Hello "World"`,
}
```

### 9.1 Rules
* **Delimiter**: Strings **MUST** be enclosed in backticks (`` ` ``).
* **Backticks within Strings**: The backtick character is **NOT** allowed inside a string in DTXT 1.0.
* **Newlines**: Literals newlines are **ALLOWED** and preserved.
* **Escaping**: DTXT 1.0 does **NOT** support escape sequences (e.g., `\n`, `\t`). All characters (except the delimiter) are treated literally.

#### Rationale
Excluding escapes and internal delimiters ensures that strings can be scanned with a single pass using simple byte comparison (`memchr`), maximizing parsing speed.

---

## 10. Boolean and Null Literals

| Literal | Meaning |
| ------- | ------- |
| `T`     | true    |
| `F`     | false   |
| `N`     | null    |

* Literals are **case-sensitive**.

---

## 11. Arrays

Arrays use square brackets `[]`.

```dtxt
{
  values: [1, 2, 3],
}
```

* Elements **MUST** be comma-separated
* Trailing commas are allowed

---

## 12. Objects

Objects use curly braces `{}`.

```dtxt
{
  config: {
    enabled: T,
    retries: 3,
  },
}
```

* Duplicate keys within the same object are **errors**
* Members **MUST** be comma-separated
* Trailing commas are allowed

---

## 13. Constructor Literals

Constructor literals provide **explicit typed values**.

### General Syntax

```
TypeName(payload)
```

Rules:

* No whitespace between `TypeName` and `(`
* Payload:

  * MUST be non-empty
  * MUST NOT contain whitespace
  * MUST NOT contain `(` or `)`
* No nesting of constructors
* Constructors are declarative, not executable

### 13.1 Strict Constructor Policy
DTXT 1.0 enforces a closed set of constructors. Only types defined in this specification are valid.
*   **Unknown Types**: Any constructor name not explicitly defined in the Standard Constructors section **MUST** result in a parse error.
*   **No Custom Extensions**: User-defined or vendor-defined constructors are not supported in this version.

---

## 14. Standard Constructor Literals

### 14.1 Date / DateTime — `D(...)`

```dtxt
D(2026-01-15)
D(2026-01-15T10:30:00Z)
```

* Payload is an ISO-8601 date or datetime token
* DTXT does not distinguish date-only vs datetime syntactically
* DTXT does not validate ISO correctness

---

### 14.2 Big Number — `BN(...)`

```dtxt
BN(9007199254740993)
```

Rules:

* Payload MUST match: `^[+-]?[0-9]+$`
* Represents an exact arbitrary-precision integer

Canonicalization:

* Remove leading zeros
* `BN(-0)` → `BN(0)`

---

### 14.3 Binary — `B(...)`

```dtxt
B(89504E470D0A1A0A)
```

Rules:

* Payload MUST be hexadecimal digits
* Payload length **MUST** be even (representing full bytes)
* Case-insensitive input
* Canonical output MUST use uppercase hex

Represents arbitrary binary data.

---

## 15. Trailing Commas

Trailing commas are **optional** but allowed in:

* Objects
* Arrays

```dtxt
{
  a: 1,
  b: 2,
}
```

---

## 16. Canonical Form (Normative)

To ensure interoperability and reproducible hashing/signing, a DTXT document **MUST** be converted to its Canonical Form when transmitted in environments requiring determinism.

A Canonical DTXT document **MUST**:
1.  **Normalization**: Use uppercase for literals (`T`, `F`, `N`) and constructor names (`D`, `BN`, `B`).
2.  **Line Endings**: Use a single line feed (`\n`) for all newlines.
3.  **No Indentation**: Remove all unnecessary whitespace between tokens.
4.  **Constructor Payloads**:
    *   `BN(...)`: Remove leading zeros and `+` signs. `BN(-0)` MUST become `BN(0)`.
    *   `B(...)`: Use uppercase hex digits.
5.  **Key Sorting**: Keys within an object **MUST** be sorted lexicographically by their UTF-8 byte values for strictly reproducible output.

---

## 17. JSON Interoperability (Recommended)

| DTXT      | JSON         |
| --------- | ------------ |
| Number    | number       |
| `T` / `F` | true / false |
| `N`       | null         |
| `D(...)`  | string       |
| `BN(...)` | string       |
| `B(...)`  | string       |

Typed JSON wrappers MAY be used by tooling.

---

## 18. Error Handling

Parsers MUST report errors for:

* Invalid tokens
* Invalid keys
* Duplicate keys
* Invalid constructor payloads
* Unterminated structures
* Trailing invalid content

---

## 19. Security Considerations

* DTXT has no execution semantics.
* Binary and big-number payloads may be attacker-controlled.

### 19.1 Implementation Limits
To prevent Denial of Service (DoS) attacks, implementations SHOULD enforce the following minimum limits:
*   **Nesting Depth**: At least 32 levels.
*   **Constructor Payload**: At least 64 KB.
*   **Identifier Length**: At least 256 bytes.
*   **Document Size**: At least 100 MB.

Implementations MAY provide configuration to increase these limits for specific use cases.

---

## 20. Example

```dtxt
# DTXT example
{
  name: `Sample`,
  created: D(2026-01-15),
  updated: D(2026-01-15T10:30:00Z),
  active: T,
  count: 42,
  big: BN(9007199254740993),
  hash: B(A7B2319E44CE12BA),
  items: [1, 2, 3],
  meta: {
    retries: 3,
    enabled: F,
  },
}
```

---

## 21. Appendix A: Formal EBNF Grammar

The following is a formal description of DTXT 1.0 using Extended Backus-Naur Form (EBNF).

```ebnf
(* DTXT 1.0 Grammar *)

document      = ws object ws ;

object        = "{" [ member { "," member } [ "," ] ] "}" ;
member        = key ws ":" ws value ;
key           = identifier ;

array         = "[" [ value { "," value } [ "," ] ] "]" ;

value         = ( number | boolean | null | string | array | object | constructor ) ;

constructor   = ( "D" | "BN" | "B" ) "(" payload ")" ;
payload       = char_not_paren { char_not_paren } ;

string        = "`" { char_not_backtick } "`" ;

boolean       = "T" | "F" ;
null          = "N" ;

number        = [ "-" ] ( "0" | ( digit1_9 { digit } ) ) [ "." fraction ] [ exponent ] ;
fraction      = digit { digit } ;
exponent      = ( "e" | "E" ) [ "-" | "+" ] digit { digit } ;

identifier    = id_char { id_char } ;
id_char       = letter | digit | "_" ;

ws            = { whitespace | comment } ;
whitespace    = " " | "\t" | "\n" | "\r" ;
comment       = "#" { char_not_newline } "\n" ;

(* Character classes *)
letter            = "A" | ... | "Z" | "a" | ... | "z" ;
digit             = "0" | ... | "9" ;
digit1_9          = "1" | ... | "9" ;
char_not_paren    = ? all UTF-8 except "(", ")", and whitespace ? ;
char_not_backtick = ? all UTF-8 except "`" ? ;
char_not_newline  = ? all UTF-8 except "\n" ? ;
```
