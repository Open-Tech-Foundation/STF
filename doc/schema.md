# STF Schema Specification

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

---

## 1. Overview

STF Schema defines the structural and type constraints for STF documents. A schema document is itself a valid STF document.

Schema validation is **decoupled** from parsing for performance:
```
document → [STF Parser] → data structure → [Schema Validator] → result
```

Libraries:
* `stf` — core parser
* `stf-schema` — optional validator

---

## 2. File Extension & Directives

Schema files use `.schema.stf`:
```stf
@schema(https://example.com/myconfig.schema.stf)
{
  name: `example`,
}
```

---

## 3. Primitive Types

| Type Keyword | Description |
|---|---|
| `String` | UTF-8 text |
| `Int` | Floating-point or 64-bit integer |
| `Float` | Floating-point number |
| `Bool` | Boolean (`T` or `F`) |
| `DATE` | Wall date via `DATE(...)` |
| `TIMESTAMP` | Instant via `TIMESTAMP(...)` |
| `BIGINT` | Arbitrary integer via `BIGINT(...)` |
| `DECIMAL` | Decimal number via `DECIMAL(...)` |
| `BINARY` | Binary data via `BINARY(...)` |
| `Any` | Any valid STF value |

---

## 4. Schema v1 Keywords & Constraints

STF Schema v1 supports four primary constraint keywords:
* `type`: Primitive type identifier (`String`, `Int`, `Float`, `Bool`, `DATE`, `TIMESTAMP`, `BIGINT`, `DECIMAL`, `BINARY`, `Any`)
* `scale`: Exact decimal scale (digits after `.`)
* `min`: Minimum numeric value or minimum length
* `max`: Maximum numeric value or maximum length

*Note*: `multipleOf` is intentionally omitted to avoid requiring decimal division in reference implementations; `scale: 2` handles monetary cases cleanly.

---

### 4.1 `scale` Constraint

The `scale` keyword enforces exact decimal scale matching:

```stf
{
  balance: DECIMAL(scale: 2),
}
```

#### Exact Scale Behavior (Common Trip-up)
The `scale` constraint is **exact**:
* `DECIMAL(1.50)` passes `scale: 2`.
* `DECIMAL(1.5)` **fails** `scale: 2` (expected scale 2, actual scale 1).

If a decimal value's scale does not match the required `scale`, validation MUST fail with error code `ERR_SCHEMA_SCALE_MISMATCH`. The error message MUST include the expected scale vs actual scale.

Rules:
* `scale: 0` is valid (e.g. `DECIMAL(100)`).
* `scale` ≤ 34.

---

### 4.2 Equality & Ordering Families

* **Equality Family** (`const`, `enum`): **Scale-sensitive**. `DECIMAL(1.5)` ≢ `DECIMAL(1.50)`.
* **Ordering Family** (`min`, `max`): **Numeric comparison**. `DECIMAL(1.50)` satisfies `min: DECIMAL(1.0)`.

---

## 5. Full Example Schema

```stf
@schema-def(1.0)
{
  name: String(min: 1, max: 100),
  price: DECIMAL(scale: 2, min: 0.00),
  created: DATE,
  updated: TIMESTAMP,
  count: BIGINT,
  avatar: BINARY?,
  tags: Array<String>,
}
```
