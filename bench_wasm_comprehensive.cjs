const wasm = require('./ref-impl/wasm/pkg-nodejs/dtxt_wasm.js');
const fs = require('fs');
const path = require('path');

// Load TypeScript DTXT implementation (compile it first or use require)
// For now, let's just benchmark WASM vs JSON

// Generate test data of different sizes
function generateDTXTData(numItems) {
    let items = [];
    for (let i = 0; i < numItems; i++) {
        items.push(`{name: \`Item ${i}\`, value: ${i}, active: T, score: ${Math.random() * 100}}`);
    }
    return `{items: [${items.join(',')}]}`;
}

function generateJSONData(numItems) {
    const items = Array.from({length: numItems}, (_, i) => ({
        name: `Item ${i}`,
        value: i,
        active: true,
        score: Math.random() * 100
    }));
    return JSON.stringify({items: items});
}

// Benchmark utility
function benchmark(name, fn, iterations = 1000) {
    // Warm-up
    for (let i = 0; i < 10; i++) {
        fn();
    }
    
    // Actual benchmark
    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1_000_000; // Convert to milliseconds
    console.log(`${name}: ${duration.toFixed(2)}ms for ${iterations} iterations (${(duration/iterations).toFixed(3)}ms per op)`);
    return duration;
}

console.log('=== DTXT WASM Performance Benchmark ===\n');

// Test with different data sizes
const sizes = [100, 1000, 10000];

for (const size of sizes) {
    console.log(`\n--- Data Size: ${size} items ---`);
    
    const dtxtData = generateDTXTData(size);
    const jsonData = generateJSONData(size);
    
    // WASM DTXT Parse
    benchmark(`WASM DTXT Parse (${size} items)`, () => {
        wasm.parse(dtxtData);
    }, 100);
    
    // Native JSON Parse
    benchmark(`Native JSON.parse (${size} items)`, () => {
        JSON.parse(jsonData);
    }, 100);
    
    // WASM DTXT Stringify
    const parsedWasm = wasm.parse(dtxtData);
    benchmark(`WASM DTXT Stringify (${size} items)`, () => {
        wasm.stringify(parsedWasm);
    }, 100);
    
    // Native JSON Stringify
    const parsedJson = JSON.parse(jsonData);
    benchmark(`Native JSON.stringify (${size} items)`, () => {
        JSON.stringify(parsedJson);
    }, 100);
}

// Test with constructor literals
console.log('\n\n--- Constructor Literals Performance ---');

const dtxtWithConstructors = `{user: {name: \`Alice\`, created: Date(2024-01-15T10:30:00Z), id: BigNumber(12345678901234567890), data: Binary(DEADBEEF), active: T}}`;

benchmark('WASM Parse with constructors', () => {
    wasm.parse(dtxtWithConstructors);
}, 1000);

const parsedWithConstructors = wasm.parse(dtxtWithConstructors);
benchmark('WASM Stringify with constructors', () => {
    wasm.stringify(parsedWithConstructors);
}, 1000);

// Memory usage test
console.log('\n\n--- Memory Test ---');
if (global.gc) {
    const dtxtData = generateDTXTData(10000);
    
    global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    
    const results = [];
    for (let i = 0; i < 100; i++) {
        results.push(wasm.parse(dtxtData));
    }
    
    const memAfter = process.memoryUsage().heapUsed;
    console.log(`Memory used for 100 parses: ${((memAfter - memBefore) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Average per parse: ${((memAfter - memBefore) / 100 / 1024).toFixed(2)} KB`);
} else {
    console.log('Run with --expose-gc for memory tests');
}

console.log('\n=== Benchmark Complete ===');
