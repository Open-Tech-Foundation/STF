# DTXT Support for VS Code

Provides syntax highlighting, validation, and basic language support for DTXT (Data Text Format) files.

## Features

### Syntax Highlighting
- Full TextMate grammar support
- GitHub syntax highlighting (when using the grammar)
- Color-coded tokens for:
  - Objects and arrays
  - Strings (backtick and double-quoted)
  - Numbers
  - Booleans (`T`, `F`)
  - Null (`N`)
  - Constructor literals (`Date()`, `BigNumber()`, `Binary()`)
  - Comments (`#`)

### Validation
- Real-time syntax checking
- Inline error reporting with diagnostic messages
- Support for DTXT error codes:
  - `ERR_SYNTAX` - Invalid syntax
  - `ERR_UNTERMINATED` - Unterminated strings or structures
  - `ERR_MISSING_COLON` - Missing colon after key
  - `ERR_UNBALANCED` - Unbalanced brackets

### Language Features
- Auto-closing pairs for brackets and strings
- Comment toggling with `#`
- Code folding based on `{ }` blocks
- File association with `.dtxt` extension

## Installation

### From VS Code Marketplace (Once Published)
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "DTXT Support"
4. Click Install

### From VSIX File
1. Download the `.vsix` file
2. Open VS Code
3. Go to Extensions, click `...` → "Install from VSIX..."

### From Source
```bash
cd vscode-dtxt
npm install
npm run compile
# Press F5 to launch Extension Development Host
```

## Usage

1. Create a file with `.dtxt` extension
2. Start writing DTXT code - syntax highlighting appears automatically
3. Errors are underlined in real-time
4. Hover over errors to see detailed messages

### Example DTXT File
```dtxt
# User configuration
user: {
    name: `Alice`
    age: 30
    active: T
    created: Date(2024-01-15T10:30:00Z)
    id: BigNumber(12345678901234567890)
    data: Binary(DEADBEEF)
}

# Settings
settings: {
    theme: `dark`
    notifications: T
}
```

## Commands

- **DTXT: Validate** - Manually trigger validation for the current file
  - Command ID: `dtxt.validate`
  - Shortcut: (Not bound by default)

## Configuration

Currently, no configuration options are available. Future versions may include:
- Validation strictness level
- Custom error suppression
- Formatting options

## Requirements

- VS Code 1.80.0 or higher

## Known Issues

1. **Validation is heuristic-based** - Currently uses basic syntax checking rather than full DTXT parser integration
2. **False positives** - Some valid DTXT syntax may trigger warnings
3. **No formatting** - Document formatting not yet implemented

## Release Notes

### 1.0.0
- Initial release
- Syntax highlighting with TextMate grammar
- Basic real-time validation
- Error code support
- Auto-closing pairs and comment toggling

## Contributing

This extension is part of the [DTXT project](https://github.com/Open-Tech-Foundation/DTXT).

To contribute:
1. Fork the repository
2. Create a feature branch
3. Make your changes in `vscode-dtxt/`
4. Submit a pull request

## License

CC0 1.0 Universal (CC0 1.0) Public Domain Dedication

---

**Enjoy DTXT!**
