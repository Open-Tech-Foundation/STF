#!/usr/bin/env node
/**
 * STF 1.0 conformance runner for the JavaScript reference implementation.
 *
 * Implements the runner contract in README.md §3: error codes are compared exactly, values
 * are compared by kind, Numbers by binary64 bit pattern, Decimals by coefficient *and* scale,
 * and Binary by decoded octets. Nothing is skipped.
 *
 * Usage: node tests/conformance/run_js.mjs [--group <name>] [--verbose]
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = JSON.parse(readFileSync(resolve(HERE, 'corpus.json'), 'utf8'));

const args = process.argv.slice(2);
const VERBOSE = args.includes('--verbose');
const GROUP = args.includes('--group') ? args[args.indexOf('--group') + 1] : null;

const stf = await import(resolve(HERE, '../../ref-impl/js/stf.ts'));

/* ---------------------------------------------------------------- helpers */

/** Corpus tag for a host value's STF kind (spec §3). */
const TAG_OF_KIND = {
  Null: 'null',
  Boolean: 'bool',
  Number: 'num',
  String: 'str',
  Array: 'arr',
  Object: 'obj',
  BigInt: 'bigint',
  Decimal: 'dec',
  Date: 'date',
  Timestamp: 'ts',
  Binary: 'bin',
};

function tagOf(v) {
  return TAG_OF_KIND[stf.kindOf(v)] ?? 'unknown';
}

function bitsOf(n) {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, n);
  return b.getBigUint64(0);
}

function show(v) {
  const kind = stf.kindOf(v);
  if (kind === 'String') return `String ${JSON.stringify(v)}`;
  if (kind === 'Number') return `Number ${Object.is(v, -0) ? '-0' : v}`;
  if (kind === 'BigInt') return `BigInt ${v}`;
  if (kind === 'Binary') return `Binary ${Buffer.from(v).toString('base64')}`;
  if (kind === 'Object' || kind === 'Array') return kind;
  return `${kind} ${v}`;
}

/**
 * Compares a parsed value against the corpus's tagged-JSON encoding.
 *
 * Kind is checked before content in every branch, so a String can never satisfy a
 * dec/date/ts/bin/bigint expectation however closely the text matches.
 */
function compare(actual, expected, path = '$') {
  const at = (msg) => `${path}: ${msg}`;

  if (
    expected !== null &&
    typeof expected === 'object' &&
    !Array.isArray(expected) &&
    Object.prototype.hasOwnProperty.call(expected, '$')
  ) {
    const tag = expected.$;
    const got = tagOf(actual);
    if (got !== tag) return at(`expected kind ${tag}, got ${got} (${show(actual)})`);

    switch (tag) {
      case 'num': {
        // Bit comparison, so -0 never satisfies 0 (README §3.3).
        const want = Number(expected.v);
        return bitsOf(actual) === bitsOf(want)
          ? null
          : at(`expected Number ${expected.v}, got ${show(actual)}`);
      }
      case 'bigint':
        return actual === BigInt(expected.v)
          ? null
          : at(`expected BigInt ${expected.v}, got ${actual}`);
      case 'dec': {
        // Coefficient *and* scale (README §3.4).
        const want = stf.parseDecimal(expected.v);
        return actual.equals(want)
          ? null
          : at(
              `expected Decimal ${want.payload} (scale ${want.scale}), ` +
                `got ${actual.payload} (scale ${actual.scale})`,
            );
      }
      case 'date':
        return actual.equals(stf.parseDate(expected.v))
          ? null
          : at(`expected Date ${expected.v}, got ${actual.payload}`);
      case 'ts':
        return actual.equals(stf.parseTimestamp(expected.v))
          ? null
          : at(`expected Timestamp ${expected.v}, got ${actual.payload}`);
      case 'bin': {
        // Octet comparison after decoding (README §3.5).
        const want = stf.parseBinary(expected.v);
        if (actual.length !== want.length || actual.some((b, i) => b !== want[i])) {
          return at(
            `expected octets ${Buffer.from(want).toString('hex')}, ` +
              `got ${Buffer.from(actual).toString('hex')}`,
          );
        }
        return null;
      }
      default:
        return at(`corpus error: unknown tag ${tag}`);
    }
  }

  if (expected === null) {
    return tagOf(actual) === 'null' ? null : at(`expected Null, got ${show(actual)}`);
  }
  if (typeof expected === 'boolean') {
    return actual === expected ? null : at(`expected Boolean ${expected}, got ${show(actual)}`);
  }
  if (typeof expected === 'number') {
    return at('corpus error: bare JSON numbers are never used (README §2)');
  }
  if (typeof expected === 'string') {
    if (tagOf(actual) !== 'str') return at(`expected String, got ${show(actual)}`);
    return actual === expected
      ? null
      : at(`expected String ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  if (Array.isArray(expected)) {
    if (tagOf(actual) !== 'arr') return at(`expected Array, got ${show(actual)}`);
    if (actual.length !== expected.length) {
      return at(`expected ${expected.length} elements, got ${actual.length}`);
    }
    for (let i = 0; i < expected.length; i++) {
      const r = compare(actual[i], expected[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }

  if (tagOf(actual) !== 'obj') return at(`expected Object, got ${show(actual)}`);
  const wantKeys = Object.keys(expected);
  const gotKeys = Object.keys(actual);
  if (gotKeys.length !== wantKeys.length) {
    return at(`expected keys [${wantKeys}], got [${gotKeys}]`);
  }
  for (const k of wantKeys) {
    if (!Object.prototype.hasOwnProperty.call(actual, k)) return at(`missing key ${JSON.stringify(k)}`);
    const r = compare(actual[k], expected[k], `${path}.${k}`);
    if (r) return r;
  }
  return null;
}

function errCode(e) {
  if (e && typeof e.code === 'string' && e.code.startsWith('ERR_')) return e.code;
  return `NO_CODE(${e?.constructor?.name ?? 'unknown'}: ${e?.message ?? e})`;
}

/* ------------------------------------------------------------------- run */

const stats = { pass: 0, fail: 0 };
const failures = [];
const byGroup = new Map();

for (const c of CORPUS) {
  if (GROUP && c.group !== GROUP) continue;
  const g = byGroup.get(c.group) ?? { pass: 0, fail: 0 };
  byGroup.set(c.group, g);

  const isStream = c.profile === 'stream';
  let result;
  let thrown = null;
  try {
    result = isStream ? stf.parseStream(c.input) : stf.parse(c.input);
  } catch (e) {
    thrown = e;
  }

  const record = (status, reason) => {
    stats[status]++;
    g[status]++;
    if (status !== 'pass') {
      failures.push({ name: c.name, reason });
      console.log(`FAIL  ${c.name}\n        ${reason}`);
    } else if (VERBOSE) {
      console.log(`PASS  ${c.name}`);
    }
  };

  if (c.error !== undefined) {
    if (!thrown) {
      record('fail', `expected ${c.error}, but the input parsed successfully`);
      continue;
    }
    const got = errCode(thrown);
    record(got === c.error ? 'pass' : 'fail', got === c.error ? null : `expected ${c.error}, got ${got}`);
    continue;
  }

  if (thrown) {
    record('fail', `expected a value, got ${errCode(thrown)}: ${thrown.message}`);
    continue;
  }

  let reason = null;
  if (isStream) {
    const records = result.records;
    if (records.length !== c.value.length) {
      reason = `expected ${c.value.length} records, got ${records.length}`;
    } else {
      for (let i = 0; i < c.value.length && !reason; i++) {
        reason = compare(records[i], c.value[i], `record[${i}]`);
      }
    }
  } else {
    reason = compare(result, c.value);
  }
  if (reason) {
    record('fail', reason);
    continue;
  }

  // README §3, the SHOULD: parse(serialize(parse(input))) equals parse(input).
  if (!isStream) {
    let roundTripError = null;
    for (const format of [stf.COMPACT, stf.pretty('  '), stf.CANONICAL]) {
      try {
        const text = stf.serialize(result, format);
        if (!stf.equals(stf.parse(text), result)) {
          roundTripError = `round trip changed the value via ${text}`;
          break;
        }
      } catch (e) {
        roundTripError = `round trip failed (${errCode(e)}): ${e.message}`;
        break;
      }
    }
    if (roundTripError) {
      record('fail', roundTripError);
      continue;
    }
  }

  if (c.canonical !== undefined) {
    const canon = isStream
      ? stf.serializeStream(result, stf.CANONICAL)
      : stf.serialize(result, stf.CANONICAL);
    if (canon !== c.canonical) {
      record('fail', `canonical: expected ${JSON.stringify(c.canonical)}, got ${JSON.stringify(canon)}`);
      continue;
    }
  }

  record('pass');
}

/* ---------------------------------------------------------------- report */

const total = stats.pass + stats.fail;
console.log(`\n${'='.repeat(64)}`);
console.log('STF 1.0 conformance -- JavaScript reference implementation\n');
console.log(`  ${'group'.padEnd(14)}${'pass'.padStart(6)}${'fail'.padStart(6)}`);
for (const g of [...byGroup.keys()].sort()) {
  const s = byGroup.get(g);
  console.log(`  ${g.padEnd(14)}${String(s.pass).padStart(6)}${String(s.fail).padStart(6)}`);
}
console.log(`  ${'-'.repeat(26)}`);
console.log(`  ${'TOTAL'.padEnd(14)}${String(stats.pass).padStart(6)}${String(stats.fail).padStart(6)}`);
console.log(`\n  ${stats.pass}/${total} passing (${((stats.pass / total) * 100).toFixed(1)}%)`);
console.log('='.repeat(64));

process.exit(stats.fail > 0 ? 1 : 0);
