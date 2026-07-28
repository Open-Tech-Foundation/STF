//! Constructor payload validation (spec §10.2–§10.5).
//!
//! Payloads are not tokenized by the parser, so every rule here is enforced against the raw
//! character sequence between the parentheses.

use crate::error::Code;
use crate::value::{Date, Decimal, Offset, Timestamp, Value};
use num_bigint::{BigInt, BigUint};

/// The five constructor names defined by STF 1.0, matched byte-for-byte.
pub const NAMES: [&str; 5] = ["BIGINT", "DECIMAL", "DATE", "TIMESTAMP", "BINARY"];

/// decimal128 coefficient precision (spec §10.2).
const MAX_SIGNIFICANT_DIGITS: usize = 34;
/// decimal128 exponent range (spec §10.2).
const MAX_SCALE: usize = 6143;

type BuildError = (Code, String);

pub fn is_known(name: &str) -> bool {
    NAMES.contains(&name)
}

/// Spec §10.1: the reserved namespace is any identifier beginning with an ASCII uppercase
/// letter, plus any ASCII case-insensitive match of a defined name. A reserved name that is
/// not an exact match is `ERR_UNKNOWN_CONSTRUCTOR`; anything else before `(` is `ERR_SYNTAX`.
pub fn is_reserved(name: &str) -> bool {
    if name.as_bytes().first().is_some_and(|b| b.is_ascii_uppercase()) {
        return true;
    }
    NAMES.iter().any(|n| n.eq_ignore_ascii_case(name))
}

pub fn build(name: &str, payload: &str) -> Result<Value, BuildError> {
    match name {
        "DECIMAL" => decimal(payload).map(Value::Decimal),
        "BIGINT" => bigint(payload).map(Value::BigInt),
        "DATE" => date(payload).map(Value::Date),
        "TIMESTAMP" => timestamp(payload).map(Value::Timestamp),
        "BINARY" => binary(payload).map(Value::Binary),
        _ => Err((Code::UnknownConstructor, format!("`{}` is not an STF 1.0 constructor", name))),
    }
}

fn bad(msg: impl Into<String>) -> BuildError {
    (Code::InvalidConstructorPayload, msg.into())
}

/// `[ "-" ] ( "0" | digit1_9 { digit } ) [ "." digit { digit } ]` — plain notation only.
pub fn decimal(payload: &str) -> Result<Decimal, BuildError> {
    let bytes = payload.as_bytes();
    if bytes.is_empty() {
        return Err(bad("DECIMAL payload is empty"));
    }
    let mut i = 0;
    let negative = bytes[0] == b'-';
    if negative {
        i = 1;
    }
    let int_start = i;
    match bytes.get(i) {
        Some(b'0') => i += 1,
        Some(b'1'..=b'9') => {
            while matches!(bytes.get(i), Some(b'0'..=b'9')) {
                i += 1;
            }
        }
        _ => return Err(bad("DECIMAL integer part is missing or has a leading zero")),
    }
    // A `0` integer part may only be followed by `.`, which rules out `01.5` and `007`.
    if bytes[int_start] == b'0' && i - int_start > 1 {
        return Err(bad("DECIMAL has a leading zero"));
    }
    let int_part = &payload[int_start..i];

    let mut frac_part = "";
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        let frac_start = i;
        while matches!(bytes.get(i), Some(b'0'..=b'9')) {
            i += 1;
        }
        if i == frac_start {
            return Err(bad("DECIMAL fraction has no digits"));
        }
        frac_part = &payload[frac_start..i];
    }
    if i != bytes.len() {
        return Err(bad(
            "DECIMAL payload must be plain notation: no exponent, sign, or trailing characters",
        ));
    }

    let scale = frac_part.len();
    if scale > MAX_SCALE {
        return Err((
            Code::DecimalOverflow,
            format!("DECIMAL scale {} exceeds the maximum of {}", scale, MAX_SCALE),
        ));
    }

    let mut digits = String::with_capacity(int_part.len() + frac_part.len());
    digits.push_str(int_part);
    digits.push_str(frac_part);

    // §10.2: leading zeros are not significant; trailing zeros are. A zero value counts as 1.
    let stripped = digits.trim_start_matches('0');
    let significant = if stripped.is_empty() { 1 } else { stripped.len() };
    if significant > MAX_SIGNIFICANT_DIGITS {
        return Err((
            Code::DecimalOverflow,
            format!(
                "DECIMAL has {} significant digits, exceeding the maximum of {}",
                significant, MAX_SIGNIFICANT_DIGITS
            ),
        ));
    }

    let coefficient = digits.parse::<BigUint>().map_err(|_| bad("DECIMAL coefficient"))?;
    Ok(Decimal::new(negative, coefficient, scale as u32))
}

/// `"0" | [ "-" ] digit1_9 { digit }` — one spelling per value, so no leading zeros and no `-0`.
pub fn bigint(payload: &str) -> Result<BigInt, BuildError> {
    let bytes = payload.as_bytes();
    if bytes.is_empty() {
        return Err(bad("BIGINT payload is empty"));
    }
    if payload == "0" {
        return Ok(BigInt::from(0));
    }
    let mut i = 0;
    if bytes[0] == b'-' {
        i = 1;
    }
    if !matches!(bytes.get(i), Some(b'1'..=b'9')) {
        return Err(bad(
            "BIGINT must be `0` or an optionally-signed integer with no leading zero",
        ));
    }
    i += 1;
    while matches!(bytes.get(i), Some(b'0'..=b'9')) {
        i += 1;
    }
    if i != bytes.len() {
        return Err(bad("BIGINT payload contains a non-digit character"));
    }
    payload.parse::<BigInt>().map_err(|_| bad("BIGINT payload"))
}

fn is_leap_year(year: u16) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn days_in_month(year: u16, month: u8) -> u8 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Two ASCII digits at `bytes[i..i+2]` as a number, or `None`.
fn two_digits(bytes: &[u8], i: usize) -> Option<u8> {
    let a = *bytes.get(i)?;
    let b = *bytes.get(i + 1)?;
    if !a.is_ascii_digit() || !b.is_ascii_digit() {
        return None;
    }
    Some((a - b'0') * 10 + (b - b'0'))
}

/// `YYYY-MM-DD`, zero-padded, with full proleptic-Gregorian calendar validation (spec §10.4).
pub fn date(payload: &str) -> Result<Date, BuildError> {
    let bytes = payload.as_bytes();
    if bytes.len() != 10 {
        return Err(bad("DATE must be exactly `YYYY-MM-DD`"));
    }
    parse_date_at(bytes, 0)
}

fn parse_date_at(bytes: &[u8], off: usize) -> Result<Date, BuildError> {
    if bytes.len() < off + 10 {
        return Err(bad("DATE must be exactly `YYYY-MM-DD`"));
    }
    for i in [off, off + 1, off + 2, off + 3, off + 5, off + 6, off + 8, off + 9] {
        if !bytes[i].is_ascii_digit() {
            return Err(bad("DATE must be exactly `YYYY-MM-DD`"));
        }
    }
    if bytes[off + 4] != b'-' || bytes[off + 7] != b'-' {
        return Err(bad("DATE must be exactly `YYYY-MM-DD`"));
    }
    let year = (bytes[off] - b'0') as u16 * 1000
        + (bytes[off + 1] - b'0') as u16 * 100
        + (bytes[off + 2] - b'0') as u16 * 10
        + (bytes[off + 3] - b'0') as u16;
    let month = two_digits(bytes, off + 5).unwrap();
    let day = two_digits(bytes, off + 8).unwrap();
    if !(1..=12).contains(&month) {
        return Err(bad(format!("month {:02} is out of range", month)));
    }
    let max_day = days_in_month(year, month);
    if day < 1 || day > max_day {
        return Err(bad(format!("day {:02} is out of range for {:04}-{:02}", day, year, month)));
    }
    Ok(Date { year, month, day })
}

/// `date "T" hh:mm:ss [ "." digit{1,9} ] ( "Z" | ±hh:mm )` (spec §10.4).
pub fn timestamp(payload: &str) -> Result<Timestamp, BuildError> {
    let bytes = payload.as_bytes();
    let date = parse_date_at(bytes, 0)?;
    if bytes.get(10) != Some(&b'T') {
        return Err(bad("TIMESTAMP requires an uppercase `T` between date and time"));
    }
    if bytes.get(13) != Some(&b':') || bytes.get(16) != Some(&b':') {
        return Err(bad("TIMESTAMP time must be `hh:mm:ss`"));
    }
    let hour = two_digits(bytes, 11).ok_or_else(|| bad("TIMESTAMP hour must be two digits"))?;
    let minute = two_digits(bytes, 14).ok_or_else(|| bad("TIMESTAMP minute must be two digits"))?;
    let second = two_digits(bytes, 17).ok_or_else(|| bad("TIMESTAMP second must be two digits"))?;
    if hour > 23 {
        return Err(bad(format!("hour {:02} is out of range", hour)));
    }
    if minute > 59 {
        return Err(bad(format!("minute {:02} is out of range", minute)));
    }
    // §10.4: leap seconds are not supported, so 60 is out of range rather than a special case.
    if second > 59 {
        return Err(bad(format!("second {:02} is out of range; leap seconds are not supported", second)));
    }

    let mut i = 19;
    let mut fraction = None;
    if bytes.get(i) == Some(&b'.') {
        i += 1;
        let start = i;
        while matches!(bytes.get(i), Some(b) if b.is_ascii_digit()) {
            i += 1;
        }
        let len = i - start;
        if !(1..=9).contains(&len) {
            return Err(bad("TIMESTAMP fraction must have 1 to 9 digits"));
        }
        fraction = Some(payload[start..i].to_string());
    }

    let offset = match bytes.get(i) {
        Some(b'Z') => {
            i += 1;
            Offset::Utc
        }
        Some(sign @ (b'+' | b'-')) => {
            let negative = *sign == b'-';
            if bytes.get(i + 3) != Some(&b':') {
                return Err(bad("TIMESTAMP offset must be `±hh:mm`"));
            }
            let hours =
                two_digits(bytes, i + 1).ok_or_else(|| bad("TIMESTAMP offset hour"))?;
            let minutes =
                two_digits(bytes, i + 4).ok_or_else(|| bad("TIMESTAMP offset minute"))?;
            if hours > 23 {
                return Err(bad(format!("offset hour {:02} is out of range", hours)));
            }
            if minutes > 59 {
                return Err(bad(format!("offset minute {:02} is out of range", minutes)));
            }
            i += 6;
            Offset::Fixed { negative, hours, minutes }
        }
        _ => return Err(bad("TIMESTAMP requires a UTC offset (`Z` or `±hh:mm`)")),
    };

    if i != bytes.len() {
        return Err(bad("TIMESTAMP has trailing characters after the offset"));
    }
    Ok(Timestamp { date, hour, minute, second, fraction, offset })
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_index(b: u8) -> Option<u8> {
    match b {
        b'A'..=b'Z' => Some(b - b'A'),
        b'a'..=b'z' => Some(b - b'a' + 26),
        b'0'..=b'9' => Some(b - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Canonical RFC 4648 §4 base64 (spec §10.5). The empty payload is valid.
pub fn binary(payload: &str) -> Result<Vec<u8>, BuildError> {
    let bytes = payload.as_bytes();
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if bytes.len() % 4 != 0 {
        return Err(bad("BINARY length must be a multiple of 4"));
    }

    let pad = bytes.iter().rev().take_while(|b| **b == b'=').count();
    if pad > 2 {
        return Err(bad("BINARY has more than two padding characters"));
    }
    let data = &bytes[..bytes.len() - pad];
    for &b in data {
        if b64_index(b).is_none() {
            // Covers the URL-safe alphabet, internal whitespace, and a stray `=`.
            return Err(bad("BINARY contains a character outside the standard base64 alphabet"));
        }
    }

    // Canonical encoding: the bits of the final symbol that the padding discards must be zero.
    if pad > 0 {
        let last = *data.last().ok_or_else(|| bad("BINARY has only padding"))?;
        let index = b64_index(last).unwrap();
        let mask = if pad == 1 { 0b11 } else { 0b1111 };
        if index & mask != 0 {
            return Err(bad("BINARY has non-canonical trailing bits"));
        }
    }

    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut acc_bits = 0;
    for &b in data {
        acc = (acc << 6) | b64_index(b).unwrap() as u32;
        acc_bits += 6;
        if acc_bits >= 8 {
            acc_bits -= 8;
            out.push((acc >> acc_bits) as u8);
        }
    }
    Ok(out)
}

/// Encodes octets as canonical base64, for serialization (spec §13.7).
pub fn binary_to_base64(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(B64[(n >> 6) as usize & 63] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(B64[n as usize & 63] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_namespace_covers_near_misses_but_not_plain_identifiers() {
        assert!(is_reserved("CUSTOM"));
        assert!(is_reserved("MY_TYPE"));
        assert!(is_reserved("Date"));
        assert!(is_reserved("BigNumber"));
        assert!(is_reserved("date"));
        assert!(is_reserved("binary"));
        assert!(!is_reserved("foo"));
        assert!(!is_reserved("bar_baz"));
    }

    #[test]
    fn decimal_preserves_scale() {
        assert_eq!(decimal("1.50").unwrap().scale(), 2);
        assert_eq!(decimal("1.5").unwrap().scale(), 1);
        assert_eq!(decimal("15").unwrap().scale(), 0);
        assert_ne!(decimal("1.5").unwrap(), decimal("1.50").unwrap());
    }

    #[test]
    fn decimal_rejects_non_plain_notation() {
        for p in ["", "1.5e3", "1.", "+1.5", "01.5", "NaN", "Infinity", "0x1f", "1_0", " 1", "1 "]
        {
            assert!(decimal(p).is_err(), "expected {:?} to be rejected", p);
        }
    }

    #[test]
    fn decimal_counts_significant_digits_after_stripping_leading_zeros() {
        // 1 significant digit, scale 38 — valid per §10.2.
        let tiny = format!("0.{}1", "0".repeat(37));
        assert!(decimal(&tiny).is_ok());

        assert!(decimal(&"1".repeat(34)).is_ok());
        let over = decimal(&"1".repeat(35)).unwrap_err();
        assert_eq!(over.0, Code::DecimalOverflow);
    }

    #[test]
    fn decimal_scale_cap_is_6143() {
        let ok = format!("0.{}", "0".repeat(6143));
        assert!(decimal(&ok).is_ok());
        let over = format!("0.{}", "0".repeat(6144));
        assert_eq!(decimal(&over).unwrap_err().0, Code::DecimalOverflow);
    }

    #[test]
    fn bigint_has_one_spelling_per_value() {
        assert_eq!(bigint("0").unwrap(), BigInt::from(0));
        assert_eq!(bigint("-123").unwrap(), BigInt::from(-123));
        for p in ["", "007", "-0", "+1", "12.34", "1e3", "123a", "-"] {
            assert!(bigint(p).is_err(), "expected {:?} to be rejected", p);
        }
    }

    #[test]
    fn bigint_is_unbounded() {
        let big = "9".repeat(100);
        assert_eq!(bigint(&big).unwrap().to_string(), big);
    }

    #[test]
    fn date_validates_the_calendar() {
        assert!(date("2024-02-29").is_ok());
        for p in [
            "2025-02-29",
            "2026-02-31",
            "2026-04-31",
            "2026-13-01",
            "2026-01-00",
            "2026-1-5",
            "2026-01-15T10:00:00Z",
            "",
        ] {
            assert!(date(p).is_err(), "expected {:?} to be rejected", p);
        }
    }

    #[test]
    fn timestamp_requires_an_offset_and_rejects_leap_seconds() {
        assert!(timestamp("2026-01-15T10:30:00Z").is_ok());
        assert!(timestamp("2026-01-15T10:30:00-05:00").is_ok());
        assert!(timestamp("2026-01-15T10:30:00.123456789+05:30").is_ok());
        for p in [
            "2026-01-15T10:30:00",
            "2026-01-15 10:30:00Z",
            "2026-01-15t10:30:00z",
            "2026-01-15T99:30:00Z",
            "2026-01-15T23:59:60Z",
            "2026-01-15T10:30:00+99:00",
            "2026-01-15T10:30:00.Z",
            "2026-01-15T10:30:00.1234567890Z",
        ] {
            assert!(timestamp(p).is_err(), "expected {:?} to be rejected", p);
        }
    }

    #[test]
    fn timestamp_preserves_offset_spelling_and_trailing_zeros() {
        assert_eq!(timestamp("2026-01-15T10:30:00.100Z").unwrap().payload(), "2026-01-15T10:30:00.100Z");
        assert_ne!(
            timestamp("2026-01-15T10:30:00Z").unwrap(),
            timestamp("2026-01-15T10:30:00+00:00").unwrap()
        );
    }

    #[test]
    fn binary_requires_canonical_base64() {
        assert_eq!(binary("").unwrap(), Vec::<u8>::new());
        assert_eq!(binary("SGVsbG8=").unwrap(), b"Hello");
        assert_eq!(binary("SGVsbG9X").unwrap(), b"HelloW");
        for p in ["SGVsbG8", "SGVsb-8=", "SG=sbG8=", "Zh==", "SGVs bG8="] {
            assert!(binary(p).is_err(), "expected {:?} to be rejected", p);
        }
    }

    #[test]
    fn base64_round_trips() {
        for case in [&b""[..], b"H", b"He", b"Hel", b"Hello", b"HelloW", b"\x00\xff\x7f"] {
            let text = binary_to_base64(case);
            assert_eq!(binary(&text).unwrap(), case, "round trip of {:?}", text);
        }
    }
}
