//! JSON interchange.
//!
//! STF replaces JSON rather than extending it, so conversion is **lossy in both directions**
//! and this module fails loudly instead of guessing:
//!
//! * JSON that STF cannot express — a non-object root, a key outside `[A-Za-z0-9_-]+`, an
//!   integer that is not exactly a `binary64` — is rejected with `ERR_UNREPRESENTABLE`
//!   (migration guide §1.4).
//! * STF that JSON cannot express — the five constructor kinds — is likewise rejected, unless
//!   the caller explicitly opts into a lossy encoding. Silently writing `DECIMAL(1.5)` as the
//!   string `"1.5"` is the in-band sentinel that spec §3.1 forbids.

use crate::constructors;
use crate::error::{Code, Error, Result};
use crate::value::{Object, Value};
use serde_json::Value as Json;

fn unrepresentable<T>(msg: impl Into<String>) -> Result<T> {
    Err(Error::detached(Code::Unrepresentable, msg))
}

/// Converts a JSON document to STF. The root must be a JSON object.
/// When `infer` is true, GeoJSON geometry objects are recognized as Geometry.
pub fn from_json(json: &Json) -> Result<Value> {
    from_json_with_infer(json, false)
}

pub fn from_json_with_infer(json: &Json, infer: bool) -> Result<Value> {
    match json {
        Json::Object(_) => convert_from(json, "$", infer),
        other => unrepresentable(format!(
            "an STF document root must be an object, but this JSON root is {}",
            json_kind(other)
        )),
    }
}

fn json_kind(json: &Json) -> &'static str {
    match json {
        Json::Null => "null",
        Json::Bool(_) => "a boolean",
        Json::Number(_) => "a number",
        Json::String(_) => "a string",
        Json::Array(_) => "an array",
        Json::Object(_) => "an object",
    }
}

fn is_geojson_geometry(map: &serde_json::Map<String, Json>) -> bool {
    if map.len() != 2 { return false; }
    match (map.get("type"), map.get("coordinates")) {
        (Some(Json::String(t)), Some(Json::Array(_))) => {
            matches!(t.as_str(), "Point"|"LineString"|"Polygon"|"MultiPoint"|"MultiLineString"|"MultiPolygon")
        }
        _ => false,
    }
}

fn convert_from(json: &Json, path: &str, infer: bool) -> Result<Value> {
    match json {
        Json::Null => Ok(Value::Null),
        Json::Bool(b) => Ok(Value::Bool(*b)),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                if (i as f64) as i64 != i {
                    return unrepresentable(format!(
                        "{}: integer {} is not exactly representable as binary64; \
                         write it as BIGINT({}) instead",
                        path, i, i
                    ));
                }
                return Ok(Value::Number(i as f64));
            }
            if let Some(u) = n.as_u64() {
                if (u as f64) as u64 != u {
                    return unrepresentable(format!(
                        "{}: integer {} is not exactly representable as binary64; \
                         write it as BIGINT({}) instead",
                        path, u, u
                    ));
                }
                return Ok(Value::Number(u as f64));
            }
            match n.as_f64() {
                Some(f) if f.is_finite() => Ok(Value::Number(f)),
                _ => unrepresentable(format!("{}: {} is not an STF Number", path, n)),
            }
        }
        Json::String(s) => Ok(Value::String(s.clone())),
        Json::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for (i, item) in items.iter().enumerate() {
                out.push(convert_from(item, &format!("{}[{}]", path, i), infer)?);
            }
            Ok(Value::Array(out))
        }
        Json::Object(map) => {
            if infer && is_geojson_geometry(map) {
                let t = map.get("type").unwrap().as_str().unwrap().to_string();
                let coords = map.get("coordinates").unwrap().clone();
                let payload = format!("\"{}\", {}", t, coords);
                if let Ok(g) = crate::constructors::geometry(&payload) {
                    return Ok(Value::Geometry(g));
                }
            }
            let mut out = Object::with_capacity(map.len());
            for (key, item) in map {
                if key.is_empty() {
                    return unrepresentable(format!("{}: an STF key must not be empty", path));
                }
                if !key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
                    return unrepresentable(format!(
                        "{}: key `{}` is not a valid STF identifier ([A-Za-z0-9_-]+)",
                        path, key
                    ));
                }
                let child = convert_from(item, &format!("{}.{}", path, key), infer)?;
                if !out.insert(key.clone(), child) {
                    return unrepresentable(format!("{}: duplicate key `{}`", path, key));
                }
            }
            Ok(Value::Object(out))
        }
    }
}

/// How to handle STF kinds that JSON has no equivalent for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypedValuePolicy {
    /// Refuse to convert, naming the offending path. The default.
    Reject,
    /// Encode the constructor payload as a JSON string. Lossy: the reader cannot tell the
    /// result from a user-authored string of the same text.
    PayloadAsString,
}

/// Converts an STF value to JSON.
pub fn to_json(value: &Value, policy: TypedValuePolicy) -> Result<Json> {
    convert_to(value, "$", policy)
}

fn convert_to(value: &Value, path: &str, policy: TypedValuePolicy) -> Result<Json> {
    let typed = |payload: String, kind: &str| -> Result<Json> {
        match policy {
            TypedValuePolicy::PayloadAsString => Ok(Json::String(payload)),
            TypedValuePolicy::Reject => unrepresentable(format!(
                "{}: JSON has no {} type. Re-run with the lossy option to write the payload \
                 as a string, accepting that the type is lost.",
                path, kind
            )),
        }
    };

    match value {
        Value::Null => Ok(Json::Null),
        Value::Bool(b) => Ok(Json::Bool(*b)),
        Value::Number(n) => {
            // Emit an integral value as a JSON integer, which is what a JSON writer would
            // produce and what keeps a JSON -> STF -> JSON round trip textually stable.
            if n.fract() == 0.0 && n.is_finite() && n.abs() <= 9007199254740992.0 {
                return Ok(Json::Number((*n as i64).into()));
            }
            match serde_json::Number::from_f64(*n) {
                Some(num) => Ok(Json::Number(num)),
                // from_f64 rejects non-finite values, which parsing cannot produce (§7.3).
                None => unrepresentable(format!("{}: {} has no JSON representation", path, n)),
            }
        }
        Value::String(s) => Ok(Json::String(s.clone())),
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for (i, item) in items.iter().enumerate() {
                out.push(convert_to(item, &format!("{}[{}]", path, i), policy)?);
            }
            Ok(Json::Array(out))
        }
        Value::Object(object) => {
            let mut map = serde_json::Map::with_capacity(object.len());
            for (key, item) in object.iter() {
                map.insert(key.to_string(), convert_to(item, &format!("{}.{}", path, key), policy)?);
            }
            Ok(Json::Object(map))
        }
        Value::BigInt(n) => typed(n.to_string(), "arbitrary-precision integer"),
        Value::Decimal(d) => typed(d.payload(), "exact decimal"),
        Value::Date(d) => typed(d.payload(), "date"),
        Value::Timestamp(t) => typed(t.payload(), "timestamp"),
        Value::Binary(b) => typed(constructors::binary_to_base64(b), "binary"),
        Value::Geometry(g) => {
            let mut map = serde_json::Map::new();
            map.insert("type".to_string(), Json::String(g.ty.as_str().to_string()));
            map.insert("coordinates".to_string(), g.coordinates.clone());
            return Ok(Json::Object(map));
        }
        Value::Time(t) => typed(t.payload(), "time"),
        Value::Duration(d) => typed(d.payload().to_string(), "duration"),
    }
}

/// Encodes a value in the corpus's **tagged JSON**, which is lossless where plain JSON is not.
///
/// Non-obvious kinds become `{"$": "<tag>", "v": "<text>"}`. `$` is safe as an escape key
/// because it is not a legal STF key character (spec §6.1), so a tag can never collide with a
/// real parsed object. See `tests/conformance/README.md` §2.
pub fn to_tagged_json(value: &Value) -> Json {
    fn tag(name: &str, text: String) -> Json {
        let mut map = serde_json::Map::with_capacity(2);
        map.insert("$".to_string(), Json::String(name.to_string()));
        map.insert("v".to_string(), Json::String(text));
        Json::Object(map)
    }

    match value {
        Value::Null => Json::Null,
        Value::Bool(b) => Json::Bool(*b),
        Value::String(s) => Json::String(s.clone()),
        Value::Array(items) => Json::Array(items.iter().map(to_tagged_json).collect()),
        Value::Object(object) => Json::Object(
            object.iter().map(|(k, v)| (k.to_string(), to_tagged_json(v))).collect(),
        ),
        // Numbers are tagged with a string too, because JSON numbers cannot express -0 and
        // give no binary64 round-trip guarantee, both of which §7.2 and §7.3 make observable.
        Value::Number(n) => tag(
            "num",
            crate::ser::format_number(*n).unwrap_or_else(|_| n.to_string()),
        ),
        Value::BigInt(n) => tag("bigint", n.to_string()),
        Value::Decimal(d) => tag("dec", d.payload()),
        Value::Date(d) => tag("date", d.payload()),
        Value::Timestamp(t) => tag("ts", t.payload()),
        Value::Binary(b) => tag("bin", constructors::binary_to_base64(b)),
        Value::Geometry(g) => {
            let mut inner = serde_json::Map::new();
            inner.insert("type".to_string(), Json::String(g.ty.as_str().to_string()));
            inner.insert("coordinates".to_string(), g.coordinates.clone());
            tag("geo", Json::Object(inner).to_string())
        }
        Value::Time(t) => tag("time", t.payload()),
        Value::Duration(d) => tag("dur", d.payload().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse, to_string, Format};

    fn json(text: &str) -> Json {
        serde_json::from_str(text).unwrap()
    }

    #[test]
    fn converts_ordinary_json() {
        let v = from_json(&json(r#"{"a":1,"b":[true,null,"x"],"c":{"d":1.5}}"#)).unwrap();
        assert_eq!(to_string(&v, &Format::compact()).unwrap(), "{a:1,b:[T,N,`x`],c:{d:1.5}}");
    }

    #[test]
    fn preserves_member_order() {
        let v = from_json(&json(r#"{"z":1,"a":2,"m":3}"#)).unwrap();
        assert_eq!(to_string(&v, &Format::compact()).unwrap(), "{z:1,a:2,m:3}");
    }

    #[test]
    fn rejects_json_that_stf_cannot_express() {
        // Migration guide §1.4.
        assert!(from_json(&json("[]")).is_err());
        assert!(from_json(&json("42")).is_err());
        assert!(from_json(&json(r#"{"a.b":1}"#)).is_err());
        assert!(from_json(&json(r#"{"":1}"#)).is_err());
        assert!(from_json(&json(r#"{"café":1}"#)).is_err());
    }

    #[test]
    fn rejects_integers_that_binary64_cannot_hold() {
        let err = from_json(&json(r#"{"id":9007199254740993}"#)).unwrap_err();
        assert_eq!(err.code, Code::Unrepresentable);
        assert!(err.message.contains("BIGINT"), "{}", err.message);
    }

    #[test]
    fn typed_values_are_refused_by_default() {
        let v = parse("{price: DECIMAL(19.99)}").unwrap();
        let err = to_json(&v, TypedValuePolicy::Reject).unwrap_err();
        assert_eq!(err.code, Code::Unrepresentable);
        assert!(err.message.contains("$.price"), "{}", err.message);
    }

    #[test]
    fn lossy_mode_writes_payloads_as_strings() {
        let v = parse("{price: DECIMAL(19.99), at: DATE(2026-01-15), k: BINARY(SGVsbG8=)}").unwrap();
        let out = to_json(&v, TypedValuePolicy::PayloadAsString).unwrap();
        assert_eq!(out["price"], Json::String("19.99".into()));
        assert_eq!(out["at"], Json::String("2026-01-15".into()));
        assert_eq!(out["k"], Json::String("SGVsbG8=".into()));
    }

    #[test]
    fn tagged_json_distinguishes_every_kind() {
        let v = parse(
            "{s:`1.5`,d:DECIMAL(1.50),n:1,z:-0,b:BIGINT(9007199254740993),\
             dt:DATE(2026-01-15),t:TIMESTAMP(2026-01-15T10:30:00Z),bin:BINARY(SGVsbG8=)}",
        )
        .unwrap();
        let out = to_tagged_json(&v);
        assert_eq!(out["s"], Json::String("1.5".into()));
        assert_eq!(out["d"]["$"], Json::String("dec".into()));
        assert_eq!(out["d"]["v"], Json::String("1.50".into()));
        assert_eq!(out["n"]["v"], Json::String("1".into()));
        assert_eq!(out["z"]["v"], Json::String("-0".into()));
        assert_eq!(out["b"]["v"], Json::String("9007199254740993".into()));
        assert_eq!(out["dt"]["$"], Json::String("date".into()));
        assert_eq!(out["t"]["v"], Json::String("2026-01-15T10:30:00Z".into()));
        assert_eq!(out["bin"]["v"], Json::String("SGVsbG8=".into()));
    }

    #[test]
    fn json_round_trip_is_stable_for_json_native_values() {
        let original = json(r#"{"a":1,"b":[true,null,"x"],"c":{"d":1.5},"e":-0.25}"#);
        let stf = from_json(&original).unwrap();
        let back = to_json(&stf, TypedValuePolicy::Reject).unwrap();
        assert_eq!(back, original);
    }
}
