# STF vs. Other Data Formats

This document provides a technical comparison between **STF (Structured Text Format)** and other established human-readable and structured data formats.

## 1. Feature Matrix

| Feature | JSON | XML | YAML | TOML | Amazon Ion | **STF** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Comments** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Unquoted Keys** | ❌ | N/A | ✅ | ✅ | ✅ | ✅ |
| **Trailing Commas** | ❌ | N/A | ✅ | ✅ | ✅ | ✅ |
| **Multiline Strings** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Explicit Dates** | ❌ | ❌ | ⚠️ (Implicit) | ✅ | ✅ `timestamp` | ✅ `DATE(...)` / `TIMESTAMP(...)` |
| **Big Int / Decimal** | ❌ | ❌ | ❌ | ❌ | ✅ `decimal` | ✅ `BIGINT(...)` / `DECIMAL(...)` |
| **Binary Support** | ❌ | ❌ | ✅ (Base64) | ❌ | ✅ `blob`/`clob` | ✅ `BINARY(...)` |
| **Scale-Sensitive Decimal** | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| **Complexity (Spec)**| Low | High | Very High | Medium | Medium-High | **Low** |
| **Parsing Speed** | Very Fast | Slow | Very Slow | Medium | Fast | **Extreme** |

---

## 2. Deep Dives

### 2.1 STF vs. Amazon Ion
*   **Overview**: Amazon Ion is a rich, typed data format that supports text and binary representations.
*   **Decimals**: Both STF and Amazon Ion converge on scale-sensitive decimals (`1.5` ≢ `1.50`), recognizing that trailing precision is semantic data in financial and scientific applications.
*   **Binary Encoding**: Amazon Ion offers a compact binary format (`Ion Binary`) that produces smaller payloads than STF text serialization. We concede binary encoding size to Amazon Ion.
*   **Spec Simplicity**: STF prioritizes specification simplicity. Unlike Amazon Ion, STF has no symbol tables, macros, shared catalogs, or binary table state machines. STF is dedicated to CC0/open specification simplicity and zero-copy text parsing speed.

### 2.2 STF vs. JSON
*   **The Problem with JSON**: No comments, mandatory double quotes on keys, and no standard distinction between dates, decimals, big integers, and strings.
*   **The STF Solution**: STF maintains JSON's structural simplicity while providing explicit uppercase constructors (`DATE`, `TIMESTAMP`, `BIGINT`, `DECIMAL`, `BINARY`) to eliminate schema ambiguity.

### 2.3 STF vs. YAML
*   **The Problem with YAML**: YAML is notoriously complex (the "Norway Problem" — `NO` evaluated as false). Indentation-dependent parsing prevents SIMD vectorized scanning.
*   **The STF Solution**: STF is **deterministic**. It uses explicit C-style braces `{}` and backtick raw strings, eliminating whitespace ambiguities and enabling SIMD-accelerated text parsing.

---

## 3. Summary: The Sweet Spot

| Use Case | Best Format | Why? |
| :--- | :--- | :--- |
| **Simple Config** | TOML | Clean for flat key-value files. |
| **Rich Enterprise Data** | **STF** / Amazon Ion | Native scale-sensitive decimals, exact temporal types, and binary payloads. |
| **Extreme Simplicity & Speed** | **STF** | Outperforms standard JSON parsers with zero symbol tables or macro complexity. |
| **Legacy Support** | JSON | Universal compatibility. |
