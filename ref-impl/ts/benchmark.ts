import * as stf from './stf.ts';
import { writeFileSync, statSync } from 'fs';

function generateLargeData(count: number) {
    const data: any = {
        title: "STF vs JSON (JSON-native types only)",
        description: "Benchmark for base format overhead (unquoted keys, short literals)",
        entries: []
    };

    for (let i = 0; i < count; i++) {
        data.entries.push({
            id: i,
            uid: `user-${i}`,
            isActive: i % 2 === 0,
            score: Math.random() * 1000,
            tags: ["data", "benchmark", "storage", "json", "stf"],
            meta: {
                level: i % 10,
                verified: i % 3 === 0,
                note: null,
                nested: {
                    a: 1,
                    b: false,
                    c: "nested string"
                }
            }
        });
    }
    return data;
}

const DATASET_SIZE = 30000;

async function runBenchmark() {
    console.log(`Generating dataset with ${DATASET_SIZE} entries (JSON-native types only)...`);
    const rawData = generateLargeData(DATASET_SIZE);

    // 1. Payload Size Comparison
    const jsonStr = JSON.stringify(rawData);
    const stfStr = stf.stringify(rawData);

    writeFileSync('../../benchmarks/ts/bench_v2.json', jsonStr);
    writeFileSync('../../benchmarks/ts/bench_v2.stf', stfStr);

    const jsonSize = statSync('../../benchmarks/ts/bench_v2.json').size;
    const stfSize = statSync('../../benchmarks/ts/bench_v2.stf').size;

    console.log("\n--- Payload Size ---");
    console.log(`JSON: ${(jsonSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`STF:  ${(stfSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Reduction: ${((1 - stfSize / jsonSize) * 100).toFixed(1)}%`);

    // 2. Performance Comparison (Time)
    const iterations = 5;

    console.log("\n--- Parsing Performance (Average of 5 runs) ---");

    let jsonParseTotal = 0;
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        JSON.parse(jsonStr);
        jsonParseTotal += performance.now() - start;
    }
    console.log(`JSON.parse: ${(jsonParseTotal / iterations).toFixed(2)} ms`);

    let stfParseTotal = 0;
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        stf.parse(stfStr);
        stfParseTotal += performance.now() - start;
    }
    console.log(`stf.parse:  ${(stfParseTotal / iterations).toFixed(2)} ms`);

    console.log("\n--- Serialization Performance (Average of 5 runs) ---");

    let jsonStringifyTotal = 0;
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        JSON.stringify(rawData);
        jsonStringifyTotal += performance.now() - start;
    }
    console.log(`JSON.stringify: ${(jsonStringifyTotal / iterations).toFixed(2)} ms`);

    let stfStringifyTotal = 0;
    for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        stf.stringify(rawData);
        stfStringifyTotal += performance.now() - start;
    }
    console.log(`stf.stringify:  ${(stfStringifyTotal / iterations).toFixed(2)} ms`);

    // 3. Memory
    console.log("\n--- Memory Usage (Current Process) ---");
    const mem = process.memoryUsage();
    console.log(`RSS:  ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
}

runBenchmark().catch(console.error);
