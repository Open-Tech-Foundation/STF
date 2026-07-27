#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseSTF, stringify as stringifySTF, STFValue, format as formatSTF } from "./ref-impl/js/stf.ts";

interface Options {
  mode: "json-to-stf" | "stf-to-json" | "format";
  input: string | null;
  output: string | null;
  indent: string | null;
  minify: boolean;
  wrapKey: string;
}

function parseArgs(args: string[]): Options {
  const opts: Options = {
    mode: "json-to-stf",
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
      case "--json-to-stf":
        opts.mode = "json-to-stf";
        break;
      case "-s":
      case "--stf-to-json":
        opts.mode = "stf-to-json";
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
STF Converter — Convert between JSON and STF formats

USAGE:
  stf-convert [options] [input-file]

MODES:
  -j, --json-to-stf    Convert JSON to STF (default)
  -s, --stf-to-json    Convert STF to JSON
  -f, --format         Format/pretty-print an STF file

INPUT/OUTPUT:
  -i, --input <file>   Input file (or pass as positional arg)
  -o, --output <file>  Output file (defaults to stdout)

FORMATTING:
  --indent <string>    Indentation string (default: "  ")
  --minify             Remove all unnecessary whitespace

ARRAY ROOTS:
  STF requires root objects. Arrays/scalars are auto-wrapped:
  --wrap-key <key>     Key name for wrapped root (default: "root")
  --no-wrap            Error instead of wrapping (strict mode)

OTHER:
  -h, --help           Show this help message
  -v, --version        Show version

EXAMPLES:
  stf-convert -j config.json -o config.stf
  stf-convert -s config.stf -o config.json
  stf-convert -f config.stf
`);
}

function printVersion(): void {
  console.log("stf-convert 1.0.0");
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

function jsonToStfValue(value: unknown, indent: string | null): string {
  if (value === null) return "N";
  if (value === true) return "T";
  if (value === false) return "F";
  if (typeof value === "number") return value.toString();
  if (typeof value === "bigint") return `BIGINT(${value.toString()})`;
  if (typeof value === "string") {
    if (value.includes("`")) {
      return JSON.stringify(value);
    }
    return "`" + value + "`";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const newline = indent ? "\n" : "";
    const sp = indent ? indent : "";
    const items = value.map((v) => sp + jsonToStfValue(v, indent));
    return `[${newline}${items.join("," + newline)},${indent ? "\n" : ""}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    const newline = indent ? "\n" : "";
    const sp = indent ? indent : "";
    const items = keys.map((k) => {
      const val = jsonToStfValue((value as any)[k], indent ? indent + "  " : null);
      return `${sp}${k}: ${val}`;
    });
    return `{${newline}${items.join("," + newline)},${indent ? "\n" : ""}}`;
  }
  throw new Error(`Unsupported JSON type: ${typeof value}`);
}

function stfToJsonValue(value: STFValue): unknown {
  if (Array.isArray(value)) return value.map(stfToJsonValue);
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      result[k] = stfToJsonValue((value as any)[k]);
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

    if (opts.mode === "json-to-stf") {
      const json = JSON.parse(input);
      let toConvert = json;
      if (!opts.wrapKey && (Array.isArray(json) || typeof json !== "object" || json === null)) {
        throw new Error("STF requires a root object. Use --wrap-key <name> or pass an object.");
      }
      if (Array.isArray(json) || typeof json !== "object" || json === null) {
        toConvert = { [opts.wrapKey]: json };
      }
      const indent = opts.minify ? null : (opts.indent || "  ");
      const result = jsonToStfValue(toConvert, indent);
      writeOutput(result, opts.output);
    } else if (opts.mode === "stf-to-json") {
      const parsed = parseSTF(input);
      const json = stfToJsonValue(parsed);
      const indent = opts.minify ? null : (opts.indent || "  ");
      writeOutput(JSON.stringify(json, null, indent), opts.output);
    } else if (opts.mode === "format") {
      const formatted = opts.minify
        ? stringifySTF(parseSTF(input), null)
        : formatSTF(input);
      writeOutput(formatted, opts.output);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
