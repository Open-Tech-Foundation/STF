"""Serialization (spec §13) and Canonical Form (spec §14).

The contract is ``parse(serialize(v)) == v``. Where a host value cannot be represented, this
module raises ``ERR_UNREPRESENTABLE`` rather than emit text a parser would reject.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, replace

from .constructors import binary_to_base64
from .errors import STFError
from .value import STFDate, STFDecimal, STFDocument, STFTimestamp, kind_of

_IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class Format:
    """Output shape."""

    #: Indent string. ``None`` emits everything on one line.
    indent: str | None = "  "
    #: Canonical Form (spec §14): sorted keys, no spacing, all strings interpreted.
    canonical: bool = False
    #: Force the interpreted form for strings holding LF or CR, keeping output on one line.
    #: Required by stream §3.2; off for documents, where §8.1 permits a raw newline.
    escape_line_terminators: bool = False


COMPACT = Format(indent=None)
CANONICAL = Format(indent=None, canonical=True)


def pretty(indent: str = "  ") -> Format:
    return Format(indent=indent)


def single_line(fmt: Format) -> Format:
    return replace(fmt, indent=None, escape_line_terminators=True)


def _unrepresentable(detail: str) -> STFError:
    return STFError("ERR_UNREPRESENTABLE", detail)


def serialize(value, fmt: Format = Format()) -> str:
    """Serializes a value. The root must be an object (spec §5)."""
    if kind_of(value) != "Object":
        raise _unrepresentable(f"an STF document root must be an object, not {kind_of(value)}")
    out: list[str] = []
    _write_object(value, fmt, 0, out)
    return "".join(out)


def serialize_document(doc: STFDocument, fmt: Format = Format()) -> str:
    """Serializes a document, emitting its directives before the root object."""
    out: list[str] = []
    for d in doc.directives:
        if not _IDENTIFIER.match(d.name):
            raise _unrepresentable(f"`{d.name}` is not a valid directive name")
        if "(" in d.payload or ")" in d.payload:
            raise _unrepresentable("a directive payload must not contain parentheses")
        out.append(f"@{d.name}({d.payload})\n")
    _write_object(doc.root, fmt, 0, out)
    return "".join(out)


def _write_value(value, fmt: Format, level: int, out: list[str]) -> None:
    kind = kind_of(value)
    if kind == "Null":
        out.append("N")
    elif kind == "Boolean":
        out.append("T" if value else "F")
    elif kind == "Number":
        out.append(format_number(value))
    elif kind == "String":
        _write_string(value, fmt, out)
    elif kind == "Array":
        _write_array(value, fmt, level, out)
    elif kind == "Object":
        _write_object(value, fmt, level, out)
    elif kind == "BigInt":
        out.append(f"BIGINT({value})")
    elif kind == "Decimal":
        out.append(f"DECIMAL({value.payload})")
    elif kind == "Date":
        out.append(f"DATE({value.payload})")
    elif kind == "Timestamp":
        out.append(f"TIMESTAMP({value.payload})")
    elif kind == "Binary":
        out.append(f"BINARY({binary_to_base64(bytes(value))})")


def _write_array(items: list, fmt: Format, level: int, out: list[str]) -> None:
    if not items:
        out.append("[]")
        return
    out.append("[")
    if fmt.indent is None:
        for i, item in enumerate(items):
            if i:
                out.append(",")
            _write_value(item, fmt, level + 1, out)
    else:
        for item in items:
            out.append("\n" + fmt.indent * (level + 1))
            _write_value(item, fmt, level + 1, out)
            out.append(",")
        out.append("\n" + fmt.indent * level)
    out.append("]")


def _write_object(obj: dict, fmt: Format, level: int, out: list[str]) -> None:
    for key in obj:
        # §13.6: a key outside the identifier grammar has no STF spelling.
        if not isinstance(key, str):
            raise _unrepresentable(f"an STF key must be a string, not {type(key).__name__}")
        if not key:
            raise _unrepresentable("an STF key must not be empty")
        if not _IDENTIFIER.match(key):
            raise _unrepresentable(f"key `{key}` is not a valid STF identifier ([A-Za-z0-9_-]+)")

    if not obj:
        out.append("{}")
        return

    # §14 rule 5: canonical output orders members by ascending UTF-8 key bytes. Key characters
    # are ASCII (§6.1), so an ordinary string sort is already a byte sort.
    keys = sorted(obj) if fmt.canonical else list(obj)

    out.append("{")
    if fmt.indent is None:
        for i, key in enumerate(keys):
            if i:
                out.append(",")
            out.append(f"{key}:")
            _write_value(obj[key], fmt, level + 1, out)
    else:
        for key in keys:
            out.append("\n" + fmt.indent * (level + 1) + key + ": ")
            _write_value(obj[key], fmt, level + 1, out)
            out.append(",")
        out.append("\n" + fmt.indent * level)
    out.append("}")


_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def _write_string(s: str, fmt: Format, out: list[str]) -> None:
    """§13.3: prefer the raw form, but a backtick has no raw escape. §14 rule 6 forces the
    interpreted form for canonical output.

    §13.2 is what this function does *not* do: string content never causes a constructor
    to be emitted.
    """
    needs_interpreted = fmt.canonical or "`" in s
    if not needs_interpreted:
        for ch in s:
            code = ord(ch)
            if code < 0x20 and ch not in "\n\r\t":
                needs_interpreted = True
                break
            if fmt.escape_line_terminators and ch in "\n\r":
                needs_interpreted = True
                break
    if not needs_interpreted:
        out.append(f"`{s}`")
        return

    body = ['"']
    for ch in s:
        if ch in _ESCAPES:
            body.append(_ESCAPES[ch])
        elif ord(ch) < 0x20:
            body.append(f"\\u{ord(ch):04X}")
        else:
            # §13.5: non-ASCII scalars are emitted literally as UTF-8.
            body.append(ch)
    body.append('"')
    out.append("".join(body))


def format_number(n: float) -> str:
    """§13.4: the shortest decimal form that parses back to the identical ``binary64``.

    ``repr`` already gives a shortest round-tripping form, but never an integer one, so
    ``1.0`` would be emitted as ``1.0`` where ``1`` is both shorter and valid. Both spellings
    are checked and the shorter is taken.
    """
    if isinstance(n, bool) or not isinstance(n, float):
        raise _unrepresentable(f"{type(n).__name__} is not an STF Number")
    if math.isnan(n):
        raise _unrepresentable("NaN is not an STF Number")
    if math.isinf(n):
        raise _unrepresentable("an infinity is not an STF Number")
    if n == 0.0:
        return "-0" if math.copysign(1.0, n) < 0 else "0"

    best = repr(n)
    if n.is_integer() and abs(n) < 1e17:
        as_int = str(int(n))
        if len(as_int) < len(best):
            best = as_int
    return best
