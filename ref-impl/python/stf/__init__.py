"""Reference implementation of **STF 1.0** — the Structured Text Format.

The normative documents are ``doc/spec.md`` and ``doc/error-codes.md``; section references
throughout this package point at them. The executable contract is the corpus under
``tests/conformance/``.

    >>> import stf
    >>> value = stf.parse("{ price: DECIMAL(19.99), tags: [`a`, `b`] }")
    >>> stf.kind_of(value["price"])
    'Decimal'
    >>> stf.serialize(value, stf.CANONICAL)
    '{price:DECIMAL(19.99),tags:["a","b"]}'
"""

from __future__ import annotations

from .constructors import (
    CONSTRUCTOR_NAMES,
    binary_to_base64,
    parse_bigint,
    parse_binary,
    parse_date,
    parse_decimal,
    parse_timestamp,
)
from .errors import ERROR_CODES, STFError
from .json_interop import (
    PAYLOAD_AS_STRING,
    REJECT,
    from_json,
    from_json_text,
    to_json,
    to_tagged_json,
)
from .parser import DEFAULT_MAX_DEPTH, Limits, Mode, Parser
from .serialize import (
    CANONICAL,
    COMPACT,
    Format,
    format_number,
    pretty,
    serialize,
    serialize_document,
    single_line,
)
from .stream import (
    STFRecord,
    STFStream,
    parse_stream,
    read_stream,
    serialize_stream,
    stream_directives,
)
from .value import (
    STFDate,
    STFDecimal,
    STFDirective,
    STFDocument,
    STFOffset,
    STFTimestamp,
    STFValue,
    equal,
    kind_of,
)

__version__ = "0.1.0"


def parse(text: str, limits: Limits | None = None) -> dict:
    """Parses a document and returns its root object."""
    return parse_document(text, limits).root


def parse_document(text: str, limits: Limits | None = None) -> STFDocument:
    """Parses a document, keeping its directives (spec §5.1), which are metadata not data."""
    return Parser(text, limits, Mode("document")).parse_document()


def parse_bytes(data: bytes, limits: Limits | None = None) -> dict:
    """Parses raw bytes, enforcing the UTF-8 requirement of spec §2.

    Substituting ``U+FFFD`` is prohibited, so malformed input is rejected outright.
    """
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as e:
        raise STFError("ERR_INVALID_UTF8", f"input is not well-formed UTF-8: {e}") from None
    return parse(text, limits)


def format(text: str, limits: Limits | None = None) -> str:  # noqa: A001 - matches the CLI verb
    """Parses then reserializes, with two-space indentation."""
    return serialize_document(parse_document(text, limits), pretty())


__all__ = [
    "CANONICAL",
    "COMPACT",
    "CONSTRUCTOR_NAMES",
    "DEFAULT_MAX_DEPTH",
    "ERROR_CODES",
    "Format",
    "Limits",
    "Mode",
    "PAYLOAD_AS_STRING",
    "Parser",
    "REJECT",
    "STFDate",
    "STFDecimal",
    "STFDirective",
    "STFDocument",
    "STFError",
    "STFOffset",
    "STFRecord",
    "STFStream",
    "STFTimestamp",
    "STFValue",
    "__version__",
    "binary_to_base64",
    "equal",
    "format",
    "format_number",
    "from_json",
    "from_json_text",
    "kind_of",
    "parse",
    "parse_bigint",
    "parse_binary",
    "parse_bytes",
    "parse_date",
    "parse_decimal",
    "parse_document",
    "parse_stream",
    "parse_timestamp",
    "pretty",
    "read_stream",
    "serialize",
    "serialize_document",
    "serialize_stream",
    "single_line",
    "stream_directives",
    "to_json",
    "to_tagged_json",
]
