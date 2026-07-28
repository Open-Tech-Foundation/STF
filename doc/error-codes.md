# STF 1.0 — Standardized Error Codes

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

This document is **normative**. It is the companion to [the STF 1.0 specification](spec.md).

Every input that STF 1.0 requires to be rejected maps to **exactly one** code below.
A conformant parser **MUST** report that code. Reporting a related-but-different code
(for example `ERR_SYNTAX` in place of `ERR_INVALID_NUMBER`) is **non-conformant**:
callers cannot branch on error codes that vary by implementation, and conformance suites
that accept substitutions cannot detect divergence.

Implementations **SHOULD** also report a byte offset and a human-readable message.
**Message text is not normative** and MUST NOT be relied upon by callers.

---

## 1. Code Index

### Encoding
| Code | Meaning |
| :--- | :--- |
| `ERR_INVALID_UTF8` | Input is not well-formed UTF-8. |

### General Syntax
| Code | Meaning |
| :--- | :--- |
| `ERR_SYNTAX` | A token is not valid in this position, and no more specific code applies. |
| `ERR_UNTERMINATED` | Input ended before a string, object, array, or constructor was closed. |
| `ERR_TRAILING_CONTENT` | Content follows the root object. |

### Structure
| Code | Meaning |
| :--- | :--- |
| `ERR_ROOT_NOT_OBJECT` | The document root is not a `{}` object. |
| `ERR_DUPLICATE_KEY` | An object contains the same key more than once. |
| `ERR_MISSING_COLON` | Expected `:` after a key. |
| `ERR_MISSING_COMMA` | Expected `,` between members or elements. |

### Identifiers
| Code | Meaning |
| :--- | :--- |
| `ERR_INVALID_IDENTIFIER` | A key is empty or contains a character outside `[A-Za-z0-9_-]`. |

### Primitive Values
| Code | Meaning |
| :--- | :--- |
| `ERR_INVALID_NUMBER` | Number literal violates the grammar of spec §7.1. |
| `ERR_NUMBER_OVERFLOW` | Number literal exceeds finite `binary64` range. |
| `ERR_INVALID_STRING` | Invalid escape, illegal literal newline, or unpaired surrogate. |

### Constructors
| Code | Meaning |
| :--- | :--- |
| `ERR_UNKNOWN_CONSTRUCTOR` | Reserved-namespace name is not an STF 1.0 constructor. |
| `ERR_INVALID_CONSTRUCTOR_PAYLOAD` | Payload does not satisfy the constructor's grammar or semantics. |
| `ERR_NESTED_CONSTRUCTOR` | `(` encountered while scanning a constructor payload. |
| `ERR_DECIMAL_OVERFLOW` | `DECIMAL` exceeds 34 significant digits or scale 6143. |

### Resource Limits
| Code | Meaning | Enforcement |
| :--- | :--- | :--- |
| `ERR_NESTING_DEPTH` | Nesting exceeds the maximum depth. | **MUST**, default 64 |
| `ERR_DOCUMENT_SIZE` | Document exceeds the configured size limit. | MAY, no default |
| `ERR_PAYLOAD_SIZE` | Constructor payload exceeds the configured size limit. | MAY, no default |

### Serialization
| Code | Meaning |
| :--- | :--- |
| `ERR_UNREPRESENTABLE` | A host value has no valid STF representation (spec §13.1). |

### Stream Profile
Raised only when reading [STF Stream](stream.md) (`.stfs`). Never raised by a core parser.

| Code | Meaning |
| :--- | :--- |
| `ERR_STREAM_RAW_NEWLINE` | A record contains a raw LF or CR (stream §3.2). |
| `ERR_STREAM_DIRECTIVE_IN_RECORD` | A directive appears outside the header line (stream §4). |

### Schema Validation
Raised by `stf-schema`, never by a core parser. See [schema.md](schema.md).

| Code | Meaning |
| :--- | :--- |
| `ERR_SCHEMA_INVALID` | The schema document itself is malformed, or a keyword or bound is unusable. |
| `ERR_SCHEMA_TYPE_MISMATCH` | Value kind does not match `type`, or `N` where `nullable: F`. |
| `ERR_SCHEMA_REQUIRED` | A key with `optional: F` is absent. |
| `ERR_SCHEMA_RANGE` | `min`, `max`, or `integer` violated. |
| `ERR_SCHEMA_SCALE_MISMATCH` | Decimal scale does not match the required `scale`. Message MUST state expected vs actual. |
| `ERR_SCHEMA_ENUM` | `const` or `enum` violated. |
| `ERR_SCHEMA_UNKNOWN_FIELD` | A key is not named in `fields` and `additional: F`. |

---

## 2. Condition → Code (Normative)

This table is the authority for conformance testing. Where two rows could apply, the
**earlier** row wins.

### 2.1 Encoding and document framing

| Condition | Example | Code |
| :--- | :--- | :--- |
| Malformed UTF-8 byte sequence | `0xFF` in input | `ERR_INVALID_UTF8` |
| Leading byte order mark | `U+FEFF` before `{` | `ERR_SYNTAX` |
| Empty input | `` | `ERR_ROOT_NOT_OBJECT` |
| Whitespace / comments only | `# hi` | `ERR_ROOT_NOT_OBJECT` |
| Directives but no root object | `@schema(x)` | `ERR_ROOT_NOT_OBJECT` |
| Root is an array | `[]` | `ERR_ROOT_NOT_OBJECT` |
| Root is a scalar or string | `42`, `` `hi` ``, `T` | `ERR_ROOT_NOT_OBJECT` |
| Root is a constructor | `DATE(2026-01-15)` | `ERR_ROOT_NOT_OBJECT` |
| Second object after root | `{a:1}{b:2}` | `ERR_TRAILING_CONTENT` |
| Any other content after root | `{a:1} x` | `ERR_TRAILING_CONTENT` |
| Directive after root | `{a:1}\n@schema(x)` | `ERR_TRAILING_CONTENT` |
| Whitespace after `@` or before `(` | `@ schema(x)`, `@schema (x)` | `ERR_SYNTAX` |
| Same directive name twice | `@schema(a)\n@schema(b)` | `ERR_SYNTAX` |
| **Unknown directive** | `@nope(1)\n{a:1}` | **not an error** — warn |

### 2.2 Objects, arrays, keys

| Condition | Example | Code |
| :--- | :--- | :--- |
| Empty key | `{ : 1 }` | `ERR_INVALID_IDENTIFIER` |
| Key contains a disallowed character | `{ a.b: 1 }` | `ERR_INVALID_IDENTIFIER` |
| Non-ASCII key | `{ café: 1 }`, `{ 🔑: 1 }` | `ERR_INVALID_IDENTIFIER` |
| Quoted key | `{ "a": 1 }`, ``{ `a`: 1 }`` | `ERR_SYNTAX` |
| Whitespace inside a key | `{ a b: 1 }` | `ERR_INVALID_IDENTIFIER` |
| Missing `:` after key | `{ a 1 }` | `ERR_MISSING_COLON` |
| Missing value after `:` | `{ a: }` | `ERR_SYNTAX` |
| Missing `,` between members | `{ a:1 b:2 }` | `ERR_MISSING_COMMA` |
| Consecutive commas | `{ a:1,, b:2 }`, `[1,,2]` | `ERR_MISSING_COMMA` |
| Leading comma | `{ , a:1 }`, `[,1]` | `ERR_MISSING_COMMA` |
| Duplicate key, any depth | `{ a:1, a:2 }` | `ERR_DUPLICATE_KEY` |
| Unterminated object or array | `{ a: 1`, `{a:[1}` | `ERR_UNTERMINATED` |
| Nesting beyond the limit | 65 nested objects | `ERR_NESTING_DEPTH` |
| Trailing comma | `{a:1,}`, `[1,]` | **valid** |

### 2.3 Numbers

A number literal **MUST NOT** be immediately followed by an identifier character
(`[A-Za-z0-9_-]`) or `.`; see spec §7.4.

| Condition | Example | Code |
| :--- | :--- | :--- |
| Leading `+` | `{a: +1}` | `ERR_INVALID_NUMBER` |
| Leading zero | `{a: 0123}` | `ERR_INVALID_NUMBER` |
| Missing integer part | `{a: .5}` | `ERR_INVALID_NUMBER` |
| Trailing decimal point | `{a: 1.}` | `ERR_INVALID_NUMBER` |
| Missing exponent digits | `{a: 1e}`, `{a: 1e+}` | `ERR_INVALID_NUMBER` |
| Sign with no digits | `{a: -}` | `ERR_INVALID_NUMBER` |
| Hexadecimal / octal / binary | `{a: 0x10}` | `ERR_INVALID_NUMBER` |
| Digit separator | `{a: 1_000}` | `ERR_INVALID_NUMBER` |
| Magnitude exceeds finite binary64 | `{a: 1e400}` | `ERR_NUMBER_OVERFLOW` |
| Underflow to zero | `{a: 1e-400}` | **valid**, yields `0.0` |
| Negative zero | `{a: -0}` | **valid**, distinct from `0` |
| Precision loss past 2^53 | `{a: 9007199254740993}` | **valid**, yields `…992` |

### 2.4 Literals

A `T`, `F`, or `N` literal **MUST NOT** be immediately followed by an identifier character.

| Condition | Example | Code |
| :--- | :--- | :--- |
| Lowercase literal | `{a: t}`, `{a: n}` | `ERR_SYNTAX` |
| Spelled-out literal | `{a: true}`, `{a: null}` | `ERR_SYNTAX` |
| Mixed case | `{a: True}` | `ERR_SYNTAX` |
| `NaN` | `{a: NaN}` | `ERR_SYNTAX` |
| `Infinity` | `{a: Infinity}` | `ERR_SYNTAX` |

### 2.5 Strings

| Condition | Example | Code |
| :--- | :--- | :--- |
| Unterminated raw string | `` {a: `hi} `` | `ERR_UNTERMINATED` |
| Unterminated interpreted string | `{a: "hi}` | `ERR_UNTERMINATED` |
| Literal LF or CR in interpreted string | an actual newline between the quotes | `ERR_INVALID_STRING` |
| Unrecognized escape | `{a: "\x41"}`, `{a: "\U0041"}` | `ERR_INVALID_STRING` |
| `\u` without 4 hex digits | `{a: "\u41"}` | `ERR_INVALID_STRING` |
| Unpaired high surrogate | `{a: "\uD800"}` | `ERR_INVALID_STRING` |
| Lone low surrogate | `{a: "\uDC00"}` | `ERR_INVALID_STRING` |
| Valid surrogate pair | `{a: "\uD83D\uDE00"}` | **valid**, yields `😀` |
| Literal non-ASCII in a string | `` {a: `😀`} `` | **valid**, no escaping required |
| Backtick inside raw string | `` {a: `x`y`} `` | `ERR_MISSING_COMMA` |
| Literal LF in raw string | an actual newline between the backticks | **valid**, preserved |
| `\u0000` escape | `{a: "\u0000"}` | **valid**, U+0000 is legal string content |

### 2.6 Constructors — general

| Condition | Example | Code |
| :--- | :--- | :--- |
| Whitespace before `(` | `{a: DATE (2026-01-15)}` | `ERR_SYNTAX` |
| Reserved name, not an STF 1.0 constructor | `{a: CUSTOM(1)}`, `{a: TIME(1)}` | `ERR_UNKNOWN_CONSTRUCTOR` |
| Uppercase-initial name before `(` | `{a: Date(…)}`, `{a: BigNumber(…)}` | `ERR_UNKNOWN_CONSTRUCTOR` |
| Case-insensitive match of a constructor | `{a: date(…)}`, `{a: binary(…)}` | `ERR_UNKNOWN_CONSTRUCTOR` |
| Non-reserved identifier before `(` | `{a: foo(1)}` | `ERR_SYNTAX` |
| `(` inside payload | `{a: DATE(DATE(x))}` | `ERR_NESTED_CONSTRUCTOR` |
| End of input before `)` | `{a: DATE(2026-01-15}` | `ERR_UNTERMINATED` |
| Uppercase word used as a key | `{ DATE: 1 }` | **valid** — key, not constructor |

### 2.7 `DECIMAL`

| Condition | Example | Code |
| :--- | :--- | :--- |
| Empty payload | `DECIMAL()` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Exponent notation | `DECIMAL(1.5e3)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Trailing decimal point | `DECIMAL(1.)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Leading `+` | `DECIMAL(+1.5)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Leading zeros | `DECIMAL(01.5)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| `NaN` / `Infinity` / hex / underscore / whitespace | `DECIMAL(NaN)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| More than 34 significant digits | 35-digit coefficient | `ERR_DECIMAL_OVERFLOW` |
| Scale greater than 6143 | — | `ERR_DECIMAL_OVERFLOW` |
| Integer form | `DECIMAL(15)` | **valid**, scale 0 |
| Leading zeros in the fraction | `DECIMAL(0.0…01)`, 38 fraction digits | **valid**, 1 significant digit |
| Trailing zeros | `DECIMAL(1.50)` | **valid**, scale 2, ≠ `DECIMAL(1.5)` |

### 2.8 `BIGINT`

| Condition | Example | Code |
| :--- | :--- | :--- |
| Empty payload | `BIGINT()` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Non-digit character | `BIGINT(123a)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Fractional or exponent form | `BIGINT(12.34)`, `BIGINT(1e3)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Leading `+` | `BIGINT(+1)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Leading zeros | `BIGINT(007)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Negative zero | `BIGINT(-0)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Arbitrarily large magnitude | 100-digit integer | **valid** |

### 2.9 `DATE` and `TIMESTAMP`

| Condition | Example | Code |
| :--- | :--- | :--- |
| Wrong shape or not zero-padded | `DATE(2026-1-5)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Month out of range | `DATE(2026-13-01)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Day out of range for that month | `DATE(2026-02-31)`, `DATE(2026-04-31)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Day `00` | `DATE(2026-01-00)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Non-leap 29 February | `DATE(2025-02-29)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Leap 29 February | `DATE(2024-02-29)` | **valid** |
| Time component in `DATE` | `DATE(2026-01-15T10:00:00Z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Missing UTC offset | `TIMESTAMP(2026-01-15T10:30:00)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Space instead of `T` | `TIMESTAMP(2026-01-15 10:30:00Z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Lowercase `t` or `z` | `TIMESTAMP(2026-01-15t10:30:00z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Hour / minute / second out of range | `TIMESTAMP(2026-01-15T99:30:00Z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Leap second | `TIMESTAMP(2026-01-15T23:59:60Z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Offset out of range | `TIMESTAMP(…+99:00)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Fraction with 0 or >9 digits | `TIMESTAMP(…T10:30:00.Z)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Negative offset | `TIMESTAMP(2026-01-15T10:30:00-05:00)` | **valid** |
| Nanosecond precision | `TIMESTAMP(…T10:30:00.123456789+05:30)` | **valid** |

### 2.10 `BINARY`

| Condition | Example | Code |
| :--- | :--- | :--- |
| Length not a multiple of 4 | `BINARY(SGVsbG8)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Character outside the standard alphabet | `BINARY(SGVsb-8=)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| `=` other than as final padding | `BINARY(SG=sbG8=)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Non-canonical trailing bits | `BINARY(Zh==)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Internal whitespace | `BINARY(SGVs bG8=)` | `ERR_INVALID_CONSTRUCTOR_PAYLOAD` |
| Empty payload | `BINARY()` | **valid**, empty octet sequence |
| No padding needed | `BINARY(SGVsbG9X)` | **valid** |

### 2.11 Serialization

| Condition | Code |
| :--- | :--- |
| Host number is `NaN` or infinite | `ERR_UNREPRESENTABLE` |
| Map key is empty or not a valid identifier | `ERR_UNREPRESENTABLE` |
| Host value has no data-model equivalent | `ERR_UNREPRESENTABLE` |

---

## 3. Changes from Pre-Release Drafts

| Change | Notes |
| :--- | :--- |
| Added `ERR_INVALID_UTF8` | Spec §2 required rejection but defined no code. |
| Added `ERR_NUMBER_OVERFLOW` | Replaces producing `Infinity` on overflow. |
| Added `ERR_TRAILING_CONTENT` | Was already emitted by several implementations but undocumented. |
| Added `ERR_UNREPRESENTABLE` | Serializers previously had no way to fail. |
| `ERR_NESTED_CONSTRUCTOR` given a precise trigger | Now defined as `(` encountered while scanning a payload. |
| `ERR_DOCUMENT_SIZE`, `ERR_PAYLOAD_SIZE` marked OPTIONAL | Previously listed with no limits and no implementation. |
| Condition → code table added | Substituted codes are now non-conformant. |
