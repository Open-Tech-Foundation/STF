const wasm = require('./ref-impl/wasm/pkg/dtxt_wasm.js');

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

// Test 3: Array
try {
    const result = wasm.parse('{items: [1, 2, 3, `hello`]}');
    console.log('✅ Test 3 - Array:', JSON.stringify(result, null, 2));
} catch (e) {
    console.error('❌ Test 3 failed:', e.message);
}

// Test 4: Constructor (Date)
try {
    const result = wasm.parse('{created: Date(2024-01-15T10:30:00Z)}');
    console.log('✅ Test 4 - Date constructor:', JSON.stringify(result, null, 2));
} catch (e) {
    console.error('❌ Test 4 failed:', e.message);
}

// Test 5: Constructor (BigNumber)
try {
    const result = wasm.parse('{value: BigNumber(12345678901234567890)}');
    console.log('✅ Test 5 - BigNumber constructor:', JSON.stringify(result, null, 2));
} catch (e) {
    console.error('❌ Test 5 failed:', e.message);
}

// Test 6: Constructor (Binary)
try {
    const result = wasm.parse('{data: Binary(DEADBEEF)}');
    console.log('✅ Test 6 - Binary constructor:', JSON.stringify(result, null, 2));
} catch (e) {
    console.error('❌ Test 6 failed:', e.message);
}

// Test 7: Stringify
try {
    const input = { test: 'hello', num: 42 };
    const result = wasm.stringify(input);
    console.log('✅ Test 7 - Stringify:', result);
} catch (e) {
    console.error('❌ Test 7 failed:', e.message);
}

console.log('\n✅ WASM module working!');
