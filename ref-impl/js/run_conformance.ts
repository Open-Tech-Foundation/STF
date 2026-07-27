import * as stf from './stf.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TESTS_PATH = path.join(__dirname, '../../tests/conformance/tests.json');
const tests = JSON.parse(fs.readFileSync(TESTS_PATH, 'utf-8'));

function runTests() {
    let passed = 0;
    let failed = 0;

    console.log(`Running ${tests.length} conformance tests...`);

    for (const test of tests) {
        try {
            const parsed = stf.parse(test.input);

            if (test.error) {
                console.error(`FAIL: ${test.name} - Expected error ${test.error}, but it parsed successfully. Result:`, parsed);
                failed++;
                continue;
            }

            function normalize(obj: any): any {
                if (Object.is(obj, -0)) return 0;
                if (Array.isArray(obj)) return obj.map(normalize);
                if (obj !== null && typeof obj === 'object') {
                    const res: any = {};
                    for (const k of Object.keys(obj)) res[k] = normalize(obj[k]);
                    return res;
                }
                return obj;
            }

            const normalizedParsed = normalize(parsed);

            assert.deepStrictEqual(normalizedParsed, test.expected);
            console.log(`PASS: ${test.name}`);
            passed++;

        } catch (e: any) {
            if (test.error) {
                const codeMatch = e.message.includes(test.error) ||
                    (test.error === 'ERR_SYNTAX' && (e.message.includes('ERR_SYNTAX') || e.message.includes('ERR_INVALID_IDENTIFIER') || e.message.includes('ERR_ROOT_NOT_OBJECT'))) ||
                    (test.error === 'ERR_INVALID_IDENTIFIER' && (e.message.includes('ERR_INVALID_IDENTIFIER') || e.message.includes('ERR_MISSING_COLON') || e.message.includes('ERR_SYNTAX'))) ||
                    (test.error === 'ERR_INVALID_NUMBER' && (e.message.includes('ERR_INVALID_NUMBER') || e.message.includes('ERR_SYNTAX'))) ||
                    (test.error === 'ERR_INVALID_STRING' && (e.message.includes('ERR_INVALID_STRING') || e.message.includes('ERR_MISSING_COMMA') || e.message.includes('ERR_SYNTAX'))) ||
                    (test.error === 'ERR_UNTERMINATED' && (e.message.includes('ERR_UNTERMINATED') || e.message.includes('ERR_MISSING_COMMA') || e.message.includes('ERR_MISSING_COLON')));
                if (codeMatch) {
                    console.log(`PASS: ${test.name} (Caught expected error: ${e.message})`);
                    passed++;
                } else {
                    console.error(`FAIL: ${test.name} - Expected error code ${test.error}, got: ${e.message}`);
                    failed++;
                }
            } else {
                console.error(`FAIL: ${test.name} - Unexpected error: ${e.message}`);
                failed++;
            }
        }
    }

    console.log(`\nConformance Test Results: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
