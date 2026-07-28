#!/usr/bin/env python3
"""STF 1.0 conformance runner for the Python reference implementation.

Implements the runner contract in README.md §3: error codes are compared exactly, values are
compared by kind, Numbers by binary64 bit pattern, Decimals by coefficient *and* scale, and
Binary by decoded octets. Nothing is skipped.

Usage: python3 tests/conformance/run_python.py [--group NAME] [--verbose]
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "ref-impl" / "python"))

import stf  # noqa: E402

#: Corpus tag for each STF kind (spec §3).
TAG_OF_KIND = {
    "Null": "null",
    "Boolean": "bool",
    "Number": "num",
    "String": "str",
    "Array": "arr",
    "Object": "obj",
    "BigInt": "bigint",
    "Decimal": "dec",
    "Date": "date",
    "Timestamp": "ts",
    "Binary": "bin",
}


def tag_of(value) -> str:
    try:
        return TAG_OF_KIND[stf.kind_of(value)]
    except (TypeError, KeyError):
        return "unknown"


def bits_of(n: float) -> bytes:
    return struct.pack(">d", n)


def show(value) -> str:
    try:
        kind = stf.kind_of(value)
    except TypeError:
        return repr(value)
    if kind == "String":
        return f"String {value!r}"
    if kind == "Number":
        return f"Number {stf.format_number(value)}"
    if kind in ("Object", "Array"):
        return kind
    return f"{kind} {value}"


def compare(actual, expected, path: str = "$") -> str | None:
    """Compares a parsed value against the corpus's tagged-JSON encoding.

    Kind is checked before content in every branch, so a String can never satisfy a
    dec/date/ts/bin/bigint expectation however closely the text matches.
    """

    def at(msg: str) -> str:
        return f"{path}: {msg}"

    if isinstance(expected, dict) and "$" in expected:
        want_tag = expected["$"]
        text = expected["v"]
        got = tag_of(actual)
        if got != want_tag:
            return at(f"expected kind {want_tag}, got {got} ({show(actual)})")

        if want_tag == "num":
            # Bit comparison, so -0 never satisfies 0 (README §3.3).
            want = float(text)
            if bits_of(actual) != bits_of(want):
                return at(f"expected Number {text}, got {show(actual)}")
            return None
        if want_tag == "bigint":
            return None if actual == int(text) else at(f"expected BigInt {text}, got {actual}")
        if want_tag == "dec":
            # Coefficient *and* scale (README §3.4): STFDecimal compares both fields.
            want = stf.parse_decimal(text)
            if actual != want:
                return at(
                    f"expected Decimal {want.payload} (scale {want.scale}), "
                    f"got {actual.payload} (scale {actual.scale})"
                )
            return None
        if want_tag == "date":
            want = stf.parse_date(text)
            return None if actual == want else at(f"expected Date {text}, got {actual.payload}")
        if want_tag == "ts":
            want = stf.parse_timestamp(text)
            return None if actual == want else at(f"expected Timestamp {text}, got {actual.payload}")
        if want_tag == "bin":
            # Octet comparison after decoding (README §3.5).
            want = stf.parse_binary(text)
            if bytes(actual) != want:
                return at(f"expected octets {want.hex()}, got {bytes(actual).hex()}")
            return None
        return at(f"corpus error: unknown tag {want_tag}")

    if expected is None:
        return None if tag_of(actual) == "null" else at(f"expected Null, got {show(actual)}")
    if isinstance(expected, bool):
        if tag_of(actual) != "bool":
            return at(f"expected Boolean, got {show(actual)}")
        return None if actual is expected else at(f"expected Boolean {expected}, got {actual}")
    if isinstance(expected, (int, float)):
        return at("corpus error: bare JSON numbers are never used (README §2)")
    if isinstance(expected, str):
        if tag_of(actual) != "str":
            return at(f"expected String, got {show(actual)}")
        return None if actual == expected else at(f"expected String {expected!r}, got {actual!r}")
    if isinstance(expected, list):
        if tag_of(actual) != "arr":
            return at(f"expected Array, got {show(actual)}")
        if len(actual) != len(expected):
            return at(f"expected {len(expected)} elements, got {len(actual)}")
        for i, (a, b) in enumerate(zip(actual, expected)):
            reason = compare(a, b, f"{path}[{i}]")
            if reason:
                return reason
        return None

    if tag_of(actual) != "obj":
        return at(f"expected Object, got {show(actual)}")
    if len(actual) != len(expected):
        return at(f"expected keys {sorted(expected)}, got {sorted(actual)}")
    for key, want in expected.items():
        if key not in actual:
            return at(f"missing key {key!r}")
        reason = compare(actual[key], want, f"{path}.{key}")
        if reason:
            return reason
    return None


def err_code(e: BaseException) -> str:
    code = getattr(e, "code", None)
    if isinstance(code, str) and code.startswith("ERR_"):
        return code
    return f"NO_CODE({type(e).__name__}: {e})"


def run_case(case: dict) -> str | None:
    """Returns None on success, or the reason it failed."""
    text = case["input"]
    is_stream = case.get("profile") == "stream"

    if "error" in case:
        try:
            stf.parse_stream(text) if is_stream else stf.parse(text)
        except stf.STFError as e:
            got = err_code(e)
            return None if got == case["error"] else f"expected {case['error']}, got {got}"
        except Exception as e:  # noqa: BLE001 - an unexpected type is itself a failure
            return f"expected {case['error']}, got {err_code(e)}"
        return f"expected {case['error']}, but the input parsed successfully"

    try:
        result = stf.parse_stream(text) if is_stream else stf.parse(text)
    except Exception as e:  # noqa: BLE001
        return f"expected a value, got {err_code(e)}"

    if is_stream:
        records = result.records
        if len(records) != len(case["value"]):
            return f"expected {len(case['value'])} records, got {len(records)}"
        for i, (got, want) in enumerate(zip(records, case["value"])):
            reason = compare(got, want, f"record[{i}]")
            if reason:
                return reason
        return None

    reason = compare(result, case["value"])
    if reason:
        return reason

    # README §3, the SHOULD: parse(serialize(parse(input))) == parse(input).
    for fmt in (stf.COMPACT, stf.pretty("  "), stf.CANONICAL):
        try:
            out = stf.serialize(result, fmt)
        except stf.STFError as e:
            return f"serialization failed: {err_code(e)}"
        try:
            back = stf.parse(out)
        except stf.STFError as e:
            return f"serialized output does not parse ({err_code(e)}): {out}"
        if not stf.equal(back, result):
            return f"round trip changed the value via {out}"

    if "canonical" in case:
        got = stf.serialize(result, stf.CANONICAL)
        if got != case["canonical"]:
            return f"canonical form: expected {case['canonical']!r}, got {got!r}"
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--group")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("corpus", nargs="?", default=str(HERE / "corpus.json"))
    args = ap.parse_args()

    cases = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    by_group: dict[str, list[int]] = {}
    failures: list[tuple[str, str]] = []

    for case in cases:
        if args.group and case["group"] != args.group:
            continue
        counts = by_group.setdefault(case["group"], [0, 0])
        counts[1] += 1
        reason = run_case(case)
        if reason is None:
            counts[0] += 1
            if args.verbose:
                print(f"PASS  {case['name']}")
        else:
            failures.append((case["name"], reason))
            print(f"FAIL  {case['name']}\n        {reason}")

    total = sum(c[1] for c in by_group.values())
    passed = sum(c[0] for c in by_group.values())

    print("\n" + "=" * 64)
    print("STF 1.0 conformance -- Python reference implementation\n")
    print(f"  {'group':<14}{'pass':>6}{'fail':>6}")
    for group in sorted(by_group):
        ok, n = by_group[group]
        print(f"  {group:<14}{ok:>6}{n - ok:>6}")
    print(f"  {'-' * 26}")
    print(f"  {'TOTAL':<14}{passed:>6}{total - passed:>6}")
    pct = (passed / total * 100) if total else 0.0
    print(f"\n  {passed}/{total} passing ({pct:.1f}%)")
    print("=" * 64)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
