# DTXT Error Code Standard (1.0)

To provide consistent feedback across different implementations, DTXT parsers SHOULD use the following standardized error codes.

## General Syntax Errors
- **`ERR_SYNTAX`**: General parsing failure when no more specific error applies.
- **`ERR_UNTERMINATED`**: Input ended prematurely (e.g., missing `}`, `]`, or `` ` ``).

## Structural Errors
- **`ERR_ROOT_NOT_OBJECT`**: The document root is not a `{}` delimited object.
- **`ERR_DUPLICATE_KEY`**: An object contains multiple members with the same identifier.
- **`ERR_MISSING_COLON`**: Expected `:` after a key.
- **`ERR_MISSING_COMMA`**: Expected `,` between members or elements.

## Identifier Errors
- **`ERR_INVALID_IDENTIFIER`**: Key contains characters not allowed by the specification (e.g., dots, spaces, quotes, non-ASCII).

## Primitive Value Errors
- **`ERR_INVALID_NUMBER`**: Number literal does not follow the JSON-derived grammar (e.g., leading zeros, invalid exponent).
- **`ERR_INVALID_STRING`**: String literal contains forbidden characters (e.g., internal backticks).

## Constructor Errors
- **`ERR_UNKNOWN_CONSTRUCTOR`**: Constructor name (e.g., `XYZ(...)` or old short forms like `D(...)`, `BN(...)`, `B(...)`) is not defined in the standard.
- **`ERR_INVALID_CONSTRUCTOR_PAYLOAD`**: The payload inside `(...)` does not match the requirements for that specific type (e.g., non-numeric characters in `BigNumber()`, or **odd-length hexadecimal string** in `Binary()`).
- **`ERR_NESTED_CONSTRUCTOR`**: A constructor literal was found inside the payload of another constructor.

## Resource Limits
- **`ERR_NESTING_DEPTH`**: The document exceeds the implementation's maximum allowed nesting depth.
- **`ERR_DOCUMENT_SIZE`**: The document exceeds the maximum allowed byte size.
- **`ERR_PAYLOAD_SIZE`**: A constructor payload exceeds the maximum allowed size.
