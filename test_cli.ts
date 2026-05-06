import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP_DIR = join(tmpdir(), "dtxt-cli-tests-" + Date.now());
const BUN = "bun";
const CLI = join(process.cwd(), "dtxt-convert.ts");

let passed = 0;
let failed = 0;

function setup(): void {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }
}

function cleanup(): void {
  try {
    const files = [
      "test.json", "test.dtxt", "out.dtxt", "out.json",
      "min.dtxt", "min.json", "err.json", "err.dtxt",
      "big.dtxt", "big.json", "comments.dtxt",
      "binary.dtxt", "binary.json", "date.dtxt", "date.json",
      "nest.dtxt", "nest.json", "empty.dtxt", "empty.json",
      "keys.dtxt", "keys.json", "types.dtxt", "types.json",
      "string.dtxt", "string.json", "number.dtxt", "number.json",
      "bool.dtxt", "bool.json", "null.dtxt", "null.json",
      "array.dtxt", "array.json", "obj.dtxt", "obj.json",
    ];
    for (const f of files) {
      const p = join(TMP_DIR, f);
      if (existsSync(p)) unlinkSync(p);
    }
    unlinkSync(TMP_DIR);
  } catch {
    // ignore
  }
}

function run(args: string, input?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`${BUN} run ${CLI} ${args}`, {
      input: input,
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status || 1,
    };
  }
}

function writeFile(name: string, content: string): void {
  writeFileSync(join(TMP_DIR, name), content, "utf-8");
}

function readFile(name: string): string {
  return readFileSync(join(TMP_DIR, name), "utf-8");
}

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function test(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  try {
    fn();
  } catch (err: any) {
    failed++;
    console.log(`  ✗ Test threw: ${err.message}`);
  }
}

setup();

test("json-to-dtxt: basic types", () => {
  writeFile("test.json", JSON.stringify({
    name: "hello",
    count: 42,
    active: true,
    disabled: false,
    value: null,
  }));
  const result = run(`-j ${join(TMP_DIR, "test.json")}`);
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("name:"), "has name key");
  assert(result.stdout.includes("`hello`"), "has backtick string");
  assert(result.stdout.includes("count: 42"), "has number");
  assert(result.stdout.includes("active: T"), "has true as T");
  assert(result.stdout.includes("disabled: F"), "has false as F");
  assert(result.stdout.includes("value: N"), "has null as N");
});

test("json-to-dtxt: ISO-8601 date detection", () => {
  writeFile("test.json", JSON.stringify({
    created: "2026-01-15T10:30:00Z",
    dateOnly: "2026-01-15",
  }));
  const result = run(`-j ${join(TMP_DIR, "test.json")}`);
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("Date(2026-01-15T10:30:00Z)"), "detects datetime");
  assert(result.stdout.includes("Date(2026-01-15)"), "detects date-only");
});

test("json-to-dtxt: nested objects", () => {
  writeFile("test.json", JSON.stringify({
    outer: {
      inner: {
        value: "deep",
      },
    },
  }));
  const result = run(`-j ${join(TMP_DIR, "test.json")}`);
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("outer:"), "has outer key");
  assert(result.stdout.includes("inner:"), "has inner key");
  assert(result.stdout.includes("`deep`"), "has deep value");
});

test("json-to-dtxt: arrays", () => {
  writeFile("test.json", JSON.stringify({
    items: [1, 2, 3],
    mixed: ["a", true, null],
    empty: [],
  }));
  const result = run(`-j ${join(TMP_DIR, "test.json")}`);
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("[") && result.stdout.includes("]"), "has array brackets");
  assert(result.stdout.includes("[]"), "has empty array");
});

test("json-to-dtxt: string with backtick", () => {
  writeFile("test.json", JSON.stringify({
    text: "contains `backtick`",
  }));
  const result = run(`-j ${join(TMP_DIR, "test.json")}`);
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes('"'), "uses double quotes for backtick strings");
});

test("json-to-dtxt: keys are sorted", () => {
  writeFile("test.json", JSON.stringify({
    zebra: 1,
    apple: 2,
    mango: 3,
  }));
  const result = run(`-j ${join(TMP_DIR, "test.json")}`);
  const lines = result.stdout.split("\n").filter((l) => l.includes(":"));
  assert(lines[0].includes("apple"), "apple comes first");
  assert(lines[1].includes("mango"), "mango comes second");
  assert(lines[2].includes("zebra"), "zebra comes last");
});

test("json-to-dtxt: minify mode", () => {
  writeFile("test.json", JSON.stringify({ a: 1, b: 2 }));
  const result = run(`-j ${join(TMP_DIR, "test.json")} --minify`);
  assert(result.exitCode === 0, "exits with 0");
  const output = result.stdout.replace(/\n/g, "");
  assert(output.includes("{a: 1,b: 2,}"), "output is minified");
});

test("json-to-dtxt: output to file", () => {
  writeFile("test.json", JSON.stringify({ name: "test" }));
  const result = run(`-j ${join(TMP_DIR, "test.json")} -o ${join(TMP_DIR, "out.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  const output = readFile("out.dtxt");
  assert(output.includes("name:"), "file contains DTXT");
  assert(output.includes("`test`"), "file has backtick string");
});

test("json-to-dtxt: stdin input", () => {
  const result = run("-j", JSON.stringify({ input: "stdin" }));
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("input:"), "has input key");
  assert(result.stdout.includes("`stdin`"), "has stdin value");
});

test("json-to-dtxt: empty object", () => {
  writeFile("test.json", JSON.stringify({}));
  const result = run(`-j ${join(TMP_DIR, "test.json")}`);
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("{}"), "outputs empty object");
});

test("json-to-dtxt: invalid JSON", () => {
  writeFile("err.json", "{ invalid json }");
  const result = run(`-j ${join(TMP_DIR, "err.json")}`);
  assert(result.exitCode === 1, "exits with 1");
  assert(result.stderr.includes("Error:"), "shows error message");
});

test("dtxt-to-json: basic types", () => {
  writeFile("test.dtxt", "{\n  name: `hello`,\n  count: 42,\n  active: T,\n  disabled: F,\n  value: N,\n}");
  const result = run(`-d ${join(TMP_DIR, "test.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  const json = JSON.parse(result.stdout);
  assert(json.name === "hello", "string parsed correctly");
  assert(json.count === 42, "number parsed correctly");
  assert(json.active === true, "T parsed as true");
  assert(json.disabled === false, "F parsed as false");
  assert(json.value === null, "N parsed as null");
});

test("dtxt-to-json: Date constructor", () => {
  writeFile("test.dtxt", "{ created: Date(2026-01-15T10:30:00Z) }");
  const result = run(`-d ${join(TMP_DIR, "test.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  const json = JSON.parse(result.stdout);
  assert(json.created === "2026-01-15T10:30:00.000Z", "Date converted to ISO string");
});

test("dtxt-to-json: BigNumber constructor", () => {
  writeFile("test.dtxt", "{ big: BigNumber(9007199254740993) }");
  const result = run(`-d ${join(TMP_DIR, "test.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  const json = JSON.parse(result.stdout);
  assert(json.big === "9007199254740993", "BigNumber converted to string");
});

test("dtxt-to-json: Binary constructor", () => {
  writeFile("test.dtxt", "{ hash: Binary(A7B2319E44CE12BA) }");
  const result = run(`-d ${join(TMP_DIR, "test.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  const json = JSON.parse(result.stdout);
  assert(json.hash === "0xA7B2319E44CE12BA", "Binary converted to 0x-prefixed hex");
});

test("dtxt-to-json: nested objects and arrays", () => {
  writeFile("test.dtxt", "{\n  items: [1, 2, 3],\n  meta: {\n    enabled: T,\n  },\n}");
  const result = run(`-d ${join(TMP_DIR, "test.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  const json = JSON.parse(result.stdout);
  assert(Array.isArray(json.items), "items is array");
  assert(json.items.length === 3, "array has 3 items");
  assert(typeof json.meta === "object", "meta is object");
  assert(json.meta.enabled === true, "nested boolean parsed");
});

test("dtxt-to-json: output to file", () => {
  writeFile("test.dtxt", "{ name: `test` }");
  const result = run(`-d ${join(TMP_DIR, "test.dtxt")} -o ${join(TMP_DIR, "out.json")}`);
  assert(result.exitCode === 0, "exits with 0");
  const json = JSON.parse(readFile("out.json"));
  assert(json.name === "test", "file contains valid JSON");
});

test("dtxt-to-json: minify mode", () => {
  writeFile("test.dtxt", "{\n  a: 1,\n  b: 2,\n}");
  const result = run(`-d ${join(TMP_DIR, "test.dtxt")} --minify`);
  assert(result.exitCode === 0, "exits with 0");
  const output = result.stdout.replace(/\n/g, "");
  assert(output === JSON.stringify({ a: 1, b: 2 }), "output is minified JSON");
});

test("dtxt-to-json: comments are ignored", () => {
  writeFile("test.dtxt", `# This is a comment
{
  name: \`test\`, # inline comment
  # another comment
  count: 42,
}`);
  const result = run(`-d ${join(TMP_DIR, "test.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  const json = JSON.parse(result.stdout);
  assert(json.name === "test", "parsed despite comments");
  assert(json.count === 42, "parsed despite comments");
});

test("dtxt-to-json: invalid DTXT", () => {
  writeFile("err.dtxt", "{ invalid }");
  const result = run(`-d ${join(TMP_DIR, "err.dtxt")}`);
  assert(result.exitCode === 1, "exits with 1");
  assert(result.stderr.includes("Error:"), "shows error message");
});

test("format: pretty-prints DTXT", () => {
  writeFile("test.dtxt", "{name:`test`,count:42}");
  const result = run(`-f ${join(TMP_DIR, "test.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("\n"), "output has newlines");
  assert(result.stdout.includes("  "), "output has indentation");
});

test("format: minify mode", () => {
  writeFile("test.dtxt", "{\n  name: `test`,\n  count: 42,\n}");
  const result = run(`-f ${join(TMP_DIR, "test.dtxt")} --minify`);
  assert(result.exitCode === 0, "exits with 0");
  const output = result.stdout.replace(/\n/g, "");
  assert(output.includes("count:") && !output.includes("\n"), "output is minified");
});

test("format: stdin input", () => {
  const result = run("-f", "{ a: 1, b: 2 }");
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("a:"), "has a key");
  assert(result.stdout.includes("b:"), "has b key");
});

test("format: output to file", () => {
  writeFile("test.dtxt", "{a:1,b:2}");
  const result = run(`-f ${join(TMP_DIR, "test.dtxt")} -o ${join(TMP_DIR, "out.dtxt")}`);
  assert(result.exitCode === 0, "exits with 0");
  const output = readFile("out.dtxt");
  assert(output.includes("\n"), "file has formatted output");
});

test("help flag", () => {
  const result = run("--help");
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("DTXT Converter"), "shows title");
  assert(result.stdout.includes("--json-to-dtxt"), "shows json-to-dtxt option");
  assert(result.stdout.includes("--dtxt-to-json"), "shows dtxt-to-json option");
  assert(result.stdout.includes("--format"), "shows format option");
});

test("version flag", () => {
  const result = run("--version");
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("dtxt-convert"), "shows name");
  assert(result.stdout.includes("0.1.0"), "shows version");
});

test("json-to-dtxt: array root auto-wrap", () => {
  const result = run("-j", JSON.stringify([1, 2, 3]));
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("root:"), "wraps in root key");
  assert(result.stdout.includes("1,"), "contains array values");
});

test("json-to-dtxt: array root custom wrap key", () => {
  const result = run("-j --wrap-key items", JSON.stringify(["a", "b"]));
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("items:"), "uses custom wrap key");
  assert(result.stdout.includes("`a`"), "contains values");
});

test("json-to-dtxt: scalar root auto-wrap", () => {
  const numResult = run("-j", "42");
  assert(numResult.exitCode === 0, "number exits with 0");
  assert(numResult.stdout.includes("root: 42"), "wraps number");

  const strResult = run("-j", JSON.stringify("hello"));
  assert(strResult.exitCode === 0, "string exits with 0");
  assert(strResult.stdout.includes("root: `hello`"), "wraps string");

  const boolResult = run("-j", "true");
  assert(boolResult.exitCode === 0, "bool exits with 0");
  assert(boolResult.stdout.includes("root: T"), "wraps boolean");

  const nullResult = run("-j", "null");
  assert(nullResult.exitCode === 0, "null exits with 0");
  assert(nullResult.stdout.includes("root: N"), "wraps null");
});

test("json-to-dtxt: no-wrap rejects array root", () => {
  const result = run("-j --no-wrap", JSON.stringify([1, 2]));
  assert(result.exitCode === 1, "exits with 1");
  assert(result.stderr.includes("DTXT requires a root object"), "shows clear error");
});

test("json-to-dtxt: no-wrap rejects scalar root", () => {
  const result = run("-j --no-wrap", "42");
  assert(result.exitCode === 1, "exits with 1");
  assert(result.stderr.includes("DTXT requires a root object"), "shows clear error");
});

test("roundtrip: json array root -> dtxt -> json", () => {
  const original = [1, "two", true, null, { nested: "value" }];
  const toDtxt = run("-j", JSON.stringify(original));
  assert(toDtxt.exitCode === 0, "to-dtxt succeeds");
  const toJson = run("-d", toDtxt.stdout);
  assert(toJson.exitCode === 0, "to-json succeeds");
  const result = JSON.parse(toJson.stdout);
  assert(result.root instanceof Array, "root is array");
  assert(result.root[0] === 1, "number matches");
  assert(result.root[1] === "two", "string matches");
  assert(result.root[2] === true, "bool matches");
  assert(result.root[3] === null, "null matches");
  assert(result.root[4].nested === "value", "nested object matches");
});

test("roundtrip: json -> dtxt -> json", () => {
  const original = {
    name: "test",
    count: 42,
    active: true,
    items: [1, 2, 3],
    meta: {
      enabled: false,
      value: null,
    },
  };
  writeFile("test.json", JSON.stringify(original));
  const toDtxt = run(`-j ${join(TMP_DIR, "test.json")}`);
  writeFile("test.dtxt", toDtxt.stdout);
  const toJson = run(`-d ${join(TMP_DIR, "test.dtxt")}`);
  const result = JSON.parse(toJson.stdout);
  assert(result.name === original.name, "name matches");
  assert(result.count === original.count, "count matches");
  assert(result.active === original.active, "active matches");
  assert(result.meta.enabled === original.meta.enabled, "nested bool matches");
  assert(result.meta.value === original.meta.value, "nested null matches");
});

test("roundtrip: dtxt -> json -> dtxt", () => {
  const original = "{\n  name: `test`,\n  count: 42,\n  active: T,\n}";
  writeFile("test.dtxt", original);
  const toJson = run(`-d ${join(TMP_DIR, "test.dtxt")}`);
  writeFile("test.json", toJson.stdout);
  const toDtxt = run(`-j ${join(TMP_DIR, "test.json")}`);
  assert(toDtxt.exitCode === 0, "roundtrip succeeds");
  assert(toDtxt.stdout.includes("name:"), "has name key");
  assert(toDtxt.stdout.includes("count: 42"), "has count");
  assert(toDtxt.stdout.includes("active: T"), "has active");
});

test("unknown argument", () => {
  const result = run("--unknown-flag");
  assert(result.exitCode === 1, "exits with 1");
  assert(result.stderr.includes("Error:"), "shows error message");
});

cleanup();

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(40));
process.exit(failed > 0 ? 1 : 0);
