const fs = require('fs');
const path = require('path');

function generateLargeData(count) {
    const data = {
        title: "DTXT vs JSON (Node.js)",
        description: "Benchmark for base format overhead",
        entries: []
    };

    for (let i = 0; i < count; i++) {
        data.entries.push({
            id: i,
            uid: `user-${i}`,
            isActive: i % 2 === 0,
            score: Math.random() * 1000,
            tags: ["data", "benchmark", "storage", "json", "dtxt"],
            meta: {
                level: i % 10,
                verified: i % 3 === 0,
                note: null,
                nested: { a: 1, b: false, c: "nested string" }
            }
        });
    }
    return data;
}

const DATASET_SIZE = 30000;
const ITERATIONS = 5;

console.log(`Generating dataset with ${DATASET_SIZE} entries...`);
const rawData = generateLargeData(DATASET_SIZE);

// Load DTXT module
const dtxt = require('./ref-impl/ts/dtxt.ts');

// Generate strings
const jsonStr = JSON.stringify(rawData);
const dtxtStr = dtxt.stringify(rawData);

// Save files
fs.writeFileSync('benchmarks/ts/bench_v2.json', jsonStr);
fs.writeFileSync('benchmarks/ts/bench_v2.dtxt', dtxtStr);

const jsonSize = fs.statSync('benchmarks/ts/bench_v2.json').size;
const dtxtSize = fs.statSync('benchmarks/ts/bench_v2.dtxt').size;

console.log("\n--- Payload Size ---");
console.log(`JSON: ${(jsonSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`DTXT: ${(dtxtSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`Reduction: ${((1 - dtxtSize/jsonSize) * 100).toFixed(1)}%`);

// Benchmark parsing
console.log(`\n--- Parsing Performance (Average of ${ITERATIONS} runs) ---`);

let jsonParseTotal = 0;
for (let i = 0; i < ITERATIONS; i++) {
    const start = Date.now();
    JSON.parse(jsonStr);
    jsonParseTotal += Date.now() - start;
}
console.log(`JSON.parse: ${(jsonParseTotal / ITERATIONS).toFixed(2)} ms`);

let dtxtParseTotal = 0;
for (let i = 0; i < ITERATIONS; i++) {
    const start = Date.now();
    dtxt.parse(dtxtStr);
    dtxtParseTotal += Date.now() - start;
}
console.log(`dtxt.parse: ${(dtxtParseTotal / ITERATIONS).toFixed(2)} ms`);
console.log(`  (Note: JS is slower because JSON.parse is native C++ bytecode, while DTXT is runtime-interpreted)`);

// Benchmark serialization
console.log(`\n--- Serialization Performance (Average of ${ITERATIONS} runs) ---`);

let jsonStringifyTotal = 0;
for (let i = 0; i < ITERATIONS; i++) {
    const start = Date.now();
    JSON.stringify(rawData);
    jsonStringifyTotal += Date.now() - start;
}
console.log(`JSON.stringify: ${(jsonStringifyTotal / ITERATIONS).toFixed(2)} ms`);

let dtxtStringifyTotal = 0;
for (let i = 0; i < ITERATIONS; i++) {
    const start = Date.now();
    dtxt.stringify(rawData);
    dtxtStringifyTotal += Date.now() - start;
}
console.log(`dtxt.stringify: ${(dtxtStringifyTotal / ITERATIONS).toFixed(2)} ms`);
console.log(`  (Note: JS is slower because JSON.stringify is native C++ bytecode, while DTXT is runtime-interpreted)`);

const usage = process.memoryUsage();
console.log(`\nRSS: ${(usage.rss / 1024 / 1024).toFixed(2)} MB`);
