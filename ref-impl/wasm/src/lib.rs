use std::borrow::Cow;
use std::fmt;
use rustc_hash::FxHashMap;
use memchr::memchr;
use num_bigint::BigInt;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen::*;
use wasm_bindgen::prelude::*;

#[derive(Debug, Serialize, Deserialize)]
pub enum DTXTValue {
    String(String),
    Number(f64),
    Bool(bool),
    Null,
    BigInt(String),
    Date(String),
    Bytes(String),
    Array(Vec<DTXTValue>),
    Object(FxHashMap<String, DTXTValue>),
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

impl std::error::Error for DTXTError {}

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

    #[inline]
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

    pub fn parse(&mut self) -> Result<FxHashMap<String, DTXTValue>, DTXTError> {
        self.skip_whitespace();
        let result = self.parse_object()?;
        self.skip_whitespace();
        if self.pos < self.input.len() {
            return Err(DTXTError::TrailingData(self.pos));
        }
        Ok(result)
    }

    fn parse_object(&mut self) -> Result<FxHashMap<String, DTXTValue>, DTXTError> {
        self.advance(); // skip {
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
            if map.insert(key.to_string(), value).is_some() {
                return Err(DTXTError::DuplicateKey(key.to_string()));
            }

            self.skip_whitespace();
            if self.current() == Some(b',') {
                self.advance();
                self.skip_whitespace();
            }
        }

        self.advance(); // skip }
        self.depth -= 1;
        Ok(map)
    }

    fn parse_array(&mut self) -> Result<Vec<DTXTValue>, DTXTError> {
        self.advance(); // skip [
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

        self.advance(); // skip ]
        self.depth -= 1;
        Ok(arr)
    }

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
        if i == start {
            return Err(DTXTError::InvalidIdentifier(self.pos));
        }
        Ok(unsafe { std::str::from_utf8_unchecked(&bytes[start..i]) })
    }

    fn parse_string(&mut self) -> Result<&'a str, DTXTError> {
        self.advance(); // skip `
        let start = self.pos;
        let bytes = self.input;
        let len = bytes.len();
        
        while self.pos < len {
            if bytes[self.pos] == b'`' {
                let result = unsafe { std::str::from_utf8_unchecked(&bytes[start..self.pos]) };
                self.advance(); // skip closing `
                return Ok(result);
            }
            self.advance();
        }
        
        Err(DTXTError::Unterminated)
    }

    fn parse_interpreted_string(&mut self) -> Result<String, DTXTError> {
        self.advance(); // skip "
        let start = self.pos;
        let bytes = self.input;
        let len = bytes.len();
        
        while self.pos < len {
            match bytes[self.pos] {
                b'"' => {
                    let s = unsafe { std::str::from_utf8_unchecked(&bytes[start..self.pos]) };
                    let escaped = s.replace("\\", "\\\").replace("""", "\\"");
                        .map_err(|_| DTXTError::InvalidString(self.pos))?;
                    self.advance(); // skip closing "
                    return Ok(unescaped);
                }
                b'\\' => {
                    self.advance(); // skip \ (the next char is part of escape)
                    if self.pos >= len {
                        return Err(DTXTError::InvalidString(self.pos));
                    }
                    self.advance();
                }
                b'\n' => return Err(DTXTError::InvalidString(self.pos)),
                _ => self.advance(),
            }
        }
        
        Err(DTXTError::Unterminated)
    }

    fn parse_number(&mut self) -> Result<f64, DTXTError> {
        let start = self.pos;
        let bytes = self.input;
        let len = bytes.len();
        
        // Check for leading zero (invalid)
        if bytes[self.pos] == b'0' && self.pos + 1 < len && bytes[self.pos + 1].is_ascii_digit() {
            return Err(DTXTError::InvalidNumber("leading zero".to_string()));
        }
        
        while self.pos < len {
            let ch = bytes[self.pos];
            if ch.is_ascii_digit() || ch == b'.' || ch == b'-' || ch == b'e' || ch == b'E' || ch == b'+' {
                self.advance();
            } else {
                break;
            }
        }
        
        let s = unsafe { std::str::from_utf8_unchecked(&bytes[start..self.pos]) };
        
        // Check for trailing dot
        if s.ends_with('.') {
            return Err(DTXTError::InvalidNumber("trailing dot".to_string()));
        }
        
        s.parse().map_err(|_| DTXTError::InvalidNumber(s.to_string()))
    }

    fn parse_value(&mut self) -> Result<DTXTValue, DTXTError> {
        self.skip_whitespace();
        match self.current() {
            Some(b'{') => Ok(DTXTValue::Object(self.parse_object()?)),
            Some(b'[') => Ok(DTXTValue::Array(self.parse_array()?)),
            Some(b'`') => Ok(DTXTValue::String(self.parse_string()?.to_string())),
            Some(b'"') => Ok(DTXTValue::String(self.parse_interpreted_string()?)),
            Some(b'-') | Some(b'0'..=b'9') => Ok(DTXTValue::Number(self.parse_number()?)),
            Some(b'T') if self.pos + 1 >= self.input.len() || !self.input[self.pos+1].is_ascii_alphanumeric() => {
                self.advance();
                Ok(DTXTValue::Bool(true))
            }
            Some(b'F') if self.pos + 1 >= self.input.len() || !self.input[self.pos+1].is_ascii_alphanumeric() => {
                self.advance();
                Ok(DTXTValue::Bool(false))
            }
            Some(b'N') if self.pos + 1 >= self.input.len() || !self.input[self.pos+1].is_ascii_alphanumeric() => {
                self.advance();
                Ok(DTXTValue::Null)
            }
            Some(b'A'..=b'Z') | Some(b'a'..=b'z') | Some(b'_') => self.parse_constructor(),
            Some(_) => Err(DTXTError::Syntax(self.pos)),
            None => Err(DTXTError::Unterminated),
        }
    }

    fn parse_constructor(&mut self) -> Result<DTXTValue, DTXTError> {
        let start = self.pos;
        while let Some(ch) = self.current() {
            if ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-' { 
                self.advance(); 
            } else { 
                break; 
            }
        }
        let type_name = unsafe { std::str::from_utf8_unchecked(&self.input[start..self.pos]) };

        if self.current() != Some(b'(') {
            return Err(DTXTError::Syntax(self.pos));
        }
        self.advance(); // skip (

        let payload_start = self.pos;
        while let Some(ch) = self.current() {
            if ch == b')' { break; }
            if ch == b'(' {
                return Err(DTXTError::InvalidConstructorPayload("nested constructor".to_string()));
            }
            self.advance();
        }

        let payload = unsafe { std::str::from_utf8_unchecked(&self.input[payload_start..self.pos]) };
        if payload.is_empty() {
            return Err(DTXTError::InvalidConstructorPayload("empty".to_string()));
        }
        self.advance(); // skip )

        match type_name {
            "Date" => {
                let valid = payload.len() >= 10 && payload.chars().all(|c| c.is_ascii_digit() || c == '-' || c == 'T' || c == 'Z' || c == ':' || c == '.' || c == '+' || c == ' ');
                if !valid {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                Ok(DTXTValue::Date(payload.to_string()))
            }
            "BigNumber" => {
                let cleaned: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
                let num = cleaned.parse::<BigInt>()
                    .map_err(|_| DTXTError::InvalidConstructorPayload(format!("BigNumber({})", payload)))?;
                Ok(DTXTValue::BigInt(num.to_string()))
            }
            "Binary" => {
                let cleaned: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
                if cleaned.len() % 2 != 0 {
                    return Err(DTXTError::InvalidConstructorPayload(format!("Binary({}) length", payload)));
                }
                let mut bytes = Vec::with_capacity(cleaned.len() / 2);
                for i in (0..cleaned.len()).step_by(2) {
                    let byte = u8::from_str_radix(&cleaned[i..i+2], 16)
                        .map_err(|_| DTXTError::InvalidConstructorPayload(format!("Binary({})", payload)))?;
                    bytes.push(byte);
                }
                Ok(DTXTValue::Bytes(hex::encode(bytes)))
            }
            _ => Err(DTXTError::UnknownConstructor(type_name.to_string())),
        }
    }
}

#[wasm_bindgen]
pub fn parse(input: &str) -> Result<JsValue, JsError> {
    let mut parser = DTXTParser::new(input);
    let result = parser.parse()?;
    Ok(to_value(&result)?)
}

#[wasm_bindgen]
pub fn stringify(input: JsValue) -> Result<String, JsError> {
    let value: DTXTValue = from_value(input)?;
    Ok(stringify_value(&value, None))
}

fn stringify_value(value: &DTXTValue, indent: Option<&str>) -> String {
    let mut result = String::with_capacity(1024);
    stringify_value_inner(value, &mut result, indent, 0);
    result
}

fn stringify_value_inner(value: &DTXTValue, out: &mut String, indent: Option<&str>, level: usize) {
    match value {
        DTXTValue::String(s) => {
            if s.contains('`') {
                // Simple escape for backticks
                let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
                out.push('"');
                out.push_str(&escaped);
                out.push('"');
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
        DTXTValue::BigInt(s) => {
            out.push_str("BigNumber(");
            out.push_str(s);
            out.push(')');
        }
        DTXTValue::Date(s) => {
            out.push_str("Date(");
            out.push_str(s);
            out.push(')');
        }
        DTXTValue::Bytes(s) => {
            out.push_str("Binary(");
            out.push_str(s);
            out.push(')');
        }
        DTXTValue::Array(arr) => {
            if arr.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            if let Some(indent) = indent {
                out.push('\n');
                let sp = indent.repeat(level + 1);
                for (i, v) in arr.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                        out.push('\n');
                    }
                    out.push_str(&sp);
                    stringify_value_inner(v, out, Some(indent), level + 1);
                }
                out.push('\n');
                out.push_str(&indent.repeat(level));
            } else {
                for (i, v) in arr.iter().enumerate() {
                    if i > 0 {
                        out.push_str(", ");
                    }
                    stringify_value_inner(v, out, None, level + 1);
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
            if let Some(indent) = indent {
                out.push('\n');
                let sp = indent.repeat(level + 1);
                let mut keys: Vec<_> = map.keys().collect();
                keys.sort();
                for (i, k) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                        out.push('\n');
                    }
                    out.push_str(&sp);
                    out.push_str(k);
                    out.push_str(": ");
                    stringify_value_inner(map.get(*k).unwrap(), out, Some(indent), level + 1);
                }
                out.push('\n');
                out.push_str(&indent.repeat(level));
            } else {
                let mut keys: Vec<_> = map.keys().collect();
                keys.sort();
                for (i, k) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push_str(", ");
                    }
                    out.push_str(k);
                    out.push_str(": ");
                    stringify_value_inner(map.get(*k).unwrap(), out, None, level + 1);
                }
            }
            out.push('}');
        }
    }
}
