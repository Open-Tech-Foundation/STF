# DTXT WebAssembly Module

A high-performance WebAssembly implementation of the DTXT (Data Text Format) parser and serializer, compiled from Rust for use in web browsers and Node.js environments.

## Overview

This module provides native-speed DTXT parsing and serialization for JavaScript environments where the pure TypeScript implementation is too slow. It is particularly useful in:

- **Browser environments** - Where JS DTXT is 8x+ slower than JSON
- **Node.js applications** - Requiring consistent DTXT performance
- **Cross-platform tools** - Single Rust codebase targeting multiple JS runtimes

## Performance

Based on benchmark results (10,000 items):

| Operation | WASM DTXT | JSON.parse | TS DTXT |
|-----------|-----------|-----------|---------|
| Parse | 35ms | 3.4ms | 342ms |
| Stringify | 28ms | 2.9ms | 188ms |

**Key insight:** WASM DTXT is ~10x faster than TypeScript DTXT, making DTXT practical in browsers.

## Features

### Implemented ✅

- **Complete DTXT parsing** - Objects, arrays, strings, numbers, booleans, null
- **Constructor literals** - `Date()`, `BigNumber()`, `Binary()`
- **Proper type mapping**:
  - `Date()` → JavaScript `Date` object
  - `Binary()` → `Uint8Array`
  - `BigNumber()` → String (JS BigInt requires special handling)
- **Serialization** - Full `stringify()` implementation
- **Error handling** - Comprehensive error types with position information
- **Comments support** - `#` single-line comments

### Build Targets

- **Web** (`pkg-web/`) - For browser `<script>` tags
- **Node.js** (`pkg-nodejs/`) - For CommonJS `require()`
- **Bundler** (`pkg/`) - For webpack, Vite, Rollup, etc.

## Installation

### Pre-built Packages

```bash
# Copy the appropriate package directory
cp -r ref-impl/wasm/pkg-nodejs /your-project/dtxt_wasm/
cp -r ref-impl/wasm/pkg-web /your-project/dtxt_wasm/
```

### From Source

```bash
cd ref-impl/wasm
wasm-pack build --target nodejs --out-dir pkg-nodejs
wasm-pack build --target web --out-dir pkg-web
wasm-pack build --target bundler --out-dir pkg
```

**Prerequisites:**
- Rust (stable)
- wasm-pack: `cargo install wasm-pack`
- wasm-opt (optional, for optimization): `npm install -g binaryen`

## Usage

### Node.js (CommonJS)

```javascript
const wasm = require('./pkg-nodejs/dtxt_wasm.js');

// Parse DTXT
const result = wasm.parse('{name: `John`, age: 30, active: T}');
console.log(result);
// { name: 'John', age: 30, active: true }

// Parse with constructors
const data = wasm.parse('{created: Date(2024-01-15T10:30:00Z), id: BigNumber(12345678901234567890)}');
console.log(data.created instanceof Date); // true
console.log(data.id); // "12345678901234567890"

// Stringify
const output = wasm.stringify({
    name: 'Alice',
    active: true,
    created: new Date('2024-01-15')
});
console.log(output);
// {active:T,created:Date(2024-01-15T00:00:00.000Z),name:`Alice`}
```

### Browser (ES Modules)

```html
<script type="module">
    import * as wasm from './pkg-web/dtxt_wasm.js';
    
    const result = wasm.parse('{user: {name: `Bob`, score: 95.5}}');
    console.log(result);
</script>
```

### With Bundlers (webpack/Vite/Rollup)

```javascript
import * as wasm from './pkg/dtxt_wasm.js';

const data = wasm.parse('{items: [1, 2, 3], flag: T}');
```

## API Reference

### `parse(input: string): object | Error`

Parses a DTXT string and returns a JavaScript object.

**Parameters:**
- `input` (string) - Valid DTXT formatted string

**Returns:**
- JavaScript object with proper type mapping
- Throws `JsError` with error message on parse failure

**Example:**
```javascript
const result = wasm.parse('{name: `Test`, value: 42}');
// { name: 'Test', value: 42 }
```

### `stringify(input: object): string | Error`

Converts a JavaScript object to DTXT format.

**Parameters:**
- `input` (object) - JavaScript object/array/value

**Returns:**
- DTXT formatted string
- Throws `JsError` on unsupported types

**Supported Types:**
- Primitives: string, number, boolean, null
- Objects: plain objects (keys must be strings)
- Arrays: any supported type
- Date: JavaScript `Date` objects → `Date(...)`
- Uint8Array: → `Binary(...)`
- BigInt: (experimental, returns as string)

**Example:**
```javascript
const dtxt = wasm.stringify({
    user: 'Alice',
    scores: [95, 87, 92],
    active: true
});
// {active:T,scores:[95,87,92],user:`Alice`}
```

## Type Mapping

| DTXT Syntax | WASM Output | Notes |
|-------------|-------------|-------|
| `` `string` `` | `string` | Backtick strings |
| `123` | `number` | Numeric values |
| `T` | `true` | Boolean true |
| `F` | `false` | Boolean false |
| `N` | `null` | Null value |
| `Date(...)` | `Date` object | JavaScript Date |
| `BigNumber(...)` | `string` | JS BigInt pending |
| `Binary(...)` | `Uint8Array` | Byte array |
| `{...}` | `object` | Plain object |
| `[...]` | `Array` | JavaScript array |

## Error Handling

The module throws errors with descriptive messages:

```javascript
try {
    wasm.parse('{invalid: }');
} catch (e) {
    console.error(e.message);
    // "ERR_SYNTAX at 10" or similar
}
```

**Error Types:**
- `ERR_SYNTAX` - Invalid syntax at position
- `ERR_UNTERMINATED` - Unterminated string or object
- `ERR_ROOT_NOT_OBJECT` - Root must be an object
- `ERR_DUPLICATE_KEY` - Duplicate object key
- `ERR_MISSING_COLON` - Missing `:` after key
- `ERR_MISSING_COMMA` - Missing `,` between items
- `ERR_UNKNOWN_CONSTRUCTOR` - Invalid constructor name
- `ERR_NESTING_DEPTH` - Exceeds 64 levels

## Architecture

```
ref-impl/wasm/
├── src/
│   └── lib.rs          # Rust implementation
├── Cargo.toml          # Rust dependencies
├── pkg/                # Bundler target
├── pkg-nodejs/         # Node.js target
├── pkg-web/            # Web target
└── README.md          # This file
```

**Key Dependencies:**
- `wasm-bindgen` - Rust ↔ JS interop
- `serde` / `serde-wasm-bindgen` - Serialization
- `js-sys` - JavaScript type bindings
- `memchr` - Fast byte scanning
- `ryu` - Fast number formatting

## Building

### Development Build

```bash
cd ref-impl/wasm
cargo build --target wasm32-unknown-unknown
```

### Release Build (Optimized)

```bash
wasm-pack build --target nodejs --out-dir pkg-nodejs --release
wasm-pack build --target web --out-dir pkg-web --release
```

### Optimize with wasm-opt (Optional)

```bash
wasm-opt -Oz -o pkg-web/dtxt_wasm_bg.wasm pkg-web/dtxt_wasm_bg.wasm
```

## Testing

Run the test suite:

```bash
cd ref-impl/wasm
cargo test
```

Run JavaScript integration tests:

```bash
node test_wasm_fixed.cjs
```

## Limitations

1. **BigNumber as String** - JavaScript BigInt requires runtime-specific handling; currently returns as string
2. **Single-threaded** - WASM runs on main thread; consider Web Workers for large payloads
3. **Memory Growth** - WASM linear memory grows as needed; check memory usage for large datasets

## Benchmark Results

See `bench_wasm_comprehensive.cjs` for detailed benchmarks.

**Quick Reference (10,000 items, 100 iterations):**
- Parse: 35ms per operation
- Stringify: 28ms per operation
- Memory: ~1MB per parse operation

## Contributing

1. Modify `src/lib.rs`
2. Build with `wasm-pack build`
3. Test with `node test_wasm_fixed.cjs`
4. Submit pull request

## License

CC0 1.0 Universal (CC0 1.0) Public Domain Dedication

---

Part of the [DTXT Project](https://github.com/Open-Tech-Foundation/DTXT) by the Open Tech Foundation.
