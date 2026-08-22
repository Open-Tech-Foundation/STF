//! The STF data model (spec §3).
//!
//! Eleven mutually distinct kinds. Spec §3.1 forbids representing `BigInt`, `Decimal`,
//! `Date`, `Timestamp`, or `Binary` as strings carrying a marker prefix, so each has its own
//! host type here rather than a `String` variant with a convention layered on top.

use num_bigint::{BigInt, BigUint};
use std::fmt;

/// The kind of an STF value, independent of its payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Kind {
    Null,
    Bool,
    Number,
    String,
    Array,
    Object,
    BigInt,
    Decimal,
    Date,
    Timestamp,
    Binary,
    Geometry,
    Time,
    Duration,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Null => "Null",
            Kind::Bool => "Boolean",
            Kind::Number => "Number",
            Kind::String => "String",
            Kind::Array => "Array",
            Kind::Object => "Object",
            Kind::BigInt => "BigInt",
            Kind::Decimal => "Decimal",
            Kind::Date => "Date",
            Kind::Timestamp => "Timestamp",
            Kind::Binary => "Binary",
            Kind::Geometry => "Geometry",
            Kind::Time => "Time",
            Kind::Duration => "Duration",
        }
    }
}

impl fmt::Display for Kind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// An STF value.
#[derive(Debug, Clone)]
pub enum Value {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<Value>),
    Object(Object),
    BigInt(BigInt),
    Decimal(Decimal),
    Date(Date),
    Timestamp(Timestamp),
    Binary(Vec<u8>),
    Geometry(Geometry),
    Time(Time),
    Duration(Duration),
}

impl Value {
    pub fn kind(&self) -> Kind {
        match self {
            Value::Null => Kind::Null,
            Value::Bool(_) => Kind::Bool,
            Value::Number(_) => Kind::Number,
            Value::String(_) => Kind::String,
            Value::Array(_) => Kind::Array,
            Value::Object(_) => Kind::Object,
            Value::BigInt(_) => Kind::BigInt,
            Value::Decimal(_) => Kind::Decimal,
            Value::Date(_) => Kind::Date,
            Value::Timestamp(_) => Kind::Timestamp,
            Value::Binary(_) => Kind::Binary,
            Value::Geometry(_) => Kind::Geometry,
            Value::Time(_) => Kind::Time,
            Value::Duration(_) => Kind::Duration,
        }
    }

    pub fn as_object(&self) -> Option<&Object> {
        match self {
            Value::Object(o) => Some(o),
            _ => None,
        }
    }
}

/// Spec §3.2. Values of different kinds are never equal; `Number` compares by bit pattern so
/// that `-0` and `0` stay distinct, and `Decimal` compares scale-sensitively.
impl PartialEq for Value {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Value::Null, Value::Null) => true,
            (Value::Bool(a), Value::Bool(b)) => a == b,
            // NaN cannot occur (§7.3), so bit equality is total here and keeps -0 != 0.
            (Value::Number(a), Value::Number(b)) => a.to_bits() == b.to_bits(),
            (Value::String(a), Value::String(b)) => a == b,
            (Value::Array(a), Value::Array(b)) => a == b,
            (Value::Object(a), Value::Object(b)) => a == b,
            (Value::BigInt(a), Value::BigInt(b)) => a == b,
            (Value::Decimal(a), Value::Decimal(b)) => a == b,
            (Value::Date(a), Value::Date(b)) => a == b,
            (Value::Timestamp(a), Value::Timestamp(b)) => a == b,
            (Value::Binary(a), Value::Binary(b)) => a == b,
            (Value::Geometry(a), Value::Geometry(b)) => a == b,
            (Value::Time(a), Value::Time(b)) => a == b,
            (Value::Duration(a), Value::Duration(b)) => a == b,
            _ => false,
        }
    }
}

/// An ordered map of unique keys to values.
///
/// Spec §11.2 requires member order to be preserved so documents round-trip as authored, and
/// §3.2 requires order *not* to affect equality. A `HashMap` cannot do the first; a plain
/// `Vec` alone makes duplicate detection quadratic, so lookups scan but insertion is checked.
#[derive(Debug, Clone, Default)]
pub struct Object {
    entries: Vec<(String, Value)>,
}

impl Object {
    pub fn new() -> Self {
        Object { entries: Vec::new() }
    }

    pub fn with_capacity(n: usize) -> Self {
        Object { entries: Vec::with_capacity(n) }
    }

    /// Appends a member. Returns `false` without inserting if the key is already present,
    /// which the parser reports as `ERR_DUPLICATE_KEY` (spec §11.2).
    pub fn insert(&mut self, key: impl Into<String>, value: Value) -> bool {
        let key = key.into();
        if self.contains_key(&key) {
            return false;
        }
        self.entries.push((key, value));
        true
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.entries.iter().any(|(k, _)| k == key)
    }

    pub fn get(&self, key: &str) -> Option<&Value> {
        self.entries.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&str, &Value)> {
        self.entries.iter().map(|(k, v)| (k.as_str(), v))
    }

    pub fn keys(&self) -> impl Iterator<Item = &str> {
        self.entries.iter().map(|(k, _)| k.as_str())
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl PartialEq for Object {
    fn eq(&self, other: &Self) -> bool {
        if self.entries.len() != other.entries.len() {
            return false;
        }
        // Order-independent by §3.2. Keys are unique, so matching every member of `self`
        // against `other` is sufficient.
        self.entries.iter().all(|(k, v)| other.get(k) == Some(v))
    }
}

impl FromIterator<(String, Value)> for Object {
    fn from_iter<I: IntoIterator<Item = (String, Value)>>(iter: I) -> Self {
        let mut o = Object::new();
        for (k, v) in iter {
            o.insert(k, v);
        }
        o
    }
}

/// An exact signed decimal: a coefficient and a scale (spec §10.2).
///
/// `DECIMAL(1.5)` and `DECIMAL(1.50)` are distinct values, so the scale is stored rather than
/// normalized away. The sign is ignored when the coefficient is zero, since a coefficient of
/// zero has one mathematical value.
#[derive(Debug, Clone)]
pub struct Decimal {
    negative: bool,
    coefficient: BigUint,
    scale: u32,
}

impl Decimal {
    pub fn new(negative: bool, coefficient: BigUint, scale: u32) -> Self {
        let is_zero = coefficient == BigUint::from(0u32);
        Decimal { negative: negative && !is_zero, coefficient, scale }
    }

    pub fn is_negative(&self) -> bool {
        self.negative
    }

    pub fn coefficient(&self) -> &BigUint {
        &self.coefficient
    }

    /// Number of digits after the decimal point.
    pub fn scale(&self) -> u32 {
        self.scale
    }

    /// The canonical payload text, which reproduces the authored spelling exactly:
    /// coefficient digits zero-padded to at least `scale + 1` digits, with the point inserted.
    pub fn payload(&self) -> String {
        let digits = self.coefficient.to_str_radix(10);
        let scale = self.scale as usize;
        let mut out = String::with_capacity(digits.len() + scale + 3);
        if self.negative {
            out.push('-');
        }
        if scale == 0 {
            out.push_str(&digits);
            return out;
        }
        if digits.len() > scale {
            out.push_str(&digits[..digits.len() - scale]);
            out.push('.');
            out.push_str(&digits[digits.len() - scale..]);
        } else {
            out.push_str("0.");
            for _ in 0..scale - digits.len() {
                out.push('0');
            }
            out.push_str(&digits);
        }
        out
    }
}

/// Scale-sensitive (spec §3.2): equal only if coefficient *and* scale match.
impl PartialEq for Decimal {
    fn eq(&self, other: &Self) -> bool {
        self.negative == other.negative
            && self.scale == other.scale
            && self.coefficient == other.coefficient
    }
}

impl Eq for Decimal {}

impl fmt::Display for Decimal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.payload())
    }
}

/// A wall date with no time and no offset (spec §10.4), on the proleptic Gregorian calendar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Date {
    pub year: u16,
    pub month: u8,
    pub day: u8,
}

impl Date {
    pub fn payload(&self) -> String {
        format!("{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

impl fmt::Display for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.payload())
    }
}

/// The zone designator of a [`Timestamp`].
///
/// `Utc` (a literal `Z`) is kept distinct from `+00:00`, because spec §3.2 makes the offset
/// spelling preserved data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Offset {
    Utc,
    Fixed { negative: bool, hours: u8, minutes: u8 },
}

impl Offset {
    pub fn text(&self) -> String {
        match self {
            Offset::Utc => "Z".to_string(),
            Offset::Fixed { negative, hours, minutes } => {
                format!("{}{:02}:{:02}", if *negative { '-' } else { '+' }, hours, minutes)
            }
        }
    }
}

/// An absolute instant with a mandatory UTC offset (spec §10.4).
///
/// Fractional-second digits are stored as text because trailing zeros are preserved data:
/// `.100` and `.1` are distinct values.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Timestamp {
    pub date: Date,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
    pub fraction: Option<String>,
    pub offset: Offset,
}

impl Timestamp {
    pub fn payload(&self) -> String {
        let mut out = self.date.payload();
        out.push('T');
        out.push_str(&format!("{:02}:{:02}:{:02}", self.hour, self.minute, self.second));
        if let Some(frac) = &self.fraction {
            out.push('.');
            out.push_str(frac);
        }
        out.push_str(&self.offset.text());
        out
    }
}

impl fmt::Display for Timestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.payload())
    }
}

/// Geometry type (new.txt §3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeometryType {
    Point,
    LineString,
    Polygon,
    MultiPoint,
    MultiLineString,
    MultiPolygon,
}

impl GeometryType {
    pub fn as_str(self) -> &'static str {
        match self {
            GeometryType::Point => "Point",
            GeometryType::LineString => "LineString",
            GeometryType::Polygon => "Polygon",
            GeometryType::MultiPoint => "MultiPoint",
            GeometryType::MultiLineString => "MultiLineString",
            GeometryType::MultiPolygon => "MultiPolygon",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "Point" => Some(GeometryType::Point),
            "LineString" => Some(GeometryType::LineString),
            "Polygon" => Some(GeometryType::Polygon),
            "MultiPoint" => Some(GeometryType::MultiPoint),
            "MultiLineString" => Some(GeometryType::MultiLineString),
            "MultiPolygon" => Some(GeometryType::MultiPolygon),
            _ => None,
        }
    }
}

impl fmt::Display for GeometryType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Native STF Geometry primitive.
#[derive(Debug, Clone, PartialEq)]
pub struct Geometry {
    pub ty: GeometryType,
    pub coordinates: serde_json::Value,
}

impl Geometry {
    pub fn new(ty: GeometryType, coordinates: serde_json::Value) -> Self {
        Geometry { ty, coordinates }
    }
}

/// Time of day without a date (new.txt §16).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Time {
    pub hour: u8,
    pub minute: u8,
    pub second: Option<u8>,
    pub fraction: Option<String>,
}

impl Time {
    pub fn payload(&self) -> String {
        let mut s = format!("{:02}:{:02}", self.hour, self.minute);
        if let Some(sec) = self.second {
            s.push_str(&format!(":{:02}", sec));
            if let Some(frac) = &self.fraction {
                s.push('.');
                s.push_str(frac);
            }
        }
        s
    }
}

impl fmt::Display for Time {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.payload())
    }
}

/// ISO-8601 duration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Duration(pub String);

impl Duration {
    pub fn payload(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Duration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A document-level directive (spec §5.1). Directives are metadata, not data, so they live
/// outside [`Value`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Directive {
    pub name: String,
    pub payload: String,
}

/// A parsed STF document: its directives plus its root object.
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub directives: Vec<Directive>,
    pub root: Object,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dec(neg: bool, coeff: u64, scale: u32) -> Decimal {
        Decimal::new(neg, BigUint::from(coeff), scale)
    }

    #[test]
    fn negative_zero_number_is_distinct() {
        assert_ne!(Value::Number(-0.0), Value::Number(0.0));
        assert_eq!(Value::Number(0.0), Value::Number(0.0));
    }

    #[test]
    fn kinds_never_cross_compare() {
        assert_ne!(Value::Number(1.0), Value::BigInt(BigInt::from(1)));
        assert_ne!(Value::String("1.5".into()), Value::Decimal(dec(false, 15, 1)));
    }

    #[test]
    fn decimal_equality_is_scale_sensitive() {
        assert_ne!(dec(false, 15, 1), dec(false, 150, 2));
        assert_eq!(dec(false, 150, 2), dec(false, 150, 2));
    }

    #[test]
    fn decimal_payload_round_trips_spelling() {
        assert_eq!(dec(false, 150, 2).payload(), "1.50");
        assert_eq!(dec(false, 15, 1).payload(), "1.5");
        assert_eq!(dec(false, 15, 0).payload(), "15");
        assert_eq!(dec(true, 1, 3).payload(), "-0.001");
        assert_eq!(dec(false, 0, 0).payload(), "0");
        assert_eq!(dec(false, 0, 2).payload(), "0.00");
    }

    #[test]
    fn decimal_sign_is_dropped_only_for_zero() {
        assert_eq!(dec(true, 0, 1).payload(), "0.0");
        assert_eq!(dec(true, 1, 1).payload(), "-0.1");
    }

    #[test]
    fn object_equality_ignores_order_but_iteration_does_not() {
        let mut a = Object::new();
        a.insert("x", Value::Null);
        a.insert("y", Value::Bool(true));
        let mut b = Object::new();
        b.insert("y", Value::Bool(true));
        b.insert("x", Value::Null);
        assert_eq!(a, b);
        assert_eq!(a.keys().collect::<Vec<_>>(), vec!["x", "y"]);
        assert_eq!(b.keys().collect::<Vec<_>>(), vec!["y", "x"]);
    }

    #[test]
    fn duplicate_insert_is_rejected() {
        let mut o = Object::new();
        assert!(o.insert("x", Value::Null));
        assert!(!o.insert("x", Value::Bool(true)));
        assert_eq!(o.len(), 1);
    }

    #[test]
    fn utc_and_zero_offset_are_distinct() {
        let base = Date { year: 2026, month: 1, day: 15 };
        let z = Timestamp {
            date: base,
            hour: 10,
            minute: 30,
            second: 0,
            fraction: None,
            offset: Offset::Utc,
        };
        let plus = Timestamp {
            offset: Offset::Fixed { negative: false, hours: 0, minutes: 0 },
            ..z.clone()
        };
        assert_ne!(z, plus);
        assert_eq!(z.payload(), "2026-01-15T10:30:00Z");
        assert_eq!(plus.payload(), "2026-01-15T10:30:00+00:00");
    }
}
