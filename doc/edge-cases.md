# DTXT 1.0 Edge Case Specification

This document clarifies the behavior of DTXT processors in corner cases to ensure cross-implementation consistency.

## 1. Identifiers (Keys)

### 1.1 Leading Digits
Identifiers **MAY** start with a digit.
```dtxt
{ 123: `value` } # VALID
```

### 1.2 Underscores
Identifiers **MAY** consist entirely of underscores.
```dtxt
{ _: 1, __: 2 } # VALID
```

### 1.3 Case Sensitivity
Keys are case-sensitive.
```dtxt
{ Key: 1, key: 2 } # VALID (distinct keys)
```

### 1.4 Hyphens (Kebab-Case)
Identifiers **MAY** contain hyphens.
```dtxt
{ content-type: `text`, max-retries: 3, -flag: T, 123-abc: F } # VALID
```

## 2. Numbers

### 2.1 Precision and Range
Normal numbers in DTXT follow IEEE 754 double-precision semantics by default. For arbitrary precision, `BN(...)` MUST be used.

### 2.2 Boundary Values
- **-0**: Implementation defined, but `stringify` SHOULD output `0`.
- **Leading Zeros**: `01` is INVALID. `0.1` is VALID.
- **Trailing Dots**: `1.` is INVALID.

## 3. Strings

### 3.1 Multi-line Strings
Literal newlines are preserved in raw strings (backticks), but are **INVALID** in interpreted strings (double quotes).
```dtxt
{
  raw: `Line 1
Line 2`,           # VALID
  interp: "Line 1
Line 2"            # INVALID
}
```

### 3.2 Backticks and Escapes
Backticks are **forbidden** inside raw string literals. There is no escape mechanism.
To use escapes or include backticks, interpreted strings MUST be used.
```dtxt
{
  raw: `hello \n world`,    # Literal backslash and 'n'
  interp: "hello \n world", # Newline character
  has_backtick: "`hi`"      # VALID
}
```

## 4. Constructors

### 4.1 Empty Payload
Payloads **MUST NOT** be empty.
```dtxt
{ date: D() } # INVALID
```

### 4.2 Whitespace in Payload
Payloads **MUST NOT** contain whitespace.
```dtxt
{ date: D(2026-01-15 10:00:00) } # INVALID (use T separator)
```

### 4.3 Nesting
Constructors **MUST NOT** be nested.
```dtxt
{ x: BN(BN(123)) } # INVALID
```

### 4.4 Strict Validation
Payloads **MUST** strictly conform to their specified formats. `D(...)` must be a valid ISO-8601 string.
```dtxt
{ d1: D(not-a-date) } # INVALID (must fail to parse)
```

## 5. Structural Constraints

### 5.1 Root Level
The document **MUST** be exactly one object.
```dtxt
[1, 2, 3] # INVALID (root must be object)
`string`  # INVALID
{}        # VALID
```

### 5.2 Duplicate Keys
Duplicate keys in the same object are **errors**.
```dtxt
{ a: 1, a: 2 } # INVALID
```

### 5.3 Trailing Commas
Trailing commas are allowed and encouraged for diff cleanliness.
```dtxt
{ a: [1,], } # VALID
```
