"""Constructor payload validation (spec §10.2–§10.5).

Payloads are not tokenized by the parser, so every rule here is enforced against the raw
character sequence between the parentheses.
"""

from __future__ import annotations

from .errors import STFError
from .value import STFDate, STFDecimal, STFDuration, STFGeometry, STFOffset, STFTimestamp, STFTime

#: Constructor names — original five plus Geometry/Time/Duration extensions.
CONSTRUCTOR_NAMES = (
    "BIGINT",
    "DECIMAL",
    "DATE",
    "TIMESTAMP",
    "BINARY",
    "GEOMETRY",
    "TIME",
    "DURATION",
    "Geometry",
    "Time",
    "Duration",
)

#: decimal128 coefficient precision (spec §10.2).
MAX_SIGNIFICANT_DIGITS = 34
#: decimal128 exponent range (spec §10.2).
MAX_SCALE = 6143

_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
_B64_INDEX = {c: i for i, c in enumerate(_B64)}


class PayloadError(Exception):
    """A payload rejection, carrying the normative code."""

    def __init__(self, code: str, detail: str) -> None:
        self.code = code
        self.detail = detail
        super().__init__(detail)


def _bad(detail: str) -> "PayloadError":
    return PayloadError("ERR_INVALID_CONSTRUCTOR_PAYLOAD", detail)


def _overflow(detail: str) -> "PayloadError":
    return PayloadError("ERR_DECIMAL_OVERFLOW", detail)


def is_known_constructor(name: str) -> bool:
    return name in CONSTRUCTOR_NAMES


def is_reserved_constructor(name: str) -> bool:
    """Spec §10.1.

    The reserved namespace is any identifier beginning with an ASCII uppercase letter, plus
    any ASCII case-insensitive match of a defined name. A reserved name that is not an exact
    match is ``ERR_UNKNOWN_CONSTRUCTOR``; anything else before ``(`` is ``ERR_SYNTAX``.
    """
    if name and "A" <= name[0] <= "Z":
        return True
    return name.upper() in CONSTRUCTOR_NAMES


def build(name: str, payload: str):
    upper = name.upper()
    if upper == "DECIMAL":
        return parse_decimal(payload)
    if upper == "BIGINT":
        return parse_bigint(payload)
    if upper == "DATE":
        return parse_date(payload)
    if upper == "TIMESTAMP":
        return parse_timestamp(payload)
    if upper == "BINARY":
        return parse_binary(payload)
    if upper == "GEOMETRY":
        return parse_geometry(payload)
    if upper == "TIME":
        return parse_time(payload)
    if upper == "DURATION":
        return parse_duration(payload)
    raise PayloadError("ERR_UNKNOWN_CONSTRUCTOR", f"`{name}` is not an STF constructor")


def parse_decimal(payload: str) -> STFDecimal:
    """``[ "-" ] ( "0" | digit1_9 { digit } ) [ "." digit { digit } ]`` — plain notation only."""
    if not payload:
        raise _bad("DECIMAL payload is empty")

    i = 0
    negative = payload[0] == "-"
    if negative:
        i = 1

    int_start = i
    if i < len(payload) and payload[i] == "0":
        i += 1
    elif i < len(payload) and payload[i].isdigit() and payload[i] != "0":
        while i < len(payload) and payload[i].isdigit():
            i += 1
    else:
        raise _bad("DECIMAL integer part is missing")
    # A `0` integer part may only be followed by `.`, which rules out `01.5`.
    if payload[int_start] == "0" and i - int_start > 1:
        raise _bad("DECIMAL has a leading zero")
    int_part = payload[int_start:i]

    frac_part = ""
    if i < len(payload) and payload[i] == ".":
        i += 1
        frac_start = i
        while i < len(payload) and payload[i].isdigit():
            i += 1
        if i == frac_start:
            raise _bad("DECIMAL fraction has no digits")
        frac_part = payload[frac_start:i]
    if i != len(payload):
        raise _bad(
            "DECIMAL payload must be plain notation: no exponent, sign, or trailing characters"
        )

    scale = len(frac_part)
    if scale > MAX_SCALE:
        raise _overflow(f"DECIMAL scale {scale} exceeds the maximum of {MAX_SCALE}")

    digits = int_part + frac_part
    # §10.2: leading zeros are not significant, trailing zeros are, and zero counts as 1.
    stripped = digits.lstrip("0")
    significant = len(stripped) if stripped else 1
    if significant > MAX_SIGNIFICANT_DIGITS:
        raise _overflow(
            f"DECIMAL has {significant} significant digits, "
            f"exceeding the maximum of {MAX_SIGNIFICANT_DIGITS}"
        )

    return STFDecimal(negative, int(digits), scale)


def parse_bigint(payload: str) -> int:
    """``"0" | [ "-" ] digit1_9 { digit }`` — one spelling per value."""
    if not payload:
        raise _bad("BIGINT payload is empty")
    if payload == "0":
        return 0

    i = 1 if payload[0] == "-" else 0
    if i >= len(payload) or not ("1" <= payload[i] <= "9"):
        raise _bad("BIGINT must be `0` or an optionally-signed integer with no leading zero")
    i += 1
    while i < len(payload) and payload[i].isdigit():
        i += 1
    if i != len(payload):
        raise _bad("BIGINT payload contains a non-digit character")
    return int(payload)


def _is_leap_year(year: int) -> bool:
    return (year % 4 == 0 and year % 100 != 0) or year % 400 == 0


def _days_in_month(year: int, month: int) -> int:
    if month in (1, 3, 5, 7, 8, 10, 12):
        return 31
    if month in (4, 6, 9, 11):
        return 30
    if month == 2:
        return 29 if _is_leap_year(year) else 28
    return 0


def _ascii_digits(text: str, start: int, count: int) -> bool:
    if start + count > len(text):
        return False
    return all("0" <= text[i] <= "9" for i in range(start, start + count))


def parse_date(payload: str) -> STFDate:
    """``YYYY-MM-DD``, zero-padded, with full proleptic-Gregorian validation (spec §10.4)."""
    if len(payload) != 10:
        raise _bad("DATE must be exactly `YYYY-MM-DD`")
    return _parse_date_at(payload)


def _parse_date_at(text: str) -> STFDate:
    if len(text) < 10:
        raise _bad("DATE must be exactly `YYYY-MM-DD`")
    if not (_ascii_digits(text, 0, 4) and _ascii_digits(text, 5, 2) and _ascii_digits(text, 8, 2)):
        raise _bad("DATE must be exactly `YYYY-MM-DD`")
    if text[4] != "-" or text[7] != "-":
        raise _bad("DATE must be exactly `YYYY-MM-DD`")
    year, month, day = int(text[0:4]), int(text[5:7]), int(text[8:10])
    if not 1 <= month <= 12:
        raise _bad(f"month {month:02d} is out of range")
    if not 1 <= day <= _days_in_month(year, month):
        raise _bad(f"day {day:02d} is out of range for {year:04d}-{month:02d}")
    return STFDate(year, month, day)


def parse_timestamp(payload: str) -> STFTimestamp:
    """``date "T" hh:mm:ss [ "." digit{1,9} ] ( "Z" | ±hh:mm )`` (spec §10.4)."""
    date = _parse_date_at(payload)
    if len(payload) < 19 or payload[10] != "T":
        raise _bad("TIMESTAMP requires an uppercase `T` between date and time")
    if payload[13] != ":" or payload[16] != ":":
        raise _bad("TIMESTAMP time must be `hh:mm:ss`")
    if not (_ascii_digits(payload, 11, 2) and _ascii_digits(payload, 14, 2) and _ascii_digits(payload, 17, 2)):
        raise _bad("TIMESTAMP time must be `hh:mm:ss`")

    hour, minute, second = int(payload[11:13]), int(payload[14:16]), int(payload[17:19])
    if hour > 23:
        raise _bad(f"hour {hour:02d} is out of range")
    if minute > 59:
        raise _bad(f"minute {minute:02d} is out of range")
    # §10.4: leap seconds are not supported, so 60 is simply out of range.
    if second > 59:
        raise _bad(f"second {second:02d} is out of range; leap seconds are not supported")

    i = 19
    fraction = None
    if i < len(payload) and payload[i] == ".":
        i += 1
        start = i
        while i < len(payload) and payload[i].isdigit():
            i += 1
        if not 1 <= i - start <= 9:
            raise _bad("TIMESTAMP fraction must have 1 to 9 digits")
        fraction = payload[start:i]

    if i < len(payload) and payload[i] == "Z":
        offset = STFOffset(utc=True)
        i += 1
    elif i < len(payload) and payload[i] in "+-":
        if i + 6 > len(payload) or payload[i + 3] != ":":
            raise _bad("TIMESTAMP offset must be `±hh:mm`")
        if not (_ascii_digits(payload, i + 1, 2) and _ascii_digits(payload, i + 4, 2)):
            raise _bad("TIMESTAMP offset must be `±hh:mm`")
        hours, minutes = int(payload[i + 1 : i + 3]), int(payload[i + 4 : i + 6])
        if hours > 23:
            raise _bad(f"offset hour {hours:02d} is out of range")
        if minutes > 59:
            raise _bad(f"offset minute {minutes:02d} is out of range")
        offset = STFOffset(utc=False, negative=payload[i] == "-", hours=hours, minutes=minutes)
        i += 6
    else:
        raise _bad("TIMESTAMP requires a UTC offset (`Z` or `±hh:mm`)")

    if i != len(payload):
        raise _bad("TIMESTAMP has trailing characters after the offset")
    return STFTimestamp(date, hour, minute, second, fraction, offset)


def parse_binary(payload: str) -> bytes:
    """Canonical RFC 4648 §4 base64 (spec §10.5). The empty payload is valid."""
    if not payload:
        return b""
    if len(payload) % 4 != 0:
        raise _bad("BINARY length must be a multiple of 4")

    pad = len(payload) - len(payload.rstrip("="))
    if pad > 2:
        raise _bad("BINARY has more than two padding characters")

    data = payload[: len(payload) - pad]
    for ch in data:
        if ch not in _B64_INDEX:
            # Covers the URL-safe alphabet, internal whitespace, and a stray `=`.
            raise _bad("BINARY contains a character outside the standard base64 alphabet")

    # Canonical encoding: the bits the padding discards must be zero.
    if pad:
        if not data:
            raise _bad("BINARY has only padding")
        mask = 0b11 if pad == 1 else 0b1111
        if _B64_INDEX[data[-1]] & mask:
            raise _bad("BINARY has non-canonical trailing bits")

    out = bytearray()
    acc = bits = 0
    for ch in data:
        acc = (acc << 6) | _B64_INDEX[ch]
        bits += 6
        if bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xFF)
    return bytes(out)


def _is_valid_position(p) -> bool:
    return (
        isinstance(p, list)
        and len(p) == 2
        and isinstance(p[0], (int, float))
        and isinstance(p[1], (int, float))
        and abs(float(p[0])) != float("inf")
        and abs(float(p[1])) != float("inf")
        and str(p[0]) != "nan"
        and str(p[1]) != "nan"
    )


_GEOMETRY_TYPES = ("Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon")


def _validate_geometry(type_str: str, coords) -> None:
    if type_str not in _GEOMETRY_TYPES:
        raise _bad(f"Geometry type `{type_str}` is not supported")
    if type_str == "Point":
        if not _is_valid_position(coords):
            raise _bad("Point coordinates must be [x, y]")
    elif type_str == "LineString":
        if not isinstance(coords, list) or len(coords) < 2:
            raise _bad("LineString requires at least 2 positions")
        for p in coords:
            if not _is_valid_position(p):
                raise _bad("LineString coordinates must be positions")
    elif type_str == "Polygon":
        if not isinstance(coords, list) or len(coords) == 0:
            raise _bad("Polygon requires at least one ring")
        for ring in coords:
            if not isinstance(ring, list) or len(ring) < 4:
                raise _bad("Polygon ring must have at least 4 positions")
            for p in ring:
                if not _is_valid_position(p):
                    raise _bad("Polygon ring coordinates must be positions")
            if ring[0] != ring[-1]:
                raise _bad("Polygon ring must be closed (first == last)")
    elif type_str == "MultiPoint":
        if not isinstance(coords, list) or len(coords) == 0:
            raise _bad("MultiPoint requires at least one position")
        for p in coords:
            if not _is_valid_position(p):
                raise _bad("MultiPoint coordinates must be positions")
    elif type_str == "MultiLineString":
        if not isinstance(coords, list) or len(coords) == 0:
            raise _bad("MultiLineString requires at least one line")
        for line in coords:
            if not isinstance(line, list) or len(line) < 2:
                raise _bad("MultiLineString line requires at least 2 positions")
            for p in line:
                if not _is_valid_position(p):
                    raise _bad("MultiLineString coordinates must be positions")
    elif type_str == "MultiPolygon":
        if not isinstance(coords, list) or len(coords) == 0:
            raise _bad("MultiPolygon requires at least one polygon")
        for poly in coords:
            if not isinstance(poly, list) or len(poly) == 0:
                raise _bad("MultiPolygon polygon requires at least one ring")
            for ring in poly:
                if not isinstance(ring, list) or len(ring) < 4:
                    raise _bad("MultiPolygon ring must have at least 4 positions")
                for p in ring:
                    if not _is_valid_position(p):
                        raise _bad("MultiPolygon ring coordinates must be positions")
                if ring[0] != ring[-1]:
                    raise _bad("MultiPolygon ring must be closed")


def parse_geometry(payload: str) -> STFGeometry:
    """Payload: ``\"Type\", <coordinates_json>`` e.g. ``\"Point\", [80.27, 13.08]``."""
    import json as _json

    trimmed = payload.strip()
    if not trimmed:
        raise _bad("Geometry payload is empty")
    if trimmed[0] not in ('"', "'"):
        raise _bad("Geometry payload must start with quoted type string")
    q = trimmed[0]
    end = -1
    for i in range(1, len(trimmed)):
        if trimmed[i] == q and trimmed[i - 1] != "\\":
            end = i
            break
    if end == -1:
        raise _bad("Geometry type string is unterminated")
    try:
        type_str = _json.loads(trimmed[: end + 1])
    except Exception:
        raise _bad("Geometry type string is not valid JSON") from None
    rest = trimmed[end + 1 :].strip()
    if not rest.startswith(","):
        raise _bad("Geometry payload requires a comma after the type")
    coord_text = rest[1:].strip()
    if not coord_text:
        raise _bad("Geometry payload missing coordinates")
    try:
        coords = _json.loads(coord_text)
    except Exception:
        raise _bad("Geometry coordinates are not valid JSON") from None
    _validate_geometry(type_str, coords)
    return STFGeometry(type_str, coords)


def parse_time(payload: str) -> STFTime:
    import json as _json
    import re as _re

    trimmed = payload.strip()
    if not trimmed:
        raise _bad("Time payload is empty")
    inner = trimmed
    if (inner[0] == '"' and inner[-1] == '"') or (inner[0] == "'" and inner[-1] == "'"):
        try:
            inner = _json.loads(inner)
        except Exception:
            raise _bad("Time payload string is not valid") from None
    elif inner[0] in ('"', "'"):
        raise _bad("Time payload string is unterminated")
    m = _re.match(r"^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?$", inner)
    if not m:
        raise _bad(f'Time "{inner}" is not valid (expected HH:mm[:ss[.fraction]])')
    hour = int(m.group(1))
    minute = int(m.group(2))
    second = int(m.group(3)) if m.group(3) is not None else None
    fraction = m.group(4)
    return STFTime(hour, minute, second, fraction)


_DURATION_RE = __import__("re").compile(
    r"^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$"
)


def parse_duration(payload: str) -> STFDuration:
    import json as _json

    trimmed = payload.strip()
    if not trimmed:
        raise _bad("Duration payload is empty")
    inner = trimmed
    if (inner[0] == '"' and inner[-1] == '"') or (inner[0] == "'" and inner[-1] == "'"):
        try:
            inner = _json.loads(inner)
        except Exception:
            raise _bad("Duration payload string is not valid") from None
    elif inner[0] in ('"', "'"):
        raise _bad("Duration payload string is unterminated")
    if inner in ("P", "PT"):
        raise _bad(f'Duration "{inner}" must contain at least one component')
    m = _DURATION_RE.match(inner)
    if not m:
        raise _bad(f'Duration "{inner}" is not valid ISO-8601')
    if not any(v is not None for v in m.groups()):
        raise _bad(f'Duration "{inner}" must contain at least one component')
    if "T" in inner:
        after = inner.split("T", 1)[1]
        if after == "":
            raise _bad(f'Duration "{inner}" has empty time section after T')
        if not __import__("re").search(r"\d+[HMS]", after):
            raise _bad(f'Duration "{inner}" has empty time section after T')
    return STFDuration(inner)


def binary_to_base64(data: bytes) -> str:
    """Encodes octets as canonical base64, for serialization (spec §13.7)."""
    out = []
    for i in range(0, len(data), 3):
        chunk = data[i : i + 3]
        b0 = chunk[0]
        b1 = chunk[1] if len(chunk) > 1 else 0
        b2 = chunk[2] if len(chunk) > 2 else 0
        n = (b0 << 16) | (b1 << 8) | b2
        out.append(_B64[(n >> 18) & 63])
        out.append(_B64[(n >> 12) & 63])
        out.append(_B64[(n >> 6) & 63] if len(chunk) > 1 else "=")
        out.append(_B64[n & 63] if len(chunk) > 2 else "=")
    return "".join(out)


__all__ = [
    "CONSTRUCTOR_NAMES",
    "PayloadError",
    "STFError",
    "binary_to_base64",
    "build",
    "is_known_constructor",
    "is_reserved_constructor",
    "parse_bigint",
    "parse_binary",
    "parse_date",
    "parse_decimal",
    "parse_duration",
    "parse_geometry",
    "parse_time",
    "parse_timestamp",
]
