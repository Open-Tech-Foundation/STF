# STF Stream 1.0 — Line-Delimited Record Streams

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

> [!WARNING]
> This specification is in a **draft state** and is subject to change.

---

## 1. Overview

**STF Stream** is an OPTIONAL profile of [STF 1.0](spec.md) for **append-only record streams**:
event logs, audit trails, telemetry, change feeds, and batch export.

A stream is a sequence of complete STF documents, one per line.

```stfs
@schema(https://example.com/event.schema.stf)
{ts:TIMESTAMP(2026-01-15T10:30:00Z),lvl:`info`,msg:`server started`}
{ts:TIMESTAMP(2026-01-15T10:30:01Z),lvl:`warn`,msg:`retrying upstream`}
{ts:TIMESTAMP(2026-01-15T10:30:02Z),lvl:`error`,msg:`upstream unavailable`}
```

The profile exists because the discrete-document model of STF 1.0 §5 cannot express an
unbounded, append-only sequence: a document has exactly one root object, and anything after it
is `ERR_TRAILING_CONTENT`. Rather than relax that rule — which would cost the single-document
fast path and make error recovery ambiguous — streams are a separate, explicitly-selected
profile.

### 1.1 Design Properties

* **Appendable.** A writer appends a line and flushes. No trailing delimiter to rewrite, no
  enclosing bracket to close, so a stream is valid at every instant, including mid-write.
* **Splittable without parsing.** Because a record can never contain a raw line terminator
  (§3.2), a reader may split on `U+000A` before parsing anything. This permits parallel and
  ranged reads, and `tail`/`grep`/`split` work as expected.
* **Independently recoverable.** Records are parsed independently, so one malformed record
  does not invalidate the rest of the stream (§5).
* **Core-compatible.** Every record is a valid STF 1.0 document. No new value kinds, no
  changes to the data model, and `.stf` files are entirely unaffected.

### 1.2 Media Type and File Extension

* **Media type (interim)**: `application/vnd.stf-stream`
* **Media type (post-registration)**: `application/stf-stream`
* **File extension**: `.stfs`

### 1.3 Conformance Language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY**, and **OPTIONAL**
are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174).

Everything in [STF 1.0](spec.md) applies to each record unless this document overrides it.
Support for this profile is OPTIONAL; an implementation MAY support STF 1.0 without it.

---

## 2. Stream Structure

```ebnf
stream       = { line } ;
line         = ( header | record | ignorable ) terminator ;
ignorable    = hws [ comment ] ;
terminator   = LF | CRLF | EOF ;
hws          = { " " | "\t" } ;
```

A stream is a sequence of **lines**, each terminated by `U+000A` (LF) or by end of input.

* A single `U+000D` (CR) immediately preceding the terminating LF **MUST** be accepted and
  discarded, so CRLF-terminated files read correctly. Writers **MUST NOT** emit CR.
* The final line **MAY** omit its terminator. A stream **SHOULD** end with a terminator so
  that appending is a pure write.
* A line containing only horizontal whitespace and/or a comment is **ignorable** and MUST be
  skipped. This makes a trailing newline at end of file harmless.
* An empty stream — zero bytes, or only ignorable lines — is **valid** and contains zero records.
* The stream **MUST** be encoded in UTF-8, per spec §2. A leading byte order mark **MUST** be
  rejected.

### 2.1 Line Numbering

Implementations **MUST** report errors with a **1-based line number** counting every line,
including ignorable ones, so that reported positions match what a text editor shows.

---

## 3. Records

A **record** is a complete STF 1.0 document occupying exactly one line.

* A record **MUST** consist of a single root object, per spec §5. All of spec §6–§11 applies
  unchanged.
* A record **MUST NOT** contain directives; see §4.
* Records are parsed **independently**. Nothing in one record affects another. There is no
  shared state, no symbol table, and no cross-record references.
* Leading and trailing horizontal whitespace around a record is permitted and ignored.
* A trailing comment after a record is permitted: `{a:1} # note`.

### 3.1 Records Are Not Homogeneous

Records in one stream **need not** share a shape. Heterogeneity is expected in event logs.
A `@schema` header (§4) constrains records only if the schema itself permits variation.

### 3.2 Line Terminators Inside Records (Critical)

A record **MUST NOT** contain a raw `U+000A` or `U+000D` anywhere — including inside a raw
backtick string, where STF 1.0 §8.1 would otherwise preserve them.

A string value containing a line break **MUST** therefore be written in the interpreted form
using `\n` and `\r` escapes:

```stfs
{msg:"line one\nline two"}      # correct
```

```stf
{msg:`line one
line two`}                       # valid .stf, INVALID as a stream record
```

Violation is rejected with `ERR_STREAM_RAW_NEWLINE`.

> **Rationale.** This single restriction is what makes a stream splittable on LF without
> parsing. Without it, a reader could not know whether a newline ends a record or sits inside
> a string, and every property in §1.1 would be lost.

Serializers writing a stream **MUST** apply this automatically: emit the interpreted form
whenever a string contains a line terminator, rather than failing. Escaping is already
required by spec §13.5.

---

## 4. Stream Header

A stream **MAY** begin with a **header line** carrying one or more directives and no object:

```stfs
@schema(https://example.com/event.schema.stf)
{ts:TIMESTAMP(2026-01-15T10:30:00Z),lvl:`info`}
```

* The header, if present, **MUST** be the first non-ignorable line.
* It **MUST** contain only directives — a header line with an object is a record, not a header.
* Directive syntax and semantics are those of spec §5.1: no whitespace around `@` or before
  `(`, names are case-sensitive, a repeated name is `ERR_SYNTAX`, and an unknown directive
  **MUST NOT** fail (warn instead).
* Header directives apply to **every record** in the stream.
* Multiple directives MAY appear on the header line, separated by whitespace.
* A directive appearing on any later line, or alongside an object, **MUST** be rejected with
  `ERR_STREAM_DIRECTIVE_IN_RECORD`.

| Directive | Payload | Meaning |
| :--- | :--- | :--- |
| `@schema` | URI or relative path | Every record conforms to this STF Schema. |
| `@version` | Version string | Authoring STF version. |

Because the header is optional and applies stream-wide, concatenating two streams with
different headers is **not** valid. Concatenate the record lines and write a single header, or
keep the streams separate.

---

## 5. Error Handling and Recovery

Each record is validated independently, which is the profile's central operational property.

* A reader encountering a malformed record **MUST** report the error with its line number, and
  **MUST** be able to continue with the next line.
* Whether it continues or aborts is a **caller policy**, not a format rule. Implementations
  **MUST** offer both, and **SHOULD** default to aborting so that corruption is not silently
  skipped.
* Errors within a record use the codes of [error-codes.md](error-codes.md) unchanged. This
  profile adds only the two codes in §6.
* A reader **MUST NOT** attempt to repair a record, join a record across lines, or infer a
  missing brace.

---

## 6. Additional Error Codes

| Code | Meaning |
| :--- | :--- |
| `ERR_STREAM_RAW_NEWLINE` | A record contains a raw LF or CR (§3.2). |
| `ERR_STREAM_DIRECTIVE_IN_RECORD` | A directive appears outside the header line (§4). |

### 6.1 Condition → Code

| Condition | Example | Code |
| :--- | :--- | :--- |
| Raw newline inside a record's string | `` {a:`x<LF>y`} `` | `ERR_STREAM_RAW_NEWLINE` |
| Directive on a non-header line | record line, then `@schema(x)` | `ERR_STREAM_DIRECTIVE_IN_RECORD` |
| Directive alongside an object | `@schema(x) {a:1}` | `ERR_STREAM_DIRECTIVE_IN_RECORD` |
| Repeated directive name in header | `@schema(a) @schema(b)` | `ERR_SYNTAX` |
| Leading byte order mark | `U+FEFF` at offset 0 | `ERR_SYNTAX` |
| Record root is not an object | `[1,2]` on a line | `ERR_ROOT_NOT_OBJECT` |
| Two objects on one line | `{a:1}{b:2}` | `ERR_TRAILING_CONTENT` |
| Empty stream | zero bytes | **valid**, zero records |
| Blank or comment-only line | `` or `# note` | **valid**, ignored |
| CRLF line terminators | `{a:1}<CR><LF>` | **valid**, CR discarded |
| Trailing comment after a record | `{a:1} # note` | **valid** |

---

## 7. Canonical Form

A stream is in **STF Canonical Stream Form** when every record is in STF Canonical Form
(spec §14) and:

1. Records are terminated by a single `U+000A`, including the final record.
2. There are no ignorable lines — no blank lines, no comment-only lines, no trailing comments.
3. The header, if present, is the first line, with single spaces between directives.

Record **order is preserved** and is significant: a stream is a sequence, and canonicalization
MUST NOT reorder records. This differs from object members within a record, which spec §14
sorts.

---

## 8. Interoperability Note

Converting NDJSON or JSONL to STF Stream is a line-by-line application of STF 1.0's conversion
rules, and is subject to the same constraint: **STF keys are identifiers** (spec §6.1), so a
JSON record with a key that is not a valid STF identifier cannot be converted. Such a record
**MUST** be reported with its line number and rejected, not silently renamed.

STF Stream is not intended to be a drop-in reader for NDJSON. It is the STF-native solution
for the same use case.
