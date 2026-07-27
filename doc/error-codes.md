# STF Error Code Standard (1.0)

Standardized error codes for STF parsers and schema validators.

## General Syntax Errors
- **`ERR_SYNTAX`**: General parsing failure.
- **`ERR_UNTERMINATED`**: Input ended prematurely.

## Structural Errors
- **`ERR_ROOT_NOT_OBJECT`**: Root is not a `{}` object.
- **`ERR_DUPLICATE_KEY`**: Object contains duplicate member identifiers.
- **`ERR_MISSING_COLON`**: Expected `:` after a key.
- **`ERR_MISSING_COMMA`**: Expected `,` between members or elements.

## Identifier Errors
- **`ERR_INVALID_IDENTIFIER`**: Key contains forbidden characters.

## Primitive Value Errors
- **`ERR_INVALID_NUMBER`**: Invalid number literal syntax.
- **`ERR_INVALID_STRING`**: Invalid string literal or illegal newline.

## Constructor Errors
- **`ERR_UNKNOWN_CONSTRUCTOR`**: Constructor name (e.g. `CUSTOM(...)`, lowercase/mixed-case like `Date(...)`, `BigNumber(...)`) is unknown.
- **`ERR_INVALID_CONSTRUCTOR_PAYLOAD`**: Payload does not match requirements (e.g. time component in `DATE`, missing offset in `TIMESTAMP`, non-canonical Base64 in `BINARY`).
- **`ERR_NESTED_CONSTRUCTOR`**: Nested constructor payload.
- **`ERR_DECIMAL_OVERFLOW`**: `DECIMAL` exceeds 34 significant digits.

## Schema Validation Errors
- **`ERR_SCHEMA_SCALE_MISMATCH`**: Decimal scale does not match required `scale` constraint. Message MUST indicate expected vs actual scale.
- **`ERR_SCHEMA_TYPE_MISMATCH`**: Value type does not match required schema type.

## Resource Limits
- **`ERR_NESTING_DEPTH`**: Exceeds maximum nesting depth (default 64).
- **`ERR_DOCUMENT_SIZE`**: Exceeds document size limit.
- **`ERR_PAYLOAD_SIZE`**: Exceeds constructor payload size limit.
