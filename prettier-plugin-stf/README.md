# prettier-plugin-dtxt

Prettier plugin for formatting DTXT files.

## Installation

```bash
npm install --save-dev prettier prettier-plugin-dtxt
```

## Usage

Create a `.prettierrc` file:

```json
{
  "plugins": ["prettier-plugin-dtxt"],
  "parser": "dtxt"
}
```

Or use via command line:

```bash
prettier --plugin=prettier-plugin-dtxt --parser=dtxt --write "**/*.dtxt"
```

## Features

- Formats DTXT files with proper indentation
- Sorts object keys lexicographically (canonical form)
- Handles trailing commas
- Supports all DTXT constructs: objects, arrays, constructors, strings, numbers, booleans, null

## Example

Input:
```dtxt
{name:`Test`,active:T,count:42,items:[1,2,3],meta:{b:2,a:1}}
```

Output:
```dtxt
{
  active: T,
  count: 42,
  items: [
    1,
    2,
    3,
  ],
  meta: {
    a: 1,
    b: 2,
  },
  name: `Test`,
}
```
