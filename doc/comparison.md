# STF vs. Other Data Formats

Non-normative. Comparisons reflect STF 1.0 as specified in [spec.md](spec.md).

STF aims to **replace** JSON, JSONC, JSON5, NDJSON, and JSONL for new work. It is not a
superset of any of them and does not accept their looser syntax — see the
[migration guide](migration-guide.md) §1.4 for what that means in practice.

---

## 1. Feature Matrix

| Feature | JSON | JSONC | JSON5 | YAML | TOML | Amazon Ion | **STF** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Comments | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Unquoted keys | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Trailing commas | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Multi-line strings | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Explicit wall date | ✗ | ✗ | ✗ | ⚠ implicit | ✓ | ✓ | ✓ `DATE(...)` |
| Explicit instant | ✗ | ✗ | ✗ | ⚠ implicit | ✓ | ✓ `timestamp` | ✓ `TIMESTAMP(...)` |
| Arbitrary-precision integer | ✗ | ✗ | ✗ | ⚠ | ✓ | ✓ | ✓ `BIGINT(...)` |
| Exact decimal | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ `decimal` | ✓ `DECIMAL(...)` |
| Scale-sensitive decimal | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| Binary values | ✗ | ✗ | ✗ | ✓ base64 | ✗ | ✓ `blob` | ✓ `BINARY(...)` |
| Record streams | ✗ | ✗ | ✗ | ✓ `---` | ✗ | ✓ | ✓ [`.stfs`](stream.md) |
| Canonical form | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ [§14](spec.md) |
| Normative error codes | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| Spec complexity | Low | Low | Low | Very high | Medium | Medium-high | Low |

---

## 2. Deep Dives

### 2.1 STF vs. JSON

**JSON's problems.** No comments. Mandatory quotes on every key. No way to distinguish a date,
a decimal, a big integer, or binary data from an ordinary string — so every project invents its
own conventions and a reader cannot tell `"2026-01-15"` (a date) from `"2026-01-15"` (a string
that happens to look like one). Numbers are binary64 in practice, so `19.99` is not exactly
19.99 and integers silently lose precision past 2^53.

**STF's answer.** Keep the structural simplicity — braces, brackets, commas, colons — and add
explicit uppercase constructors for the five types JSON forces into strings. Precision is opt-in
and visible at the point of use: `DECIMAL(19.99)` is exact, `19.99` is binary64, and the
difference is in the document rather than in a schema or a convention.

**What STF gives up.** Any-value roots, arbitrary-string keys, and duplicate keys.

### 2.2 STF vs. JSONC and JSON5

JSONC adds comments to JSON; JSON5 adds comments, unquoted keys, trailing commas, and a range
of ECMAScript-flavoured number and string syntax.

STF has the ergonomics both were reaching for — comments, unquoted keys, trailing commas,
multi-line strings — without the extra syntax JSON5 accumulated. Hex literals, leading `+`,
leading and trailing decimal points, digit separators, single-quoted strings, line
continuations, `NaN`, and `Infinity` are all rejected (see [migration-guide](migration-guide.md)
§1.5). Every one of those is a second way to write something, and none of them carries meaning
the first way could not.

Neither JSONC nor JSON5 addresses the type problem, which is the reason STF exists.

### 2.3 STF vs. NDJSON / JSONL

NDJSON and JSONL are conventions rather than specifications: one JSON value per line, with the
line-splitting rule left implicit. Because JSON strings may contain escaped-but-not-raw
newlines, splitting on `\n` happens to work — but nothing in JSON says so.

[STF Stream](stream.md) makes it a rule: a record **may not** contain a raw line terminator, so
splitting on `U+000A` before parsing is guaranteed correct, not merely conventional. Records
parse independently, so one corrupt record does not invalidate the stream, and an optional
header line carries stream-wide directives such as `@schema`.

### 2.4 STF vs. YAML

YAML's difficulty is well documented — the Norway problem (`NO` parsed as false), significant
indentation, anchors and aliases, multiple document types, and a specification large enough that
implementations disagree in practice.

STF has no implicit typing: `T` is a boolean and `` `T` `` is a string, always. Structure is
explicit through braces and brackets, so no line's meaning depends on the whitespace before it.
There are no anchors, aliases, or references (spec §1.3), so a document cannot expand
exponentially on load.

### 2.5 STF vs. Amazon Ion

Ion is the closest relative: a richly typed format with text and binary encodings, and the two
converge on scale-sensitive decimals — both recognising that trailing precision is data in
financial and scientific contexts.

Differences:

* **Binary encoding.** Ion has a compact binary form that is smaller than STF text. STF has no
  binary encoding, and concedes payload size to Ion where that matters.
* **Complexity.** Ion has symbol tables, shared catalogues, annotations, s-expressions, and a
  binary state machine. STF has none of these. The whole of STF is one grammar over UTF-8 text.
* **Licence.** STF is dedicated to the public domain under CC0.

---

## 3. Performance

Claims here are limited to what this repository's benchmarks actually measure. See
[benchmarks/RESULTS.md](../benchmarks/RESULTS.md).

**Payload size.** STF is consistently **15–18% smaller than JSON** on equivalent data, from
unquoted keys and the one-character `T` / `F` / `N` literals. Measured on a dataset of
JSON-native types only, so it reflects base format overhead and does not exercise the
constructor types.

**Parse speed.** Results depend far more on the implementation than on the format:

| | STF | Native JSON | |
| :--- | ---: | ---: | :--- |
| Go | 65.6 ms | 82.6 ms (`encoding/json`) | STF ~21% faster |
| Go | 65.6 ms | 42.2 ms (Sonic) | a tuned JSON parser is faster |
| JS (Bun) | 66.8 ms | 28.4 ms (`JSON.parse`) | native parser is C++ |
| Python | 1348 ms | 81.2 ms (`json.loads`) | pure-Python scanner vs C |

The honest summary: **STF's grammar is cheap to parse, but a reference implementation written
in the host language does not beat a native JSON parser written in C.** Go's result shows what
comparable implementations look like; the JS and Python results compare an STF implementation in
the language against a JSON parser in C, and should not be read as a property of the format.

> **Caveat.** These figures are not directly comparable across languages: each implementation's
> benchmark generates its own randomly-seeded dataset, and the Python run measures against a
> `json.dumps` baseline that includes default separator spacing. Treat them as within-language
> comparisons only, pending a benchmark rework.

---

## 4. Choosing a Format

| Use case | Best fit | Why |
| :--- | :--- | :--- |
| Flat application config | TOML or STF | TOML is ergonomic when flat; STF wins as soon as you need nesting, dates, or comments with types |
| Config with typed values | **STF** | Dates, decimals, and durations stop being stringly-typed |
| Financial / scientific data | **STF** or Ion | Scale-sensitive decimals and exact big integers |
| Event logs, audit trails | **STF Stream** or Ion | Append-only, line-splittable, independently recoverable records |
| Signed or hashed documents | **STF** or Ion | Canonical form gives one byte encoding per value |
| Maximum payload compactness | Ion (binary) | STF is a text format |
| Interop with existing systems | JSON | Universal support is JSON's remaining advantage |
