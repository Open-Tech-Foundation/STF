# STF Schema 1.0 — Validation Layer

**By the [Open Tech Foundation](https://github.com/Open-Tech-Foundation)**

> [!WARNING]
> This specification is in a **draft state** and is subject to change.

---

## 1. Overview

STF Schema describes the structural and type constraints of an [STF 1.0](spec.md) document.

**A schema document is itself an ordinary STF document.** It introduces no new syntax: no
generics, no suffix operators, no constraint call syntax. Everything is expressed with objects,
strings, and the constructor literals already defined in the core specification.

That is a deliberate constraint, not a limitation. Because a schema is plain STF:

* the core parser reads it — there is no second grammar to specify or implement;
* `stf fmt`, `stf lint`, editor support, and syntax highlighting work on schemas for free;
* constraint values are **real STF values**, so `min: DECIMAL(0.00)` carries its scale, and a
  timestamp bound is a `TIMESTAMP(...)` rather than a string to be re-parsed.

Validation is **decoupled** from parsing, so the cost is opt-in:

```
document → [STF parser] → data model → [schema validator] → result
```

| Library | Role |
| :--- | :--- |
| `stf` | Core parser. Never performs schema validation. |
| `stf-schema` | Optional validator. Raises only `ERR_SCHEMA_*` codes. |

### 1.1 Conformance Language

**MUST**, **MUST NOT**, **SHOULD**, **MAY**, and **OPTIONAL** are as described in
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and
[RFC 8174](https://www.rfc-editor.org/rfc/rfc8174).

### 1.2 File Extension and Association

Schema files use `.schema.stf`. A data document associates itself with a schema using the
`@schema` directive (spec §5.1):

```stf
@schema(https://example.com/product.schema.stf)
{
  name: `Widget`,
}
```

A schema document declares itself with `@schema-def`, whose payload is the schema language
version:

```stf
@schema-def(1.0)
{
  name: { type: `String` },
}
```

`@schema-def` is REQUIRED in a schema document. Its absence is `ERR_SCHEMA_INVALID`.

---

## 2. Document Shape

The **root of a schema document is a field map**: each key names a field of the document being
validated, and each value is a **schema node** (§3).

```stf
@schema-def(1.0)
{
  name:    { type: `String`, min: 1, max: 100 },
  price:   { type: `DECIMAL`, scale: 2, min: DECIMAL(0.00) },
  created: { type: `Date` },
  updated: { type: `Timestamp` },
  count:   { type: `BigInt` },
  avatar:  { type: `Binary`, optional: T },
  tags:    { type: `Array`, items: { type: `String` } },
}
```

The root is a field map rather than a schema node because the root of an STF document is
**always** an object (spec §5) — its type is not in question. Everywhere below the root, a
schema is a node.

To constrain the root itself, use the reserved key `_` , whose value is a schema node with
`type: `Object`` applied to the root:

```stf
@schema-def(1.0)
{
  _: { additional: F },        # reject unknown top-level keys
  name: { type: `String` },
}
```

`_` is a legal STF identifier (spec §6.1) and is reserved by this specification for that
purpose. A document field literally named `_` cannot be constrained; rename it.

---

## 3. Schema Nodes

A schema node is an STF object. Every node MAY carry `type` and the general keywords of §4.
A node with no `type` accepts any value, equivalent to `type: `Any``.

```stf
{ type: `String`, min: 1, max: 100 }
```

An unknown keyword in a schema node **MUST** be rejected with `ERR_SCHEMA_INVALID`. Silently
ignoring it would let a typo disable a constraint.

---

## 4. Types

`type` is a **string** naming one of the eleven kinds of the STF data model (spec §3), or `Any`.

| `type` | Matches | Notes |
| :--- | :--- | :--- |
| `` `Null` `` | `N` | |
| `` `Boolean` `` | `T`, `F` | |
| `` `Number` `` | a bare number | IEEE 754 binary64 (spec §7.2) |
| `` `String` `` | either string form | the form is not data |
| `` `Array` `` | `[...]` | see `items` |
| `` `Object` `` | `{...}` | see `fields` |
| `` `BigInt` `` | `BIGINT(...)` | |
| `` `Decimal` `` | `DECIMAL(...)` | see `scale` |
| `` `Date` `` | `DATE(...)` | |
| `` `Timestamp` `` | `TIMESTAMP(...)` | |
| `` `Binary` `` | `BINARY(...)` | |
| `` `Any` `` | any value | |

Type names are written in **TitleCase** and are case-sensitive. They are ordinary STF strings,
so they never collide with the reserved uppercase constructor namespace of spec §10.1.

Matching is by **kind, not by coincidence of text**. A `String` value never satisfies
`type: `Decimal``, even if its text happens to read `1.50`. A value whose kind differs from
`type` **MUST** be rejected with `ERR_SCHEMA_TYPE_MISMATCH`.

There is no `Int` or `Float` type. Bare numbers are a single kind; use `integer: T` (§5.4) to
require an integral value.

---

## 5. Constraint Keywords

STF Schema 1.0 defines eleven keywords. The set is intentionally small.

| Keyword | Applies to | Value |
| :--- | :--- | :--- |
| `type` | all | type name (§4) |
| `optional` | all | `T` / `F` — default `F` |
| `nullable` | all | `T` / `F` — default `F` |
| `const` | all | an exact value |
| `enum` | all | array of permitted values |
| `min` | `Number` `BigInt` `Decimal` `Date` `Timestamp` `String` `Array` | bound |
| `max` | same as `min` | bound |
| `integer` | `Number` | `T` / `F` — default `F` |
| `scale` | `Decimal` | integer 0–6143 |
| `items` | `Array` | a schema node |
| `fields` | `Object` | a field map |
| `additional` | `Object` | `T` / `F` — default `T` |

> `pattern` (regular-expression matching) and `multipleOf` are intentionally **not** in 1.0.
> `multipleOf` would require decimal division in every implementation; `scale` covers the
> monetary case it was wanted for. `pattern` would pull a regular-expression engine and its
> dialect differences into a validator whose whole appeal is that it is small.

### 5.1 `optional` and `nullable`

These are distinct and orthogonal:

* `optional: T` — the **key may be absent**. A missing key with `optional: F` is
  `ERR_SCHEMA_REQUIRED`.
* `nullable: T` — the value **may be `N`**. An `N` value with `nullable: F` is
  `ERR_SCHEMA_TYPE_MISMATCH`.

```stf
{
  nickname:  { type: `String`, optional: T },              # may be absent
  deleted_at:{ type: `Timestamp`, nullable: T },           # must be present, may be N
  middle:    { type: `String`, optional: T, nullable: T }, # either
}
```

### 5.2 `min` and `max`

Meaning depends on the type:

| Type | `min` / `max` mean | Bound is |
| :--- | :--- | :--- |
| `Number`, `BigInt`, `Decimal` | value bounds, inclusive | a numeric value |
| `Date`, `Timestamp` | chronological bounds, inclusive | a `DATE(...)` / `TIMESTAMP(...)` |
| `String` | length in **Unicode scalar values** | a `Number` |
| `Array` | element count | a `Number` |

String length counts scalar values, not bytes and not UTF-16 code units, so `"😀"` has length 1
in every implementation.

The bound **SHOULD** be written in the type being constrained: `min: DECIMAL(0.00)` for a
`Decimal` field. A bound of a different numeric kind is compared numerically. A bound that is
not comparable to the type is `ERR_SCHEMA_INVALID`.

A value outside its bounds is `ERR_SCHEMA_RANGE`.

### 5.3 `scale`

`scale` requires an **exact** decimal scale — the digit count after the decimal point.

```stf
{ balance: { type: `Decimal`, scale: 2 } }
```

* `DECIMAL(1.50)` **passes** `scale: 2`.
* `DECIMAL(1.5)` **fails** `scale: 2` — expected scale 2, actual scale 1.
* `DECIMAL(1.500)` **fails** `scale: 2`.
* `scale: 0` is valid and requires an integral spelling, e.g. `DECIMAL(100)`.
* `scale` ranges 0–6143, matching spec §10.2. (Coefficient precision is capped separately at 34
  significant digits; scale and significant digits are different quantities.)

A scale mismatch is `ERR_SCHEMA_SCALE_MISMATCH`, and the message **MUST** state expected versus
actual scale.

### 5.4 `integer`

`integer: T` requires a `Number` to have no fractional part. `{a: 3}` and `{a: 3.0}` both pass;
`{a: 3.5}` is `ERR_SCHEMA_RANGE`.

This does not make the value exact — it is still binary64. Use `BigInt` when exactness matters.

### 5.5 `items`, `fields`, and `additional`

```stf
@schema-def(1.0)
{
  tags: { type: `Array`, items: { type: `String`, min: 1 } },

  address: {
    type: `Object`,
    additional: F,
    fields: {
      city:     { type: `String` },
      postcode: { type: `String`, optional: T },
    },
  },
}
```

* `items` applies one schema node to **every** element. Tuple typing is not supported in 1.0.
* `fields` is a field map, exactly as at the root (§2).
* `additional: F` rejects keys not named in `fields`, with `ERR_SCHEMA_UNKNOWN_FIELD`. The
  default is `T`.
* An `Object` node without `fields` constrains only the kind.

### 5.6 `const` and `enum`

`const` requires an exact value; `enum` requires membership in a list.

```stf
{
  currency: { type: `String`, enum: [`GBP`, `EUR`, `USD`] },
  version:  { const: 1 },
  rate:     { type: `Decimal`, enum: [DECIMAL(0.00), DECIMAL(0.05), DECIMAL(0.20)] },
}
```

A failure is `ERR_SCHEMA_ENUM`.

---

## 6. Equality and Ordering Families

Two comparison rules apply, and the difference is observable for decimals and timestamps.

**Equality family** — `const`, `enum`. Uses **data-model equality** (spec §3.2), which is
scale-sensitive and offset-sensitive:

* `DECIMAL(1.50)` does **not** match `enum: [DECIMAL(1.5)]`.
* `TIMESTAMP(2026-01-15T10:00:00Z)` does **not** match
  `const: TIMESTAMP(2026-01-15T15:30:00+05:30)`, though they are the same instant.

**Ordering family** — `min`, `max`. Uses **numeric and chronological comparison**:

* `DECIMAL(1.50)` **satisfies** `min: DECIMAL(1.0)`.
* `TIMESTAMP(2026-01-15T15:30:00+05:30)` **satisfies**
  `max: TIMESTAMP(2026-01-15T10:00:00Z)` — the offsets are normalised before comparing.

This split is deliberate: an enumeration of permitted values is about the exact value written,
whereas a bound is about magnitude.

> **Implementation note.** Native `==` on Python `Decimal`, Go `shopspring/decimal`, and Rust
> `rust_decimal` compares numerically, so `1.5 == 1.50` is true. The equality family **MUST NOT**
> use it — compare coefficient and scale.

---

## 7. Validation Semantics

* Validation operates on the **data model** (spec §3), never on document text. Comments,
  whitespace, member order, and the choice of string form are invisible to a validator.
* Validation is **order-independent**: the result does not depend on the order of members in the
  document or of keys in the schema.
* A validator **SHOULD** report **all** violations, not only the first, each with a path such as
  `$.address.postcode` and its error code.
* A validator **MUST NOT** modify the document: no defaults are applied, no values coerced. The
  format has no coercion, and a validator that added it would reintroduce the ambiguity STF
  exists to remove.
* Validating the **schema document itself** happens before validating any data. A malformed
  schema is `ERR_SCHEMA_INVALID` and **MUST NOT** be reported as a data error.

---

## 8. Error Codes

Defined normatively in [error-codes.md](error-codes.md). Raised only by a validator, never by a
core parser.

| Code | Raised when |
| :--- | :--- |
| `ERR_SCHEMA_INVALID` | The schema document is malformed, or a keyword or bound is unusable. |
| `ERR_SCHEMA_TYPE_MISMATCH` | Value kind does not match `type`, or `N` with `nullable: F`. |
| `ERR_SCHEMA_REQUIRED` | A key with `optional: F` is absent. |
| `ERR_SCHEMA_RANGE` | `min`, `max`, or `integer` violated. |
| `ERR_SCHEMA_SCALE_MISMATCH` | `scale` violated. Message states expected vs actual. |
| `ERR_SCHEMA_ENUM` | `const` or `enum` violated. |
| `ERR_SCHEMA_UNKNOWN_FIELD` | A key is not in `fields` and `additional: F`. |

---

## 9. Complete Example

```stf
@schema-def(1.0)
{
  _: { additional: F },

  id:       { type: `BigInt`, min: BIGINT(1) },
  sku:      { type: `String`, min: 3, max: 32 },
  name:     { type: `String`, min: 1, max: 100 },
  price:    { type: `Decimal`, scale: 2, min: DECIMAL(0.00) },
  currency: { type: `String`, enum: [`GBP`, `EUR`, `USD`] },
  weight_g: { type: `Number`, integer: T, min: 0 },
  released: { type: `Date`, min: DATE(2000-01-01) },
  updated:  { type: `Timestamp` },
  retired:  { type: `Timestamp`, nullable: T },
  avatar:   { type: `Binary`, optional: T },
  tags:     { type: `Array`, max: 10, items: { type: `String`, min: 1 } },

  supplier: {
    type: `Object`,
    additional: F,
    fields: {
      name:    { type: `String` },
      country: { type: `String`, min: 2, max: 2 },
    },
  },
}
```

A document this schema accepts:

```stf
@schema(product.schema.stf)
{
  id: BIGINT(90071992547409931),
  sku: `WIDGET-001`,
  name: `Widget`,
  price: DECIMAL(19.99),
  currency: `GBP`,
  weight_g: 250,
  released: DATE(2026-01-15),
  updated: TIMESTAMP(2026-01-15T10:30:00Z),
  retired: N,
  tags: [`tools`, `hardware`],
  supplier: {
    name: `Acme Ltd`,
    country: `GB`,
  },
}
```
