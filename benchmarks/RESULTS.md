# DTXT Benchmark Results (Comprehensive)

This document provides a detailed performance analysis of DTXT 1.0 against standard JSON implementations across all reference languages.

**Dataset**: 30,000 entries (Mixed types: integers, floats, booleans, nulls, nested objects, and strings).

## 1. Payload Size Efficiency

DTXT achieves significant storage savings primarily by omitting quotes from keys and using concise boolean/null literals (`T`, `F`, `N`).

| Language | JSON Size | DTXT Size | Reduction |
| :--- | :--- | :--- | :--- |
| **Go** | 6.31 MB | 5.16 MB | **18.2%** |
| **Rust** | 6.31 MB* | 5.33 MB | **15.5%** |
| **TypeScript** | 6.31 MB | 5.28 MB | **16.4%** |
| **Python** | 7.11 MB | 5.96 MB | **16.2%** |
| **Zig** | 6.31 MB | 5.28 MB | **16.4%** |

*\*Rust baseline estimated from JSON equivalence.*

## 2. Parsing Performance

Average of 5 runs for 30,000 entries.

| Language | Implementation | Parse Time | vs JSON (Std) |
| :--- | :--- | :--- | :--- |
| **Go** | Standard `encoding/json` | 89.20 ms | - |
| | **DTXT (Reference)** | **71.60 ms** | 🚀 **20% faster** |
| | Sonic (Fastest JSON) | 55.00 ms | 28% faster than DTXT |
| **Rust** | **DTXT (Reference)** | **49.32 ms** | 🚀 **Fastest** |
| **Zig** | Standard JSON | 53.10 ms | - |
| | **DTXT (Reference)** | **62.40 ms** | 18% slower |
| **TypeScript (Bun)** | Native `JSON.parse` | 38.39 ms | - |
| | **DTXT (Ref - Optimized)** | **91.38 ms** | 2.4x slower |
| **TypeScript (Node)** | Native `JSON.parse` | 38.80 ms* | - |
| | **DTXT (Ref - Optimized)** | **92.80 ms*** | 2.4x slower* |
| **Python** | Standard `json.loads` | 84.87 ms | - |
| | **DTXT (Rust Ext)** | **97.39 ms** | 15% slower |
| | DTXT (Pure Python) | 2018.44 ms | 24x slower |

*\*From previous benchmark run; Bun and Node results are comparable.*

**Note**: TypeScript DTXT is slower than native `JSON.parse` because `JSON.parse` is implemented in native C++ bytecode (V8 engine), while DTXT is a runtime-interpreted JavaScript implementation.

## 3. Serialization Performance

Average of 5 runs for 30,000 entries.

| Language | Implementation | Serialization | vs JSON (Std) |
| :--- | :--- | :--- | :--- |
| **Go** | Standard `encoding/json` | 101.00 ms | - |
| | **DTXT (Reference)** | **44.80 ms** | 🚀 **56% faster** |
| | Sonic (Fastest JSON) | 41.60 ms | 7% faster than DTXT |
| **Rust** | **DTXT (Reference)** | **24.11 ms** | 🚀 **Fastest** |
| **Zig** | Standard JSON | 59.54 ms | - |
| | **DTXT (Reference)** | **47.63 ms** | 🚀 **20% faster** |
| **TypeScript (Bun)** | Native `JSON.stringify` | 27.30 ms | - |
| | **DTXT (Ref - Optimized)** | **227.26 ms** | 8.3x slower |
| **TypeScript (Node)** | Native `JSON.stringify` | 31.80 ms* | - |
| | **DTXT (Ref - Optimized)** | **232.00 ms*** | 7.3x slower* |
| **Python** | Standard `json.dumps` | 70.14 ms | - |
| | **DTXT (Reference)** | **218.50 ms** | 3.1x slower |

*\*From previous benchmark run; Bun and Node results are comparable.*

**Note**: TypeScript DTXT serialization is slower than native `JSON.stringify` because `JSON.stringify` is implemented in native C++ bytecode (V8 engine), while DTXT is a runtime-interpreted JavaScript implementation.

## Key Observations:

1.  **Go Excellence**: The Go implementation of DTXT outperforms the standard library JSON parser by **20%** for both parsing and serialization (~2x for serialization), approaching the performance of specialized libraries like Sonic.
2.  **Rust Power**: The Rust implementation is the overall performance leader, delivering the fastest parsing (49.32 ms) and serialization (24.11 ms) times across all implementations.
3.  **Zig Balance**: The Zig implementation is the only one where DTXT serialization is **faster** than standard JSON (20% faster). DTXT parsing is 18% slower than JSON parsing, making Zig the most balanced compiled implementation.
4.  **TypeScript Reality**: Pure JavaScript DTXT cannot match native `JSON.parse/stringify` speed because those are C++ V8 internals, while DTXT runs as interpreted JS bytecode. Parsing is 2.4x slower, serialization is 8.3x slower.
5.  **Python Leap**: By leveraging the Rust extension (`dtxt_rs`), Python's parsing performance jumps from 2000ms+ to 97ms, making it competitive with the built-in `json.loads`. Pure Python serialization remains slow (3.1x slower than `json.dumps`).
6.  **Efficiency**: Across all languages, DTXT consistently delivers a **15-18% reduction** in data size, making it ideal for bandwidth-constrained environments.

## 4. CLI Conversion Performance (Zig)

Full pipeline benchmarks for the compiled Zig CLI tool (`dtxt-convert`), measured with ReleaseFast optimization.

| Operation | Time (avg of 5) | Description |
| :--- | :--- | :--- |
| **JSON → DTXT** | 102.91 ms | Parse JSON + stringify DTXT (pretty) |
| **DTXT → JSON** | 119.36 ms | Parse DTXT + stringify JSON (pretty) |
| **DTXT Format** | 108.60 ms | Parse DTXT + re-stringify DTXT (pretty) |

**Note**: CLI benchmarks include file I/O overhead and full parse+stringify pipeline.

## 5. Conformance Status

All implementations pass the same 87-test conformance suite, ensuring benchmark results are directly comparable.

| Implementation | Result |
| :--- | :--- |
| **Zig** | 87/87 ✅ |
| **TypeScript** | 87/87 ✅ |
| **Python** | 87/87 ✅ |
| **Go** | 87/87 ✅ |
| **Rust** | 87/87 ✅ |
