"""Unit tests for the Python reference implementation.

The conformance corpus (``tests/conformance/run_python.py``) is the executable contract for
the specification; these cover the host-language surface it cannot reach — the mapping onto
Python types, JSON interchange, and the traps Python's own semantics set.

Run with: python3 -m unittest discover -s ref-impl/python/tests
"""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import stf  # noqa: E402


def code(text: str) -> str:
    try:
        stf.parse(text)
    except stf.STFError as e:
        return e.code
    return "NO_ERROR"


class DataModel(unittest.TestCase):
    """Spec §3."""

    def test_every_constructor_has_its_own_kind(self):
        v = stf.parse(
            "{dec: DECIMAL(1.5), big: BIGINT(1), d: DATE(2026-01-15), "
            "t: TIMESTAMP(2026-01-15T00:00:00Z), bin: BINARY(SGVsbG8=)}"
        )
        self.assertEqual(stf.kind_of(v["dec"]), "Decimal")
        self.assertEqual(stf.kind_of(v["big"]), "BigInt")
        self.assertEqual(stf.kind_of(v["d"]), "Date")
        self.assertEqual(stf.kind_of(v["t"]), "Timestamp")
        self.assertEqual(stf.kind_of(v["bin"]), "Binary")
        # §3.1: the defect this rewrite exists to remove.
        self.assertNotIsInstance(v["dec"], str)
        self.assertNotIsInstance(v["d"], str)

    def test_a_string_never_equals_a_typed_value(self):
        self.assertFalse(stf.equal(stf.parse("{x: DECIMAL(1.5)}"), stf.parse("{x: `1.5`}")))

    def test_booleans_are_not_bigints(self):
        # bool subclasses int in Python, so this is a real trap.
        self.assertEqual(stf.kind_of(True), "Boolean")
        self.assertEqual(stf.kind_of(1), "BigInt")
        self.assertFalse(stf.equal(stf.parse("{x: T}")["x"], stf.parse("{x: BIGINT(1)}")["x"]))

    def test_number_bigint_and_decimal_stay_distinct(self):
        v = stf.parse("{n: 1, b: BIGINT(1), d: DECIMAL(1)}")
        self.assertFalse(stf.equal(v["n"], v["b"]))
        self.assertFalse(stf.equal(v["b"], v["d"]))
        self.assertFalse(stf.equal(v["n"], v["d"]))

    def test_decimal_equality_is_scale_sensitive(self):
        # decimal.Decimal would call these equal, which is why it is not used.
        a = stf.parse("{x: DECIMAL(1.5)}")["x"]
        b = stf.parse("{x: DECIMAL(1.50)}")["x"]
        self.assertNotEqual(a, b)
        self.assertEqual(b, stf.parse("{x: DECIMAL(1.50)}")["x"])

    def test_negative_zero_is_distinct(self):
        neg = stf.parse("{x: -0}")["x"]
        pos = stf.parse("{x: 0}")["x"]
        self.assertEqual(neg, pos)  # plain == cannot tell them apart
        self.assertFalse(stf.equal(neg, pos))  # but STF equality can
        self.assertEqual(math.copysign(1.0, neg), -1.0)

    def test_utc_and_zero_offset_are_distinct(self):
        z = stf.parse("{t: TIMESTAMP(2026-01-15T10:30:00Z)}")["t"]
        plus = stf.parse("{t: TIMESTAMP(2026-01-15T10:30:00+00:00)}")["t"]
        self.assertFalse(stf.equal(z, plus))

    def test_member_order_does_not_affect_equality(self):
        self.assertTrue(stf.equal(stf.parse("{a: 1, b: 2}"), stf.parse("{b: 2, a: 1}")))


class Numbers(unittest.TestCase):
    """Spec §7."""

    def test_numbers_are_always_float_never_widened(self):
        # §7.2: returning a Python int here would widen the domain.
        v = stf.parse("{a: 1, b: 9007199254740993}")
        self.assertIsInstance(v["a"], float)
        self.assertEqual(v["b"], 9007199254740992.0)

    def test_overflow_and_underflow(self):
        self.assertEqual(code("{a: 1e400}"), "ERR_NUMBER_OVERFLOW")
        self.assertEqual(stf.parse("{a: 1e-400}")["a"], 0.0)

    def test_shortest_round_tripping_form(self):
        self.assertEqual(stf.format_number(1.0), "1")
        self.assertEqual(stf.format_number(-0.0), "-0")
        self.assertEqual(stf.format_number(0.0), "0")
        self.assertEqual(stf.format_number(3.14), "3.14")
        for n in (1.0, -0.0, 1e300, 3.14, 9007199254740992.0, 1e-320, 2.5e-3):
            got = stf.parse("{a:%s}" % stf.format_number(n))["a"]
            self.assertEqual(math.copysign(1.0, got), math.copysign(1.0, n))
            self.assertEqual(got, n)


class Serialization(unittest.TestCase):
    """Spec §13."""

    def test_strings_are_never_promoted_to_constructors(self):
        # §13.2. The old implementation emitted DECIMAL(abc) here, producing unparseable text.
        v = stf.parse("{a: `DECIMAL(1.5)`, b: `2026-01-15`, c: `$decimal:abc`}")
        text = stf.serialize(v, stf.COMPACT)
        self.assertEqual(text, "{a:`DECIMAL(1.5)`,b:`2026-01-15`,c:`$decimal:abc`}")
        self.assertTrue(stf.equal(stf.parse(text), v))

    def test_round_trips_every_kind(self):
        v = stf.parse(
            "{n:N,b:T,num:-2.5e-3,s:`hi`,arr:[1,`x`],obj:{k:1},"
            "big:BIGINT(-99999999999999999999),dec:DECIMAL(1.50),"
            "d:DATE(2024-02-29),t:TIMESTAMP(2026-01-15T10:30:00.100+05:30),"
            "bin:BINARY(SGVsbG9X)}"
        )
        for fmt in (stf.COMPACT, stf.pretty("  "), stf.CANONICAL):
            self.assertTrue(stf.equal(stf.parse(stf.serialize(v, fmt)), v))

    def test_member_order_is_preserved(self):
        self.assertEqual(
            stf.serialize(stf.parse("{z: 1, a: 2, m: 3}"), stf.COMPACT), "{z:1,a:2,m:3}"
        )

    def test_invalid_keys_fail_rather_than_emit_bad_output(self):
        for bad in ({"a.b": 1.0}, {"": 1.0}, {1: 1.0}):
            with self.assertRaises(stf.STFError) as ctx:
                stf.serialize(bad)
            self.assertEqual(ctx.exception.code, "ERR_UNREPRESENTABLE")

    def test_non_finite_numbers_fail(self):
        with self.assertRaises(stf.STFError) as ctx:
            stf.serialize({"a": float("inf")})
        self.assertEqual(ctx.exception.code, "ERR_UNREPRESENTABLE")

    def test_format_is_idempotent(self):
        once = stf.format("{ b:2,a:`x`, }")
        self.assertEqual(stf.format(once), once)


class CanonicalForm(unittest.TestCase):
    """Spec §14."""

    def canon(self, text: str) -> str:
        return stf.serialize(stf.parse(text), stf.CANONICAL)

    def test_sorts_by_key_bytes(self):
        self.assertEqual(self.canon("{b: 2, a: 1, c: 3}"), "{a:1,b:2,c:3}")
        self.assertEqual(self.canon("{a: 1, B: 2}"), "{B:2,a:1}")

    def test_strips_comments_and_interprets_strings(self):
        self.assertEqual(self.canon("# lead\n{a: 1} # trail"), "{a:1}")
        self.assertEqual(self.canon("{a: 1,}"), "{a:1}")
        self.assertEqual(self.canon("{a: `hi`}"), '{a:"hi"}')

    def test_preserves_scale_and_array_order(self):
        self.assertEqual(self.canon("{a: DECIMAL(1.50)}"), "{a:DECIMAL(1.50)}")
        self.assertEqual(self.canon("{b: {d: 1, c: 2}, a: [3, 1]}"), "{a:[3,1],b:{c:2,d:1}}")


class Errors(unittest.TestCase):
    def test_code_is_an_attribute_not_just_a_message(self):
        with self.assertRaises(stf.STFError) as ctx:
            stf.parse("{a: 0x10}")
        self.assertEqual(ctx.exception.code, "ERR_INVALID_NUMBER")

    def test_line_and_column_are_one_based(self):
        with self.assertRaises(stf.STFError) as ctx:
            stf.parse("{\n  a: 0x10\n}")
        self.assertEqual((ctx.exception.line, ctx.exception.column), (2, 7))

    def test_utf8_is_enforced_on_bytes(self):
        self.assertTrue(stf.equal(stf.parse_bytes(b"{a: 1}"), stf.parse("{a: 1}")))
        with self.assertRaises(stf.STFError) as ctx:
            stf.parse_bytes(b"{a: \xff}")
        self.assertEqual(ctx.exception.code, "ERR_INVALID_UTF8")


class Directives(unittest.TestCase):
    """Spec §5.1."""

    def test_directives_stay_out_of_the_data_model(self):
        doc = stf.parse_document("@schema(x)\n{a: 1}")
        self.assertEqual([d.name for d in doc.directives], ["schema"])
        self.assertEqual(list(doc.root), ["a"])

    def test_unknown_is_accepted_but_a_repeat_is_not(self):
        stf.parse("@nope(1)\n{a: 1}")
        self.assertEqual(code("@schema(a)\n@schema(b)\n{a: 1}"), "ERR_SYNTAX")


class Stream(unittest.TestCase):
    def test_reads_records_and_header(self):
        s = stf.parse_stream("@schema(e.stf)\n{a:1}\n{a:2}\n")
        self.assertEqual(len(s.records), 2)
        self.assertEqual([d.name for d in s.directives], ["schema"])

    def test_continues_past_a_bad_record_with_line_numbers(self):
        items = list(stf.read_stream("# note\n{a:1}\n{oops\n{b:2}\n"))
        self.assertEqual([r.line for r in items], [2, 3, 4])
        self.assertIsNone(items[0].error)
        self.assertEqual(items[1].error.code, "ERR_MISSING_COLON")
        self.assertIsNone(items[2].error)

    def test_writing_escapes_line_terminators(self):
        # Stream §3.2 requires this rather than a failure.
        stream = stf.STFStream([], [stf.parse("{msg: `one\ntwo`}")])
        text = stf.serialize_stream(stream, stf.COMPACT)
        self.assertEqual(text, '{msg:"one\\ntwo"}\n')
        self.assertEqual(len(stf.parse_stream(text).records), 1)

    def test_record_order_is_preserved_while_members_sort(self):
        s = stf.parse_stream("{b:1,a:2}\n{d:1,c:2}\n")
        self.assertEqual(stf.serialize_stream(s, stf.CANONICAL), "{a:2,b:1}\n{c:2,d:1}\n")


class JsonInterop(unittest.TestCase):
    def test_converts_ordinary_json_and_keeps_order(self):
        v = stf.from_json({"z": 1, "a": [True, None, "x"], "m": {"d": 1.5}})
        self.assertEqual(stf.serialize(v, stf.COMPACT), "{z:1,a:[T,N,`x`],m:{d:1.5}}")

    def test_refuses_json_stf_cannot_express(self):
        for bad in ([], 42, "x", None):
            with self.assertRaises(stf.STFError):
                stf.from_json(bad)
        for bad in ({"a.b": 1}, {"": 1}, {"café": 1}):
            with self.assertRaises(stf.STFError) as ctx:
                stf.from_json(bad)
            self.assertEqual(ctx.exception.code, "ERR_UNREPRESENTABLE")

    def test_refuses_an_integer_binary64_cannot_hold(self):
        with self.assertRaises(stf.STFError) as ctx:
            stf.from_json_text('{"id": 9007199254740993}')
        self.assertEqual(ctx.exception.code, "ERR_UNREPRESENTABLE")
        self.assertIn("BIGINT", ctx.exception.detail)
        stf.from_json_text('{"id": 9007199254740992}')
        stf.from_json_text('{"id": "9007199254740993"}')

    def test_refuses_typed_values_unless_asked(self):
        v = stf.parse("{price: DECIMAL(19.99)}")
        with self.assertRaises(stf.STFError):
            stf.to_json(v)
        self.assertEqual(stf.to_json(v, stf.PAYLOAD_AS_STRING), {"price": "19.99"})

    def test_tagged_json_separates_kinds(self):
        v = stf.parse("{s: `1.5`, d: DECIMAL(1.50), z: -0}")
        self.assertEqual(
            stf.to_tagged_json(v),
            {"s": "1.5", "d": {"$": "dec", "v": "1.50"}, "z": {"$": "num", "v": "-0"}},
        )


class Geometry(unittest.TestCase):
    def test_point(self):
        v = stf.parse('{p: Geometry("Point", [80.27,13.08])}')
        self.assertEqual(stf.kind_of(v["p"]), "Geometry")
        self.assertEqual(v["p"].type, "Point")
        self.assertEqual(stf.serialize(v, stf.COMPACT), '{p:Geometry("Point", [80.27, 13.08])}')

    def test_linestring(self):
        v = stf.parse('{l: Geometry("LineString", [[80.27,13.08],[80.28,13.09]])}')
        self.assertEqual(v["l"].type, "LineString")

    def test_polygon(self):
        v = stf.parse('{p: Geometry("Polygon", [[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]]])}')
        self.assertEqual(v["p"].type, "Polygon")

    def test_polygon_with_hole(self):
        v = stf.parse('{p: Geometry("Polygon", [[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]], [[80.273,13.083],[80.275,13.083],[80.275,13.085],[80.273,13.083]]])}')
        self.assertEqual(len(v["p"].coordinates), 2)

    def test_multipoint(self):
        self.assertEqual(stf.parse('{p: Geometry("MultiPoint", [[80.27,13.08],[80.28,13.09]])}')["p"].type, "MultiPoint")

    def test_multilinestring(self):
        self.assertEqual(stf.parse('{m: Geometry("MultiLineString", [[[80.27,13.08],[80.28,13.09]], [[80.29,13.09],[80.30,13.10]]])}')["m"].type, "MultiLineString")

    def test_multipolygon(self):
        v = stf.parse('{m: Geometry("MultiPolygon", [[[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]]], [[[80.30,13.10],[80.31,13.10],[80.31,13.11],[80.30,13.10]]]])}')
        self.assertEqual(v["m"].type, "MultiPolygon")

    def test_upper_alias(self):
        self.assertEqual(stf.parse('{p: GEOMETRY("Point", [1,2])}')["p"].type, "Point")

    def test_rejects_invalid(self):
        for bad in [
            '{p: Geometry("Point", [80])}',
            '{p: Geometry("Unknown", [1,2])}',
            '{p: Geometry("Point", ["a","b"])}',
            '{p: Geometry("LineString", [[80,13]])}',
            '{p: Geometry("Polygon", [[[0,0],[1,0],[1,1]]])}',
            '{p: Geometry("Polygon", [[[0,0],[1,0],[1,1],[0,1]]])}',
            '{p: Geometry("MultiPoint", [])}',
        ]:
            self.assertEqual(code(bad), "ERR_INVALID_CONSTRUCTOR_PAYLOAD", bad)

    def test_round_trips(self):
        for txt in ['{p: Geometry("Point", [1,2])}', '{p: Geometry("LineString", [[0,0],[1,1]])}', '{p: Geometry("Polygon", [[[0,0],[1,0],[1,1],[0,0]]])}']:
            v = stf.parse(txt)
            self.assertTrue(stf.equal(stf.parse(stf.serialize(v, stf.COMPACT)), v))


class TimeTests(unittest.TestCase):
    def test_valid(self):
        for txt in ['Time("00:00")','Time("09:30")','Time("23:59:59")','Time("09:30:00.123")']:
            v = stf.parse("{t: %s}" % txt)
            self.assertEqual(stf.kind_of(v["t"]), "Time")
            self.assertTrue(stf.equal(stf.parse(stf.serialize(v, stf.COMPACT)), v))
        self.assertEqual(stf.parse('{t: TIME("09:30")}')["t"].payload, "09:30")

    def test_invalid(self):
        for bad in ['Time("24:00")','Time("12:60")','Time("09:60:00")','Time("abc")','Time("")']:
            self.assertEqual(code("{t: %s}" % bad), "ERR_INVALID_CONSTRUCTOR_PAYLOAD", bad)


class DurationTests(unittest.TestCase):
    def test_valid(self):
        for txt in ['Duration("PT30S")','Duration("PT45M")','Duration("PT2H30M")','Duration("P1D")','Duration("P1Y")','DURATION("PT2H")']:
            v = stf.parse("{d: %s}" % txt)
            self.assertEqual(stf.kind_of(v["d"]), "Duration")
            self.assertTrue(stf.equal(stf.parse(stf.serialize(v, stf.COMPACT)), v))

    def test_invalid(self):
        for bad in ['Duration("invalid")','Duration("P")','Duration("PT")','Duration("")','Duration("P1DT")']:
            self.assertEqual(code("{d: %s}" % bad), "ERR_INVALID_CONSTRUCTOR_PAYLOAD", bad)


class GeometryJson(unittest.TestCase):
    def test_to_json_emits_geojson(self):
        v = stf.parse('{g: Geometry("Point", [80.27,13.08])}')
        j = stf.to_json(v["g"])
        self.assertEqual(j["type"], "Point")
        self.assertEqual(j["coordinates"], [80.27,13.08])

    def test_to_geo_emit(self):
        g = stf.parse('{g: Geometry("Point", [80.27,13.08])}')["g"]
        self.assertEqual(stf.to_geo(g), {"type": "Point", "coordinates": [80.27,13.08]})
        self.assertEqual(stf.to_geojson(g), {"type": "Point", "coordinates": [80.27,13.08]})
        self.assertEqual(stf.to_geo(g), stf.to_json(g))

    def test_from_json_no_infer(self):
        gj = {"type":"Point","coordinates":[1,2]}
        v = stf.from_json({"x": gj})
        self.assertEqual(stf.kind_of(v["x"]), "Object")
        self.assertEqual(v["x"]["type"], "Point")


class MixedObject(unittest.TestCase):
    def test_realistic(self):
        txt = '{name:`Chennai`, population:7000000, active:T, boundary:Geometry("Polygon", [[[80.27,13.08],[80.28,13.08],[80.28,13.09],[80.27,13.08]]]), opens:Time("09:30"), ttl:Duration("PT45M"), founded:DATE(2026-01-15)}'
        v = stf.parse(txt)
        self.assertEqual(stf.kind_of(v["boundary"]), "Geometry")
        self.assertEqual(stf.kind_of(v["opens"]), "Time")
        self.assertEqual(stf.kind_of(v["ttl"]), "Duration")
        self.assertTrue(stf.equal(stf.parse(stf.serialize(v, stf.COMPACT)), v))


class PublicHelpers(unittest.TestCase):
    def test_decimal_payload_keeps_its_scale(self):
        self.assertEqual(stf.STFDecimal(False, 150, 2).payload, "1.50")
        self.assertEqual(stf.STFDecimal(True, 1, 3).payload, "-0.001")
        # A zero coefficient has no sign.
        self.assertEqual(stf.STFDecimal(True, 0, 1).payload, "0.0")


if __name__ == "__main__":
    unittest.main()
