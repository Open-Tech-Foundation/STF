# DTXT Schema Specification (Draft)

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

> [!WARNING]
> This specification is in an **experimental draft** state and is subject to change. It is currently being shared for feedback and initial implementation testing.

---

## 1. Overview

DTXT Schema defines the structure and constraints for DTXT documents. A schema document is itself a valid DTXT document, using type expressions as values instead of data values.

Schema validation is **intentionally decoupled** from parsing for performance reasons. The recommended architecture is:

```
document → [DTXT Parser] → data structure → [Schema Validator] → result
```

The core DTXT parser has zero schema knowledge. Schema validation is a separate optional library:
* `dtxt` — core parser only
* `dtxt-schema` — optional validator, depends on `dtxt`

Applications opt-in explicitly. Validation is recommended at:
* Application startup (config loading)
* API ingress points
* CI/CD pipelines
* Developer tooling and language servers

Semantic validation (e.g. "date must be in future", "value must exist in database") is always the application's responsibility and outside DTXT Schema scope.

---

## 2. File Naming

Schema files use the `.schema.dtxt` extension:

```
myconfig.schema.dtxt
```

---

## 3. Schema Declaration

A schema is referenced from a data document via the `@schema` directive:

```dtxt
@schema(https://example.com/myconfig.schema.dtxt)
{
  name: `example`,
}
```

The `@schema` directive MUST appear before the root object in the data document.

---

## 4. Schema Document Structure

A schema document is a valid DTXT document where values are type expressions instead of data.

The schema document SHOULD declare its version using the `@schema-def` directive:

```dtxt
@schema-def(1.0)
{
  name: String,
}
```

---

## 5. Primitive Types

| Type | Description |
|------|-------------|
| `String` | UTF-8 text |
| `Int` | Integer number |
| `Float` | Floating-point number |
| `Bool` | Boolean (`T` or `F`) |
| `Date` | Date or datetime via `D(...)` |
| `BN` | Big number via `BN(...)` |
| `Binary` | Binary data via `B(...)` |
| `Any` | Any valid DTXT value |

---

## 6. Optional Fields

Use the `?` suffix to mark a field as optional:

```dtxt
{
  name: String,
  bio: String?,  # optional
}
```

Optional fields may be absent from the data document without causing a validation error.

---

## 7. Typed Arrays

Arrays are specified using `Array<Type>` syntax:

```dtxt
{
  tags: Array<String>,
  items: Array<Any>,
}
```

---

## 8. Constraints

Constraints are specified using parentheses after the type name.

### 8.1 String Constraints

```dtxt
{
  name: String(max:100),
  description: String(min:5, max:100),
}
```

* `min` — minimum length in characters
* `max` — maximum length in characters

### 8.2 Int Constraints

```dtxt
{
  age: Int(min:0, max:255),
}
```

* `min` — minimum value (inclusive)
* `max` — maximum value (inclusive)

### 8.3 Float Constraints

```dtxt
{
  score: Float(min:0.0),
  percentage: Float(min:0.0, max:100.0),
}
```

* `min` — minimum value (inclusive)
* `max` — maximum value (inclusive)

---

## 9. Unknown Keys

By default, unknown keys in data documents are **errors**.

To opt-in to allowing additional keys:

```dtxt
{
  name: String,
  *: Any,        # allow any additional keys untyped
}
```

You can also enforce a type for all additional keys:

```dtxt
{
  name: String,
  *: String,     # allow any additional keys but must be String type
}
```

---

## 10. Nested Objects

Nested objects are specified using inline object syntax:

```dtxt
{
  address: {
    street: String,
    zip: String,
  },
}
```

Wildcard keys and constraints work inside nested objects:

```dtxt
{
  meta: {
    retries: Int(min:0, max:10),
    enabled: Bool,
    *: Any,
  },
}
```

---

## 11. Full Example Schema

```dtxt
@schema-def(1.0)
{
  name: String,
  age: Int(min:0),
  bio: String?,
  created: Date,
  score: Float(min:0.0, max:100.0),
  balance: BN,
  avatar: Binary?,
  tags: Array<String>,
  meta: {
    retries: Int(min:0, max:10),
    enabled: Bool,
    *: Any,
  },
}
```

---

## 12. Validation Model

### 12.1 Decoupled Architecture

Schema validation is a separate pass after parsing. This keeps the core parser fast and allows applications to choose whether to validate.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ DTXT Source │────▶│ DTXT Parser │────▶│   Data      │
│             │     │  (dtxt)     │     │  Structure  │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │   Schema    │
                                        │ Validator  │
                                        │(dtxt-schema)│
                                        └──────┬──────┘
                                               │
                                               ▼
                                        ┌─────────────┐
                                        │ Validation  │
                                        │   Result    │
                                        └─────────────┘
```

### 12.2 Recommended Usage

* **Application startup** — Validate configuration files before use
* **API ingress** — Validate incoming data at service boundaries
* **CI/CD pipelines** — Validate configuration as part of deployment
* **Developer tooling** — Language servers and IDE extensions

### 12.3 Out of Scope

The following are **not** covered by DTXT Schema:
* Semantic validation (e.g., "date must be in the future")
* Cross-field validation (e.g., "end date must be after start date")
* Database or external service lookups
* Business logic rules

These are always the application's responsibility.

---

## 13. Error Reporting

Validators SHOULD report:
* Field path (e.g., `address.zip`)
* Expected type or constraint
* Actual value or error
* Line and column number when available from parser

---

## 14. Appendix A: Schema EBNF

```ebnf
(* DTXT Schema Grammar *)

schema_document = { directive } ws schema_object ws ;

schema_object   = "{" [ schema_member { "," schema_member } [ "," ] ] "}" ;
schema_member   = key ws ":" ws type_expr ;
type_expr       = primitive_type | array_type | schema_object ;

primitive_type  = "String" | "Int" | "Float" | "Bool" | "Date" | "BN" | "Binary" | "Any" ;
primitive_type  = primitive_type "?" ;
primitive_type  = primitive_type "(" constraint { "," constraint } ")" ;

array_type      = "Array" "<" type_expr ">" ;

constraint      = "min" ":" number | "max" ":" number ;

directive       = "@" identifier "(" directive-value ")" ;
```

---
