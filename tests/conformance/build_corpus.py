#!/usr/bin/env python3
"""Author the STF 1.0 conformance corpus.

Source of truth for tests/conformance/corpus.json. Every case traces to a normative rule
in doc/spec.md or a row in doc/error-codes.md. See README.md for the case format.

Usage: python3 tests/conformance/build_corpus.py
"""

import json
import os

CASES = []


def _add(name, group, inp, note=None, profile=None, **outcome):
    case = {"name": name, "group": group, "input": inp}
    case.update(outcome)
    if profile:
        case["profile"] = profile
    if note:
        case["note"] = note
    CASES.append(case)


def ok(name, group, inp, value, canonical=None, note=None, profile=None):
    extra = {"value": value}
    if canonical is not None:
        extra["canonical"] = canonical
    _add(name, group, inp, note=note, profile=profile, **extra)


def err(name, group, inp, code, note=None, profile=None):
    _add(name, group, inp, note=note, profile=profile, error=code)


# Tagged value constructors (see README §2).
def num(v):
    return {"$": "num", "v": v}


def big(v):
    return {"$": "bigint", "v": v}


def dec(v):
    return {"$": "dec", "v": v}


def date(v):
    return {"$": "date", "v": v}


def ts(v):
    return {"$": "ts", "v": v}


def binary(v):
    return {"$": "bin", "v": v}


# --------------------------------------------------------------------------
# structure -- spec §5, error-codes §2.1
# --------------------------------------------------------------------------
ok("structure/empty-object", "structure", "{}", {}, canonical="{}")
ok("structure/simple", "structure", "{name: `Alice`, age: 30}",
   {"name": "Alice", "age": num("30")}, canonical='{age:30,name:"Alice"}')
ok("structure/nested", "structure", "{user: {name: `Bob`, role: `admin`}}",
   {"user": {"name": "Bob", "role": "admin"}})
ok("structure/trailing-newline", "structure", "{a: 1}\n", {"a": num("1")})

err("structure/empty-input", "structure", "", "ERR_ROOT_NOT_OBJECT")
err("structure/whitespace-only", "structure", "   \n\t  ", "ERR_ROOT_NOT_OBJECT")
err("structure/comment-only", "structure", "# hi\n", "ERR_ROOT_NOT_OBJECT")
err("structure/directive-no-object", "structure", "@schema(x)", "ERR_ROOT_NOT_OBJECT")
err("structure/root-array", "structure", "[]", "ERR_ROOT_NOT_OBJECT")
err("structure/root-array-full", "structure", "[1, 2, 3]", "ERR_ROOT_NOT_OBJECT")
err("structure/root-number", "structure", "42", "ERR_ROOT_NOT_OBJECT")
err("structure/root-string", "structure", "`hello`", "ERR_ROOT_NOT_OBJECT")
err("structure/root-literal", "structure", "T", "ERR_ROOT_NOT_OBJECT")
err("structure/root-constructor", "structure", "DATE(2026-01-15)", "ERR_ROOT_NOT_OBJECT")
err("structure/two-objects", "structure", "{a:1}{b:2}", "ERR_TRAILING_CONTENT")
err("structure/trailing-junk", "structure", "{a:1} x", "ERR_TRAILING_CONTENT")
err("structure/trailing-directive", "structure", "{a:1}\n@schema(x)", "ERR_TRAILING_CONTENT")
err("structure/bom-leading", "structure", "\ufeff{a: 1}", "ERR_SYNTAX",
    note="U+FEFF is not whitespace (spec §2)")

# --------------------------------------------------------------------------
# directives -- spec §5.1
# --------------------------------------------------------------------------
ok("directives/schema", "directives", "@schema(config.schema.stf)\n{a: 1}", {"a": num("1")})
ok("directives/uri-payload", "directives",
   "@schema(https://example.com/a.schema.stf)\n{a: 1}", {"a": num("1")})
ok("directives/unknown-tolerated", "directives", "@nope(1)\n{a: 1}", {"a": num("1")},
   note="unknown directives warn, never fail")
ok("directives/two-distinct", "directives", "@schema(a)\n@version(1.0)\n{a: 1}", {"a": num("1")})
ok("directives/not-in-data-model", "directives", "@schema(x)\n{a: 1}", {"a": num("1")},
   note="directives are metadata and must not appear in the parsed value")

err("directives/space-before-paren", "directives", "@schema (x)\n{a:1}", "ERR_SYNTAX")
err("directives/space-after-at", "directives", "@ schema(x)\n{a:1}", "ERR_SYNTAX")
err("directives/repeated-name", "directives", "@schema(a)\n@schema(b)\n{a:1}", "ERR_SYNTAX")

# --------------------------------------------------------------------------
# objects / arrays -- spec §11, error-codes §2.2
# --------------------------------------------------------------------------
ok("objects/trailing-comma", "objects", "{a: 1, b: 2,}", {"a": num("1"), "b": num("2")})
ok("objects/no-whitespace", "objects", "{a:1,b:2}", {"a": num("1"), "b": num("2")})
ok("objects/extra-whitespace", "objects", "{  a  :  1  ,  b  :  2  }",
   {"a": num("1"), "b": num("2")},
   note="the pre-1.0 EBNF rejected this; spec §12 now threads ws")
ok("objects/newlines-around", "objects", "{\n  a: 1,\n  b: 2\n}",
   {"a": num("1"), "b": num("2")})
ok("objects/order-preserved", "objects", "{z: 1, a: 2, m: 3}",
   {"z": num("1"), "a": num("2"), "m": num("3")}, canonical="{a:2,m:3,z:1}",
   note="parse preserves order (§11.2); canonical sorts (§14)")

err("objects/missing-colon", "objects", "{ a 1 }", "ERR_MISSING_COLON")
err("objects/missing-value", "objects", "{ a: }", "ERR_SYNTAX")
err("objects/missing-comma", "objects", "{ a:1 b:2 }", "ERR_MISSING_COMMA")
err("objects/double-comma", "objects", "{ a:1,, b:2 }", "ERR_MISSING_COMMA")
err("objects/leading-comma", "objects", "{ , a:1 }", "ERR_MISSING_COMMA")
err("objects/unterminated", "objects", "{ a: 1", "ERR_UNTERMINATED")
err("objects/duplicate-key", "objects", "{ a: 1, a: 2 }", "ERR_DUPLICATE_KEY")
err("objects/duplicate-nested", "objects", "{ o: { i: { a: 1, a: 2 } } }", "ERR_DUPLICATE_KEY")
err("objects/duplicate-in-array", "objects", "{ a: [{b:1, b:2}] }", "ERR_DUPLICATE_KEY")

ok("arrays/empty", "arrays", "{items: []}", {"items": []})
ok("arrays/simple", "arrays", "{nums: [1, 2, 3]}",
   {"nums": [num("1"), num("2"), num("3")]})
ok("arrays/trailing-comma", "arrays", "{a: [1, 2,]}", {"a": [num("1"), num("2")]})
ok("arrays/mixed-kinds", "arrays", "{a: [1, `s`, T, F, N, [], {}]}",
   {"a": [num("1"), "s", True, False, None, [], {}]})
ok("arrays/nested", "arrays", "{a: [[1], [2, [3]]]}",
   {"a": [[num("1")], [num("2"), [num("3")]]]})

err("arrays/double-comma", "arrays", "{a: [1,,2]}", "ERR_MISSING_COMMA")
err("arrays/leading-comma", "arrays", "{a: [,1]}", "ERR_MISSING_COMMA")
err("arrays/unterminated", "arrays", "{a: [1", "ERR_UNTERMINATED")

# --------------------------------------------------------------------------
# keys -- spec §6
# --------------------------------------------------------------------------
ok("keys/underscore", "keys", "{user_id: 1}", {"user_id": num("1")})
ok("keys/kebab", "keys", "{content-type: 1}", {"content-type": num("1")})
ok("keys/leading-digit", "keys", "{123key: 1}", {"123key": num("1")})
ok("keys/all-digits", "keys", "{123: 1}", {"123": num("1")})
ok("keys/hyphen-only", "keys", "{-: 1}", {"-": num("1")})
ok("keys/underscore-only", "keys", "{_: 1}", {"_": num("1")})
ok("keys/case-sensitive", "keys", "{a: 1, A: 2}", {"a": num("1"), "A": num("2")},
   note="distinct keys, not a duplicate")
ok("keys/constructor-names", "keys",
   "{T: 1, F: 2, N: 3, DATE: 4, TIMESTAMP: 5, DECIMAL: 6, BIGINT: 7, BINARY: 8}",
   {"T": num("1"), "F": num("2"), "N": num("3"), "DATE": num("4"), "TIMESTAMP": num("5"),
    "DECIMAL": num("6"), "BIGINT": num("7"), "BINARY": num("8")},
   note="§6.3 -- bare uppercase words in key position are identifiers")

err("keys/empty", "keys", "{ : 1 }", "ERR_INVALID_IDENTIFIER")
err("keys/dot", "keys", "{ a.b: 1 }", "ERR_INVALID_IDENTIFIER")
err("keys/space-inside", "keys", "{ a b: 1 }", "ERR_INVALID_IDENTIFIER")
err("keys/non-ascii-latin", "keys", "{ caf\u00e9: 1 }", "ERR_INVALID_IDENTIFIER")
err("keys/emoji", "keys", "{ \U0001F511: 1 }", "ERR_INVALID_IDENTIFIER")
err("keys/dollar", "keys", "{ $id: 1 }", "ERR_INVALID_IDENTIFIER",
    note="$ is excluded, which is what makes it a safe corpus escape key")
err("keys/quoted-double", "keys", '{ "a": 1 }', "ERR_SYNTAX")
err("keys/quoted-backtick", "keys", "{ `a`: 1 }", "ERR_SYNTAX")

# --------------------------------------------------------------------------
# numbers -- spec §7, error-codes §2.3
# --------------------------------------------------------------------------
ok("numbers/zero", "numbers", "{a: 0}", {"a": num("0")})
ok("numbers/int", "numbers", "{a: 123}", {"a": num("123")})
ok("numbers/negative", "numbers", "{a: -42}", {"a": num("-42")})
ok("numbers/fraction", "numbers", "{a: 3.14}", {"a": num("3.14")})
ok("numbers/exp-lower", "numbers", "{a: 1e9}", {"a": num("1000000000")})
ok("numbers/exp-upper-plus", "numbers", "{a: 1E+9}", {"a": num("1000000000")})
ok("numbers/exp-negative", "numbers", "{a: -2.5E-3}", {"a": num("-0.0025")})
ok("numbers/negative-zero", "numbers", "{a: -0}", {"a": num("-0")}, canonical="{a:-0}",
   note="§7.3 -- distinct bit pattern from 0")
ok("numbers/underflow-to-zero", "numbers", "{a: 1e-400}", {"a": num("0")},
   note="§7.3 -- gradual underflow is valid, unlike overflow")
ok("numbers/precision-loss", "numbers", "{a: 9007199254740993}",
   {"a": num("9007199254740992")},
   note="§7.2 -- binary64 domain; returning an exact integer here is non-conformant")
ok("numbers/large-magnitude", "numbers", "{a: 123456789012345678901234567890}",
   {"a": num("1.2345678901234568e+29")})

err("numbers/leading-plus", "numbers", "{a: +1}", "ERR_INVALID_NUMBER")
err("numbers/leading-zero", "numbers", "{a: 0123}", "ERR_INVALID_NUMBER")
err("numbers/negative-leading-zero", "numbers", "{a: -01}", "ERR_INVALID_NUMBER")
err("numbers/leading-dot", "numbers", "{a: .5}", "ERR_INVALID_NUMBER")
err("numbers/trailing-dot", "numbers", "{a: 1.}", "ERR_INVALID_NUMBER")
err("numbers/bare-exponent", "numbers", "{a: 1e}", "ERR_INVALID_NUMBER")
err("numbers/exponent-sign-only", "numbers", "{a: 1e+}", "ERR_INVALID_NUMBER")
err("numbers/minus-only", "numbers", "{a: -}", "ERR_INVALID_NUMBER")
err("numbers/overflow", "numbers", "{a: 1e400}", "ERR_NUMBER_OVERFLOW",
    note="§7.3 -- must not yield Infinity")
err("numbers/overflow-negative", "numbers", "{a: -1e400}", "ERR_NUMBER_OVERFLOW")
err("numbers/hex", "numbers", "{a: 0x10}", "ERR_INVALID_NUMBER",
    note="§7.4 token boundary, not ERR_MISSING_COMMA")
err("numbers/digit-separator", "numbers", "{a: 1_000}", "ERR_INVALID_NUMBER")
err("numbers/double-dot", "numbers", "{a: 1.2.3}", "ERR_INVALID_NUMBER")
err("numbers/trailing-letter", "numbers", "{a: 1f}", "ERR_INVALID_NUMBER")

# --------------------------------------------------------------------------
# literals -- spec §9, error-codes §2.4
# --------------------------------------------------------------------------
ok("literals/true", "literals", "{a: T}", {"a": True})
ok("literals/false", "literals", "{a: F}", {"a": False})
ok("literals/null", "literals", "{a: N}", {"a": None})

err("literals/lowercase-t", "literals", "{a: t}", "ERR_SYNTAX")
err("literals/lowercase-n", "literals", "{a: n}", "ERR_SYNTAX")
err("literals/spelled-true", "literals", "{a: true}", "ERR_SYNTAX")
err("literals/spelled-null", "literals", "{a: null}", "ERR_SYNTAX")
err("literals/mixed-case", "literals", "{a: True}", "ERR_SYNTAX")
err("literals/nan", "literals", "{a: NaN}", "ERR_SYNTAX",
    note="§7.4 -- N followed by an identifier char, not null + junk")
err("literals/infinity", "literals", "{a: Infinity}", "ERR_SYNTAX")

# --------------------------------------------------------------------------
# strings -- spec §8, error-codes §2.5
# --------------------------------------------------------------------------
ok("strings/raw-simple", "strings", "{a: `hello`}", {"a": "hello"}, canonical='{a:"hello"}')
ok("strings/raw-empty", "strings", "{a: ``}", {"a": ""})
ok("strings/raw-newline", "strings", "{a: `x\ny`}", {"a": "x\ny"},
   canonical='{a:"x\\ny"}', note="§8.1 -- raw strings preserve literal newlines")
ok("strings/raw-tab", "strings", "{a: `x\ty`}", {"a": "x\ty"})
ok("strings/raw-no-escapes", "strings", "{a: `x\\ny`}", {"a": "x\\ny"},
   note="§8.1 -- backslash-n is two characters in a raw string")
ok("strings/raw-hash", "strings", "{a: `x # y`}", {"a": "x # y"},
   note="§4.2 -- # inside a string is not a comment")
ok("strings/raw-quote", "strings", '{a: `say "hi"`}', {"a": 'say "hi"'})
ok("strings/raw-unicode", "strings", "{a: `h\u00e9llo \U0001F511 \u65e5\u672c`}",
   {"a": "h\u00e9llo \U0001F511 \u65e5\u672c"})
ok("strings/interp-simple", "strings", '{a: "hello"}', {"a": "hello"})
ok("strings/interp-escapes", "strings", '{a: "tab\\there"}', {"a": "tab\there"})
ok("strings/interp-quote", "strings", '{a: "say \\"hi\\""}', {"a": 'say "hi"'})
ok("strings/interp-backslash", "strings", '{a: "a\\\\b"}', {"a": "a\\b"})
ok("strings/interp-solidus", "strings", '{a: "a\\/b"}', {"a": "a/b"})
ok("strings/interp-controls", "strings", '{a: "\\b\\f\\n\\r\\t"}', {"a": "\b\f\n\r\t"})
ok("strings/interp-unicode-escape", "strings", '{a: "\\u0041"}', {"a": "A"})
ok("strings/interp-nul", "strings", '{a: "\\u0000"}', {"a": "\u0000"},
   note="§8.4 -- U+0000 is legal string content and must not terminate the string")
ok("strings/interp-backtick", "strings", '{a: "has ` tick"}', {"a": "has ` tick"},
   note="§8.1 -- the only way to express a backtick")
ok("strings/surrogate-pair", "strings", '{a: "\\uD83D\\uDE00"}', {"a": "\U0001F600"})

err("strings/raw-unterminated", "strings", "{a: `hi}", "ERR_UNTERMINATED")
err("strings/interp-unterminated", "strings", '{a: "hi}', "ERR_UNTERMINATED")
err("strings/interp-literal-newline", "strings", '{a: "x\ny"}', "ERR_INVALID_STRING")
err("strings/interp-literal-cr", "strings", '{a: "x\ry"}', "ERR_INVALID_STRING")
err("strings/bad-escape-x", "strings", '{a: "\\x41"}', "ERR_INVALID_STRING")
err("strings/bad-escape-upper-u", "strings", '{a: "\\U0041"}', "ERR_INVALID_STRING")
err("strings/bad-escape-quote", "strings", "{a: \"\\'\"}", "ERR_INVALID_STRING")
err("strings/short-unicode", "strings", '{a: "\\u41"}', "ERR_INVALID_STRING")
err("strings/bad-hex-unicode", "strings", '{a: "\\uZZZZ"}', "ERR_INVALID_STRING")
err("strings/lone-high-surrogate", "strings", '{a: "\\uD800"}', "ERR_INVALID_STRING",
    note="§8.3 -- has no UTF-8 encoding; substituting U+FFFD is prohibited")
err("strings/lone-low-surrogate", "strings", '{a: "\\uDC00"}', "ERR_INVALID_STRING")
err("strings/high-surrogate-then-text", "strings", '{a: "\\uD800A"}', "ERR_INVALID_STRING")
err("strings/backtick-in-raw", "strings", "{a: `x`y`}", "ERR_MISSING_COMMA")

# --------------------------------------------------------------------------
# constructors, general -- spec §10.1, error-codes §2.6
# --------------------------------------------------------------------------
err("ctor/space-before-paren", "ctor", "{a: DATE (2026-01-15)}", "ERR_SYNTAX")
err("ctor/reserved-custom", "ctor", "{a: CUSTOM(1)}", "ERR_UNKNOWN_CONSTRUCTOR")
err("ctor/reserved-time", "ctor", "{a: TIME(10:00:00)}", "ERR_UNKNOWN_CONSTRUCTOR")
err("ctor/reserved-underscore", "ctor", "{a: MY_TYPE(1)}", "ERR_UNKNOWN_CONSTRUCTOR")
err("ctor/lowercase", "ctor", "{a: date(2026-01-15)}", "ERR_UNKNOWN_CONSTRUCTOR")
err("ctor/mixed-case", "ctor", "{a: Date(2026-01-15)}", "ERR_UNKNOWN_CONSTRUCTOR")
err("ctor/legacy-bignumber", "ctor", "{a: BigNumber(1)}", "ERR_UNKNOWN_CONSTRUCTOR")
err("ctor/legacy-binary", "ctor", "{a: Binary(48656C6C6F)}", "ERR_UNKNOWN_CONSTRUCTOR")
err("ctor/non-reserved-ident", "ctor", "{a: foo(1)}", "ERR_SYNTAX")
err("ctor/nested", "ctor", "{a: DATE(DATE(2026-01-15))}", "ERR_NESTED_CONSTRUCTOR")
err("ctor/unterminated", "ctor", "{a: DATE(2026-01-15}", "ERR_UNTERMINATED")

# --------------------------------------------------------------------------
# DECIMAL -- spec §10.2, error-codes §2.7
# --------------------------------------------------------------------------
ok("decimal/scale-1", "decimal", "{a: DECIMAL(1.5)}", {"a": dec("1.5")})
ok("decimal/scale-2", "decimal", "{a: DECIMAL(1.50)}", {"a": dec("1.50")},
   note="scale is data: distinct from DECIMAL(1.5)")
ok("decimal/integer", "decimal", "{a: DECIMAL(15)}", {"a": dec("15")})
ok("decimal/zero", "decimal", "{a: DECIMAL(0)}", {"a": dec("0")})
ok("decimal/zero-scaled", "decimal", "{a: DECIMAL(0.00)}", {"a": dec("0.00")})
ok("decimal/negative", "decimal", "{a: DECIMAL(-0.001)}", {"a": dec("-0.001")})
ok("decimal/negative-zero", "decimal", "{a: DECIMAL(-0.00)}", {"a": dec("-0.00")})
ok("decimal/34-significant", "decimal",
   "{a: DECIMAL(1.234567890123456789012345678901234)}",
   {"a": dec("1.234567890123456789012345678901234")})
ok("decimal/leading-zeros-fraction", "decimal",
   "{a: DECIMAL(0.00000000000000000000000000000000000001)}",
   {"a": dec("0.00000000000000000000000000000000000001")},
   note="§10.2 -- 1 significant digit, scale 38; leading zeros are not significant")
ok("decimal/money", "decimal", "{price: DECIMAL(19.99)}", {"price": dec("19.99")})

err("decimal/empty", "decimal", "{a: DECIMAL()}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/exponent", "decimal", "{a: DECIMAL(1.5e3)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD",
    note="§10.2 -- plain notation only")
err("decimal/trailing-dot", "decimal", "{a: DECIMAL(1.)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/leading-plus", "decimal", "{a: DECIMAL(+1.5)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/leading-zeros", "decimal", "{a: DECIMAL(01.5)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/nan", "decimal", "{a: DECIMAL(NaN)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/infinity", "decimal", "{a: DECIMAL(Infinity)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/underscore", "decimal", "{a: DECIMAL(1_0.5)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/whitespace", "decimal", "{a: DECIMAL( 1.5 )}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/leading-dot", "decimal", "{a: DECIMAL(.5)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("decimal/overflow-35-digits", "decimal",
    "{a: DECIMAL(12345678901234567890123456789012345)}", "ERR_DECIMAL_OVERFLOW",
    note="35 significant digits, cap is 34")
err("decimal/overflow-35-fractional", "decimal",
    "{a: DECIMAL(1.2345678901234567890123456789012345)}", "ERR_DECIMAL_OVERFLOW")

# --------------------------------------------------------------------------
# BIGINT -- spec §10.3, error-codes §2.8
# --------------------------------------------------------------------------
ok("bigint/beyond-2-53", "bigint", "{a: BIGINT(9007199254740993)}",
   {"a": big("9007199254740993")})
ok("bigint/zero", "bigint", "{a: BIGINT(0)}", {"a": big("0")})
ok("bigint/negative", "bigint", "{a: BIGINT(-9007199254740993)}",
   {"a": big("-9007199254740993")})
ok("bigint/huge", "bigint", "{a: BIGINT(-123456789012345678901234567890)}",
   {"a": big("-123456789012345678901234567890")})
ok("bigint/100-digits", "bigint", "{a: BIGINT(" + "9" * 100 + ")}", {"a": big("9" * 100)})

err("bigint/empty", "bigint", "{a: BIGINT()}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("bigint/letters", "bigint", "{a: BIGINT(123a)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("bigint/fractional", "bigint", "{a: BIGINT(12.34)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("bigint/exponent", "bigint", "{a: BIGINT(1e3)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("bigint/leading-plus", "bigint", "{a: BIGINT(+1)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("bigint/leading-zeros", "bigint", "{a: BIGINT(007)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD",
    note="§10.3 -- must not be silently rewritten to 7")
err("bigint/negative-zero", "bigint", "{a: BIGINT(-0)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("bigint/whitespace", "bigint", "{a: BIGINT( 1 )}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")

# --------------------------------------------------------------------------
# temporal -- spec §10.4, error-codes §2.9
# --------------------------------------------------------------------------
ok("temporal/date", "temporal", "{a: DATE(2026-01-15)}", {"a": date("2026-01-15")})
ok("temporal/date-leap-day", "temporal", "{a: DATE(2024-02-29)}", {"a": date("2024-02-29")})
ok("temporal/date-century-leap", "temporal", "{a: DATE(2000-02-29)}",
   {"a": date("2000-02-29")}, note="2000 is a leap year: divisible by 400")
ok("temporal/date-min", "temporal", "{a: DATE(0000-01-01)}", {"a": date("0000-01-01")})
ok("temporal/date-max", "temporal", "{a: DATE(9999-12-31)}", {"a": date("9999-12-31")})
ok("temporal/ts-z", "temporal", "{a: TIMESTAMP(2026-01-15T12:00:00Z)}",
   {"a": ts("2026-01-15T12:00:00Z")})
ok("temporal/ts-positive-offset", "temporal",
   "{a: TIMESTAMP(2026-01-15T12:00:00.123+05:30)}",
   {"a": ts("2026-01-15T12:00:00.123+05:30")})
ok("temporal/ts-negative-offset", "temporal",
   "{a: TIMESTAMP(2026-01-15T10:30:00-05:00)}", {"a": ts("2026-01-15T10:30:00-05:00")})
ok("temporal/ts-nanoseconds", "temporal",
   "{a: TIMESTAMP(2026-01-15T10:30:00.123456789+05:30)}",
   {"a": ts("2026-01-15T10:30:00.123456789+05:30")})
ok("temporal/ts-fraction-trailing-zeros", "temporal",
   "{a: TIMESTAMP(2026-01-15T10:30:00.100Z)}", {"a": ts("2026-01-15T10:30:00.100Z")},
   note="§10.4 -- .100 is preserved, not normalized to .1")
ok("temporal/ts-offset-zero", "temporal", "{a: TIMESTAMP(2026-01-15T10:30:00+00:00)}",
   {"a": ts("2026-01-15T10:30:00+00:00")},
   note="§3.2 -- +00:00 is distinct from Z as a value")

err("temporal/date-not-padded", "temporal", "{a: DATE(2026-1-5)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/date-month-13", "temporal", "{a: DATE(2026-13-01)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/date-month-00", "temporal", "{a: DATE(2026-00-01)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/date-day-00", "temporal", "{a: DATE(2026-01-00)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/date-feb-31", "temporal", "{a: DATE(2026-02-31)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD", note="§10.4 -- full calendar validity")
err("temporal/date-apr-31", "temporal", "{a: DATE(2026-04-31)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/date-non-leap-feb-29", "temporal", "{a: DATE(2025-02-29)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/date-century-non-leap", "temporal", "{a: DATE(1900-02-29)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD", note="1900 is not a leap year: divisible by 100")
err("temporal/date-with-time", "temporal", "{a: DATE(2026-01-15T10:00:00Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/date-empty", "temporal", "{a: DATE()}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-no-offset", "temporal", "{a: TIMESTAMP(2026-01-15T10:30:00)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-space-separator", "temporal", "{a: TIMESTAMP(2026-01-15 10:30:00Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-lowercase-t", "temporal", "{a: TIMESTAMP(2026-01-15t10:30:00Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-lowercase-z", "temporal", "{a: TIMESTAMP(2026-01-15T10:30:00z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-hour-99", "temporal", "{a: TIMESTAMP(2026-01-15T99:30:00Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-hour-24", "temporal", "{a: TIMESTAMP(2026-01-15T24:00:00Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-minute-60", "temporal", "{a: TIMESTAMP(2026-01-15T10:60:00Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-leap-second", "temporal", "{a: TIMESTAMP(2026-01-15T23:59:60Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD", note="§10.4 -- leap seconds are not supported")
err("temporal/ts-offset-99", "temporal", "{a: TIMESTAMP(2026-01-15T10:30:00+99:00)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-empty-fraction", "temporal", "{a: TIMESTAMP(2026-01-15T10:30:00.Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-fraction-10-digits", "temporal",
    "{a: TIMESTAMP(2026-01-15T10:30:00.1234567890Z)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-invalid-date-part", "temporal", "{a: TIMESTAMP(2026-02-31T10:30:00Z)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("temporal/ts-garbage-right-length", "temporal",
    "{a: TIMESTAMP(XXXXXXXXXXXXXXXXXXZ)}", "ERR_INVALID_CONSTRUCTOR_PAYLOAD")

# --------------------------------------------------------------------------
# BINARY -- spec §10.5, error-codes §2.10
# --------------------------------------------------------------------------
ok("binary/hello", "binary", "{a: BINARY(SGVsbG8=)}", {"a": binary("SGVsbG8=")})
ok("binary/empty", "binary", "{a: BINARY()}", {"a": binary("")},
   note="§10.5 -- the empty octet sequence is expressible")
ok("binary/no-padding-needed", "binary", "{a: BINARY(SGVsbG9X)}", {"a": binary("SGVsbG9X")},
   note="length is a multiple of 4, so no '=' is required")
ok("binary/single-pad", "binary", "{a: BINARY(SGVsbG9Xbw==)}", {"a": binary("SGVsbG9Xbw==")})
ok("binary/plus-slash", "binary", "{a: BINARY(+/+/)}", {"a": binary("+/+/")})

err("binary/length-not-multiple-4", "binary", "{a: BINARY(SGVsbG8)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("binary/url-safe-dash", "binary", "{a: BINARY(SGVsb-8=)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("binary/url-safe-underscore", "binary", "{a: BINARY(SGVsb_8=)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("binary/inner-padding", "binary", "{a: BINARY(SG=sbG8=)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("binary/non-canonical-trailing-bits", "binary", "{a: BINARY(Zh==)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD", note="unused low 4 bits of 'h' are non-zero")
err("binary/internal-whitespace", "binary", "{a: BINARY(SGVs bG8=)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")
err("binary/invalid-char", "binary", "{a: BINARY(SGVs!G8=)}",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD")

# --------------------------------------------------------------------------
# comments and whitespace -- spec §4
# --------------------------------------------------------------------------
ok("comments/leading", "comments", "# note\n{a: 1}", {"a": num("1")})
ok("comments/trailing-member", "comments", "{a: 1, # note\n b: 2}",
   {"a": num("1"), "b": num("2")})
ok("comments/eof-no-newline", "comments", "{a: 1} # note", {"a": num("1")})
ok("comments/inside-array", "comments", "{a: [1, # note\n 2]}",
   {"a": [num("1"), num("2")]})
ok("comments/cr-terminated", "comments", "# note\r{a: 1}", {"a": num("1")},
   note="§4.2 -- a comment ends at CR as well as LF")
ok("whitespace/tabs", "comments", "{\ta:\t1\t}", {"a": num("1")})
ok("whitespace/lone-cr", "comments", "{\ra: 1\r}", {"a": num("1")},
   note="§4.1 -- CR is whitespace on its own, not only within CRLF")
ok("whitespace/crlf", "comments", "{\r\na: 1\r\n}", {"a": num("1")})

# --------------------------------------------------------------------------
# nesting depth -- spec §11.3
# --------------------------------------------------------------------------
def nested_objects(n):
    return "{" + "a:{" * (n - 1) + "}" * (n - 1) + "}"


def nested_arrays(n):
    return "{a:" + "[" * n + "]" * n + "}"


def nested_value(n):
    v = {}
    for _ in range(n - 1):
        v = {"a": v}
    return v


ok("depth/at-limit-64", "depth", nested_objects(64), nested_value(64),
   note="§11.3 -- 64 is the default limit, counting the root as depth 1")
err("depth/over-limit-65", "depth", nested_objects(65), "ERR_NESTING_DEPTH")
err("depth/far-over-limit", "depth", nested_objects(200), "ERR_NESTING_DEPTH")
err("depth/arrays-over-limit", "depth", nested_arrays(65), "ERR_NESTING_DEPTH")

# --------------------------------------------------------------------------
# canonical form -- spec §14
# --------------------------------------------------------------------------
ok("canonical/sorts-keys", "canonical", "{b: 2, a: 1, c: 3}",
   {"b": num("2"), "a": num("1"), "c": num("3")}, canonical="{a:1,b:2,c:3}")
ok("canonical/byte-order-not-case-insensitive", "canonical", "{a: 1, B: 2}",
   {"a": num("1"), "B": num("2")}, canonical="{B:2,a:1}",
   note="§14 -- ascending UTF-8 byte order, so uppercase sorts first")
ok("canonical/strips-comments", "canonical", "# lead\n{a: 1} # trail",
   {"a": num("1")}, canonical="{a:1}")
ok("canonical/drops-trailing-comma", "canonical", "{a: 1,}", {"a": num("1")},
   canonical="{a:1}")
ok("canonical/interpreted-strings", "canonical", "{a: `hi`}", {"a": "hi"},
   canonical='{a:"hi"}')
ok("canonical/preserves-decimal-scale", "canonical", "{a: DECIMAL(1.50)}",
   {"a": dec("1.50")}, canonical="{a:DECIMAL(1.50)}")
ok("canonical/nested", "canonical", "{b: {d: 1, c: 2}, a: [3, 1]}",
   {"b": {"d": num("1"), "c": num("2")}, "a": [num("3"), num("1")]},
   canonical="{a:[3,1],b:{c:2,d:1}}",
   note="array order is data and must not be sorted")

# --------------------------------------------------------------------------
# stream profile -- doc/stream.md
# --------------------------------------------------------------------------
ok("stream/two-records", "stream", "{a:1}\n{a:2}\n",
   [{"a": num("1")}, {"a": num("2")}], profile="stream",
   note="a stream's value is the sequence of its records")
ok("stream/no-trailing-newline", "stream", "{a:1}\n{a:2}",
   [{"a": num("1")}, {"a": num("2")}], profile="stream")
ok("stream/empty", "stream", "", [], profile="stream")
ok("stream/blank-lines-ignored", "stream", "{a:1}\n\n\n{a:2}\n",
   [{"a": num("1")}, {"a": num("2")}], profile="stream")
ok("stream/comment-lines-ignored", "stream", "# header note\n{a:1}\n# mid\n{a:2}\n",
   [{"a": num("1")}, {"a": num("2")}], profile="stream")
ok("stream/trailing-comment", "stream", "{a:1} # note\n", [{"a": num("1")}], profile="stream")
ok("stream/crlf", "stream", "{a:1}\r\n{a:2}\r\n",
   [{"a": num("1")}, {"a": num("2")}], profile="stream",
   note="stream §2 -- CR before the terminating LF is discarded")
ok("stream/header-directive", "stream", "@schema(event.schema.stf)\n{a:1}\n",
   [{"a": num("1")}], profile="stream")
ok("stream/heterogeneous", "stream", "{a:1}\n{b:`x`,c:T}\n",
   [{"a": num("1")}, {"b": "x", "c": True}], profile="stream",
   note="stream §3.1 -- records need not share a shape")
ok("stream/interpreted-newline", "stream", '{msg:"line one\\nline two"}\n',
   [{"msg": "line one\nline two"}], profile="stream",
   note="stream §3.2 -- the correct way to carry a newline in a record")

err("stream/raw-newline-in-record", "stream", "{a:`x\ny`}\n", "ERR_STREAM_RAW_NEWLINE",
    profile="stream", note="stream §3.2 -- would break LF splitting")
err("stream/directive-after-record", "stream", "{a:1}\n@schema(x)\n",
    "ERR_STREAM_DIRECTIVE_IN_RECORD", profile="stream")
err("stream/directive-with-object", "stream", "@schema(x) {a:1}\n",
    "ERR_STREAM_DIRECTIVE_IN_RECORD", profile="stream")
err("stream/repeated-header-directive", "stream", "@schema(a) @schema(b)\n{a:1}\n",
    "ERR_SYNTAX", profile="stream")
err("stream/record-root-array", "stream", "[1,2]\n", "ERR_ROOT_NOT_OBJECT", profile="stream")
err("stream/two-objects-one-line", "stream", "{a:1}{b:2}\n", "ERR_TRAILING_CONTENT",
    profile="stream")
err("stream/bom", "stream", "\ufeff{a:1}\n", "ERR_SYNTAX", profile="stream")


def main():
    names = [c["name"] for c in CASES]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        raise SystemExit("duplicate case names: %s" % sorted(dupes))
    for c in CASES:
        if ("value" in c) == ("error" in c):
            raise SystemExit("case %s must have exactly one of value/error" % c["name"])

    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "corpus.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(CASES, f, ensure_ascii=False, indent=2)
        f.write("\n")

    groups = {}
    for c in CASES:
        groups[c["group"]] = groups.get(c["group"], 0) + 1
    print("wrote %d cases to %s" % (len(CASES), out))
    for g in sorted(groups):
        print("  %-12s %3d" % (g, groups[g]))


if __name__ == "__main__":
    main()
