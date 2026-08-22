/**
 * Unit tests for the JavaScript reference implementation.
 *
 * The conformance corpus (`tests/conformance/run_js.mjs`) is the executable contract for the
 * specification; these cover the host-language surface it cannot reach — the shape of the
 * value model, JSON interchange, and the ordering guarantee.
 *
 * Run with: node --test ref-impl/js/
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CANONICAL,
  COMPACT,
  equals,
  format,
  formatNumber,
  fromJSON,
  fromJSONText,
  keysOf,
  kindOf,
  parse,
  parseBytes,
  parseDocument,
  parseStream,
  pretty,
  readStream,
  serialize,
  serializeStream,
  STFDecimal,
  STFError,
  toJSON,
  toTaggedJSON,
  type STFValue,
} from "./stf.ts";

function code(input: string): string {
  try {
    parse(input);
  } catch (e) {
    return (e as STFError).code;
  }
  return "NO_ERROR";
}

describe("data model (spec §3)", () => {
  it("gives every constructor its own kind, never a string", () => {
    const v = parse(
      "{dec: DECIMAL(1.5), big: BIGINT(1), d: DATE(2026-01-15), " +
        "t: TIMESTAMP(2026-01-15T00:00:00Z), bin: BINARY(SGVsbG8=)}",
    );
    assert.equal(kindOf(v.dec), "Decimal");
    assert.equal(kindOf(v.big), "BigInt");
    assert.equal(kindOf(v.d), "Date");
    assert.equal(kindOf(v.t), "Timestamp");
    assert.equal(kindOf(v.bin), "Binary");
    // §3.1: the defect this rewrite exists to remove.
    assert.equal(typeof v.dec, "object");
    assert.notEqual(typeof v.dec, "string");
  });

  it("never compares a string equal to a typed value", () => {
    const a = parse("{x: DECIMAL(1.5)}");
    const b = parse("{x: `1.5`}");
    assert.ok(!equals(a, b));
  });

  it("keeps Number, BigInt, and Decimal distinct at the same magnitude", () => {
    const v = parse("{n: 1, b: BIGINT(1), d: DECIMAL(1)}");
    assert.ok(!equals(v.n, v.b));
    assert.ok(!equals(v.b, v.d));
    assert.ok(!equals(v.n, v.d));
  });

  it("makes Decimal equality scale-sensitive", () => {
    assert.ok(!equals(parse("{x: DECIMAL(1.5)}").x, parse("{x: DECIMAL(1.50)}").x));
    assert.ok(equals(parse("{x: DECIMAL(1.50)}").x, parse("{x: DECIMAL(1.50)}").x));
  });

  it("keeps -0 distinct from 0", () => {
    assert.ok(!equals(parse("{x: -0}").x, parse("{x: 0}").x));
    assert.ok(Object.is(parse("{x: -0}").x, -0));
  });

  it("keeps Z distinct from +00:00", () => {
    const z = parse("{t: TIMESTAMP(2026-01-15T10:30:00Z)}").t;
    const plus = parse("{t: TIMESTAMP(2026-01-15T10:30:00+00:00)}").t;
    assert.ok(!equals(z, plus));
  });

  it("ignores member order in equality", () => {
    assert.ok(equals(parse("{a: 1, b: 2}"), parse("{b: 2, a: 1}")));
  });
});

describe("member order (spec §11.2)", () => {
  it("preserves authored order through a round trip", () => {
    const text = "{z: 1, a: 2, m: 3}";
    assert.equal(serialize(parse(text), COMPACT), "{z:1,a:2,m:3}");
  });

  it("preserves order even for keys JavaScript would reorder", () => {
    // Plain objects hoist array-index-like keys, so `123` would otherwise come first.
    const v = parse("{b: 1, 123: 2, a: 3}");
    assert.deepEqual(keysOf(v), ["b", "123", "a"]);
    assert.equal(serialize(v, COMPACT), "{b:1,123:2,a:3}");
  });

  it("falls back to host order when a caller mutates the object", () => {
    const v = parse("{a: 1}");
    v.b = 2;
    assert.deepEqual(keysOf(v), ["a", "b"]);
  });
});

describe("numbers (spec §7)", () => {
  it("is binary64 and does not widen", () => {
    assert.equal(parse("{a: 9007199254740993}").a, 9007199254740992);
    assert.equal(typeof parse("{a: 9007199254740993}").a, "number");
  });

  it("rejects overflow rather than producing an infinity", () => {
    assert.equal(code("{a: 1e400}"), "ERR_NUMBER_OVERFLOW");
    assert.equal(parse("{a: 1e-400}").a, 0);
  });

  it("emits the shortest round-tripping form", () => {
    assert.equal(formatNumber(1), "1");
    assert.equal(formatNumber(-0), "-0");
    assert.equal(formatNumber(0), "0");
    assert.equal(formatNumber(3.14), "3.14");
    for (const n of [1, -0, 1e300, 3.14, 9007199254740992, 1e-320, 2.5e-3]) {
      assert.ok(Object.is(parse(`{a:${formatNumber(n)}}`).a, n), `${n}`);
    }
  });
});

describe("serialization (spec §13)", () => {
  it("never promotes a string to a constructor", () => {
    // §13.2. The old implementation emitted DECIMAL(abc) here and produced unparseable output.
    const v = parse("{a: `DECIMAL(1.5)`, b: `2026-01-15`, c: `$decimal:abc`}");
    const text = serialize(v, COMPACT);
    assert.equal(text, "{a:`DECIMAL(1.5)`,b:`2026-01-15`,c:`$decimal:abc`}");
    assert.ok(equals(parse(text), v));
  });

  it("round-trips every kind through every format", () => {
    const input =
      "{n:N,b:T,num:-2.5e-3,s:`hi`,arr:[1,`x`],obj:{k:1}," +
      "big:BIGINT(-99999999999999999999),dec:DECIMAL(1.50)," +
      "d:DATE(2024-02-29),t:TIMESTAMP(2026-01-15T10:30:00.100+05:30)," +
      "bin:BINARY(SGVsbG9X)}";
    const v = parse(input);
    for (const f of [COMPACT, pretty("  "), CANONICAL]) {
      assert.ok(equals(parse(serialize(v, f)), v));
    }
  });

  it("fails rather than emit an invalid key", () => {
    assert.throws(
      () => serialize({ "a.b": 1 } as unknown as STFValue),
      (e: STFError) => e.code === "ERR_UNREPRESENTABLE",
    );
  });

  it("fails on a non-finite number", () => {
    assert.throws(
      () => serialize({ a: Infinity } as unknown as STFValue),
      (e: STFError) => e.code === "ERR_UNREPRESENTABLE",
    );
  });

  it("uses the interpreted form when a backtick is present", () => {
    const v = parse('{a: "x`y"}');
    assert.equal(serialize(v, COMPACT), '{a:"x`y"}');
  });

  it("formats idempotently", () => {
    const once = format("{ b:2,a:`x`, }");
    assert.equal(format(once), once);
  });
});

describe("canonical form (spec §14)", () => {
  const canon = (t: string) => serialize(parse(t), CANONICAL);

  it("sorts by key bytes, not case-insensitively", () => {
    assert.equal(canon("{b: 2, a: 1, c: 3}"), "{a:1,b:2,c:3}");
    assert.equal(canon("{a: 1, B: 2}"), "{B:2,a:1}");
  });

  it("drops comments and trailing commas, and interprets strings", () => {
    assert.equal(canon("# lead\n{a: 1} # trail"), "{a:1}");
    assert.equal(canon("{a: 1,}"), "{a:1}");
    assert.equal(canon("{a: `hi`}"), '{a:"hi"}');
  });

  it("preserves decimal scale and does not reorder arrays", () => {
    assert.equal(canon("{a: DECIMAL(1.50)}"), "{a:DECIMAL(1.50)}");
    assert.equal(canon("{b: {d: 1, c: 2}, a: [3, 1]}"), "{a:[3,1],b:{c:2,d:1}}");
  });
});

describe("directives (spec §5.1)", () => {
  it("keeps directives out of the data model", () => {
    const doc = parseDocument("@schema(x)\n{a: 1}");
    assert.deepEqual(doc.directives, [{ name: "schema", payload: "x" }]);
    assert.deepEqual(Object.keys(doc.root), ["a"]);
  });

  it("accepts an unknown directive but rejects a repeat", () => {
    assert.doesNotThrow(() => parse("@nope(1)\n{a: 1}"));
    assert.equal(code("@schema(a)\n@schema(b)\n{a: 1}"), "ERR_SYNTAX");
  });
});

describe("encoding (spec §2)", () => {
  it("rejects malformed UTF-8 without substituting U+FFFD", () => {
    assert.throws(
      () => parseBytes(new Uint8Array([0x7b, 0x61, 0x3a, 0xff, 0x7d])),
      (e: STFError) => e.code === "ERR_INVALID_UTF8",
    );
  });

  it("accepts well-formed bytes", () => {
    const bytes = new TextEncoder().encode("{a: 1}");
    assert.ok(equals(parseBytes(bytes), parse("{a: 1}")));
  });
});

describe("errors", () => {
  it("exposes the normative code as a property, not just in the message", () => {
    try {
      parse("{a: 0x10}");
      assert.fail("expected a rejection");
    } catch (e) {
      assert.ok(e instanceof STFError);
      assert.equal(e.code, "ERR_INVALID_NUMBER");
    }
  });

  it("reports a 1-based line and column", () => {
    try {
      parse("{\n  a: 0x10\n}");
      assert.fail("expected a rejection");
    } catch (e) {
      assert.equal((e as STFError).line, 2);
      assert.equal((e as STFError).column, 7);
    }
  });

  it("counts columns in code points, not UTF-16 units", () => {
    try {
      parse("{a: `\u{1F600}`, b: 0x1}");
      assert.fail("expected a rejection");
    } catch (e) {
      // The emoji counts as one column, so the offending `x` is the 14th code point.
      assert.equal((e as STFError).column, 14);
    }
  });
});

describe("stream profile", () => {
  it("reads records in order and reports the header", () => {
    const s = parseStream("@schema(e.stf)\n{a:1}\n{a:2}\n");
    assert.equal(s.records.length, 2);
    assert.deepEqual(s.directives, [{ name: "schema", payload: "e.stf" }]);
  });

  it("continues past a bad record and numbers lines from 1", () => {
    const items = [...readStream("# note\n{a:1}\n{oops\n{b:2}\n")];
    assert.equal(items.length, 3);
    assert.equal(items[0].line, 2);
    assert.equal(items[1].line, 3);
    assert.equal(items[1].error?.code, "ERR_MISSING_COLON");
    assert.equal(items[2].line, 4);
    assert.equal(items[2].error, null);
  });

  it("escapes line terminators automatically when writing", () => {
    // Stream §3.2 requires this rather than a failure.
    const stream = { directives: [], records: [parse("{msg: `one\ntwo`}")] };
    const text = serializeStream(stream, COMPACT);
    assert.equal(text, '{msg:"one\\ntwo"}\n');
    assert.equal(parseStream(text).records.length, 1);
  });

  it("preserves record order while sorting within records", () => {
    const s = parseStream("{b:1,a:2}\n{d:1,c:2}\n");
    assert.equal(serializeStream(s, CANONICAL), "{a:2,b:1}\n{c:2,d:1}\n");
  });
});

describe("JSON interchange", () => {
  it("converts ordinary JSON and preserves order", () => {
    const v = fromJSON({ z: 1, a: [true, null, "x"], m: { d: 1.5 } });
    assert.equal(serialize(v, COMPACT), "{z:1,a:[T,N,`x`],m:{d:1.5}}");
  });

  it("refuses JSON that STF cannot express", () => {
    for (const bad of [[] as never, 42 as never, "x" as never]) {
      assert.throws(() => fromJSON(bad), (e: STFError) => e.code === "ERR_UNREPRESENTABLE");
    }
    assert.throws(
      () => fromJSON({ "a.b": 1 }),
      (e: STFError) => e.code === "ERR_UNREPRESENTABLE",
    );
    assert.throws(() => fromJSON({ "": 1 }), (e: STFError) => e.code === "ERR_UNREPRESENTABLE");
  });

  it("refuses an integer JSON.parse would silently round", () => {
    assert.throws(
      () => fromJSONText('{"id":9007199254740993}'),
      (e: STFError) => e.code === "ERR_UNREPRESENTABLE" && e.message.includes("BIGINT"),
    );
    // A digit run inside a string is not a number.
    assert.doesNotThrow(() => fromJSONText('{"id":"9007199254740993"}'));
    assert.doesNotThrow(() => fromJSONText('{"id":9007199254740992}'));
  });

  it("refuses typed values on the way to JSON unless asked", () => {
    const v = parse("{price: DECIMAL(19.99)}");
    assert.throws(() => toJSON(v), (e: STFError) => e.code === "ERR_UNREPRESENTABLE");
    assert.deepEqual(toJSON(v, "payload-as-string"), { price: "19.99" });
  });

  it("tags every kind distinctly", () => {
    const v = parse("{s: `1.5`, d: DECIMAL(1.50), z: -0}");
    assert.deepEqual(toTaggedJSON(v), {
      s: "1.5",
      d: { $: "dec", v: "1.50" },
      z: { $: "num", v: "-0" },
    });
  });
});

describe("Geometry (new.txt §2-6)", () => {
  it("parses Point", () => {
    const v = parse('{p: Geometry("Point", [80.2707,13.0827])}');
    assert.equal(kindOf(v.p), "Geometry");
    assert.equal(v.p.type, "Point");
    assert.deepEqual(v.p.coordinates, [80.2707, 13.0827]);
    assert.equal(serialize(v, COMPACT), '{p:Geometry("Point", [80.2707,13.0827])}');
  });
  it("parses LineString", () => {
    const v = parse('{l: Geometry("LineString", [[80.27,13.08],[80.28,13.09],[80.29,13.10]])}');
    assert.equal(v.l.type, "LineString");
    assert.equal(v.l.coordinates.length, 3);
  });
  it("parses Polygon", () => {
    const v = parse('{poly: Geometry("Polygon", [[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]]])}');
    assert.equal(v.poly.type, "Polygon");
  });
  it("parses Polygon with hole", () => {
    const v = parse('{poly: Geometry("Polygon", [[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]], [[80.273,13.083],[80.275,13.083],[80.275,13.085],[80.273,13.083]]])}');
    assert.equal(v.poly.coordinates.length, 2);
  });
  it("parses MultiPoint", () => {
    assert.equal(parse('{p: Geometry("MultiPoint", [[80.27,13.08],[80.28,13.09]])}').p.type, "MultiPoint");
  });
  it("parses MultiLineString", () => {
    assert.equal(parse('{m: Geometry("MultiLineString", [[[80.27,13.08],[80.28,13.09]], [[80.29,13.09],[80.30,13.10]]])}').m.type, "MultiLineString");
  });
  it("parses MultiPolygon", () => {
    const v = parse('{m: Geometry("MultiPolygon", [[[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]]], [[[80.30,13.10],[80.31,13.10],[80.31,13.11],[80.30,13.10]]]])}');
    assert.equal(v.m.type, "MultiPolygon");
  });
  it("accepts GEOMETRY upper alias", () => {
    assert.equal(parse('{p: GEOMETRY("Point", [1,2])}').p.type, "Point");
    assert.equal(parse('{p: Geometry("Point", [1,2])}').p.type, "Point");
  });
  it("rejects invalid geometry", () => {
    assert.equal(code('{p: Geometry("Point", [80])}'), "ERR_INVALID_CONSTRUCTOR_PAYLOAD");
    assert.equal(code('{p: Geometry("Unknown", [1,2])}'), "ERR_INVALID_CONSTRUCTOR_PAYLOAD");
    assert.equal(code('{p: Geometry("Point", ["a","b"])}'), "ERR_INVALID_CONSTRUCTOR_PAYLOAD");
    assert.equal(code('{p: Geometry("LineString", [[80,13]])}'), "ERR_INVALID_CONSTRUCTOR_PAYLOAD"); // insufficient
    assert.equal(code('{p: Geometry("Polygon", [[[80,13],[81,13],[81,14]]])}'), "ERR_INVALID_CONSTRUCTOR_PAYLOAD"); // unclosed+ <4?
    assert.equal(code('{p: Geometry("Polygon", [[[0,0],[1,0],[1,1],[0,1]]])}'), "ERR_INVALID_CONSTRUCTOR_PAYLOAD"); // open ring
    assert.equal(code('{p: Geometry("MultiPoint", [])}'), "ERR_INVALID_CONSTRUCTOR_PAYLOAD");
  });
  it("round-trips geometry through serialize/parse and equals", () => {
    for (const txt of [
      '{p: Geometry("Point", [1,2])}',
      '{p: Geometry("LineString", [[0,0],[1,1]])}',
      '{p: Geometry("Polygon", [[[0,0],[1,0],[1,1],[0,0]]])}',
      '{p: Geometry("MultiPolygon", [[[[0,0],[1,0],[1,1],[0,0]]]])}',
    ]) {
      const v = parse(txt);
      assert.ok(equals(parse(serialize(v, COMPACT)), v));
    }
  });
});

describe("Time (new.txt §16-17)", () => {
  it("parses valid times", () => {
    for (const txt of ['Time("00:00")','Time("09:30")','Time("23:59:59")','Time("09:30:00.123")','Time("09:30:00.123456789")']) {
      const v = parse(`{t: ${txt}}`);
      assert.equal(kindOf(v.t), "Time");
      assert.ok(equals(parse(serialize(v, COMPACT)), v));
    }
    assert.equal(parse('{t: TIME("09:30")}').t.payload, "09:30");
  });
  it("rejects invalid times", () => {
    for (const bad of ['Time("24:00")','Time("12:60")','Time("09:60:00")','Time("abc")','Time("09:30:60")','Time("")']) {
      assert.equal(code(`{t: ${bad}}`), "ERR_INVALID_CONSTRUCTOR_PAYLOAD", bad);
    }
  });
});

describe("Duration (new.txt §18-19)", () => {
  it("parses valid durations", () => {
    for (const txt of ['Duration("PT30S")','Duration("PT45M")','Duration("PT2H30M")','Duration("P1D")','Duration("P1Y")','Duration("P1Y2M3DT4H5M6S")','DURATION("PT2H")']) {
      const v = parse(`{d: ${txt}}`);
      assert.equal(kindOf(v.d), "Duration");
      assert.ok(equals(parse(serialize(v, COMPACT)), v));
    }
  });
  it("rejects invalid durations", () => {
    for (const bad of ['Duration("invalid")','Duration("P")','Duration("PT")','Duration("")','Duration("P1DT")']) {
      assert.equal(code(`{d: ${bad}}`), "ERR_INVALID_CONSTRUCTOR_PAYLOAD", bad);
    }
  });
});

describe("Geometry JSON (new.txt §7-9)", () => {
  it("toJSON emits GeoJSON", () => {
    const v = parse('{g: Geometry("Point", [80.27,13.08])}');
    const j = toJSON(v.g) as { type: string; coordinates: number[] };
    assert.equal(j.type, "Point");
    assert.deepEqual(j.coordinates, [80.27, 13.08]);
    assert.deepEqual(toJSON(parse('{g: Geometry("Polygon", [[[0,0],[1,0],[1,1],[0,0]]])}').g) as any, { type: "Polygon", coordinates: [[[0,0],[1,0],[1,1],[0,0]]] });
  });
  it("toGeo / toGeoJSON emits GeoJSON for Geometry", async () => {
    const { toGeo, toGeoJSON } = await import("./json.ts");
    const g = parse('{g: Geometry("Point", [80.27,13.08])}').g;
    assert.deepEqual(toGeo(g as any), { type: "Point", coordinates: [80.27, 13.08] });
    assert.deepEqual(toGeoJSON(g as any), { type: "Point", coordinates: [80.27, 13.08] });
    assert.deepEqual(toGeo(g as any), toJSON(g));
  });
  it("fromJSON does not infer Geometry — plain object stays Object", () => {
    const gj = { type: "Point", coordinates: [1,2] };
    const v = fromJSON({ x: gj as never });
    assert.equal(kindOf(v.x), "Object");
  });
  it("Array[Geometry] vs MultiPolygon are distinct", () => {
    const arr = parse('{a: [Geometry("Polygon", [[[0,0],[1,0],[1,1],[0,0]]]), Geometry("Polygon", [[[2,2],[3,2],[3,3],[2,2]]])]}');
    const multi = parse('{m: Geometry("MultiPolygon", [[[[0,0],[1,0],[1,1],[0,0]]], [[[2,2],[3,2],[3,3],[2,2]]]])}');
    assert.equal(kindOf(arr.a), "Array");
    assert.equal(kindOf(multi.m), "Geometry");
    assert.ok(!equals(arr.a, multi.m));
  });
});

describe("Mixed object (new.txt §28)", () => {
  it("round-trips a realistic app object with all new primitives", () => {
    const txt = '{name:`Chennai`, population:7000000, active:T, boundary:Geometry("Polygon", [[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]]]), opens:Time("09:30"), ttl:Duration("PT45M"), founded:DATE(2026-01-15)}';
    const v = parse(txt);
    assert.equal(kindOf(v.boundary), "Geometry");
    assert.equal(kindOf(v.opens), "Time");
    assert.equal(kindOf(v.ttl), "Duration");
    assert.ok(equals(parse(serialize(v, COMPACT)), v));
    assert.ok(equals(parse(serialize(v, CANONICAL)), v));
  });
  it("plain GeoJSON stays Object — no inference", () => {
    const gj = { type: "Point", coordinates: [80.27,13.08] };
    const plain = { name: "Chennai", boundary: gj, count: 1 };
    const v = fromJSON(plain as never);
    assert.equal(kindOf(v.boundary), "Object");
    assert.equal(v.name, "Chennai");
    assert.equal(v.count, 1);
  });
});

describe("public helpers", () => {
  it("builds a decimal whose payload keeps its scale", () => {
    assert.equal(new STFDecimal(false, 150n, 2).payload, "1.50");
    assert.equal(new STFDecimal(true, 1n, 3).payload, "-0.001");
    // A zero coefficient has no sign.
    assert.equal(new STFDecimal(true, 0n, 1).payload, "0.0");
  });
});
