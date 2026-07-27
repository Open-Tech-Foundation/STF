# STF 1.0 Edge Case Specification

This document clarifies corner-case processor behaviors for STF 1.0 implementations.

## 1. Keys & Disambiguation

### 1.1 Uppercase Words in Key Position
A bare uppercase word in key position (e.g. `{ DATE: 1 }`) is a **valid key identifier**.
```stf
{ DATE: 1, DECIMAL: 2, TIMESTAMP: 3 } # VALID
```
The opening parenthesis `(` immediately following an uppercase word in value position disambiguates constructor literals from identifiers.

### 1.2 Case Sensitivity
Constructor names are strictly uppercase: `BIGINT`, `DECIMAL`, `DATE`, `TIMESTAMP`, `BINARY`.
`Date()`, `date()`, `BigNumber()` are syntax/unknown constructor errors (`ERR_UNKNOWN_CONSTRUCTOR`). Parsers MUST branch on first byte without case folding.

---

## 2. DECIMAL

### 2.1 Scale Preservation
`DECIMAL(1.5)` ≢ `DECIMAL(1.50)`. Scale is part of the data value representation.
Serializers MUST emit input bytes exactly without stripping trailing zeroes.

### 2.2 Numeric Bounds & Formatting
* Max 34 significant digits (`ERR_DECIMAL_OVERFLOW`).
* Rejected: Leading `+`, leading zero (`01.5`), `NaN`, `Infinity`, hex, underscores.

---

## 3. Temporals (`DATE` vs `TIMESTAMP`)

* `DATE(2026-01-15)`: Wall date only. Time components are strictly rejected (`ERR_INVALID_CONSTRUCTOR_PAYLOAD`).
* `TIMESTAMP(2026-01-15T10:30:00Z)`: Instant in time. Timezone offset (`Z` or `+HH:MM` / `-HH:MM`) is mandatory.

---

## 4. BINARY

* RFC 4648 Base64 alphabet only. URL-safe characters (`-`, `_`) are rejected.
* Mandatory `=` padding. No internal whitespace.
* Non-canonical trailing bits (e.g. `BINARY(Zh==)`) MUST be rejected.
