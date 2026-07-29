// GENERATED from doc/*.md by scripts/gen-spec.ts. Do not edit.
// Edit the Markdown under doc/, then run `tsr spec` from the repository root.
export interface SpecEntry { id: string; text: string; sub: boolean }
export interface SpecGroup { group: string; note: string; id: string; entries: SpecEntry[] }
export const CONTENTS: SpecGroup[] = [
  {
    "group": "STF 1.0",
    "note": "The format itself. Required of every implementation.",
    "id": "stf-1-0",
    "entries": [
      {
        "id": "stf-1-0",
        "text": "STF 1.0",
        "sub": false
      },
      {
        "id": "1-overview",
        "text": "1. Overview",
        "sub": false
      },
      {
        "id": "1-1-conformance-language",
        "text": "1.1 Conformance Language",
        "sub": true
      },
      {
        "id": "1-2-media-type-and-file-extension",
        "text": "1.2 Media Type and File Extension",
        "sub": true
      },
      {
        "id": "1-3-non-goals",
        "text": "1.3 Non-Goals",
        "sub": true
      },
      {
        "id": "1-4-supplementary-documentation",
        "text": "1.4 Supplementary Documentation",
        "sub": true
      },
      {
        "id": "2-character-encoding",
        "text": "2. Character Encoding",
        "sub": false
      },
      {
        "id": "3-data-model",
        "text": "3. Data Model",
        "sub": false
      },
      {
        "id": "3-1-type-distinctness-critical",
        "text": "3.1 Type Distinctness (Critical)",
        "sub": true
      },
      {
        "id": "3-2-equality",
        "text": "3.2 Equality",
        "sub": true
      },
      {
        "id": "4-whitespace-and-comments",
        "text": "4. Whitespace and Comments",
        "sub": false
      },
      {
        "id": "4-1-whitespace",
        "text": "4.1 Whitespace",
        "sub": true
      },
      {
        "id": "4-2-comments",
        "text": "4.2 Comments",
        "sub": true
      },
      {
        "id": "5-document-structure",
        "text": "5. Document Structure",
        "sub": false
      },
      {
        "id": "5-1-directives",
        "text": "5.1 Directives",
        "sub": true
      },
      {
        "id": "6-keys",
        "text": "6. Keys",
        "sub": false
      },
      {
        "id": "6-1-key-syntax",
        "text": "6.1 Key Syntax",
        "sub": true
      },
      {
        "id": "6-2-disallowed-in-keys",
        "text": "6.2 Disallowed in Keys",
        "sub": true
      },
      {
        "id": "6-3-key-disambiguation-vs-constructors",
        "text": "6.3 Key Disambiguation vs Constructors",
        "sub": true
      },
      {
        "id": "7-numbers",
        "text": "7. Numbers",
        "sub": false
      },
      {
        "id": "7-1-grammar",
        "text": "7.1 Grammar",
        "sub": true
      },
      {
        "id": "7-2-value-domain-and-precision",
        "text": "7.2 Value Domain and Precision",
        "sub": true
      },
      {
        "id": "7-3-overflow-and-non-finite-values",
        "text": "7.3 Overflow and Non-Finite Values",
        "sub": true
      },
      {
        "id": "7-4-token-boundaries",
        "text": "7.4 Token Boundaries",
        "sub": true
      },
      {
        "id": "8-strings",
        "text": "8. Strings",
        "sub": false
      },
      {
        "id": "8-1-raw-strings-backticks",
        "text": "8.1 Raw Strings (Backticks)",
        "sub": true
      },
      {
        "id": "8-2-interpreted-strings-double-quotes",
        "text": "8.2 Interpreted Strings (Double Quotes)",
        "sub": true
      },
      {
        "id": "8-3-surrogates",
        "text": "8.3 Surrogates",
        "sub": true
      },
      {
        "id": "8-4-control-characters",
        "text": "8.4 Control Characters",
        "sub": true
      },
      {
        "id": "9-boolean-and-null-literals",
        "text": "9. Boolean and Null Literals",
        "sub": false
      },
      {
        "id": "10-constructor-literals",
        "text": "10. Constructor Literals",
        "sub": false
      },
      {
        "id": "10-1-general-syntax",
        "text": "10.1 General Syntax",
        "sub": true
      },
      {
        "id": "10-2-decimal-exact-decimal",
        "text": "10.2 `DECIMAL(...)` — Exact Decimal",
        "sub": true
      },
      {
        "id": "10-3-bigint-arbitrary-precision-integer",
        "text": "10.3 `BIGINT(...)` — Arbitrary-Precision Integer",
        "sub": true
      },
      {
        "id": "10-4-temporal-constructors",
        "text": "10.4 Temporal Constructors",
        "sub": true
      },
      {
        "id": "10-5-binary-octet-sequence",
        "text": "10.5 `BINARY(...)` — Octet Sequence",
        "sub": true
      },
      {
        "id": "11-arrays-and-objects",
        "text": "11. Arrays and Objects",
        "sub": false
      },
      {
        "id": "11-1-arrays",
        "text": "11.1 Arrays",
        "sub": true
      },
      {
        "id": "11-2-objects",
        "text": "11.2 Objects",
        "sub": true
      },
      {
        "id": "11-3-nesting-depth",
        "text": "11.3 Nesting Depth",
        "sub": true
      },
      {
        "id": "12-grammar-summary",
        "text": "12. Grammar Summary",
        "sub": false
      },
      {
        "id": "13-serialization",
        "text": "13. Serialization",
        "sub": false
      },
      {
        "id": "13-1-round-trip-critical",
        "text": "13.1 Round-Trip (Critical)",
        "sub": true
      },
      {
        "id": "13-2-strings-are-never-constructors",
        "text": "13.2 Strings Are Never Constructors",
        "sub": true
      },
      {
        "id": "13-3-choice-of-string-form",
        "text": "13.3 Choice of String Form",
        "sub": true
      },
      {
        "id": "13-4-numbers",
        "text": "13.4 Numbers",
        "sub": true
      },
      {
        "id": "13-5-escaping",
        "text": "13.5 Escaping",
        "sub": true
      },
      {
        "id": "13-6-keys",
        "text": "13.6 Keys",
        "sub": true
      },
      {
        "id": "13-7-typed-values",
        "text": "13.7 Typed Values",
        "sub": true
      },
      {
        "id": "14-canonical-form",
        "text": "14. Canonical Form",
        "sub": false
      },
      {
        "id": "15-resource-limits",
        "text": "15. Resource Limits",
        "sub": false
      },
      {
        "id": "16-error-reporting",
        "text": "16. Error Reporting",
        "sub": false
      }
    ]
  },
  {
    "group": "STF Stream 1.0",
    "note": "Optional profile — .stfs record streams.",
    "id": "stream",
    "entries": [
      {
        "id": "stream",
        "text": "STF Stream 1.0",
        "sub": false
      },
      {
        "id": "stream-1-overview",
        "text": "1. Overview",
        "sub": false
      },
      {
        "id": "stream-1-1-design-properties",
        "text": "1.1 Design Properties",
        "sub": true
      },
      {
        "id": "stream-1-2-media-type-and-file-extension",
        "text": "1.2 Media Type and File Extension",
        "sub": true
      },
      {
        "id": "stream-1-3-conformance-language",
        "text": "1.3 Conformance Language",
        "sub": true
      },
      {
        "id": "stream-2-stream-structure",
        "text": "2. Stream Structure",
        "sub": false
      },
      {
        "id": "stream-2-1-line-numbering",
        "text": "2.1 Line Numbering",
        "sub": true
      },
      {
        "id": "stream-3-records",
        "text": "3. Records",
        "sub": false
      },
      {
        "id": "stream-3-1-records-are-not-homogeneous",
        "text": "3.1 Records Are Not Homogeneous",
        "sub": true
      },
      {
        "id": "stream-3-2-line-terminators-inside-records-critical",
        "text": "3.2 Line Terminators Inside Records (Critical)",
        "sub": true
      },
      {
        "id": "stream-4-stream-header",
        "text": "4. Stream Header",
        "sub": false
      },
      {
        "id": "stream-5-error-handling-and-recovery",
        "text": "5. Error Handling and Recovery",
        "sub": false
      },
      {
        "id": "stream-6-additional-error-codes",
        "text": "6. Additional Error Codes",
        "sub": false
      },
      {
        "id": "stream-6-1-condition-code",
        "text": "6.1 Condition → Code",
        "sub": true
      },
      {
        "id": "stream-7-canonical-form",
        "text": "7. Canonical Form",
        "sub": false
      },
      {
        "id": "stream-8-interoperability-note",
        "text": "8. Interoperability Note",
        "sub": false
      }
    ]
  },
  {
    "group": "STF Schema 1.0",
    "note": "Optional profile — validation.",
    "id": "schema",
    "entries": [
      {
        "id": "schema",
        "text": "STF Schema 1.0",
        "sub": false
      },
      {
        "id": "schema-1-overview",
        "text": "1. Overview",
        "sub": false
      },
      {
        "id": "schema-1-1-conformance-language",
        "text": "1.1 Conformance Language",
        "sub": true
      },
      {
        "id": "schema-1-2-file-extension-and-association",
        "text": "1.2 File Extension and Association",
        "sub": true
      },
      {
        "id": "schema-2-document-shape",
        "text": "2. Document Shape",
        "sub": false
      },
      {
        "id": "schema-3-schema-nodes",
        "text": "3. Schema Nodes",
        "sub": false
      },
      {
        "id": "schema-4-types",
        "text": "4. Types",
        "sub": false
      },
      {
        "id": "schema-5-constraint-keywords",
        "text": "5. Constraint Keywords",
        "sub": false
      },
      {
        "id": "schema-5-1-optional-and-nullable",
        "text": "5.1 `optional` and `nullable`",
        "sub": true
      },
      {
        "id": "schema-5-2-min-and-max",
        "text": "5.2 `min` and `max`",
        "sub": true
      },
      {
        "id": "schema-5-3-scale",
        "text": "5.3 `scale`",
        "sub": true
      },
      {
        "id": "schema-5-4-integer",
        "text": "5.4 `integer`",
        "sub": true
      },
      {
        "id": "schema-5-5-items-fields-and-additional",
        "text": "5.5 `items`, `fields`, and `additional`",
        "sub": true
      },
      {
        "id": "schema-5-6-const-and-enum",
        "text": "5.6 `const` and `enum`",
        "sub": true
      },
      {
        "id": "schema-6-equality-and-ordering-families",
        "text": "6. Equality and Ordering Families",
        "sub": false
      },
      {
        "id": "schema-7-validation-semantics",
        "text": "7. Validation Semantics",
        "sub": false
      },
      {
        "id": "schema-8-error-codes",
        "text": "8. Error Codes",
        "sub": false
      },
      {
        "id": "schema-9-complete-example",
        "text": "9. Complete Example",
        "sub": false
      }
    ]
  },
  {
    "group": "Error codes",
    "note": "The normative registry referenced by §16.",
    "id": "errors",
    "entries": [
      {
        "id": "errors",
        "text": "Error codes",
        "sub": false
      },
      {
        "id": "errors-1-code-index",
        "text": "1. Code Index",
        "sub": false
      },
      {
        "id": "errors-encoding",
        "text": "Encoding",
        "sub": true
      },
      {
        "id": "errors-general-syntax",
        "text": "General Syntax",
        "sub": true
      },
      {
        "id": "errors-structure",
        "text": "Structure",
        "sub": true
      },
      {
        "id": "errors-identifiers",
        "text": "Identifiers",
        "sub": true
      },
      {
        "id": "errors-primitive-values",
        "text": "Primitive Values",
        "sub": true
      },
      {
        "id": "errors-constructors",
        "text": "Constructors",
        "sub": true
      },
      {
        "id": "errors-resource-limits",
        "text": "Resource Limits",
        "sub": true
      },
      {
        "id": "errors-serialization",
        "text": "Serialization",
        "sub": true
      },
      {
        "id": "errors-stream-profile",
        "text": "Stream Profile",
        "sub": true
      },
      {
        "id": "errors-schema-validation",
        "text": "Schema Validation",
        "sub": true
      },
      {
        "id": "errors-2-condition-code-normative",
        "text": "2. Condition → Code (Normative)",
        "sub": false
      },
      {
        "id": "errors-2-1-encoding-and-document-framing",
        "text": "2.1 Encoding and document framing",
        "sub": true
      },
      {
        "id": "errors-2-2-objects-arrays-keys",
        "text": "2.2 Objects, arrays, keys",
        "sub": true
      },
      {
        "id": "errors-2-3-numbers",
        "text": "2.3 Numbers",
        "sub": true
      },
      {
        "id": "errors-2-4-literals",
        "text": "2.4 Literals",
        "sub": true
      },
      {
        "id": "errors-2-5-strings",
        "text": "2.5 Strings",
        "sub": true
      },
      {
        "id": "errors-2-6-constructors-general",
        "text": "2.6 Constructors — general",
        "sub": true
      },
      {
        "id": "errors-2-7-decimal",
        "text": "2.7 `DECIMAL`",
        "sub": true
      },
      {
        "id": "errors-2-8-bigint",
        "text": "2.8 `BIGINT`",
        "sub": true
      },
      {
        "id": "errors-2-9-date-and-timestamp",
        "text": "2.9 `DATE` and `TIMESTAMP`",
        "sub": true
      },
      {
        "id": "errors-2-10-binary",
        "text": "2.10 `BINARY`",
        "sub": true
      },
      {
        "id": "errors-2-11-serialization",
        "text": "2.11 Serialization",
        "sub": true
      },
      {
        "id": "errors-3-changes-from-pre-release-drafts",
        "text": "3. Changes from Pre-Release Drafts",
        "sub": false
      }
    ]
  }
];
