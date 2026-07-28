# STF Support for VS Code

Syntax highlighting, diagnostics, and formatting for
[STF](https://github.com/Open-Tech-Foundation/STF) — the Structured Text Format.

Diagnostics come from `stf lsp`, the language server built into the reference implementation,
so what the editor underlines is exactly what `stf check` and `stf lint` report in CI, with the
same normative error codes. The extension itself does no checking; it launches the server.

## Requirements

The **`stf` command-line tool** must be installed and on your `PATH`:

```sh
cargo install --path ref-impl/rust
```

Set `stf.server.path` if it lives somewhere else. VS Code 1.91 or higher.

## Features

- **Diagnostics** — every rejection carries its normative `ERR_*` code (`ERR_INVALID_NUMBER`,
  `ERR_DUPLICATE_KEY`, …), and `stf lint`'s warnings appear alongside: strings that should have
  been `DATE`, `TIMESTAMP`, or `BIGINT`, and unknown directives.
- **Formatting** — Format Document runs the same formatter as `stf fmt`, honouring your
  `editor.tabSize` and `editor.insertSpaces`. A file that does not parse is left alone rather
  than reformatted from a guess.
- **Streams** — `.stfs` files are diagnosed record by record, so one malformed line does not
  hide the rest of the file.
- **Syntax highlighting** — TextMate grammar covering objects, arrays, both string forms, the
  `T`/`F`/`N` literals, the five constructors, directives, and comments.
- **Editing** — auto-closing pairs, `#` comment toggling, and `{ }` folding.

## Example

```stf
# A configuration file
{
  service: `checkout-api`,
  port: 8080,
  enabled: T,
  deploy_after: TIMESTAMP(2026-01-15T10:30:00Z),
  price_cap: DECIMAL(199.00),
  account_id: BIGINT(9007199254740993),
  regions: [`eu-west-1`, `us-east-1`],
}
```

## Settings

| Setting | Default | Meaning |
| :--- | :--- | :--- |
| `stf.server.path` | `stf` | Path to the `stf` binary. |
| `stf.server.args` | `[]` | Extra arguments passed before `lsp`. |
| `stf.trace.server` | `off` | Log the traffic between VS Code and the server. |

## Commands

- **STF: Restart Language Server** (`stf.restartServer`) — after installing or upgrading the
  `stf` binary. Changing either `stf.server` setting restarts it automatically.

## Installation

**From a VSIX**: Extensions → `...` → "Install from VSIX…".

**From source**:

```sh
cd vscode-stf
npm install
npm run compile
# then press F5 to launch the Extension Development Host
```

## Release Notes

### 2.0.0

- Diagnostics and formatting now come from the `stf` language server, which requires the `stf`
  binary to be installed.
- Replaces the extension's own heuristic validator, which approximated the grammar with a
  bracket counter and so both missed real errors and flagged valid documents.
- `.stfs` stream files are recognised and diagnosed per record.
- Document formatting, which the previous release did not implement.

### 1.0.0

- Initial release: syntax highlighting, heuristic validation, auto-closing pairs.

## Contributing

Part of the [STF project](https://github.com/Open-Tech-Foundation/STF). Changes to this
extension live in `vscode-stf/`; run `npm test` before opening a pull request.

## License

CC0 1.0 Universal Public Domain Dedication.
