"""The STF 1.0 parser."""

from __future__ import annotations

from dataclasses import dataclass

from . import constructors
from .errors import STFError, locate
from .value import STFDirective, STFDocument

#: Spec §11.3. The default MUST be 64 so documents port between conformant parsers.
DEFAULT_MAX_DEPTH = 64

_WS = " \t\n\r"


@dataclass(frozen=True)
class Limits:
    """Optional resource limits (spec §15). ``None`` means unlimited, the specified default."""

    max_depth: int = DEFAULT_MAX_DEPTH
    max_document_bytes: int | None = None
    max_payload_bytes: int | None = None


@dataclass(frozen=True)
class Mode:
    """How the parser frames its input."""

    kind: str = "document"  # "document" | "record" | "header"
    #: For a record: whether a line terminator actually followed.
    newline_follows: bool = False


def _is_ident(ch: str) -> bool:
    return ch.isascii() and (ch.isalnum() or ch == "_" or ch == "-")


class Parser:
    __slots__ = ("src", "pos", "depth", "limits", "mode")

    def __init__(self, src: str, limits: Limits | None = None, mode: Mode | None = None) -> None:
        self.src = src
        self.pos = 0
        self.depth = 0
        self.limits = limits or Limits()
        self.mode = mode or Mode()
        if self.limits.max_document_bytes is not None and len(src) > self.limits.max_document_bytes:
            raise self._err("ERR_DOCUMENT_SIZE", "document exceeds the configured size limit", 0)

    # ------------------------------------------------------------------ helpers

    def _err(self, code: str, detail: str, offset: int | None = None) -> STFError:
        return STFError(code, detail, locate(self.src, self.pos if offset is None else offset))

    def _peek(self, at: int = 0) -> str:
        i = self.pos + at
        return self.src[i] if i < len(self.src) else ""

    def _skip_ws(self) -> None:
        """Skips whitespace and comments (spec §4). A comment ends at LF *or* CR."""
        src, n = self.src, len(self.src)
        i = self.pos
        while i < n:
            ch = src[i]
            if ch in _WS:
                i += 1
            elif ch == "#":
                i += 1
                while i < n and src[i] not in "\n\r":
                    i += 1
            else:
                break
        self.pos = i

    # ---------------------------------------------------------------- documents

    def parse_document(self) -> STFDocument:
        """Parses a whole document: directives, one root object, then end of input."""
        # A BOM is not whitespace (spec §2) and must not read as a missing root.
        if self.src.startswith("﻿"):
            raise self._err("ERR_SYNTAX", "leading byte order mark", 0)

        directives: list[STFDirective] = []
        self._skip_ws()
        while self._peek() == "@":
            d = self._parse_directive()
            if any(e.name == d.name for e in directives):
                raise self._err("ERR_SYNTAX", f"directive `@{d.name}` appears more than once")
            directives.append(d)
            self._skip_ws()

        if self._peek() != "{":
            detail = (
                "document contains no root object"
                if self.pos >= len(self.src)
                else "document root must be an object"
            )
            raise self._err("ERR_ROOT_NOT_OBJECT", detail)

        root = self._parse_object()
        self._skip_ws()
        if self.pos < len(self.src):
            raise self._err("ERR_TRAILING_CONTENT", "content follows the root object")
        return STFDocument(directives, root)

    def _parse_directive(self) -> STFDirective:
        """``@name(payload)`` with no whitespace around ``@`` or before ``(`` (spec §5.1)."""
        at = self.pos
        if self.mode.kind == "record":
            raise self._err(
                "ERR_STREAM_DIRECTIVE_IN_RECORD",
                "a stream record must not contain a directive",
                at,
            )
        self.pos += 1  # '@'
        start = self.pos
        while _is_ident(self._peek()):
            self.pos += 1
        if self.pos == start:
            raise self._err("ERR_SYNTAX", "directive name is empty")
        name = self.src[start : self.pos]
        if self._peek() != "(":
            raise self._err("ERR_SYNTAX", "expected `(` immediately after the directive name")
        self.pos += 1
        payload_start = self.pos
        while True:
            ch = self._peek()
            if ch == "":
                raise self._err("ERR_UNTERMINATED", "unterminated directive")
            if ch == ")":
                break
            if ch == "(":
                raise self._err("ERR_NESTED_CONSTRUCTOR", "`(` inside a directive payload")
            self.pos += 1
        payload = self.src[payload_start : self.pos]
        self.pos += 1  # ')'
        return STFDirective(name, payload)

    # ------------------------------------------------------------ compound values

    def _enter(self, at: int) -> None:
        self.depth += 1
        if self.depth > self.limits.max_depth:
            raise self._err(
                "ERR_NESTING_DEPTH",
                f"nesting exceeds the maximum depth of {self.limits.max_depth}",
                at,
            )

    def _parse_object(self) -> dict:
        open_at = self.pos
        self.pos += 1  # '{'
        self._enter(open_at)
        obj: dict = {}

        self._skip_ws()
        if self._peek() == ",":
            raise self._err("ERR_MISSING_COMMA", "leading comma")
        while self._peek() != "}":
            if self._peek() == "":
                raise self._err("ERR_UNTERMINATED", "unterminated object")

            key_at = self.pos
            key = self._parse_key()
            self._skip_ws()
            if self._peek() != ":":
                # `{a b: 1}` is a key containing whitespace (§6.2); `{a 1}` is a missing colon.
                if self._looks_like_split_key():
                    raise self._err(
                        "ERR_INVALID_IDENTIFIER", "whitespace is not permitted within a key"
                    )
                raise self._err("ERR_MISSING_COLON", "expected `:` after the key")
            self.pos += 1

            value = self._parse_value()
            if key in obj:
                raise self._err("ERR_DUPLICATE_KEY", f"duplicate key `{key}`", key_at)
            obj[key] = value

            self._skip_ws()
            ch = self._peek()
            if ch == ",":
                self.pos += 1
                self._skip_ws()
                if self._peek() == ",":
                    raise self._err("ERR_MISSING_COMMA", "consecutive commas")
            elif ch == "}":
                break
            elif ch == "":
                raise self._err("ERR_UNTERMINATED", "unterminated object")
            else:
                raise self._err("ERR_MISSING_COMMA", "expected `,` between members")

        self.pos += 1  # '}'
        self.depth -= 1
        return obj

    def _parse_array(self) -> list:
        open_at = self.pos
        self.pos += 1  # '['
        self._enter(open_at)
        items: list = []

        self._skip_ws()
        if self._peek() == ",":
            raise self._err("ERR_MISSING_COMMA", "leading comma")
        while self._peek() != "]":
            if self._peek() == "":
                raise self._err("ERR_UNTERMINATED", "unterminated array")
            items.append(self._parse_value())
            self._skip_ws()
            ch = self._peek()
            if ch == ",":
                self.pos += 1
                self._skip_ws()
                if self._peek() == ",":
                    raise self._err("ERR_MISSING_COMMA", "consecutive commas")
            elif ch == "]":
                break
            elif ch == "":
                raise self._err("ERR_UNTERMINATED", "unterminated array")
            else:
                raise self._err("ERR_MISSING_COMMA", "expected `,` between elements")

        self.pos += 1  # ']'
        self.depth -= 1
        return items

    # -------------------------------------------------------------------- keys

    def _parse_key(self) -> str:
        """Keys are unquoted identifiers (spec §6.1). A quoted key is ``ERR_SYNTAX``."""
        ch = self._peek()
        if ch in ('"', "`"):
            raise self._err("ERR_SYNTAX", "keys must not be quoted")
        start = self.pos
        while _is_ident(self._peek()):
            self.pos += 1
        if self.pos == start:
            raise self._err(
                "ERR_INVALID_IDENTIFIER", "expected a key matching [A-Za-z0-9_-]+", start
            )
        # A character that is neither whitespace, a comment, nor `:` straight after the
        # identifier is a bad key character (`a.b`), not a missing colon.
        nxt = self._peek()
        if nxt != "" and nxt not in _WS and nxt != "#" and nxt != ":":
            raise self._err("ERR_INVALID_IDENTIFIER", "character is not permitted in a key")
        return self.src[start : self.pos]

    def _looks_like_split_key(self) -> bool:
        """True when the cursor holds a second identifier that is itself followed by ``:``."""
        src, n = self.src, len(self.src)
        i = start = self.pos
        while i < n and _is_ident(src[i]):
            i += 1
        if i == start:
            return False
        while i < n and src[i] in _WS:
            i += 1
        return i < n and src[i] == ":"

    # ------------------------------------------------------------------ values

    def _parse_value(self):
        self._skip_ws()
        ch = self._peek()
        if ch == "":
            raise self._err("ERR_UNTERMINATED", "expected a value")
        if ch == "{":
            return self._parse_object()
        if ch == "[":
            return self._parse_array()
        if ch == "`":
            return self._parse_raw_string()
        if ch == '"':
            return self._parse_interpreted_string()
        # `+` and `.` cannot start a valid number, but dispatching them here yields the
        # specific ERR_INVALID_NUMBER that §7.1 requires rather than generic syntax.
        if ch in "+-." or ("0" <= ch <= "9"):
            return self._parse_number()
        if ch.isascii() and (ch.isalpha() or ch == "_"):
            return self._parse_word()
        raise self._err("ERR_SYNTAX", "expected a value")

    def _parse_word(self):
        """A bare word: a ``T``/``F``/``N`` literal, or a constructor when ``(`` follows."""
        start = self.pos
        while _is_ident(self._peek()):
            self.pos += 1
        word = self.src[start : self.pos]

        if self._peek() != "(":
            # Scanning greedily is what enforces the §7.4 boundary rule: `NaN` never reaches
            # here as `N` followed by `aN`.
            if word == "T":
                return True
            if word == "F":
                return False
            if word == "N":
                return None
            raise self._err(
                "ERR_SYNTAX",
                f"`{word}` is not a value; literals are `T`, `F`, and `N`",
                start,
            )

        if not constructors.is_known_constructor(word):
            if constructors.is_reserved_constructor(word):
                raise self._err(
                    "ERR_UNKNOWN_CONSTRUCTOR", f"`{word}` is not an STF 1.0 constructor", start
                )
            raise self._err("ERR_SYNTAX", f"`{word}` is not valid in value position", start)

        self.pos += 1  # '('
        payload_start = self.pos
        while True:
            ch = self._peek()
            if ch == "":
                raise self._err("ERR_UNTERMINATED", "unterminated constructor")
            if ch == ")":
                break
            if ch == "(":
                raise self._err("ERR_NESTED_CONSTRUCTOR", "`(` inside a constructor payload")
            self.pos += 1
        payload = self.src[payload_start : self.pos]
        if (
            self.limits.max_payload_bytes is not None
            and len(payload) > self.limits.max_payload_bytes
        ):
            raise self._err("ERR_PAYLOAD_SIZE", "payload exceeds the configured limit", payload_start)
        try:
            value = constructors.build(word, payload)
        except constructors.PayloadError as e:
            raise self._err(e.code, e.detail, payload_start) from None
        self.pos += 1  # ')'
        return value

    # ----------------------------------------------------------------- strings

    def _parse_raw_string(self) -> str:
        """Spec §8.1. No escape processing; a backtick cannot appear inside."""
        open_at = self.pos
        self.pos += 1
        start = self.pos
        end = self.src.find("`", start)
        if end == -1:
            raise self._unterminated_string(open_at, "unterminated raw string")
        self.pos = end + 1
        return self.src[start:end]

    def _parse_interpreted_string(self) -> str:
        """Spec §8.2 and §8.3. The JSON escape set exactly, with surrogate pairing enforced."""
        open_at = self.pos
        self.pos += 1
        buf: list[str] = []
        simple = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            "b": "\b",
            "f": "\f",
            "n": "\n",
            "r": "\r",
            "t": "\t",
        }
        while True:
            ch = self._peek()
            if ch == "":
                raise self._unterminated_string(open_at, "unterminated interpreted string")
            if ch == '"':
                self.pos += 1
                return "".join(buf)
            if ch in "\n\r":
                raise self._err(
                    "ERR_INVALID_STRING", "literal line terminator in an interpreted string"
                )
            if ch != "\\":
                buf.append(ch)
                self.pos += 1
                continue

            esc_at = self.pos
            self.pos += 1
            esc = self._peek()
            if esc == "":
                raise self._unterminated_string(open_at, "unterminated interpreted string")
            self.pos += 1
            if esc in simple:
                buf.append(simple[esc])
            elif esc == "u":
                unit = self._parse_hex4(esc_at)
                if 0xD800 <= unit <= 0xDBFF:
                    if self._peek() != "\\" or self._peek(1) != "u":
                        raise self._err(
                            "ERR_INVALID_STRING",
                            "high surrogate is not followed by a low surrogate",
                            esc_at,
                        )
                    self.pos += 2
                    low = self._parse_hex4(esc_at)
                    if not 0xDC00 <= low <= 0xDFFF:
                        raise self._err(
                            "ERR_INVALID_STRING",
                            "high surrogate is not followed by a low surrogate",
                            esc_at,
                        )
                    buf.append(chr(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)))
                elif 0xDC00 <= unit <= 0xDFFF:
                    raise self._err("ERR_INVALID_STRING", "lone low surrogate", esc_at)
                else:
                    buf.append(chr(unit))
            else:
                raise self._err("ERR_INVALID_STRING", "unrecognized escape sequence", esc_at)

    def _parse_hex4(self, at: int) -> int:
        if self.pos + 4 > len(self.src):
            raise self._err("ERR_INVALID_STRING", "`\\u` needs four hex digits", at)
        chunk = self.src[self.pos : self.pos + 4]
        if not all(c in "0123456789abcdefABCDEF" for c in chunk):
            raise self._err("ERR_INVALID_STRING", "`\\u` needs four hex digits", at)
        self.pos += 4
        return int(chunk, 16)

    def _unterminated_string(self, at: int, detail: str) -> STFError:
        """In a stream record, a string left open at end of line is a raw line terminator
        inside a string (stream §3.2) — but only when a terminator actually follows."""
        if self.mode.kind == "record" and self.mode.newline_follows:
            return self._err(
                "ERR_STREAM_RAW_NEWLINE",
                "a stream record must not contain a raw line terminator",
                at,
            )
        return self._err("ERR_UNTERMINATED", detail, at)

    # ----------------------------------------------------------------- numbers

    def _parse_number(self) -> float:
        """Spec §7. Grammar, then the §7.4 boundary rule, then the ``binary64`` conversion."""
        start = self.pos
        if self._peek() == "+":
            raise self._err("ERR_INVALID_NUMBER", "leading `+` is not permitted", start)
        if self._peek() == "-":
            self.pos += 1

        ch = self._peek()
        if ch == "0":
            self.pos += 1
        elif "1" <= ch <= "9":
            while "0" <= self._peek() <= "9" and self._peek() != "":
                self.pos += 1
        else:
            raise self._err("ERR_INVALID_NUMBER", "number has no integer part", start)

        if self._peek() == ".":
            self.pos += 1
            frac_start = self.pos
            while self._peek() != "" and "0" <= self._peek() <= "9":
                self.pos += 1
            if self.pos == frac_start:
                raise self._err("ERR_INVALID_NUMBER", "fraction has no digits")

        if self._peek() in ("e", "E"):
            self.pos += 1
            if self._peek() in ("+", "-"):
                self.pos += 1
            exp_start = self.pos
            while self._peek() != "" and "0" <= self._peek() <= "9":
                self.pos += 1
            if self.pos == exp_start:
                raise self._err("ERR_INVALID_NUMBER", "exponent has no digits")

        # §7.4: rejects `0x10`, `1_000`, `0123`, and `1.2.3` at the offending character.
        nxt = self._peek()
        if nxt != "" and (_is_ident(nxt) or nxt == "."):
            raise self._err(
                "ERR_INVALID_NUMBER", "number is immediately followed by an identifier character"
            )

        text = self.src[start : self.pos]
        # §7.2: the domain is binary64, so an integer literal is a float too. Returning a
        # Python int here would widen the domain and is explicitly non-conformant.
        value = float(text)
        if value in (float("inf"), float("-inf")):
            raise self._err(
                "ERR_NUMBER_OVERFLOW", "magnitude exceeds the finite binary64 range", start
            )
        return value

    # ------------------------------------------------------------------ stream

    def parse_record(self) -> dict:
        """Parses one stream record: a root object with no directives, then end of line."""
        self._skip_ws()
        if self._peek() == "@":
            self._parse_directive()  # always raises in record mode
        if self._peek() != "{":
            raise self._err("ERR_ROOT_NOT_OBJECT", "a record root must be an object")
        root = self._parse_object()
        self._skip_ws()
        if self.pos < len(self.src):
            raise self._err("ERR_TRAILING_CONTENT", "content follows the record")
        return root

    def parse_header_line(self) -> list[STFDirective]:
        """Parses a stream header line: one or more directives and nothing else."""
        out: list[STFDirective] = []
        self._skip_ws()
        while self._peek() == "@":
            d = self._parse_directive()
            if any(e.name == d.name for e in out):
                raise self._err("ERR_SYNTAX", f"directive `@{d.name}` appears more than once")
            out.append(d)
            self._skip_ws()
        if self.pos < len(self.src):
            raise self._err(
                "ERR_STREAM_DIRECTIVE_IN_RECORD", "a header line must contain only directives"
            )
        return out
