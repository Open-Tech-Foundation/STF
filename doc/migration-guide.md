# Migration Guide: JSON to DTXT

Migrating from JSON to DTXT is straightforward but requires attention to literal changes and unquoted keys.

## Quick Reference Table

| Feature | JSON | DTXT |
| :--- | :--- | :--- |
| **Root** | Any value | Object `{}` always |
| **True** | `true` | `T` |
| **False** | `false` | `F` |
| **Null** | `null` | `N` |
| **Keys** | `"key"` (quoted) | `key` (unquoted) |
| **Strings** | `"string"` | `` `string` `` |
| **Comments** | N/A | `# comment` |
| **Commas** | No trailing | Trailing allowed |

## Step-by-Step Migration

### 1. Change the Root
In JSON, the root can be an array or a primitive. In DTXT, it **must** be an object.
- **JSON**: `[1, 2, 3]`
- **DTXT**: `{ data: [1, 2, 3] }`

### 2. Update Boolean and Null Literals
DTXT uses single-character, uppercase literals for speed.
- `true` → `T`
- `false` → `F`
- `null` → `N`

### 3. Remove Quotes from Keys
DTXT keys are unquoted identifiers.
- **JSON**: `"user_id": 123`
- **DTXT**: `user_id: 123`

> [!NOTE]
> DTXT keys are restricted to ASCII letters, digits, and underscores. If your JSON keys contain special characters (like dots or spaces), you must rename them or nest them.

### 4. Switch to Backticks for Strings
All strings in DTXT use backticks.
- **JSON**: `"Hello World"`
- **DTXT**: `` `Hello World` ``

### 5. Take Advantage of Constructors
DTXT provides explicit types for data that JSON usually treats as strings.

#### Dates
- **JSON**: `"2026-01-15T10:00:00Z"`
- **DTXT**: `Date(2026-01-15T10:00:00Z)`

#### Big Integers
JSON often loses precision with large numbers or requires strings.
- **JSON**: `"9007199254740993"` (string)
- **DTXT**: `BigNumber(9007199254740993)`

#### Binary Data
- **JSON**: `"aGVsbG8="` (base64)
- **DTXT**: `Binary(68656C6C6F)` (hex)

## Example Transformation

### Before (JSON)
```json
{
  "project": "DTXT",
  "version": 1.0,
  "stable": false,
  "config": {
    "retry_count": 3
  },
  "tags": ["data", "format"]
}
```

### After (DTXT)
```dtxt
{
  project: `DTXT`,
  version: 1.0,
  stable: F,
  config: {
    retry_count: 3,
  },
  tags: [`data`, `format`],
}
```
