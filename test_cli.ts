import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP_DIR = join(tmpdir(), "stf-cli-tests-" + Date.now());
const BUN = "bun";
const CLI = join(process.cwd(), "stf-convert.ts");

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
      "test.json", "test.stf", "out.stf", "out.json",
      "min.stf", "min.json", "err.json", "err.stf",
      "big.stf", "big.json", "comments.stf",
      "binary.stf", "binary.json", "date.stf", "date.json",
      "nest.stf", "nest.json", "empty.stf", "empty.json",
      "keys.stf", "keys.json", "types.stf", "types.json",
      "string.stf", "string.json", "number.stf", "number.json",
      "bool.stf", "bool.json", "null.stf", "null.json",
      "array.stf", "array.json", "obj.stf", "obj.json",
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

test("json-to-stf: basic types", () => {
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

test("json-to-stf: nested objects", () => {
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

test("json-to-stf: arrays", () => {
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

test("json-to-stf: string with backtick", () => {
  writeFile("test.json", JSON.stringify({
    text: "contains `backtick`",
  }));
  const result = run(`-j ${join(TMP_DIR, "test.json")}`);
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes('"'), "uses double quotes for backtick strings");
});

test("json-to-stf: keys are sorted", () => {
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

test("json-to-stf: output to file", () => {
  writeFile("test.json", JSON.stringify({ name: "test" }));
  const result = run(`-j ${join(TMP_DIR, "test.json")} -o ${join(TMP_DIR, "out.stf")}`);
  assert(result.exitCode === 0, "exits with 0");
  const output = readFile("out.stf");
  assert(output.includes("name:"), "file contains STF");
  assert(output.includes("`test`"), "file has backtick string");
});

test("stf-to-json: basic types", () => {
  writeFile("test.stf", "{\n  name: `hello`,\n  count: 42,\n  active: T,\n  disabled: F,\n  value: N,\n}");
  const result = run(`-s ${join(TMP_DIR, "test.stf")}`);
  assert(result.exitCode === 0, "exits with 0");
  const json = JSON.parse(result.stdout);
  assert(json.name === "hello", "string parsed correctly");
  assert(json.count === 42, "number parsed correctly");
  assert(json.active === true, "T parsed as true");
  assert(json.disabled === false, "F parsed as false");
  assert(json.value === null, "N parsed as null");
});

test("help flag", () => {
  const result = run("--help");
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("STF Converter"), "shows title");
});

test("version flag", () => {
  const result = run("--version");
  assert(result.exitCode === 0, "exits with 0");
  assert(result.stdout.includes("stf-convert"), "shows name");
});

cleanup();

console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(40));
process.exit(failed > 0 ? 1 : 0);
