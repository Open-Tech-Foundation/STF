"""The STF data model (spec §3): eleven mutually distinct kinds.

Spec §3.1 forbids representing a typed value as a string carrying a marker prefix, so the
mapping onto Python types keeps every kind distinguishable:

===========  ==========================================================
STF kind     Python type
===========  ==========================================================
Null         ``None``
Boolean      ``bool``
Number       ``float`` — always, because §7.2 makes Number exactly binary64
String       ``str``
Array        ``list``
Object       ``dict`` — insertion-ordered since 3.7, as §11.2 requires
BigInt       ``int`` — arbitrary precision, and never used for Number
Decimal      :class:`STFDecimal`
Date         :class:`STFDate`
Timestamp    :class:`STFTimestamp`
Binary       ``bytes``
===========  ==========================================================

``bool`` is a subclass of ``int`` in Python, so :func:`kind_of` tests it first.
``decimal.Decimal`` is deliberately *not* used: its ``==`` compares numerically, so
``Decimal("1.5") == Decimal("1.50")``, while spec §3.2 requires those to differ.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Union

STFValue = Union[
    None,
    bool,
    float,
    str,
    list,
    dict,
    int,
    "STFDecimal",
    "STFDate",
    "STFTimestamp",
    bytes,
    "STFGeometry",
    "STFTime",
    "STFDuration",
]


@dataclass(frozen=True)
class STFDecimal:
    """An exact signed decimal: a coefficient and a scale (spec §10.2).

    ``DECIMAL(1.5)`` and ``DECIMAL(1.50)`` are distinct values, so the scale is data and is
    never normalized away. The sign is dropped when the coefficient is zero, since zero has
    one mathematical value.
    """

    negative: bool
    coefficient: int
    scale: int

    def __post_init__(self) -> None:
        if self.coefficient == 0 and self.negative:
            object.__setattr__(self, "negative", False)

    @property
    def payload(self) -> str:
        """The canonical payload text, reproducing the authored spelling exactly."""
        digits = str(self.coefficient)
        sign = "-" if self.negative else ""
        if self.scale == 0:
            return sign + digits
        if len(digits) > self.scale:
            cut = len(digits) - self.scale
            return f"{sign}{digits[:cut]}.{digits[cut:]}"
        return f"{sign}0.{digits.zfill(self.scale)}"

    def __str__(self) -> str:
        return self.payload


@dataclass(frozen=True)
class STFDate:
    """A wall date with no time and no offset (spec §10.4)."""

    year: int
    month: int
    day: int

    @property
    def payload(self) -> str:
        return f"{self.year:04d}-{self.month:02d}-{self.day:02d}"

    def __str__(self) -> str:
        return self.payload


@dataclass(frozen=True)
class STFOffset:
    """A zone designator.

    ``Z`` stays distinct from ``+00:00``, because spec §3.2 makes the spelling data.
    """

    utc: bool = True
    negative: bool = False
    hours: int = 0
    minutes: int = 0

    @property
    def text(self) -> str:
        if self.utc:
            return "Z"
        return f"{'-' if self.negative else '+'}{self.hours:02d}:{self.minutes:02d}"

    def __str__(self) -> str:
        return self.text


@dataclass(frozen=True)
class STFTimestamp:
    """An absolute instant with a mandatory UTC offset (spec §10.4).

    Fractional-second digits are kept as text because trailing zeros are data: ``.100`` is
    not ``.1``.
    """

    date: STFDate
    hour: int
    minute: int
    second: int
    fraction: str | None
    offset: STFOffset

    @property
    def payload(self) -> str:
        frac = "" if self.fraction is None else f".{self.fraction}"
        return (
            f"{self.date.payload}T{self.hour:02d}:{self.minute:02d}:"
            f"{self.second:02d}{frac}{self.offset.text}"
        )

    def __str__(self) -> str:
        return self.payload


@dataclass(frozen=True)
class STFGeometry:
    """Native STF Geometry primitive (new.txt §6).

    Coordinates use WGS84 longitude/latitude ordering [x, y] = [longitude, latitude].
    """

    type: str
    coordinates: Any

    def __str__(self) -> str:
        import json as _json

        return f'Geometry("{self.type}", {_json.dumps(self.coordinates)})'


@dataclass(frozen=True)
class STFTime:
    """Time of day without a date (new.txt §16)."""

    hour: int
    minute: int
    second: int | None
    fraction: str | None

    @property
    def payload(self) -> str:
        base = f"{self.hour:02d}:{self.minute:02d}"
        if self.second is None:
            return base
        frac = "" if self.fraction is None else f".{self.fraction}"
        return f"{base}:{self.second:02d}{frac}"

    def __str__(self) -> str:
        return self.payload


@dataclass(frozen=True)
class STFDuration:
    """ISO-8601 duration. Raw payload preserved (e.g. PT45M)."""

    payload: str

    def __str__(self) -> str:
        return self.payload


@dataclass(frozen=True)
class STFDirective:
    """A document-level directive (spec §5.1). Metadata, not data."""

    name: str
    payload: str


@dataclass
class STFDocument:
    """A parsed document: its directives plus its root object."""

    directives: list[STFDirective] = field(default_factory=list)
    root: dict = field(default_factory=dict)


def kind_of(value: Any) -> str:
    """The STF kind of a host value (spec §3)."""
    if value is None:
        return "Null"
    # bool before int: bool is a subclass of int in Python.
    if isinstance(value, bool):
        return "Boolean"
    if isinstance(value, float):
        return "Number"
    if isinstance(value, int):
        return "BigInt"
    if isinstance(value, str):
        return "String"
    if isinstance(value, (bytes, bytearray)):
        return "Binary"
    if isinstance(value, STFDecimal):
        return "Decimal"
    if isinstance(value, STFTimestamp):
        return "Timestamp"
    if isinstance(value, STFDate):
        return "Date"
    if isinstance(value, STFGeometry):
        return "Geometry"
    if isinstance(value, STFTime):
        return "Time"
    if isinstance(value, STFDuration):
        return "Duration"
    if isinstance(value, list):
        return "Array"
    if isinstance(value, dict):
        return "Object"
    raise TypeError(f"{type(value).__name__} is not an STF value")


def equal(a: Any, b: Any) -> bool:
    """Value equality per spec §3.2.

    Kinds never cross-compare, Numbers keep ``-0`` distinct from ``0``, Decimals are
    scale-sensitive, Binary compares octets, and object member order is ignored.
    """
    kind = kind_of(a)
    if kind != kind_of(b):
        return False

    if kind == "Null":
        return True
    if kind == "Number":
        # NaN cannot occur (§7.3), so this is total; copysign keeps -0 distinct from 0.
        return a == b and math.copysign(1.0, a) == math.copysign(1.0, b)
    if kind == "Array":
        return len(a) == len(b) and all(equal(x, y) for x, y in zip(a, b))
    if kind == "Object":
        return a.keys() == b.keys() and all(equal(a[k], b[k]) for k in a)
    if kind == "Binary":
        return bytes(a) == bytes(b)
    # Boolean, String, BigInt, and the frozen dataclasses all compare correctly with ==.
    return a == b
