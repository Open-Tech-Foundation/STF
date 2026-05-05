const wasm = require('./ref-impl/wasm/pkg/dtxt_wasm.js');

// Generate test data
function generateTestData(numItems) {
    let items = [];
    for (let i = 0; i < numItems; i++) {
        items.push(`{name: \`Item ${i}\`, value: ${i}, active: T}`);
    }
    return `{items: [${items.join(',')}]}`;
}

// Benchmark
function benchmark(name, fn, iterations = 1000) {
    const start = Date.now();
    for (let i = 0; i < iterations; i++) {
        fn();
    }
    const end = Date.now();
    console.log(`${name}: ${(end - start)}ms for ${iterations} iterations`);
}

const testData = generateTestData(100);

// Benchmark WASM parse
benchmark('WASM DTXT Parse', () => {
    wasm.parse(testData);
}, 100);

// Benchmark native JSON.parse
const jsonData = JSON.stringify({items: Array.from({length: 100}, (_, i) => ({name: `Item ${i}`, value: i, active: true}))});
benchmark('Native JSON.parse', () => {
    JSON.parse(jsonData);
}, 100);

console.log('\nWASM module performance comparison complete!');
