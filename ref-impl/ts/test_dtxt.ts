import * as dtxt from './dtxt';
import * as assert from 'assert';

function testSpecExample() {
    const specExample = `
# DTXT example
{
  name: \`Sample\`,
  created: D(2026-01-15),
  updated: D(2026-01-15T10:30:00Z),
  active: T,
  count: 42,
  big: BN(9007199254740993),
  hash: B(A7B2319E44CE12BA),
  items: [1, 2, 3],
  meta: {
    retries: 3,
    enabled: F,
  },
}
`;
    const parsed = dtxt.parse(specExample);
    console.log("Parsed Example Successfully");

    assert.strictEqual(parsed.name, 'Sample');
    assert.strictEqual(parsed.active, true);
    assert.strictEqual(parsed.count, 42);
    assert.strictEqual(parsed.big, 9007199254740993n);
    assert.deepStrictEqual(parsed.hash, new Uint8Array([0xA7, 0xB2, 0x31, 0x9E, 0x44, 0xCE, 0x12, 0xBA]));
    assert.deepStrictEqual(parsed.items, [1, 2, 3]);
    assert.strictEqual((parsed.meta as any).retries, 3);
    assert.strictEqual((parsed.meta as any).enabled, false);

    // Round trip
    const dumped = dtxt.stringify(parsed);
    console.log("Dumped (Canonical):", dumped);

    const reparsed = dtxt.parse(dumped);
    assert.strictEqual(reparsed.name, parsed.name);
    assert.strictEqual(reparsed.big, parsed.big);
    assert.deepStrictEqual(reparsed.hash, parsed.hash);
    console.log("Round trip successful");
}

function testErrorHandling() {
    try {
        dtxt.parse("{ user.name: 1 }");
        assert.fail("Should have failed on dot in key");
    } catch (e: any) {
        console.log("Caught expected error for dot in key:", e.message);
    }
}

testSpecExample();
testErrorHandling();
console.log("All TypeScript tests passed!");
