const wasm = require('./ref-impl/wasm/pkg-nodejs/dtxt_wasm.js');

console.log('=== Testing Fixed WASM Implementation ===\n');

// Test 1: Parse with Date constructor
console.log('Test 1: Parse with Date constructor');
try {
    const result = wasm.parse('{created: Date(2024-01-15T10:30:00Z)}');
    console.log('  Result:', JSON.stringify(result));
    console.log('  created type:', typeof result.created);
    console.log('  ✓ Date parsing works\n');
} catch (e) {
    console.log('  ✗ Error:', e.message, '\n');
}

// Test 2: Parse with Binary constructor
console.log('Test 2: Parse with Binary constructor');
try {
    const result = wasm.parse('{data: Binary(DEADBEEF)}');
    console.log('  data constructor:', result.data.constructor.name);
    console.log('  data length:', result.data.length);
    console.log('  data bytes:', Array.from(result.data).map(b => b.toString(16).padStart(2, '0')).join(''));
    console.log('  ✓ Binary parsing works (Uint8Array)\n');
} catch (e) {
    console.log('  ✗ Error:', e.message, '\n');
}

// Test 3: Parse with BigNumber constructor
console.log('Test 3: Parse with BigNumber constructor');
try {
    const result = wasm.parse('{value: BigNumber(12345678901234567890)}');
    console.log('  Result:', JSON.stringify(result));
    console.log('  value:', result.value);
    console.log('  ✓ BigNumber parsing works\n');
} catch (e) {
    console.log('  ✗ Error:', e.message, '\n');
}

// Test 4: Stringify object
console.log('Test 4: Stringify object');
try {
    const input = { name: 'John', age: 30, active: true };
    const result = wasm.stringify(input);
    console.log('  Input:', JSON.stringify(input));
    console.log('  Output:', result);
    console.log('  ✓ Stringify works\n');
} catch (e) {
    console.log('  ✗ Error:', e.message, '\n');
}

// Test 5: Stringify with Date
console.log('Test 5: Stringify with Date object');
try {
    const input = { created: new Date('2024-01-15T10:30:00Z') };
    const result = wasm.stringify(input);
    console.log('  Input:', JSON.stringify(input));
    console.log('  Output:', result);
    console.log('  ✓ Stringify Date works\n');
} catch (e) {
    console.log('  ✗ Error:', e.message, '\n');
}

// Test 6: Stringify with nested object
console.log('Test 6: Stringify with nested object');
try {
    const input = { user: { name: 'Alice', active: true }, items: [1, 2, 3] };
    const result = wasm.stringify(input);
    console.log('  Input:', JSON.stringify(input));
    console.log('  Output:', result);
    console.log('  ✓ Stringify nested works\n');
} catch (e) {
    console.log('  ✗ Error:', e.message, '\n');
}

// Test 7: Round-trip parse -> stringify
console.log('Test 7: Round-trip parse -> stringify');
try {
    const original = '{user: {name: `Alice`, active: T}, score: 95.5}';
    const parsed = wasm.parse(original);
    const stringified = wasm.stringify(parsed);
    console.log('  Original:', original);
    console.log('  Stringified:', stringified);
    console.log('  ✓ Round-trip works\n');
} catch (e) {
    console.log('  ✗ Error:', e.message, '\n');
}

console.log('=== All Tests Complete ===');
