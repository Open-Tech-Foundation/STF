use std::borrow::Cow;
use std::fmt;
use rustc_hash::FxHashMap;
use memchr::memchr;
use num_bigint::BigInt;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList, PyString};
use pyo3::IntoPyObjectExt;

#[cfg(feature = "wasm-pack")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm-pack")]
#[wasm_bindgen]
pub fn parse_wasm(input: &str) -> Result<JsValue, JsError> {
    let result = parse(input)?;
    Ok(serde_wasm_bindgen::to_value(&result)?)
}

#[cfg(feature = "wasm-pack")]
#[wasm_bindgen]
pub fn stringify_wasm(input: JsValue) -> Result<String, JsError> {
    let value: DTXTValue = serde_wasm_bindgen::from_value(input)?;
    Ok(stringify(&value, None))
}

#[derive(Debug)]
pub enum DTXTError {
    Syntax(usize),
    Unterminated,
    RootNotObject,
    DuplicateKey(String),
    MissingColon(usize),
    MissingComma(usize),
    InvalidIdentifier(usize),
    InvalidNumber(String),
    InvalidString(usize),
    UnknownConstructor(String),
    InvalidConstructorPayload(String),
    NestedConstructor,
    NestingDepth,
    TrailingData(usize),
}

impl fmt::Display for DTXTError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            DTXTError::Syntax(pos) => write!(f, "ERR_SYNTAX at {}", pos),
            DTXTError::Unterminated => write!(f, "ERR_UNTERMINATED"),
            DTXTError::RootNotObject => write!(f, "ERR_ROOT_NOT_OBJECT"),
            DTXTError::DuplicateKey(k) => write!(f, "ERR_DUPLICATE_KEY: {}", k),
            DTXTError::MissingColon(pos) => write!(f, "ERR_MISSING_COLON at {}", pos),
            DTXTError::MissingComma(pos) => write!(f, "ERR_MISSING_COMMA at {}", pos),
            DTXTError::InvalidIdentifier(pos) => write!(f, "ERR_INVALID_IDENTIFIER at {}", pos),
            DTXTError::InvalidNumber(s) => write!(f, "ERR_INVALID_NUMBER: {}", s),
            DTXTError::InvalidString(pos) => write!(f, "ERR_INVALID_STRING at {}", pos),
            DTXTError::UnknownConstructor(s) => write!(f, "ERR_UNKNOWN_CONSTRUCTOR: {}", s),
            DTXTError::InvalidConstructorPayload(s) => write!(f, "ERR_INVALID_CONSTRUCTOR_PAYLOAD: {}", s),
            DTXTError::NestedConstructor => write!(f, "ERR_NESTED_CONSTRUCTOR"),
            DTXTError::NestingDepth => write!(f, "ERR_NESTING_DEPTH"),
            DTXTError::TrailingData(pos) => write!(f, "ERR_SYNTAX (trailing data) at {}", pos),
        }
    }
}

impl std::error::Error for DTXTError {}

#[derive(Debug, Clone, PartialEq)]
pub enum DTXTValue<'a> {
    String(Cow<'a, str>),
    Number(f64),
    Bool(bool),
    Null,
    BigInt(BigInt),
    Date(&'a str),
    Bytes(Vec<u8>),
    Array(Vec<DTXTValue<'a>>),
    Object(FxHashMap<&'a str, DTXTValue<'a>>),
}

pub struct DTXTParser<'a> {
    input: &'a [u8],
    pos: usize,
    depth: usize,
}

const MAX_DEPTH: usize = 64;

impl<'a> DTXTParser<'a> {
    pub fn new(input: &'a str) -> Self {
        Self {
            input: input.as_bytes(),
            pos: 0,
            depth: 0,
        }
    }

    #[inline]
    fn current(&self) -> Option<u8> {
        self.input.get(self.pos).copied()
    }

    #[inline]
    fn advance(&mut self) {
        self.pos += 1;
    }

    #[inline(always)]
    fn skip_whitespace(&mut self) {
        let mut i = self.pos;
        let bytes = self.input;
        let len = bytes.len();
        
        while i < len {
            match bytes[i] {
                b' ' | b'\t' | b'\r' | b'\n' => i += 1,
                b'#' => {
                    i += 1;
                    if let Some(next_nl) = memchr(b'\n', &bytes[i..]) {
                        i += next_nl + 1;
                    } else {
                        i = len;
                    }
                }
                _ => break,
            }
        }
        self.pos = i;
    }

    #[inline(always)]

    pub fn parse(&mut self) -> Result<FxHashMap<&'a str, DTXTValue<'a>>, DTXTError> {
        self.skip_whitespace();
        while self.current() == Some(b'@') {
            self.parse_directive()?;
            self.skip_whitespace();
        }
        let result = self.parse_object()?;
        self.skip_whitespace();
        if self.pos < self.input.len() {
            return Err(DTXTError::TrailingData(self.pos));
        }
        Ok(result)
    }

    fn parse_directive(&mut self) -> Result<(), DTXTError> {
        self.advance(); // skip '@'
        while let Some(ch) = self.current() {
            if ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-' {
                self.advance();
            } else {
                break;
            }
        }
        if self.current() != Some(b'(') {
            return Err(DTXTError::Syntax(self.pos));
        }
        self.advance(); // skip '('
        while self.current() != Some(b')') {
            if self.pos >= self.input.len() {
                return Err(DTXTError::Unterminated);
            }
            self.advance();
        }
        self.advance(); // skip ')'
        Ok(())
    }

    #[inline]
    fn parse_value(&mut self) -> Result<DTXTValue<'a>, DTXTError> {
        self.skip_whitespace();
        match self.current() {
            Some(b'{') => Ok(DTXTValue::Object(self.parse_object()?)),
            Some(b'[') => Ok(DTXTValue::Array(self.parse_array()?)),
            Some(b'`') => Ok(DTXTValue::String(Cow::Borrowed(self.parse_string()?))),
            Some(b'"') => Ok(DTXTValue::String(Cow::Owned(self.parse_interpreted_string()?))),
            Some(b'-') | Some(b'0'..=b'9') => Ok(DTXTValue::Number(self.parse_number()?)),
            Some(b'T') if self.pos + 1 >= self.input.len() || (!self.input[self.pos+1].is_ascii_alphanumeric() && self.input[self.pos+1] != b'_' && self.input[self.pos+1] != b'-') => {
                self.advance();
                Ok(DTXTValue::Bool(true))
            }
            Some(b'F') if self.pos + 1 >= self.input.len() || (!self.input[self.pos+1].is_ascii_alphanumeric() && self.input[self.pos+1] != b'_' && self.input[self.pos+1] != b'-') => {
                self.advance();
                Ok(DTXTValue::Bool(false))
            }
            Some(b'N') if self.pos + 1 >= self.input.len() || (!self.input[self.pos+1].is_ascii_alphanumeric() && self.input[self.pos+1] != b'_' && self.input[self.pos+1] != b'-') => {
                self.advance();
                Ok(DTXTValue::Null)
            }
            Some(b'A'..=b'Z') | Some(b'a'..=b'z') | Some(b'_') => self.parse_constructor(),
            Some(_) => Err(DTXTError::Syntax(self.pos)),
            None => Err(DTXTError::Unterminated),
        }
    }

    fn parse_object(&mut self) -> Result<FxHashMap<&'a str, DTXTValue<'a>>, DTXTError> {
        self.advance(); // skip '{'
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(DTXTError::NestingDepth);
        }
        
        let mut map = FxHashMap::default();

        self.skip_whitespace();
        while self.current() != Some(b'}') {
            let key = self.parse_key()?;
            self.skip_whitespace();

             if self.current() != Some(b':') {
                return Err(DTXTError::MissingColon(self.pos));
            }
            self.advance(); // skip ':'

            let value = self.parse_value()?;
            if map.insert(key, value).is_some() {
                return Err(DTXTError::DuplicateKey(key.to_string()));
            }

            self.skip_whitespace();
            if self.current() == Some(b',') {
                self.advance();
                self.skip_whitespace();
            }
        }

        self.advance(); // skip '}'
        self.depth -= 1;
        Ok(map)
    }

    fn parse_array(&mut self) -> Result<Vec<DTXTValue<'a>>, DTXTError> {
        self.advance(); // skip '['
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(DTXTError::NestingDepth);
        }
        
        let mut arr = Vec::new();

        self.skip_whitespace();
        while self.current() != Some(b']') {
            arr.push(self.parse_value()?);

            self.skip_whitespace();
            if self.current() == Some(b',') {
                self.advance();
                self.skip_whitespace();
            }
        }

        self.advance(); // skip ']'
        self.depth -= 1;
        Ok(arr)
    }

    #[inline(always)]
    fn parse_key(&mut self) -> Result<&'a str, DTXTError> {
        let start = self.pos;
        let bytes = self.input;
        let len = bytes.len();
        let mut i = start;
        while i < len {
            let ch = bytes[i];
            if ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-' {
                i += 1;
            } else {
                break;
            }
        }
        self.pos = i;
        if i == start { return Err(DTXTError::InvalidIdentifier(start)); }
        // Unsafe because we assume the input is valid UTF-8 (as per spec) and we only parsed ASCII
        unsafe { Ok(std::str::from_utf8_unchecked(&bytes[start..i])) }
    }

    fn parse_string(&mut self) -> Result<&'a str, DTXTError> {
        self.advance(); // skip opening '`'
        let start = self.pos;
        if let Some(end) = memchr(b'`', &self.input[start..]) {
            let abs_end = start + end;
            self.pos = abs_end + 1;
            // Unsafe because we already validated the presence of closing '`' and assume valid UTF-8 input
            unsafe { Ok(std::str::from_utf8_unchecked(&self.input[start..abs_end])) }
        } else {
            Err(DTXTError::Unterminated)
        }
    }

    fn parse_interpreted_string(&mut self) -> Result<String, DTXTError> {
        let start = self.pos;
        self.advance(); // skip opening '"'
        let mut i = self.pos;
        while i < self.input.len() {
            match self.input[i] {
                b'\\' => i += 2,
                b'"' => {
                    let end = i + 1;
                    self.pos = end;
                    let s = unsafe { std::str::from_utf8_unchecked(&self.input[start..end]) };
                    return serde_json::from_str(s).map_err(|_| DTXTError::InvalidString(self.pos));
                }
                b'\n' => return Err(DTXTError::InvalidString(self.pos)),
                _ => i += 1,
            }
        }
        Err(DTXTError::Unterminated)
    }

    fn parse_number(&mut self) -> Result<f64, DTXTError> {
        let start = self.pos;
        if self.current() == Some(b'-') { self.advance(); }
        if self.current() == Some(b'0') {
            self.advance();
        } else if matches!(self.current(), Some(b'1'..=b'9')) {
            while matches!(self.current(), Some(b'0'..=b'9')) { self.advance(); }
        }
        if self.current() == Some(b'.') {
            self.advance();
            while matches!(self.current(), Some(b'0'..=b'9')) { self.advance(); }
        }
        if matches!(self.current(), Some(b'e') | Some(b'E')) {
            self.advance();
            if matches!(self.current(), Some(b'+') | Some(b'-')) { self.advance(); }
            while matches!(self.current(), Some(b'0'..=b'9')) { self.advance(); }
        }
        let num_str = std::str::from_utf8(&self.input[start..self.pos])
            .map_err(|_| DTXTError::InvalidNumber("invalid utf8".to_string()))?;
        if num_str.ends_with('.') {
            return Err(DTXTError::InvalidNumber(num_str.to_string()));
        }
        num_str.parse::<f64>()
            .map_err(|_| DTXTError::InvalidNumber(num_str.to_string()))
}

    fn parse_constructor(&mut self) -> Result<DTXTValue<'a>, DTXTError> {
        let start = self.pos;
        while let Some(ch) = self.current() {
            if ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-' {
                self.advance();
            } else {
                break;
            }
        }
        let type_name = std::str::from_utf8(&self.input[start..self.pos])
            .map_err(|_| DTXTError::InvalidConstructorPayload("invalid utf8".to_string()))?;

        if self.current() != Some(b'(') {
            return Err(DTXTError::Syntax(self.pos)); // No space allowed
        }
        self.advance(); // skip '('

        let payload_start = self.pos;
        while self.current() != Some(b')') {
            if self.pos >= self.input.len() {
                return Err(DTXTError::Unterminated);
            }
            let ch = self.input[self.pos];
            if ch == b'(' {
                let bytes = &self.input[payload_start..self.pos];
                return Err(DTXTError::InvalidConstructorPayload(std::str::from_utf8(bytes).unwrap_or("").to_string()));
            }
            self.advance();
        }
        let payload = std::str::from_utf8(&self.input[payload_start..self.pos])
            .map_err(|_| DTXTError::InvalidConstructorPayload("invalid utf8 in payload".to_string()))?;
        if payload.is_empty() {
             return Err(DTXTError::InvalidConstructorPayload("empty".to_string()));
        }
        self.advance(); // skip ')'

        match type_name {
            "DATE" => {
                let bytes = payload.as_bytes();
                if payload.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                for (idx, &b) in bytes.iter().enumerate() {
                    if idx == 4 || idx == 7 { continue; }
                    if !b.is_ascii_digit() {
                        return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                    }
                }
                let month = (bytes[5] - b'0') * 10 + (bytes[6] - b'0');
                let day = (bytes[8] - b'0') * 10 + (bytes[9] - b'0');
                if month < 1 || month > 12 || day < 1 || day > 31 {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                Ok(DTXTValue::Date(payload))
            }
            "TIMESTAMP" => {
                if payload.len() < 19 {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                let has_z = payload.ends_with('Z');
                let has_offset = has_z || (payload.len() >= 25 && (payload.as_bytes()[payload.len()-6] == b'+' || payload.as_bytes()[payload.len()-6] == b'-'));
                if !has_offset {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                Ok(DTXTValue::String(Cow::Owned(format!("$timestamp:{}", payload))))
            }
            "BIGINT" => {
                if payload.as_bytes().iter().any(|&c| c == b' ' || c == b'\t' || c == b'\r' || c == b'\n' || c == b'+') {
                    return Err(DTXTError::InvalidConstructorPayload(format!("BIGINT({})", payload)));
                }
                let num = payload.parse::<BigInt>()
                    .map_err(|_| DTXTError::InvalidConstructorPayload(format!("BIGINT({})", payload)))?;
                Ok(DTXTValue::BigInt(num))
            }
            "DECIMAL" => {
                if payload.is_empty() || payload.starts_with('+') {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                if payload.starts_with("0") && payload.len() > 1 && !payload.starts_with("0.") {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                if payload.starts_with("-0") && payload.len() > 2 && !payload.starts_with("-0.") {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                let clean = payload.trim_start_matches('-').trim_start_matches('0').replace('.', "");
                if clean.len() > 34 {
                    return Err(DTXTError::InvalidConstructorPayload(format!("ERR_DECIMAL_OVERFLOW: {}", payload)));
                }
                Ok(DTXTValue::String(Cow::Owned(format!("$decimal:{}", payload))))
            }
            "BINARY" => {
                if payload.is_empty() || payload.len() % 4 != 0 {
                    return Err(DTXTError::InvalidConstructorPayload(format!("BINARY({}) length", payload)));
                }
                for &b in payload.as_bytes() {
                    if !b.is_ascii_alphanumeric() && b != b'+' && b != b'/' && b != b'=' {
                        return Err(DTXTError::InvalidConstructorPayload("BINARY invalid base64 alphabet".to_string()));
                    }
                }
                if payload.ends_with("==") {
                    let b64_table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                    let byte_ch = payload.as_bytes()[payload.len() - 3];
                    if let Some(pos) = b64_table.iter().position(|&r| r == byte_ch) {
                        if pos & 15 != 0 {
                            return Err(DTXTError::InvalidConstructorPayload("non-canonical trailing bits".to_string()));
                        }
                    }
                } else if payload.ends_with('=') {
                    let b64_table = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                    let byte_ch = payload.as_bytes()[payload.len() - 2];
                    if let Some(pos) = b64_table.iter().position(|&r| r == byte_ch) {
                        if pos & 3 != 0 {
                            return Err(DTXTError::InvalidConstructorPayload("non-canonical trailing bits".to_string()));
                        }
                    }
                }
                Ok(DTXTValue::String(Cow::Owned(format!("$binary:{}", payload))))
            }
            _ => Err(DTXTError::UnknownConstructor(type_name.to_string())),
        }
    }
}

// Stringifier
pub fn stringify(value: &DTXTValue, indent: Option<&str>) -> String {
    let mut result = String::with_capacity(1024);
    stringify_value(value, &mut result, indent, 0);
    result
}

fn stringify_value(value: &DTXTValue, out: &mut String, indent: Option<&str>, level: usize) {
    match value {
        DTXTValue::String(s) => {
            if s.contains('`') {
                out.push_str(&serde_json::to_string(s.as_ref()).unwrap());
            } else {
                out.push('`');
                out.push_str(s);
                out.push('`');
            }
        }
        DTXTValue::Number(n) => {
            let mut buf = ryu::Buffer::new();
            out.push_str(buf.format(*n));
        }
        DTXTValue::Bool(true) => out.push('T'),
        DTXTValue::Bool(false) => out.push('F'),
        DTXTValue::Null => out.push('N'),
        DTXTValue::BigInt(n) => {
            out.push_str("BIGINT(");
            out.push_str(&n.to_string());
            out.push(')');
        }
        DTXTValue::Date(s) => {
            out.push_str("DATE(");
            out.push_str(s);
            out.push(')');
        }
        DTXTValue::Bytes(bytes) => {
            out.push_str("BINARY(");
            out.push_str(&serde_json::to_string(bytes).unwrap());
            out.push(')');
        }
        DTXTValue::Array(arr) => {
            if arr.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            if let Some(ind) = indent {
                out.push('\n');
                for item in arr.iter() {
                    for _ in 0..=level { out.push_str(ind); }
                    stringify_value(item, out, indent, level + 1);
                    out.push_str(",\n");
                }
                for _ in 0..level { out.push_str(ind); }
            } else {
                for (i, item) in arr.iter().enumerate() {
                    stringify_value(item, out, indent, level + 1);
                    if i < arr.len() - 1 { out.push(','); }
                }
            }
            out.push(']');
        }
        DTXTValue::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort_unstable();
            
            if let Some(ind) = indent {
                out.push('\n');
                for key in keys {
                    for _ in 0..=level { out.push_str(ind); }
                    out.push_str(key);
                    out.push_str(": ");
                    stringify_value(&map[key], out, indent, level + 1);
                    out.push_str(",\n");
                }
                for _ in 0..level { out.push_str(ind); }
            } else {
                for (i, key) in keys.iter().enumerate() {
                    out.push_str(key);
                    out.push(':');
                    stringify_value(&map[*key], out, indent, level + 1);
                    if i < keys.len() - 1 { out.push(','); }
                }
            }
            out.push('}');
        }
    }
}

// Public API
#[inline]
pub fn parse<'a>(input: &'a str) -> Result<FxHashMap<&'a str, DTXTValue<'a>>, DTXTError> {
    let mut parser = DTXTParser::new(input);
    parser.parse()
}

// --- Python Bindings (Single-pass Optimization) ---

struct PyDTXTParser<'py, 'a> {
    py: Python<'py>,
    input: &'a [u8],
    pos: usize,
    depth: usize,
}

impl<'py, 'a> PyDTXTParser<'py, 'a> {
    fn new(py: Python<'py>, input: &'a str) -> Self {
        Self {
            py,
            input: input.as_bytes(),
            pos: 0,
            depth: 0,
        }
    }

    #[inline(always)]
    fn current(&self) -> Option<u8> {
        self.input.get(self.pos).copied()
    }

    #[inline(always)]
    fn advance(&mut self) {
        self.pos += 1;
    }

    #[inline(always)]
    fn skip_whitespace(&mut self) {
        let mut i = self.pos;
        let bytes = self.input;
        let len = bytes.len();
        while i < len {
            match bytes[i] {
                b' ' | b'\t' | b'\r' | b'\n' => i += 1,
                b'#' => {
                    i += 1;
                    if let Some(next_nl) = memchr(b'\n', &bytes[i..]) {
                        i += next_nl + 1;
                    } else {
                        i = len;
                    }
                }
                _ => break,
            }
        }
        self.pos = i;
    }

    fn parse_value(&mut self) -> PyResult<Bound<'py, PyAny>> {
        self.skip_whitespace();
        match self.current() {
            Some(b'{') => self.parse_object().map(|v| v.into_any()),
            Some(b'[') => self.parse_array().map(|v| v.into_any()),
            Some(b'`') => self.parse_string().map(|v| v.into_any()),
            Some(b'"') => self.parse_interpreted_string().map(|v| v.into_any()),
            Some(b'-') | Some(b'0'..=b'9') => self.parse_number(),
            Some(b'T') if self.pos + 1 >= self.input.len() || self.input[self.pos+1] != b'(' => {
                self.advance(); Ok(true.into_py_any(self.py)?.into_bound(self.py))
            }
            Some(b'F') if self.pos + 1 >= self.input.len() || self.input[self.pos+1] != b'(' => {
                self.advance(); Ok(false.into_py_any(self.py)?.into_bound(self.py))
            }
            Some(b'N') if self.pos + 1 >= self.input.len() || self.input[self.pos+1] != b'(' => {
                self.advance(); Ok(self.py.None().into_bound(self.py))
            }
            Some(_) => self.parse_constructor_py(),
            None => Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Unexpected EOF")),
        }
    }

    fn parse_constructor_py(&mut self) -> PyResult<Bound<'py, PyAny>> {
        let start = self.pos;
        while let Some(ch) = self.current() {
            if ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-' { self.advance(); } else { break; }
        }
        let type_name = unsafe { std::str::from_utf8_unchecked(&self.input[start..self.pos]) };
        if self.current() != Some(b'(') {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("Invalid identifier: {}", type_name)));
        }
        self.advance(); // (
        let _payload_start = self.pos;
        while let Some(ch) = self.current() {
            if ch == b')' { break; }
            if ch == b'(' {
                 return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Invalid constructor payload"));
            }
            self.advance();
        }
        let type_name = unsafe { std::str::from_utf8_unchecked(&self.input[start..self.pos]) };
        if self.current() != Some(b'(') {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("Invalid identifier: {}", type_name)));
        }
        self.advance(); // (
        let payload_start = self.pos;
        while let Some(ch) = self.current() {
            if ch == b')' { break; }
            if ch.is_ascii_whitespace() || ch == b'(' {
                 return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Invalid constructor payload"));
            }
            self.advance();
        }
        if self.current() != Some(b')') {
             return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Unterminated constructor"));
        }
        let payload = unsafe { std::str::from_utf8_unchecked(&self.input[payload_start..self.pos]) };
        if payload.is_empty() {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Empty constructor payload"));
        }
        self.advance(); // )
        
        match type_name {
            "BigNumber" => {
                let n: i128 = payload.parse().map_err(|_| PyErr::new::<pyo3::exceptions::PyValueError, _>("Invalid BigNumber"))?;
                // Canonicalization: remove leading zeros and normalize -0 to 0
                let canonicalized = if n == 0 { 0i128 } else { n };
                Ok(canonicalized.into_py_any(self.py)?.into_bound(self.py))
            }
            "Binary" => {
                let b = hex::decode(payload).map_err(|_| PyErr::new::<pyo3::exceptions::PyValueError, _>("Invalid Binary"))?;
                Ok(b.into_py_any(self.py)?.into_bound(self.py))
            }
            "Date" => {
                Ok(payload.into_py_any(self.py)?.into_bound(self.py)) // Simplified
            }
            _ => Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("Unknown constructor: {}", type_name))),
        }
    }

    fn parse_object(&mut self) -> PyResult<Bound<'py, PyDict>> {
        self.advance(); // {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("ERR_NESTING_DEPTH"));
        }
        let dict = PyDict::new(self.py);
        self.skip_whitespace();
        while self.current() != Some(b'}') {
            let key = self.parse_key()?;
            // Check for duplicate key
            if dict.contains(key)? {
                return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("ERR_DUPLICATE_KEY: {}", key)));
            }
            self.skip_whitespace();
            self.advance(); // :
            let val = self.parse_value()?;
            dict.set_item(key, val)?;
            self.skip_whitespace();
            if self.current() == Some(b',') { self.advance(); self.skip_whitespace(); }
        }
        self.advance(); // }
        self.depth -= 1;
        Ok(dict)
    }

    fn parse_array(&mut self) -> PyResult<Bound<'py, PyList>> {
        self.advance(); // [
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("ERR_NESTING_DEPTH"));
        }
        let list = PyList::empty(self.py);
        self.skip_whitespace();
        while self.current() != Some(b']') {
            list.append(self.parse_value()?)?;
            self.skip_whitespace();
            if self.current() == Some(b',') { self.advance(); self.skip_whitespace(); }
        }
        self.advance(); // ]
        self.depth -= 1;
        Ok(list)
    }

    fn parse_key(&mut self) -> PyResult<&'a str> {
        let start = self.pos;
        let bytes = self.input;
        let len = bytes.len();
        let mut i = start;
        while i < len {
            let ch = bytes[i];
            if ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-' { i += 1; } else { break; }
        }
        self.pos = i;
        if i == start { return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Empty key")); }
        Ok(unsafe { std::str::from_utf8_unchecked(&bytes[start..i]) })
    }

    fn parse_string(&mut self) -> PyResult<Bound<'py, PyString>> {
        self.advance(); // `
        let start = self.pos;
        if let Some(end) = memchr(b'`', &self.input[start..]) {
            let abs_end = start + end;
            self.pos = abs_end + 1;
            Ok(PyString::new(self.py, unsafe { std::str::from_utf8_unchecked(&self.input[start..abs_end]) }))
        } else {
            Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Unterminated string"))
        }
    }

    fn parse_interpreted_string(&mut self) -> PyResult<Bound<'py, PyAny>> {
        let start = self.pos;
        self.advance(); // "
        let mut i = self.pos;
        while i < self.input.len() {
            match self.input[i] {
                b'\\' => i += 2,
                b'"' => {
                    let end = i + 1;
                    self.pos = end;
                    let s = unsafe { std::str::from_utf8_unchecked(&self.input[start..end]) };
                    let unescaped: String = serde_json::from_str(s)
                        .map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("{}", e)))?;
                    return Ok(unescaped.into_py_any(self.py)?.into_bound(self.py));
                }
                b'\n' => return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Literal newline in interpreted string")),
                _ => i += 1,
            }
        }
        Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Unterminated string"))
    }

    fn parse_number(&mut self) -> PyResult<Bound<'py, PyAny>> {
        let start = self.pos;
        while let Some(ch) = self.current() {
            if ch.is_ascii_digit() || ch == b'.' || ch == b'-' || ch == b'e' || ch == b'E' || ch == b'+' {
                self.advance();
            } else { break; }
        }
        let s = unsafe { std::str::from_utf8_unchecked(&self.input[start..self.pos]) };
        
        // Validate: no leading zeros (except for "0" itself)
        if s.len() > 1 && s.starts_with('0') && s.chars().nth(1).map_or(false, |c| c.is_ascii_digit()) {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("ERR_INVALID_NUMBER: {} (leading zero)", s)));
        }
        // Validate: no trailing dot
        if s.ends_with('.') {
            return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("ERR_INVALID_NUMBER: {} (trailing dot)", s)));
        }
        
        if s.contains('.') || s.contains('e') || s.contains('E') {
            let n: f64 = s.parse().map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("{}", e)))?;
            Ok(n.into_py_any(self.py)?.into_bound(self.py))
        } else {
            let n: i128 = s.parse().map_err(|e| PyErr::new::<pyo3::exceptions::PyValueError, _>(format!("{}", e)))?;
            Ok(n.into_py_any(self.py)?.into_bound(self.py))
        }
    }
}

#[pyfunction]
fn loads(py: Python<'_>, input: &str) -> PyResult<PyObject> {
    let mut parser = PyDTXTParser::new(py, input);
    parser.skip_whitespace();
    let result = parser.parse_object()?;
    parser.skip_whitespace();
    if parser.current().is_some() {
        return Err(PyErr::new::<pyo3::exceptions::PyValueError, _>("Trailing data after root object"));
    }
    Ok(result.into())
}

#[pyfunction]
fn dumps(obj: PyObject) -> PyResult<String> {
    // For now, we reuse the existing stringifier by converting back or just implementing a simple python version.
    // But since the goal is speed and we already have a reference python dumps, 
    // we could keep Python dumps as is and only use Rust for loads.
    // However, to be complete:
    Ok(format!("# Serialized from Rust\n{:?}", obj)) // Placeholder
}

#[pymodule]
fn dtxt_rs(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(loads, m)?)?;
    m.add_function(wrap_pyfunction!(dumps, m)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_object() {
        let input = "{name: `John`, age: 30}";
        let result = parse(input).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_array() {
        let input = "{items: [1, 2, 3]}";
        let result = parse(input).unwrap();
        if let Some(DTXTValue::Array(arr)) = result.get("items") {
            assert_eq!(arr.len(), 3);
        } else {
            panic!("Expected array");
        }
    }
}
