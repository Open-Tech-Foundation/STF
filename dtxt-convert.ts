#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseDTXT, stringify as stringifyDTXT, DTXTValue, format as formatDTXT } from "./ref-impl/ts/dtxt.js";

interface Options {
  mode: "json-to-dtxt" | "dtxt-to-json" | "format";
  input: string | null;
  output: string | null;
  indent: string | null;
  minify: boolean;
  wrapKey: string;
}

function parseArgs(args: string[]): Options {
  const opts: Options = {
    mode: "json-to-dtxt",
    input: null,
    output: null,
    indent: null,
    minify: false,
    wrapKey: "root",
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-j":
      case "--json-to-dtxt":
        opts.mode = "json-to-dtxt";
        break;
      case "-d":
      case "--dtxt-to-json":
        opts.mode = "dtxt-to-json";
        break;
      case "-f":
      case "--format":
        opts.mode = "format";
        break;
      case "-i":
      case "--input":
        opts.input = args[++i] || null;
        break;
      case "-o":
      case "--output":
        opts.output = args[++i] || null;
        break;
      case "--indent":
        opts.indent = args[++i] || "  ";
        break;
      case "--minify":
        opts.minify = true;
        break;
      case "--wrap-key":
        opts.wrapKey = args[++i] || "root";
        break;
      case "--no-wrap":
        opts.wrapKey = "";
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
        break;
      case "-v":
      case "--version":
        printVersion();
        process.exit(0);
        break;
      default:
        if (!opts.input) {
          opts.input = arg;
        } else {
          console.error(`Unknown argument: ${arg}`);
          process.exit(1);
        }
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
DTXT Converter — Convert between JSON and DTXT formats

USAGE:
  dtxt-convert [options] [input-file]

MODES:
  -j, --json-to-dtxt    Convert JSON to DTXT (default)
  -d, --dtxt-to-json    Convert DTXT to JSON
  -f, --format          Format/pretty-print a DTXT file

INPUT/OUTPUT:
  -i, --input <file>    Input file (or pass as positional arg)
  -o, --output <file>   Output file (defaults to stdout)

FORMATTING:
  --indent <string>     Indentation string (default: "  ")
  --minify              Remove all unnecessary whitespace

ARRAY ROOTS:
  DTXT requires root objects. Arrays/scalars are auto-wrapped:
  --wrap-key <key>      Key name for wrapped root (default: "root")
  --no-wrap             Error instead of wrapping (strict mode)

OTHER:
  -h, --help            Show this help message
  -v, --version         Show version

EXAMPLES:
  dtxt-convert -j config.json -o config.dtxt
  dtxt-convert -d config.dtxt -o config.json
  dtxt-convert -f config.dtxt
  cat data.json | dtxt-convert -j
  dtxt-convert --json-to-dtxt --minify input.json

JSON TO DTXT MAPPING:
  true/false       → T/F
  null             → N
  strings          → \`string\` (or "string" if contains backtick)
  numbers          → number
  arrays           → [...]
  objects          → { key: value, }
  ISO-8601 dates   → Date(YYYY-MM-DDTHH:mm:ssZ)  (if string matches ISO-8601)
  large integers   → BigNumber(n)  (if exceeds safe integer range)

DTXT TO JSON MAPPING:
  T/F              → true/false
  N                → null
  Date(...)        → ISO-8601 string
  BigNumber(...)   → string representation
  Binary(...)      → hex string prefixed with "0x"
`);
}

function printVersion(): void {
  console.log("dtxt-convert 0.1.0");
}

function readInput(filePath: string | null): string {
  if (filePath) {
    return readFileSync(filePath, "utf-8");
  }
  return readFileSync(0, "utf-8");
}

function writeOutput(content: string, filePath: string | null): void {
  if (filePath) {
    writeFileSync(filePath, content, "utf-8");
  } else {
    process.stdout.write(content);
    if (!content.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
}

function detectIsoDate(str: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(str);
}

function jsonToDtxtValue(value: unknown, indent: string | null): string {
  if (value === null) return "N";
  if (value === true) return "T";
  if (value === false) return "F";
  if (typeof value === "number") return value.toString();
  if (typeof value === "bigint") return `BigNumber(${value.toString()})`;
  if (typeof value === "string") {
    if (detectIsoDate(value)) {
      return `Date(${value})`;
    }
    if (value.includes("`")) {
      return JSON.stringify(value);
    }
    return "`" + value + "`";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const newline = indent ? "\n" : "";
    const sp = indent ? indent : "";
    const items = value.map((v) => sp + jsonToDtxtValue(v, indent));
    return `[${newline}${items.join("," + newline)},${indent ? "\n" : ""}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    const newline = indent ? "\n" : "";
    const sp = indent ? indent : "";
    const items = keys.map((k) => {
      const val = jsonToDtxtValue((value as any)[k], indent ? indent + "  " : null);
      return `${sp}${k}: ${val}`;
    });
    return `{${newline}${items.join("," + newline)},${indent ? "\n" : ""}}`;
  }
  throw new Error(`Unsupported JSON type: ${typeof value}`);
}

function dtxtToJsonValue(value: DTXTValue): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) {
    let hex = "0x";
    for (let i = 0; i < value.length; i++) {
      const h = value[i].toString(16);
      hex += h.length === 1 ? "0" + h.toUpperCase() : h.toUpperCase();
    }
    return hex;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(dtxtToJsonValue);
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      result[k] = dtxtToJsonValue((value as any)[k]);
    }
    return result;
  }
  return value;
}

function main(): void {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);

  try {
    const input = readInput(opts.input);

    if (opts.mode === "json-to-dtxt") {
      const json = JSON.parse(input);
      let toConvert = json;
      if (!opts.wrapKey && (Array.isArray(json) || typeof json !== "object" || json === null)) {
        throw new Error("DTXT requires a root object. Use --wrap-key <name> or pass an object.");
      }
      if (Array.isArray(json) || typeof json !== "object" || json === null) {
        toConvert = { [opts.wrapKey]: json };
      }
      const indent = opts.minify ? null : (opts.indent || "  ");
      const result = jsonToDtxtValue(toConvert, indent);
      writeOutput(result, opts.output);
    } else if (opts.mode === "dtxt-to-json") {
      const dtxt = parseDTXT(input);
      const json = dtxtToJsonValue(dtxt);
      const indent = opts.minify ? null : (opts.indent || "  ");
      writeOutput(JSON.stringify(json, null, indent), opts.output);
    } else if (opts.mode === "format") {
      const formatted = opts.minify
        ? stringifyDTXT(parseDTXT(input), null)
        : formatDTXT(input);
      writeOutput(formatted, opts.output);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
