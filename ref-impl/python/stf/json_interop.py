"""JSON interchange.

STF replaces JSON rather than extending it, so conversion is lossy in both directions and
this module fails loudly instead of guessing. Silently writing ``DECIMAL(1.5)`` as the string
``"1.5"`` is the in-band sentinel spec §3.1 forbids.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .constructors import binary_to_base64
from .errors import STFError
from .serialize import format_number
from .value import STFGeometry, kind_of

_IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]+$")

#: The largest magnitude an integer can have and still be exactly a ``binary64``.
_EXACT_INT_LIMIT = 9007199254740992


def _unrepresentable(detail: str) -> STFError:
    return STFError("ERR_UNREPRESENTABLE", detail)


def from_json(data: Any) -> dict:
    """Converts a decoded JSON document to STF. The root must be a JSON object."""
    if not isinstance(data, dict):
        raise _unrepresentable(
            f"an STF document root must be an object, but this JSON root is {_json_kind(data)}"
        )
    return _convert_from(data, "$")


def _json_kind(data: Any) -> str:
    if data is None:
        return "null"
    if isinstance(data, bool):
        return "a boolean"
    if isinstance(data, (int, float)):
        return "a number"
    if isinstance(data, str):
        return "a string"
    if isinstance(data, list):
        return "an array"
    return "an object"


def _convert_from(data: Any, path: str):
    if data is None or isinstance(data, (bool, str)):
        return data
    if isinstance(data, int):
        if abs(data) > _EXACT_INT_LIMIT:
            raise _unrepresentable(
                f"{path}: integer {data} is not exactly representable as binary64; "
                f"write it as BIGINT({data}) instead"
            )
        return float(data)
    if isinstance(data, float):
        if data != data or data in (float("inf"), float("-inf")):
            raise _unrepresentable(f"{path}: {data} is not an STF Number")
        return data
    if isinstance(data, list):
        return [_convert_from(item, f"{path}[{i}]") for i, item in enumerate(data)]
    if isinstance(data, dict):
        out: dict = {}
        for key, item in data.items():
            if not isinstance(key, str):
                raise _unrepresentable(f"{path}: an STF key must be a string")
            if not key:
                raise _unrepresentable(f"{path}: an STF key must not be empty")
            if not _IDENTIFIER.match(key):
                raise _unrepresentable(
                    f"{path}: key `{key}` is not a valid STF identifier ([A-Za-z0-9_-]+)"
                )
            out[key] = _convert_from(item, f"{path}.{key}")
        return out
    raise _unrepresentable(f"{path}: {type(data).__name__} has no STF representation")


def from_json_text(text: str) -> dict:
    """Parses JSON text and converts it.

    ``json.loads`` yields Python ``int`` for integer literals, so an oversized integer would
    otherwise be silently narrowed on conversion; :func:`from_json` refuses it instead.
    """
    return from_json(json.loads(text))


#: Refuse typed values (the default), or write their payload as a JSON string (lossy).
REJECT = "reject"
PAYLOAD_AS_STRING = "payload-as-string"


def to_json(value, policy: str = REJECT):
    """Converts an STF value to a JSON-encodable Python value. Geometry is emitted as GeoJSON."""
    return _convert_to(value, "$", policy)


def to_geojson(value: STFGeometry) -> dict:
    """Converts an STF Geometry value to a GeoJSON object."""
    return {"type": value.type, "coordinates": value.coordinates}


# Alias — explicit GeoJSON output for Geometry.
to_geo = to_geojson


def _convert_to(value, path: str, policy: str):
    kind = kind_of(value)

    def typed(payload: str, what: str):
        if policy == PAYLOAD_AS_STRING:
            return payload
        raise _unrepresentable(
            f"{path}: JSON has no {what} type. Convert with the lossy policy to write the "
            f"payload as a string, accepting that the type is lost."
        )

    if kind in ("Null", "Boolean", "String"):
        return value
    if kind == "Number":
        # Emit an integral value as a JSON integer, which is what a JSON writer produces and
        # what keeps a JSON -> STF -> JSON round trip textually stable.
        if value.is_integer() and abs(value) <= _EXACT_INT_LIMIT:
            return int(value)
        return value
    if kind == "Array":
        return [_convert_to(item, f"{path}[{i}]", policy) for i, item in enumerate(value)]
    if kind == "Object":
        return {k: _convert_to(v, f"{path}.{k}", policy) for k, v in value.items()}
    if kind == "BigInt":
        return typed(str(value), "arbitrary-precision integer")
    if kind == "Decimal":
        return typed(value.payload, "exact decimal")
    if kind == "Date":
        return typed(value.payload, "date")
    if kind == "Timestamp":
        return typed(value.payload, "timestamp")
    if kind == "Binary":
        return typed(binary_to_base64(bytes(value)), "binary")
    if kind == "Geometry":
        return {"type": value.type, "coordinates": value.coordinates}
    if kind == "Time":
        return typed(value.payload, "time")
    if kind == "Duration":
        return typed(value.payload, "duration")
    raise _unrepresentable(f"{path}: {kind} has no JSON representation")


def to_tagged_json(value):
    """Encodes a value in the conformance corpus's **tagged JSON**, lossless where JSON is not.

    ``$`` is safe as an escape key because it is not a legal STF key character (spec §6.1),
    so a tag can never collide with a real parsed object.
    """
    kind = kind_of(value)
    if kind in ("Null", "Boolean", "String"):
        return value
    if kind == "Array":
        return [to_tagged_json(item) for item in value]
    if kind == "Object":
        return {k: to_tagged_json(v) for k, v in value.items()}
    # Numbers are tagged with a string too: JSON numbers cannot express -0 and give no
    # binary64 round-trip guarantee, both of which §7.2 and §7.3 make observable.
    if kind == "Number":
        return {"$": "num", "v": format_number(value)}
    if kind == "BigInt":
        return {"$": "bigint", "v": str(value)}
    if kind == "Decimal":
        return {"$": "dec", "v": value.payload}
    if kind == "Date":
        return {"$": "date", "v": value.payload}
    if kind == "Timestamp":
        return {"$": "ts", "v": value.payload}
    if kind == "Binary":
        return {"$": "bin", "v": binary_to_base64(bytes(value))}
    if kind == "Geometry":
        import json as _json

        return {"$": "geo", "v": _json.dumps({"type": value.type, "coordinates": value.coordinates})}
    if kind == "Time":
        return {"$": "time", "v": value.payload}
    if kind == "Duration":
        return {"$": "dur", "v": value.payload}
    raise _unrepresentable(f"{kind} has no tagged-JSON encoding")
