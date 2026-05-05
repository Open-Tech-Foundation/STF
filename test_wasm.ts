import * as wasm from './ref-impl/wasm/pkg/dtxt_wasm.js';

// WASM module loaded via TypeScript wrapper
const { parse, stringify } = wasm;

// Test parse
const input = '{name: `Test`, value: 42}';
try {
    const result = parse(input);
    console.log('✅ WASM parse result:', result);
    console.log('✅ WASM module works!');
} catch (e) {
    console.error('❌ Error:', e.message);
}
