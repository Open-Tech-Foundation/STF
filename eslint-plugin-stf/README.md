# eslint-plugin-dtxt

ESLint plugin for linting DTXT files.

## Installation

```bash
npm install --save-dev eslint eslint-plugin-dtxt
```

## Usage

Add to your ESLint configuration:

```javascript
// eslint.config.js
import dtxtPlugin from 'eslint-plugin-dtxt';

export default [
  {
    files: ['**/*.dtxt'],
    plugins: { dtxt: dtxtPlugin },
    languageOptions: {
      parser: dtxtPlugin.parser
    },
    rules: {
      'dtxt/no-unknown-constructor': 'error',
      'dtxt/no-duplicate-keys': 'error',
      'dtxt/no-invalid-numbers': 'error',
    }
  }
];
```

## Rules

| Rule | Description |
|------|-------------|
| `no-unknown-constructor` | Disallows unknown constructor types (only Date, BigNumber, Binary allowed) |
| `no-duplicate-keys` | Disallows duplicate keys in DTXT objects |
| `no-invalid-numbers` | Disallows invalid number formats (leading zeros, trailing dots) |

## Example

```dtxt
# This will trigger errors
{
  name: `Test`,
  name: `Duplicate`,  # Error: duplicate key
  value: InvalidType(123),  # Error: unknown constructor
  count: 0123,  # Error: leading zero
}
```
