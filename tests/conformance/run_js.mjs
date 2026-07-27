#!/usr/bin/env node
/**
 * Strict STF 1.0 conformance runner for the JavaScript reference implementation.
 *
 * Implements the runner contract in README.md §3. Unlike the pre-1.0 runners, this one
 * compares error codes exactly and checks value *kinds*, so a String can never satisfy a
 * Decimal/Date/Timestamp/Binary/BigInt expectation.
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

const NOT_IMPLEMENTED = Symbol('not-implemented');

/** Map a host value to its STF data-model kind (spec §3). */
function classify(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean') return 'bool';
  if (t === 'number') return 'num';
  if (t === 'bigint') return 'bigint';
  if (t === 'string') return 'str';
  if (v instanceof Uint8Array) return 'bin';
  if (Array.isArray(v)) return 'arr';
  if (v instanceof Map) return 'obj';
  if (t === 'object') {
    // Wrapper types are matched by constructor name so the runner works before they exist.
    const n = v.constructor?.name ?? '';
    if (/Decimal$/.test(n)) return 'dec';
    if (/Timestamp$/.test(n)) return 'ts';
    if (/Date$/.test(n)) return 'date';
    if (/Binary|Bytes$/.test(n)) return 'bin';
    return 'obj';
  }
  return 'unknown';
}

/** Exact text of a wrapper value, for scale/offset-sensitive comparison. */
function wrapperText(v) {
  for (const p of ['text', 'value', 'payload', 'source', 'raw']) {
    if (typeof v?.[p] === 'string') return v[p];
  }
  return String(v);
}

function objEntries(v) {
  return v instanceof Map ? [...v.entries()] : Object.entries(v);
}

function bitsOf(n) {
  const b = new DataView(new ArrayBuffer(8));
  b.setFloat64(0, n);
  return b.getBigUint64(0);
}

/** Compare a parsed host value against a corpus expectation. Returns null or a reason. */
function compare(actual, expected, path = '$') {
  const at = (msg) => `${path}: ${msg}`;

  // Tagged expectation
  if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)
      && Object.prototype.hasOwnProperty.call(expected, '$')) {
    const kind = expected.$;
    const got = classify(actual);
    if (got !== kind) {
      return at(`expected kind ${kind}, got ${got} (${JSON.stringify(
        typeof actual === 'bigint' ? String(actual) : actual)})`);
    }
    switch (kind) {
      case 'num': {
        const want = Number(expected.v);
        if (bitsOf(actual) !== bitsOf(want)) {
          return at(`expected number ${expected.v}, got ${Object.is(actual, -0) ? '-0' : actual}`);
        }
        return null;
      }
      case 'bigint':
        return actual === BigInt(expected.v) ? null
          : at(`expected bigint ${expected.v}, got ${actual}`);
      case 'dec': case 'date': case 'ts': {
        const got2 = wrapperText(actual);
        return got2 === expected.v ? null
          : at(`expected ${kind} text "${expected.v}", got "${got2}"`);
      }
      case 'bin': {
        const want = Uint8Array.from(Buffer.from(expected.v, 'base64'));
        const g = actual instanceof Uint8Array ? actual
          : Uint8Array.from(Buffer.from(wrapperText(actual), 'base64'));
        if (g.length !== want.length || g.some((b, i) => b !== want[i])) {
          return at(`expected octets ${Buffer.from(want).toString('hex')}, got ${
            Buffer.from(g).toString('hex')}`);
        }
        return null;
      }
      default:
        return at(`unknown tag ${kind}`);
    }
  }

  if (expected === null) {
    return classify(actual) === 'null' ? null : at(`expected null, got ${classify(actual)}`);
  }
  if (typeof expected === 'boolean') {
    return actual === expected ? null : at(`expected ${expected}, got ${actual}`);
  }
  if (typeof expected === 'string') {
    const got = classify(actual);
    if (got !== 'str') return at(`expected kind str, got ${got}`);
    return actual === expected ? null
      : at(`expected string ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  if (Array.isArray(expected)) {
    if (classify(actual) !== 'arr') return at(`expected array, got ${classify(actual)}`);
    if (actual.length !== expected.length) {
      return at(`expected ${expected.length} elements, got ${actual.length}`);
    }
    for (let i = 0; i < expected.length; i++) {
      const r = compare(actual[i], expected[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  // plain object
  if (classify(actual) !== 'obj') return at(`expected object, got ${classify(actual)}`);
  const got = new Map(objEntries(actual));
  const wantKeys = Object.keys(expected);
  if (got.size !== wantKeys.length) {
    return at(`expected keys [${wantKeys}], got [${[...got.keys()]}]`);
  }
  for (const k of wantKeys) {
    if (!got.has(k)) return at(`missing key ${JSON.stringify(k)}`);
    const r = compare(got.get(k), expected[k], `${path}.${k}`);
    if (r) return r;
  }
  return null;
}

function errCode(e) {
  const m = /ERR_[A-Z0-9_]+/.exec(e?.message ?? String(e));
  return m ? m[0] : `NO_CODE(${e?.constructor?.name ?? 'unknown'}: ${e?.message ?? e})`;
}

/* ------------------------------------------------------------- invocation */

function parseCore(input) {
  return stf.parse(input);
}

function parseStream(input) {
  if (typeof stf.parseStream !== 'function') return NOT_IMPLEMENTED;
  return stf.parseStream(input);
}

function canonicalize(value) {
  if (typeof stf.canonicalize === 'function') return stf.canonicalize(value);
  if (typeof stf.stringify === 'function') {
    try { return stf.stringify(value, { canonical: true }); } catch { /* fall through */ }
  }
  return NOT_IMPLEMENTED;
}

/* ------------------------------------------------------------------- run */

const stats = { pass: 0, fail: 0, unimplemented: 0 };
const failures = [];
const byGroup = new Map();

for (const c of CORPUS) {
  if (GROUP && c.group !== GROUP) continue;
  const g = byGroup.get(c.group) ?? { pass: 0, fail: 0, unimplemented: 0 };
  byGroup.set(c.group, g);

  const isStream = c.profile === 'stream';
  let result, thrown = null;
  try {
    result = isStream ? parseStream(c.input) : parseCore(c.input);
  } catch (e) {
    thrown = e;
  }

  const record = (status, reason) => {
    stats[status]++; g[status]++;
    if (status !== 'pass') failures.push({ name: c.name, group: c.group, status, reason });
    if (VERBOSE || status === 'fail') {
      const tag = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'UNIMPL';
      if (status !== 'pass' || VERBOSE) console.log(`${tag}  ${c.name}${reason ? ` -- ${reason}` : ''}`);
    }
  };

  if (result === NOT_IMPLEMENTED) {
    record('unimplemented', isStream ? 'parseStream() not exported' : 'not implemented');
    continue;
  }

  if (c.error !== undefined) {
    if (!thrown) { record('fail', `expected ${c.error}, but parsed successfully`); continue; }
    const got = errCode(thrown);
    if (got !== c.error) { record('fail', `expected ${c.error}, got ${got}`); continue; }
    record('pass');
    continue;
  }

  if (thrown) { record('fail', `unexpected ${errCode(thrown)}`); continue; }

  const expected = isStream ? c.value : c.value;
  let reason = null;
  if (isStream) {
    if (!Array.isArray(result)) reason = 'stream result is not an array of records';
    else if (result.length !== expected.length) {
      reason = `expected ${expected.length} records, got ${result.length}`;
    } else {
      for (let i = 0; i < expected.length && !reason; i++) {
        reason = compare(result[i], expected[i], `record[${i}]`);
      }
    }
  } else {
    reason = compare(result, expected);
  }
  if (reason) { record('fail', reason); continue; }

  if (c.canonical !== undefined) {
    const canon = canonicalize(result);
    if (canon === NOT_IMPLEMENTED) {
      record('unimplemented', 'canonicalize() not implemented');
      continue;
    }
    if (canon !== c.canonical) {
      record('fail', `canonical: expected ${JSON.stringify(c.canonical)}, got ${JSON.stringify(canon)}`);
      continue;
    }
  }

  record('pass');
}

/* ---------------------------------------------------------------- report */

const total = stats.pass + stats.fail + stats.unimplemented;
console.log(`\n${'='.repeat(64)}`);
console.log('STF 1.0 conformance -- JavaScript reference implementation\n');
console.log(`  ${'group'.padEnd(14)}${'pass'.padStart(6)}${'fail'.padStart(6)}${'unimpl'.padStart(8)}`);
for (const g of [...byGroup.keys()].sort()) {
  const s = byGroup.get(g);
  console.log(`  ${g.padEnd(14)}${String(s.pass).padStart(6)}${String(s.fail).padStart(6)}${String(s.unimplemented).padStart(8)}`);
}
console.log(`  ${'-'.repeat(34)}`);
console.log(`  ${'TOTAL'.padEnd(14)}${String(stats.pass).padStart(6)}${String(stats.fail).padStart(6)}${String(stats.unimplemented).padStart(8)}`);
console.log(`\n  ${stats.pass}/${total} passing (${((stats.pass / total) * 100).toFixed(1)}%)`);
console.log('='.repeat(64));

process.exit(stats.fail + stats.unimplemented > 0 ? 1 : 0);
