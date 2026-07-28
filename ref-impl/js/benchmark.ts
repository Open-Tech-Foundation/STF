/**
 * Payload-size and throughput benchmark for the JavaScript implementation.
 *
 * The dataset uses only JSON-native kinds, so the figures measure base format overhead rather
 * than the constructor types, and it is generated from a **fixed seed** so runs are comparable
 * to each other. Figures from different languages are not comparable — each implementation
 * benchmarks its own dataset, against its own host's JSON parser.
 *
 * Run with: node ref-impl/js/benchmark.ts
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { COMPACT, fromJSON, parse, serialize, toJSON, type STFValue } from "./stf.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../benchmarks/js");
const DATASET_SIZE = 30_000;
const ITERATIONS = 5;
const SEED = 0x57455354;

/** Mulberry32. Deterministic and dependency-free, so the dataset is identical every run. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(count: number) {
  const random = makeRng(SEED);
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      id: i,
      uid: `user-${i}`,
      isActive: i % 2 === 0,
      score: random() * 1000,
      tags: ["data", "benchmark", "storage", "json", "stf"],
      meta: {
        level: i % 10,
        verified: i % 3 === 0,
        note: null,
        nested: { a: 1, b: false, c: "nested string" },
      },
    });
  }
  return {
    title: "STF vs JSON (JSON-native types only)",
    description: "Benchmark for base format overhead (unquoted keys, short literals)",
    entries,
  };
}

function averageMs(iterations: number, body: () => void): number {
  let total = 0;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    body();
    total += performance.now() - start;
  }
  return total / iterations;
}

console.log(`Generating dataset with ${DATASET_SIZE} entries (seed ${SEED})...`);
const raw = generate(DATASET_SIZE);
const value: STFValue = fromJSON(raw as never);

const jsonText = JSON.stringify(toJSON(value));
const stfText = serialize(value, COMPACT);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "bench_v2.json"), jsonText);
writeFileSync(resolve(OUT_DIR, "bench_v2.stf"), stfText);

const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
console.log("\n--- Payload Size ---");
console.log(`JSON: ${mb(statSync(resolve(OUT_DIR, "bench_v2.json")).size)} MB`);
console.log(`STF:  ${mb(statSync(resolve(OUT_DIR, "bench_v2.stf")).size)} MB`);
console.log(`STF is ${((1 - stfText.length / jsonText.length) * 100).toFixed(1)}% smaller`);

console.log(`\n--- Parsing (average of ${ITERATIONS} runs) ---`);
console.log(`JSON.parse: ${averageMs(ITERATIONS, () => JSON.parse(jsonText)).toFixed(2)} ms`);
console.log(`stf.parse:  ${averageMs(ITERATIONS, () => parse(stfText)).toFixed(2)} ms`);

console.log(`\n--- Serialization (average of ${ITERATIONS} runs) ---`);
const jsonValue = toJSON(value);
console.log(
  `JSON.stringify: ${averageMs(ITERATIONS, () => JSON.stringify(jsonValue)).toFixed(2)} ms`,
);
console.log(
  `stf.serialize:  ${averageMs(ITERATIONS, () => serialize(value, COMPACT)).toFixed(2)} ms`,
);

const mem = process.memoryUsage();
console.log("\n--- Memory Usage (Current Process) ---");
console.log(`RSS:  ${mb(mem.rss)} MB`);
console.log(`Heap: ${mb(mem.heapUsed)} MB`);
