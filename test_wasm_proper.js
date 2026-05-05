// Proper WASM test using the generated wrapper
const wasm = require('./ref-impl/wasm/pkg/dtxt_wasm.js');

console.log('WASM module loaded:', typeof wasm.parse);

// Test parse
try {
    const result = wasm.parse('{test: `hello`, value: 42}');
    console.log('✅ WASM parse result:', result);
} catch (e) {
    console.error('❌ Parse error:', e.message);
    console.error('Stack:', e.stack);
}
