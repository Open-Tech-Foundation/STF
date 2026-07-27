# Migration Guide: JSON & DTXT → STF

This guide covers migrating existing JSON and DTXT documents to **STF (Structured Text Format)**.

## Quick Reference Table

| Feature | JSON | Legacy DTXT | STF 1.0 |
| :--- | :--- | :--- | :--- |
| **Root** | Any value | Object `{}` | Object `{}` always |
| **True / False / Null** | `true` / `false` / `null` | `T` / `F` / `N` | `T` / `F` / `N` |
| **Keys** | `"key"` (quoted) | `key` | `key` (unquoted) |
| **Strings** | `"string"` | `` `string` `` | `` `string` `` (raw) or `"string"` (interpreted) |
| **Wall Date** | `"2026-01-15"` | `Date(2026-01-15)` | `DATE(2026-01-15)` |
| **Timestamp (Instant)** | `"2026-01-15T10:30:00Z"` | `Date(...)` | `TIMESTAMP(2026-01-15T10:30:00Z)` |
| **Big Integer** | `"9007199254740993"` | `BigNumber(...)` | `BIGINT(9007199254740993)` |
| **Decimal** | `1.50` (lossy) | N/A | `DECIMAL(1.50)` |
| **Binary** | `"aGVsbG8="` | `Binary(HEX)` | `BINARY(SGVsbG8=)` (Base64) |

---

## Major STF 1.0 Breaking Changes

### 1. Uppercase Constructor Casing
All constructor literals are now strictly **uppercase** (`BIGINT`, `DECIMAL`, `DATE`, `TIMESTAMP`, `BINARY`).
* `Date(...)` → `DATE(...)` or `TIMESTAMP(...)`
* `BigNumber(...)` → `BIGINT(...)`
* `Binary(...)` → `BINARY(...)`
* Mixed-case and lowercase constructor names (e.g. `Date()`, `date()`) are **parse errors** (`ERR_UNKNOWN_CONSTRUCTOR`). No case folding is performed.

### 2. `DATE` vs `TIMESTAMP` Semantics
* `DATE` is strictly for **wall dates** (`YYYY-MM-DD`). Passing any time or timezone component to `DATE(...)` will result in a parse error (`ERR_INVALID_CONSTRUCTOR_PAYLOAD`).
* `TIMESTAMP` is for **instants**. A timezone offset (`Z` or `+HH:MM` / `-HH:MM`) is **mandatory**. Timestamps without an offset are rejected to prevent timezone ambiguities.

### 3. Arbitrary-Precision Integer: `BIGINT`
Renamed from `BigNumber` to `BIGINT`. It accepts arbitrary-precision integers only. Fractional/decimal numbers must use `DECIMAL(...)`.

### 4. Binary Base64 Encoding
`BINARY(...)` now uses standard RFC 4648 Base64 encoding with mandatory padding `=`. Hex encoding is no longer accepted.

---

## Step-by-Step Migration Example

### Before (Legacy DTXT)
```dtxt
{
  created: Date(2026-01-15),
  updated: Date(2026-01-15T10:30:00Z),
  big: BigNumber(9007199254740993),
  hash: Binary(48656C6C6F),
}
```

### After (STF 1.0)
```stf
{
  created: DATE(2026-01-15),
  updated: TIMESTAMP(2026-01-15T10:30:00Z),
  big: BIGINT(9007199254740993),
  hash: BINARY(SGVsbG8=),
  price: DECIMAL(19.99),
}
```
