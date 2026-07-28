# `stf` — Command-Line Tool

Non-normative. The tool implements [STF 1.0](spec.md), the [Stream profile](stream.md), and the
[error codes](error-codes.md).

```sh
cargo install --path ref-impl/rust      # installs `stf`
# or, from a checkout:
cargo run --manifest-path ref-impl/rust/Cargo.toml --bin stf -- <args>
```

---

## 1. Commands

| Command | Purpose |
| :--- | :--- |
| `stf check` | Parse each input and report any error. |
| `stf fmt` | Reformat. Prints to stdout, or rewrites with `--write`. |
| `stf lint` | Warn about style and portability problems that are *not* errors. |
| `stf parse` | Print the parsed data model as tagged JSON. |
| `stf canon` | Print [STF Canonical Form](spec.md#14-canonical-form). |
| `stf convert` | Convert between STF and JSON. |
| `stf lsp` | Serve the Language Server Protocol over stdio, for editors. |

`FILE` may be `-`, or omitted, to read standard input.

### Exit codes

| Code | Meaning |
| :--- | :--- |
| `0` | Success. |
| `1` | An input was rejected, a lint warning fired, or `--check` found a difference. |
| `2` | Usage error. |

Errors are written to standard error in the form
`FILE:LINE:COLUMN: ERR_CODE: message`, so a script can branch on the normative code rather
than on message text. Only the code is normative (spec §16).

---

## 2. `check` — verify

```sh
stf check config.stf
stf check events.stfs
```

Reports the first error in a document. For a stream, it reports **every** malformed record with
its line number rather than stopping at the first, because stream §5 makes records independently
recoverable.

```
$ stf check bad.stfs
bad.stfs:2: ERR_MISSING_COLON: expected `:` after the key
bad.stfs:4: ERR_ROOT_NOT_OBJECT: a record root must be an object
```

## 3. `fmt` — format

```sh
stf fmt config.stf              # print the formatted document
stf fmt --write config.stf      # rewrite in place
stf fmt --check config.stf      # exit non-zero if it is not already formatted (for CI)
stf fmt --compact config.stf    # one line, no padding
stf fmt --indent 4 config.stf
```

Formatting preserves authored member order and never changes a value — the output always
reparses to a value equal to the input's (spec §13.1). It is idempotent.

Directives, being document metadata, are re-emitted before the root object. Comments are **not**
preserved: they are equivalent to whitespace (spec §4.2) and do not survive into the data model.

## 4. `lint` — beyond conformance

`lint` reports things a conformant document may still get wrong. It exits `1` if anything fires.

| Warning | Why |
| :--- | :--- |
| Unknown directive | Spec §5.1 says a parser MUST accept it and SHOULD warn. |
| A string that is exactly a `DATE` or `TIMESTAMP` payload | The JSON habit STF exists to remove: a reader cannot tell `` `2026-01-15` `` from a date. |
| A string of more than 15 digits that is a valid `BIGINT` | Usually an integer stringified to survive `JSON.parse`. |

```
$ stf lint config.stf
config.stf:1:1: warning: unknown directive `@nope`
config.stf:4:12: warning: created is a string that looks like a typed value; consider DATE(2026-01-15)
```

Warnings are positioned the way errors are — `FILE:LINE:COLUMN:` — and the same rules, with the
same positions, are what [`stf lsp`](#8-lsp--editor-integration) publishes to an editor.

Nothing here is an error, and none of it is inferred automatically — `fmt` and `convert` will
never rewrite a string into a constructor, because spec §13.2 forbids exactly that.

## 5. `parse` — inspect the data model

Prints the parsed value as **tagged JSON**, the encoding used by the conformance corpus. It
exists because plain JSON cannot distinguish STF's eleven kinds:

```
$ echo '{s: `1.5`, d: DECIMAL(1.5)}' | stf parse --compact
{"s":"1.5","d":{"$":"dec","v":"1.5"}}
```

The string and the decimal are visibly different, which is the point of spec §3.1. Tags are
`num`, `bigint`, `dec`, `date`, `ts`, and `bin`; `$` is safe as an escape key because it is not
a legal STF key character.

## 6. `canon` — canonical form

```sh
stf canon config.stf | sha256sum
```

Emits the single byte sequence spec §14 defines for the value: members sorted by UTF-8 key
bytes, no comments, no trailing commas, no whitespace, all strings interpreted. Two documents
that are equal under spec §3.2 produce identical output, which is what makes hashing and signing
meaningful.

For a stream, each record is canonicalized and record order is preserved — a stream is a
sequence, so reordering it would change the data (stream §7).

## 7. `convert` — STF and JSON

```sh
stf convert config.json --to stf
stf convert config.stf  --to json
stf convert events.ndjson -o events.stfs      # target inferred from the extension
stf convert events.stfs   -o events.jsonl
```

**Conversion is strict in both directions.** STF replaces JSON rather than extending it, so
anything the target cannot express is reported and refused, never repaired:

```
$ stf convert data.json --to stf
stf: data.json: ERR_UNREPRESENTABLE: $.id: integer 9007199254740993 is not exactly
representable as binary64; write it as BIGINT(9007199254740993) instead
```

JSON that STF refuses (migration guide §1.4): a non-object root, a key outside
`[A-Za-z0-9_-]+`, an empty key, and an integer outside the exact `binary64` range.

STF that JSON refuses: the five constructor kinds. `--lossy` writes their payloads as JSON
strings, which discards the type — the reader can no longer tell `DECIMAL(19.90)` from the
string `"19.90"`:

```sh
stf convert prices.stf --to json --lossy
```

Streams are converted line by line. A record that cannot be converted is reported with its line
number, per stream §8.

---

## 8. `lsp` — editor integration

```sh
stf lsp
```

Serves [LSP 3.17](https://microsoft.github.io/language-server-protocol/) over stdin/stdout.
Editors launch it; it is not useful to run by hand. There is nothing to configure, and it takes
no options — the document URI's extension selects the framing, so a `.stfs` file is diagnosed
per record rather than as one document with trailing content.

| Capability | Behaviour |
| :--- | :--- |
| `textDocument/publishDiagnostics` | Parse errors carrying their normative `ERR_*` code as the diagnostic code, plus `lint` warnings. Recomputed on open, change, and save. |
| `textDocument/formatting` | What `fmt` produces. The client's `tabSize` and `insertSpaces` choose the indent. A document that does not parse yields **no** edit, never a guess. |

Diagnostic positions are UTF-16 code unit offsets, the protocol's default encoding, which the
server advertises explicitly as `positionEncoding`.

Because the server, `check`, and `lint` all run the same parser, a document is never clean in
the editor and rejected in CI.

**Editor configuration**

Most clients need the command and the file extensions. For Neovim's built-in client:

```lua
vim.lsp.config.stf = {
  cmd = { 'stf', 'lsp' },
  filetypes = { 'stf' },
  root_markers = { '.git' },
}
vim.lsp.enable('stf')
```

The VS Code extension under [`vscode-stf/`](../vscode-stf/) still does its own heuristic
checking and does not yet launch this server.

---

## 9. Options

| Option | Applies to | Meaning |
| :--- | :--- | :--- |
| `--stream` | all | Treat inputs as `.stfs` records. Inferred from `.stfs`, `.ndjson`, `.jsonl`. |
| `-w`, `--write` | `fmt`, `canon` | Rewrite each file in place. |
| `--check` | `fmt`, `canon` | Exit non-zero if a file is not already formatted. |
| `--indent <N>` | `fmt` | Indent with N spaces. Default 2. |
| `--compact` | `fmt`, `parse`, `convert` | One line, no padding. |
| `--to <stf\|json>` | `convert` | Target format. |
| `-o`, `--output <PATH>` | `convert` | Write here instead of stdout. |
| `--lossy` | `convert` | Allow typed values to degrade to JSON strings. |
