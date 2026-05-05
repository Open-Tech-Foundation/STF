const wasm = require('@assemblyscript/loader');

// Load WASM module
const fs = require('fs');
const path = require('path');

const wasmPath = path.join(__dirname, 'ref-impl/wasm/pkg/dtxt_wasm_bg.wasm');
const wasmBuffer = fs.readFileSync(wasmPath);

// Get imports from the JS wrapper
const wrapperPath = path.join(__dirname, 'ref-impl/wasm/pkg/dtxt_wasm.js');
const wrapper = fs.readFileSync(wrapperPath, 'utf8');

// Extract import functions
const importRegex = /const import(\d+) = \{([^}]+)\};/g;
let match;
const imports = {};

while ((match = importRegex.exec(wrapper)) !== null) {
    const importBody = match[2];
    // Simple eval of the import object (this is unsafe but works for simple cases)
    try {
        imports[`import${match[1]}`] = eval(`(${importBody})`);
    } catch (e) {
        console.log('Could not parse import:', e.message);
    }
}

// Instantiate WASM
WebAssembly.instantiate(wasmBuffer, imports).then(instance => {
    const { parse, stringify } = instance.exports;
    
    // Test
    try {
        const result = parse('{test: `hello`}');
        console.log('✅ WASM parse result:', result);
    } catch (e) {
        console.error('❌ Parse error:', e.message);
    }
}).catch(err => {
    console.error('❌ WASM instantiation error:', err.message);
});
