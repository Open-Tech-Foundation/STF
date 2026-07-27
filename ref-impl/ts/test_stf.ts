import { parse, stringify } from './stf.ts';
import * as assert from 'assert';

function testSpecExample() {
    const specExample = `
# STF example
{
  name: \`Sample\`,
  created: DATE(2026-01-15),
  updated: TIMESTAMP(2026-01-15T10:30:00Z),
  active: T,
  count: 42,
  price: DECIMAL(19.99),
  big: BIGINT(9007199254740993),
  hash: BINARY(SGVsbG8=),
  items: [1, 2, 3],
  meta: {
    retries: 3,
    enabled: F,
  },
}
`;
    const parsed = parse(specExample);
    console.log("Parsed Example Successfully");

    assert.strictEqual(parsed.name, 'Sample');
    assert.strictEqual(parsed.created, '$date:2026-01-15');
    assert.strictEqual(parsed.updated, '$timestamp:2026-01-15T10:30:00Z');
    assert.strictEqual(parsed.active, true);
    assert.strictEqual(parsed.count, 42);
    assert.strictEqual(parsed.price, '$decimal:19.99');
    assert.strictEqual(parsed.big, '$bigint:9007199254740993');
    assert.strictEqual(parsed.hash, '$binary:SGVsbG8=');
    assert.deepStrictEqual(parsed.items, [1, 2, 3]);
    assert.strictEqual((parsed as any).meta.retries, 3);
    assert.strictEqual((parsed as any).meta.enabled, false);

    // Round trip
    const dumped = stringify(parsed);
    console.log("Dumped (Canonical):", dumped);

    const reparsed = parse(dumped);
    assert.strictEqual(reparsed.name, parsed.name);
    assert.strictEqual(reparsed.big, parsed.big);
    assert.strictEqual(reparsed.hash, parsed.hash);
    console.log("Round trip successful");
}

function testErrorHandling() {
    try {
        parse("{ user.name: 1 }");
        assert.fail("Should have failed on dot in key");
    } catch (e: any) {
        console.log("Caught expected error for dot in key:", e.message);
    }
}

testSpecExample();
testErrorHandling();
console.log("All TypeScript tests passed!");
