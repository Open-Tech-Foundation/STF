// Tests for the playground's conversion layer.
//
// Two things are pinned here, and the second matters more than the first.
//
// The first is our own behaviour: what the lossiness report says about each format, and that the
// strict policy refuses exactly what it claims to refuse.
//
// The second is the *third-party* behaviour those claims rest on. The report tells a visitor that
// TOML drops a null key without erroring and that js-yaml writes a `!!binary` tag it then cannot
// read back. Those are observations about js-yaml 5 and smol-toml 1, not eternal truths — if a
// dependency upgrade changes them, the report starts lying to visitors and nothing else in the
// build would notice. These tests are how it gets noticed.

import { expect, test, describe } from "bun:test";
import { dump, load } from "js-yaml";
import { parse, kindOf } from "@open-tech-foundation/stf";
import { stringify as tomlStringify } from "smol-toml";

import { ConversionRefused, read, write, type FormatId } from "./formats.ts";
import { analyze } from "./lossiness.ts";
import { measure } from "./size.ts";
import { readRecords, STREAM_SAMPLE, toNDJSON } from "./streams.ts";

/** One document carrying all eleven kinds, so every profile is exercised by the same input. */
const EVERY_KIND = `{
  nothing: N,
  yes: T,
  number: 19.99,
  text: \`raw\`,
  list: [1, 2],
  nested: { a: 1 },
  big: BIGINT(9007199254740993),
  exact: DECIMAL(1.50),
  day: DATE(2026-01-15),
  instant: TIMESTAMP(2026-01-15T10:30:00Z),
  bytes: BINARY(SGVsbG8=),
}`;

const root = parse(EVERY_KIND);

/** The paths a format cannot hold at all, which is what the strict policy refuses on. */
function blocked(format: FormatId): string[] {
  return analyze(root, format)
    .findings.filter((f) => f.verdict === "unrepresentable")
    .map((f) => f.path)
    .sort();
}

describe("lossiness", () => {
  test("the JSON family loses exactly the five constructors", () => {
    const expected = ["big", "bytes", "day", "exact", "instant"];
    expect(blocked("json")).toEqual(expected);
    // JSON5 and JSONC buy syntax, not kinds — the whole point of listing them separately.
    expect(blocked("json5")).toEqual(expected);
    expect(blocked("jsonc")).toEqual(expected);
    expect(blocked("ndjson")).toEqual(expected);
  });

  test("YAML holds binary and dates, but not decimals or big integers", () => {
    expect(blocked("yaml")).toEqual(["big", "exact"]);
    const verdicts = Object.fromEntries(
      analyze(root, "yaml").findings.map((f) => [f.path, f.verdict]),
    );
    expect(verdicts.bytes).toBe("degraded");
    expect(verdicts.day).toBe("degraded");
    expect(verdicts.instant).toBe("degraded");
  });

  test("TOML holds dates but has no null and no binary", () => {
    expect(blocked("toml")).toEqual(["bytes", "exact", "nothing"]);
    const findings = analyze(root, "toml").findings;
    // A date and a timestamp are the two kinds TOML carries that the JSON family cannot.
    expect(findings.find((f) => f.path === "day")).toBeUndefined();
    expect(findings.find((f) => f.path === "instant")).toBeUndefined();
  });

  test("the silent flag marks only what is corrupted without an error", () => {
    const silent = analyze(root, "toml")
      .findings.filter((f) => f.silent)
      .map((f) => f.path)
      .sort();
    expect(silent).toEqual(["bytes", "nothing"]);
  });

  test("negative zero is a finding for JSON but not for YAML", () => {
    const negZero = parse("{z: -0}");
    expect(analyze(negZero, "json").findings[0].verdict).toBe("degraded");
    expect(analyze(negZero, "yaml").findings).toHaveLength(0);
  });

  test("a BigInt is unrepresentable in JSON whether or not the digits fit", () => {
    // Below 2^53 the digits survive; the kind does not, and the reference implementation refuses
    // rather than silently handing back a Number. Both cases are reported, with different notes.
    const small = analyze(parse("{n: BIGINT(42)}"), "json").findings[0];
    const large = analyze(parse("{n: BIGINT(9007199254740993)}"), "json").findings[0];
    expect(small.verdict).toBe("unrepresentable");
    expect(large.verdict).toBe("unrepresentable");
    expect(small.note).not.toBe(large.note);
  });

  test("a document of JSON-native kinds is clean everywhere except TOML's null", () => {
    const plain = parse("{a: 1, b: `two`, c: T, d: [1, 2], e: {f: 3}}");
    for (const format of ["json", "json5", "jsonc", "yaml", "toml", "ndjson"] as FormatId[]) {
      expect(analyze(plain, format).clean).toBe(true);
    }
  });
});

describe("strict and lossy policies", () => {
  test("strict refuses and names the values in the way", () => {
    try {
      write(root, "toml", "strict");
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ConversionRefused);
      const refusal = error as ConversionRefused;
      expect(refusal.findings).toHaveLength(3);
      expect(refusal.findings.join(" ")).toContain("nothing");
    }
  });

  test("lossy writes every format without throwing", () => {
    for (const format of ["json", "json5", "jsonc", "yaml", "toml", "ndjson"] as FormatId[]) {
      expect(write(root, format, "lossy").length).toBeGreaterThan(0);
    }
  });

  test("the JSON family keeps a BigInt's digits under the lossy policy", () => {
    // JSON5 once projected this to a double and silently lost the last digit while JSON, going
    // through the reference implementation, preserved it as text. The family must agree.
    for (const format of ["json", "json5", "jsonc", "ndjson"] as FormatId[]) {
      expect(write(root, format, "lossy")).toContain("9007199254740993");
    }
  });

  test("JSONC is byte-for-byte JSON, so the size table is not measuring a banner", () => {
    expect(write(root, "jsonc", "lossy")).toBe(write(root, "json", "lossy"));
  });
});

describe("reading back into STF", () => {
  test("TOML recovers dates, timestamps and big integers", () => {
    const back = parse(read(write(root, "toml", "lossy"), "toml"));
    expect(kindOf(back.day)).toBe("Date");
    expect(kindOf(back.instant)).toBe("Timestamp");
    expect(kindOf(back.big)).toBe("BigInt");
  });

  test("a plain TOML integer is a Number, not a BigInt", () => {
    // Reading TOML with `integersAsBigInt` is what lets large integers survive; without the
    // narrowing in `lift` it would also turn every `port = 8080` into BIGINT(8080).
    const back = parse(read("port = 8080", "toml"));
    expect(kindOf(back.port)).toBe("Number");
    expect(back.port).toBe(8080);
  });

  test("JSON recovers nothing typed — every constructor comes back as a String", () => {
    const back = parse(read(write(root, "json", "lossy"), "json"));
    for (const key of ["day", "instant", "exact", "big", "bytes"]) {
      expect(kindOf(back[key])).toBe("String");
    }
  });

  test("nothing is inferred from a string that merely looks like a date", () => {
    const back = parse(read('{"when": "2026-01-15"}', "json"));
    expect(kindOf(back.when)).toBe("String");
  });

  test("a non-object root is refused rather than silently wrapped", () => {
    expect(() => read("[1, 2]", "json5")).toThrow(/root must be an object/);
  });

  test("NaN and the infinities are refused on the way in", () => {
    expect(() => read("{a: Infinity}", "json5")).toThrow(/not an STF Number/);
  });
});

describe("dependency behaviour the report depends on", () => {
  test("smol-toml drops a null key with no error at all", () => {
    // The justification for reporting TOML's null as `silent`. If this ever throws instead, the
    // report should be reworded — a refusal is not the same warning as a disappearance.
    expect(tomlStringify({ a: 1, n: null })).not.toContain("n");
  });

  test("js-yaml writes a !!binary tag its own default loader rejects", () => {
    // The justification for reporting YAML's binary as `degraded` rather than `ok`.
    const text = dump({ b: new Uint8Array([72, 101]) });
    expect(text).toContain("!!binary");
    expect(() => load(text)).toThrow();
  });

  test("js-yaml cannot write a BigInt at all", () => {
    expect(() => dump({ n: 1n })).toThrow();
  });

  test("YAML's core schema reads a timestamp as a string", () => {
    // Why the report says YAML timestamps vary by implementation rather than claiming support.
    const loaded = load("t: 2026-01-15T10:30:00Z") as Record<string, unknown>;
    expect(typeof loaded.t).toBe("string");
  });
});

describe("size", () => {
  test("every format is measured, and refusals are reported rather than omitted", async () => {
    const rows = await measure(EVERY_KIND, root);
    expect(rows.map((r) => r.label)).toContain("JSON");
    expect(rows.map((r) => r.label)).toContain("STF (canonical)");
    for (const row of rows) expect(row.bytes).toBeGreaterThan(0);
  });

  test("STF is smaller than JSON raw, and the gzip column is measured not assumed", async () => {
    const rows = await measure(EVERY_KIND, root);
    const stf = rows.find((r) => r.label === "STF (compact)")!;
    expect(stf.versusJson).toBeGreaterThan(0);
    // Gzip is available under bun; the column is null only where CompressionStream is missing.
    expect(stf.gzipped).not.toBeNull();
  });
});

describe("streams", () => {
  test("one malformed record does not invalidate the others", () => {
    const result = readRecords(STREAM_SAMPLE);
    expect(result.ok).toBe(4);
    expect(result.failed).toBe(1);
    expect(result.directives).toEqual([{ name: "version", payload: "1.0" }]);
  });

  test("the failing record carries its own line number and code", () => {
    const failed = readRecords(STREAM_SAMPLE).records.find((r) => r.error !== null)!;
    expect(failed.line).toBe(5);
    expect(failed.error!.code).toBe("ERR_INVALID_NUMBER");
  });

  test("NDJSON conversion skips bad records and says how many", () => {
    const result = toNDJSON(readRecords(STREAM_SAMPLE));
    expect(result.skipped).toBe(1);
    expect(result.text.split("\n")).toHaveLength(4);
  });
});
