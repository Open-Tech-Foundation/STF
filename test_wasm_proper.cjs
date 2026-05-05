// Proper WASM test
const fs = require('fs');
const path = require('path');

// Read the JS wrapper
const wasmJsPath = path.join(__dirname, 'ref-impl/wasm/pkg/dtxt_wasm.js');
const wasmJs = fs.readFileSync(wasmJsPath, 'utf8');

// Create a module to evaluate the wrapper
const mod = new module();
mod.filename = wasmJsPath;
mod._compile(wasmJs);

// Get exports
const wasmModule = mod.exports;

console.log('WASM module loaded:', typeof wasmModule.parse);

// Test parse
try {
    const result = wasmModule.parse('{test: `hello`}');
    console.log('✅ WASM parse result:', result);
} catch (e) {
    console.error('❌ Error:', e.message);
    console.error('Stack:', e.stack);
}
