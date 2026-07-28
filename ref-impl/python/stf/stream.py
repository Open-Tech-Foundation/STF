"""The STF Stream profile: line-delimited record streams (``.stfs``).

The profile's central property is that a record can never contain a raw line terminator, so
the reader splits on ``U+000A`` *before* parsing anything.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator

from .errors import STFError
from .parser import Limits, Mode, Parser
from .serialize import Format, serialize_document, single_line
from .value import STFDirective, STFDocument


@dataclass
class STFStream:
    """A fully-read stream: its header directives plus its records, in order."""

    directives: list[STFDirective] = field(default_factory=list)
    records: list[dict] = field(default_factory=list)


@dataclass
class STFRecord:
    """One item from :func:`read_stream`, tagged with its 1-based line number (stream §2.1)."""

    line: int
    value: dict | None = None
    error: STFError | None = None


@dataclass(frozen=True)
class _Line:
    no: int
    text: str
    #: Whether a line terminator actually followed, which an open string reads differently.
    terminated: bool


def _split_lines(text: str) -> list[_Line]:
    """Splits on LF, discarding a single CR before each terminator (stream §2)."""
    out: list[_Line] = []
    start = 0
    no = 1
    for i, ch in enumerate(text):
        if ch == "\n":
            end = i
            if end > start and text[end - 1] == "\r":
                end -= 1
            out.append(_Line(no, text[start:end], True))
            no += 1
            start = i + 1
    if start < len(text):
        out.append(_Line(no, text[start:], False))
    return out


def _is_ignorable(text: str) -> bool:
    """A line holding only horizontal whitespace and/or a comment (stream §2)."""
    trimmed = text.strip(" \t")
    return not trimmed or trimmed.startswith("#")


def read_stream(text: str, limits: Limits | None = None) -> Iterator[STFRecord]:
    """Reads a stream lazily, yielding one item per non-ignorable line whether or not it parsed.

    This is the continue-on-error policy; :func:`parse_stream` is the aborting one. Stream §5
    requires implementations to offer both.
    """
    if text.startswith("﻿"):
        yield STFRecord(1, None, STFError("ERR_SYNTAX", "leading byte order mark", (0, 1, 1)))
        return

    lines = _split_lines(text)
    index = 0

    # The header, if present, is the first non-ignorable line and holds only directives.
    while index < len(lines) and _is_ignorable(lines[index].text):
        index += 1
    if index < len(lines) and lines[index].text.lstrip(" \t").startswith("@"):
        line = lines[index]
        index += 1
        try:
            # Parsed in document mode, where directives are legal.
            Parser(line.text, limits, Mode("document")).parse_header_line()
        except STFError as e:
            yield STFRecord(line.no, None, e)
            return

    for line in lines[index:]:
        if _is_ignorable(line.text):
            continue
        # Splitting only on LF leaves any interior CR in place; it is a raw line terminator
        # inside the record either way (stream §3.2).
        if "\r" in line.text:
            yield STFRecord(
                line.no,
                None,
                STFError(
                    "ERR_STREAM_RAW_NEWLINE",
                    "a stream record must not contain a raw carriage return",
                    (0, line.no, 1),
                ),
            )
            continue
        try:
            parser = Parser(line.text, limits, Mode("record", line.terminated))
            yield STFRecord(line.no, parser.parse_record(), None)
        except STFError as e:
            yield STFRecord(line.no, None, e)


def stream_directives(text: str, limits: Limits | None = None) -> list[STFDirective]:
    """The header directives of a stream, which apply to every record (stream §4)."""
    if text.startswith("﻿"):
        return []
    lines = _split_lines(text)
    index = 0
    while index < len(lines) and _is_ignorable(lines[index].text):
        index += 1
    if index >= len(lines) or not lines[index].text.lstrip(" \t").startswith("@"):
        return []
    return Parser(lines[index].text, limits, Mode("document")).parse_header_line()


def parse_stream(text: str, limits: Limits | None = None) -> STFStream:
    """Reads a whole stream, aborting at the first malformed record — the default policy."""
    records: list[dict] = []
    for record in read_stream(text, limits):
        if record.error is not None:
            raise record.error
        records.append(record.value)
    return STFStream(stream_directives(text, limits), records)


def serialize_stream(stream: STFStream, fmt: Format) -> str:
    """Writes a stream: an optional header line, then one record per line.

    Stream §3.2 requires a string containing a line terminator to be escaped automatically
    rather than to fail, which the interpreted form already does.
    """
    # A record must occupy exactly one line, so an indented format is not expressible.
    record_format = single_line(fmt)
    out: list[str] = []
    if stream.directives:
        header = serialize_document(STFDocument(list(stream.directives), {}), record_format)
        # serialize_document appends the (empty) root object; a header line carries no object.
        out.append(header.removesuffix("{}").replace("\n", " ").rstrip() + "\n")
    for record in stream.records:
        line = serialize_document(STFDocument([], record), record_format)
        if "\n" in line or "\r" in line:
            raise STFError(
                "ERR_STREAM_RAW_NEWLINE",
                "a serialized record must not contain a raw line terminator",
            )
        out.append(line + "\n")
    return "".join(out)
