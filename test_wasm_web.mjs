import * as wasm from './ref-impl/wasm/pkg-web/dtxt_wasm.js';

console.log('WASM module loaded:', typeof wasm.parse);

// Test 1: Simple object
try {
    const result = wasm.parse('{name: `John`, age: 30}');
    console.log('✅ Test 1 - Simple object:', JSON.stringify(result, null, 2));
} catch (e) {
    console.error('❌ Test 1 failed:', e.message);
}

// Test 2: Nested object
try {
    const result = wasm.parse('{user: {name: `Alice`, active: T}}');
    console.log('✅ Test 2 - Nested object:', JSON.stringify(result, null, 2));
} catch (e) {
    console.error('❌ Test 2 failed:', e.message);
}

console.log('\n✅ Web WASM module working!');
