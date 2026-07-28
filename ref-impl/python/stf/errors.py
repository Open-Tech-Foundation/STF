"""Error codes and the error type.

Every rejection required by the specification maps to exactly one code from
``doc/error-codes.md``. Only the code is normative; message text is not (spec §16).
"""

from __future__ import annotations

ERROR_CODES = (
    # Encoding
    "ERR_INVALID_UTF8",
    # General syntax
    "ERR_SYNTAX",
    "ERR_UNTERMINATED",
    "ERR_TRAILING_CONTENT",
    # Structure
    "ERR_ROOT_NOT_OBJECT",
    "ERR_DUPLICATE_KEY",
    "ERR_MISSING_COLON",
    "ERR_MISSING_COMMA",
    # Identifiers
    "ERR_INVALID_IDENTIFIER",
    # Primitive values
    "ERR_INVALID_NUMBER",
    "ERR_NUMBER_OVERFLOW",
    "ERR_INVALID_STRING",
    # Constructors
    "ERR_UNKNOWN_CONSTRUCTOR",
    "ERR_INVALID_CONSTRUCTOR_PAYLOAD",
    "ERR_NESTED_CONSTRUCTOR",
    "ERR_DECIMAL_OVERFLOW",
    # Resource limits
    "ERR_NESTING_DEPTH",
    "ERR_DOCUMENT_SIZE",
    "ERR_PAYLOAD_SIZE",
    # Serialization
    "ERR_UNREPRESENTABLE",
    # Stream profile
    "ERR_STREAM_RAW_NEWLINE",
    "ERR_STREAM_DIRECTIVE_IN_RECORD",
)


class STFError(Exception):
    """A rejection.

    ``code`` is the normative part; callers branch on it rather than on ``args``.
    """

    __slots__ = ("code", "detail", "offset", "line", "column")

    def __init__(
        self,
        code: str,
        detail: str,
        position: tuple[int, int, int] | None = None,
    ) -> None:
        self.code = code
        self.detail = detail
        if position is None:
            self.offset, self.line, self.column = -1, 0, 0
            super().__init__(f"{code}: {detail}")
        else:
            self.offset, self.line, self.column = position
            super().__init__(f"{code} at {self.line}:{self.column}: {detail}")


def locate(text: str, offset: int) -> tuple[int, int, int]:
    """Resolves an offset to ``(offset, line, column)``, both 1-based."""
    clamped = max(0, min(offset, len(text)))
    line_start = text.rfind("\n", 0, clamped) + 1
    line = text.count("\n", 0, clamped) + 1
    return clamped, line, clamped - line_start + 1
