import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the dtxt module
const dtxtPath = resolve(__dirname, '../../ref-impl/ts/dtxt.ts');
const dtxt = await import(dtxtPath);

// Read test cases
const testsPath = resolve(__dirname, 'tests.json');
const tests = JSON.parse(readFileSync(testsPath, 'utf-8'));

// Convert parsed DTXT values to comparable format (matching tests.json expected format)
function convertToComparable(value) {
    if (value instanceof Date) {
        const iso = value.toISOString();
        // Check if it's just a date (no time component or midnight UTC)
        if (iso.includes('T00:00:00.000Z')) {
            return `$date:${iso.split('T')[0]}`;
        }
        // Remove .000Z suffix if present
        if (iso.endsWith('.000Z')) {
            return `$date:${iso.slice(0, -5)}Z`;
        }
        return `$date:${iso}`;
    }
    if (typeof value === 'bigint') {
        return `$bigint:${value.toString()}`;
    }
    if (value instanceof Uint8Array) {
        return `$binary:${Array.from(value).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
    }
    if (Array.isArray(value)) {
        return value.map(convertToComparable);
    }
    if (value !== null && typeof value === 'object') {
        const result = {};
        for (const [key, val] of Object.entries(value)) {
            result[key] = convertToComparable(val);
        }
        return result;
    }
    return value;
}

// Deep equality check
function deepEqual(actual, expected, path = '') {
    if (typeof actual !== typeof expected) {
        return { pass: false, message: `${path}: type mismatch - expected ${typeof expected}, got ${typeof actual}` };
    }
    if (actual === null && expected === null) return { pass: true };
    if (actual === null || expected === null) {
        return { pass: false, message: `${path}: expected ${expected}, got ${actual}` };
    }
    if (typeof actual !== 'object') {
        if (actual !== expected) {
            return { pass: false, message: `${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}` };
        }
        return { pass: true };
    }
    if (Array.isArray(actual) !== Array.isArray(expected)) {
        return { pass: false, message: `${path}: array/object mismatch` };
    }
    if (Array.isArray(actual)) {
        if (actual.length !== expected.length) {
            return { pass: false, message: `${path}: array length mismatch - expected ${expected.length}, got ${actual.length}` };
        }
        for (let i = 0; i < actual.length; i++) {
            const result = deepEqual(actual[i], expected[i], `${path}[${i}]`);
            if (!result.pass) return result;
        }
        return { pass: true };
    }
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        return { pass: false, message: `${path}: keys mismatch - expected ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}` };
    }
    for (const key of actualKeys) {
        const result = deepEqual(actual[key], expected[key], `${path}.${key}`);
        if (!result.pass) return result;
    }
    return { pass: true };
}

// Error code extraction
function getErrorCode(error) {
    const msg = error.message;
    // Extract error code from message
    const codes = ['ERR_DUPLICATE_KEY', 'ERR_SYNTAX', 'ERR_INVALID_IDENTIFIER', 'ERR_ROOT_NOT_OBJECT',
                   'ERR_INVALID_NUMBER', 'ERR_UNTERMINATED', 'ERR_INVALID_STRING', 'ERR_UNKNOWN_CONSTRUCTOR',
                   'ERR_INVALID_CONSTRUCTOR_PAYLOAD', 'ERR_NESTED_CONSTRUCTOR', 'ERR_TRAILING_CONTENT',
                   'ERR_NESTING_DEPTH'];
    for (const code of codes) {
        if (msg.includes(code)) return code;
    }
    return 'ERR_SYNTAX'; // Default
}

// Run tests
const results = [];
let passed = 0;
let failed = 0;

console.log('Running DTXT Conformance Tests (TypeScript)\n');
console.log('='.repeat(60));

for (const test of tests) {
    const result = { name: test.name, pass: false, error: null, expected: null, actual: null };

    try {
        if (test.expected !== undefined) {
            // Expected test - should parse successfully
            const parsed = dtxt.parse(test.input);
            const converted = convertToComparable(parsed);
            const comparison = deepEqual(converted, test.expected);

            if (comparison.pass) {
                result.pass = true;
                passed++;
                console.log(`  ✓ ${test.name}`);
            } else {
                result.pass = false;
                result.error = comparison.message;
                result.expected = test.expected;
                result.actual = converted;
                failed++;
                console.log(`  ✗ ${test.name}`);
                console.log(`    ${comparison.message}`);
            }
        } else if (test.error !== undefined) {
            // Error test - should throw
            try {
                dtxt.parse(test.input);
                result.pass = false;
                result.error = `Expected error ${test.error} but parsed successfully`;
                failed++;
                console.log(`  ✗ ${test.name}`);
                console.log(`    Expected error ${test.error} but parsed successfully`);
            } catch (e) {
                const errorCode = getErrorCode(e);
                if (errorCode === test.error) {
                    result.pass = true;
                    passed++;
                    console.log(`  ✓ ${test.name}`);
                } else {
                    result.pass = false;
                    result.error = `Expected ${test.error} but got ${errorCode}: ${e.message}`;
                    failed++;
                    console.log(`  ✗ ${test.name}`);
                    console.log(`    Expected ${test.error} but got ${errorCode}: ${e.message}`);
                }
            }
        }
    } catch (e) {
        result.pass = false;
        result.error = `Unexpected error: ${e.message}`;
        failed++;
        console.log(`  ✗ ${test.name}`);
        console.log(`    Unexpected error: ${e.message}`);
    }

    results.push(result);
}

console.log('='.repeat(60));
console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total\n`);

// Write results to JSON
const outputPath = resolve(__dirname, 'results_ts.json');
writeFileSync(outputPath, JSON.stringify({
    implementation: 'typescript',
    timestamp: new Date().toISOString(),
    summary: { passed, failed, total: passed + failed },
    results
}, null, 2));

console.log(`Results written to: ${outputPath}`);
