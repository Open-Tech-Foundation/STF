# STF — Structured Text Format

A project of the [Open Tech Foundation](https://github.com/Open-Tech-Foundation).

**[🚀 Try the STF Playground](https://open-tech-foundation.github.io/DTXT/)**

> [!CAUTION]
> **EXPERIMENTAL PRE-RELEASE**
>
> STF is currently in an experimental, pre-release state. The specification and implementations provided here are for research and feedback purposes only. APIs and document grammar are subject to breaking changes.

## Overview

>**STF (Structured Text Format)** is a human-readable, structured data format designed for configuration and high-performance data interchange. It emphasizes predictability, fast parsing, and explicit typing via uppercase constructor literals (`BIGINT`, `DECIMAL`, `DATE`, `TIMESTAMP`, `BINARY`).

### Key Features

- **Unquoted Keys**: Clean, minimal syntax.
- **Backtick Raw Strings & Interpreted Strings**: Flexible string handling.
- **Explicit Literals**: `T`, `F`, `N` for True, False, and Null.
- **Uppercase Constructor Literals**: Native support for `BIGINT`, `DECIMAL`, `DATE`, `TIMESTAMP`, and Base64 `BINARY`.
- **Scale-Sensitive Decimals**: `1.5` ≢ `1.50`, preserving exact precision.
- **Single-line Comments**: Use `#` for notes and documentation.
- **Fast Parsing**: Designed for direct byte-level processing.
- **Optional Schema Validation**: Separate `stf-schema` validator keeps core parsing fast.

## Documentation

-   [STF 1.0 Specification (Draft)](doc/spec.md)
-   [STF Schema Specification (Draft)](doc/schema.md)
-   [Migration Guide (JSON → STF)](doc/migration-guide.md)
-   [Edge Cases & Constraints](doc/edge-cases.md)
-   [Standardized Error Codes](doc/error-codes.md)
-   [Comparison with Other Formats](doc/comparison.md)

## Testing

-   [Conformance Test Suite](tests/conformance/tests.json)

## Reference Implementations

The `ref-impl/` directory contains reference implementations for the supported languages:

-   [JavaScript / TypeScript](ref-impl/js/)
-   [Python](ref-impl/python/)
-   [Go](ref-impl/go/)
-   [Rust](ref-impl/rust/)

## License

This project is dedicated to the public domain under the [CC0 1.0 Universal (CC0 1.0) Public Domain Dedication](LICENSE).
