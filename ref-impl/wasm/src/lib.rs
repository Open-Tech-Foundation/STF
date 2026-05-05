use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::collections::HashMap;
use memchr::memchr;
use js_sys::{Date, Uint8Array};

// DTXT Errors
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

// DTXT Value enum
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DTXTValue {
    String(String),
    Number(f64),
    Bool(bool),
    Null,
    BigInt(String), // Store as string for WASM compatibility
    Date(String),
    Bytes(Vec<u8>),
    Array(Vec<DTXTValue>),
    Object(HashMap<String, DTXTValue>),
}

// Parser
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
    pub fn parse(&mut self) -> Result<HashMap<String, DTXTValue>, DTXTError> {
        self.skip_whitespace();
        let result = self.parse_object()?;
        self.skip_whitespace();
        if self.pos < self.input.len() {
            return Err(DTXTError::TrailingData(self.pos));
        }
        Ok(result)
    }

    #[inline]
    fn parse_value(&mut self) -> Result<DTXTValue, DTXTError> {
        self.skip_whitespace();
        match self.current() {
            Some(b'{') => Ok(DTXTValue::Object(self.parse_object()?)),
            Some(b'[') => Ok(DTXTValue::Array(self.parse_array()?)),
            Some(b'`') => Ok(DTXTValue::String(self.parse_string()?.to_string())),
            Some(b'"') => Ok(DTXTValue::String(self.parse_interpreted_string()?)),
            Some(b'-') | Some(b'0'..=b'9') => Ok(DTXTValue::Number(self.parse_number()?)),
            Some(b'T') if self.pos + 1 >= self.input.len() || self.input[self.pos+1] != b'(' => {
                self.advance();
                Ok(DTXTValue::Bool(true))
            }
            Some(b'F') if self.pos + 1 >= self.input.len() || self.input[self.pos+1] != b'(' => {
                self.advance();
                Ok(DTXTValue::Bool(false))
            }
            Some(b'N') if self.pos + 1 >= self.input.len() || self.input[self.pos+1] != b'(' => {
                self.advance();
                Ok(DTXTValue::Null)
            }
            Some(b'A'..=b'Z') | Some(b'a'..=b'z') | Some(b'_') => self.parse_constructor(),
            Some(_) => Err(DTXTError::Syntax(self.pos)),
            None => Err(DTXTError::Unterminated),
        }
    }

    fn parse_object(&mut self) -> Result<HashMap<String, DTXTValue>, DTXTError> {
        self.advance(); // skip '{'
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(DTXTError::NestingDepth);
        }
        
        let mut map = HashMap::default();

        self.skip_whitespace();
        while self.current() != Some(b'}') {
            let key = self.parse_key()?.to_string();
            self.skip_whitespace();

             if self.current() != Some(b':') {
                return Err(DTXTError::MissingColon(self.pos));
            }
            self.advance(); // skip ':'

            let value = self.parse_value()?;
            if map.insert(key.clone(), value).is_some() {
                return Err(DTXTError::DuplicateKey(key));
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

    fn parse_array(&mut self) -> Result<Vec<DTXTValue>, DTXTError> {
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

    fn parse_constructor(&mut self) -> Result<DTXTValue, DTXTError> {
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
            "Date" => {
                // Payload may contain any UTF-8 except ( and )
                // Validate ISO 8601 - allow spaces in payload
                let valid = payload.len() >= 10 && payload.chars().all(|c| c.is_ascii_digit() || c == '-' || c == 'T' || c == 'Z' || c == ':' || c == '.' || c == '+' || c == ' ');
                if !valid {
                    return Err(DTXTError::InvalidConstructorPayload(payload.to_string()));
                }
                Ok(DTXTValue::Date(payload.to_string()))
            }
            "BigNumber" => {
                // Remove spaces from payload for validation and parsing
                let cleaned: String = payload.chars().filter(|c| !c.is_whitespace()).collect();
                // Store as string for WASM compatibility
                Ok(DTXTValue::BigInt(cleaned))
            }
            "Binary" => {
                // Remove spaces from payload for validation and parsing
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
                Ok(DTXTValue::Bytes(bytes))
            }
            _ => Err(DTXTError::UnknownConstructor(type_name.to_string())),
        }
    }
}

// Stringifier
pub fn stringify_value_wrapper(value: &DTXTValue, indent: Option<&str>) -> String {
    let mut result = String::with_capacity(1024);
    stringify_value(value, &mut result, indent, 0);
    result
}

fn stringify_value(value: &DTXTValue, out: &mut String, indent: Option<&str>, level: usize) {
    match value {
        DTXTValue::String(s) => {
            if s.contains('`') {
                out.push_str(&serde_json::to_string(&s).unwrap());
            } else {
                out.push('`');
                out.push_str(&s);
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
            out.push_str("BigNumber(");
            out.push_str(&n.to_string());
            out.push(')');
        }
        DTXTValue::Date(s) => {
            out.push_str("Date(");
            out.push_str(s);
            out.push(')');
        }
        DTXTValue::Bytes(bytes) => {
            out.push_str("Binary(");
            for byte in bytes {
                const HEX: &[u8; 16] = b"0123456789ABCDEF";
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0x0F) as usize] as char);
            }
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

// Public API for WASM
#[wasm_bindgen]
pub fn parse(input: &str) -> Result<JsValue, JsError> {
    let mut parser = DTXTParser::new(input);
    match parser.parse() {
        Ok(result) => {
            // Convert to a JsValue that's a plain JS object (not a Map)
            let obj = js_sys::Object::new();
            for (key, value) in result {
                let js_value = dtxt_value_to_js(&value);
                js_sys::Reflect::set(&obj, &key.into(), &js_value).unwrap();
            }
            Ok(obj.into())
        }
        Err(e) => Err(JsError::new(&e.to_string())),
    }
}

fn js_to_dtxt_value(value: &JsValue) -> Result<DTXTValue, JsError> {
    // Check for null
    if value.is_null() || value.is_undefined() {
        return Ok(DTXTValue::Null);
    }
    
    // Check for boolean
    if let Some(b) = value.as_bool() {
        return Ok(DTXTValue::Bool(b));
    }
    
    // Check for number
    if let Some(n) = value.as_f64() {
        return Ok(DTXTValue::Number(n));
    }
    
    // Check for string
    if let Some(s) = value.as_string() {
        return Ok(DTXTValue::String(s));
    }
    
    // Check for Date
    if value.is_instance_of::<js_sys::Date>() {
        let date = js_sys::Date::from(value.clone());
        let iso_string = date.to_iso_string();
        let iso_str = iso_string.as_string().unwrap_or_else(|| "1970-01-01T00:00:00.000Z".to_string());
        return Ok(DTXTValue::Date(iso_str));
    }
    
    // Check for Uint8Array
    if value.is_instance_of::<js_sys::Uint8Array>() {
        let uint8 = js_sys::Uint8Array::from(value.clone());
        let length = uint8.length() as usize;
        let mut bytes = Vec::with_capacity(length);
        for i in 0..length {
            bytes.push(uint8.get_index(i as u32));
        }
        return Ok(DTXTValue::Bytes(bytes));
    }
    
    // Check for Array
    if value.is_instance_of::<js_sys::Array>() {
        let array = js_sys::Array::from(value);
        let mut vec = Vec::new();
        for i in 0..array.length() {
            let item = array.get(i);
            vec.push(js_to_dtxt_value(&item)?);
        }
        return Ok(DTXTValue::Array(vec));
    }
    
    // Check for Object (and not Date/Uint8Array which were checked above)
    if value.is_instance_of::<js_sys::Object>() {
        let obj = js_sys::Object::from(value.clone());
        let entries = js_sys::Object::entries(&obj);
        let mut map = HashMap::new();
        
        for i in 0..entries.length() {
            let entry = js_sys::Array::from(&entries.get(i));
            let key = entry.get(0).as_string().ok_or_else(|| {
                JsError::new("Object key must be a string")
            })?;
            let val = entry.get(1);
            map.insert(key, js_to_dtxt_value(&val)?);
        }
        return Ok(DTXTValue::Object(map));
    }
    
    Err(JsError::new("Unsupported JS value type"))
}

fn dtxt_value_to_js(value: &DTXTValue) -> JsValue {
    match value {
        DTXTValue::String(s) => JsValue::from_str(s),
        DTXTValue::Number(n) => JsValue::from_f64(*n),
        DTXTValue::Bool(true) => JsValue::TRUE,
        DTXTValue::Bool(false) => JsValue::FALSE,
        DTXTValue::Null => JsValue::NULL,
        DTXTValue::BigInt(s) => {
            // Return as string (JS BigInt requires special handling)
            JsValue::from_str(s)
        }
        DTXTValue::Date(s) => {
            // Convert to JS Date object
            let date_str = format!("{}", s);
            let timestamp = js_sys::Date::parse(&date_str);
            if timestamp.is_finite() && timestamp > 0.0 {
                let date = Date::new(&JsValue::from_f64(timestamp));
                date.into()
            } else {
                JsValue::from_str(s)
            }
        }
        DTXTValue::Bytes(bytes) => {
            // Convert to Uint8Array
            let array = Uint8Array::new_with_length(bytes.len() as u32);
            for (i, &byte) in bytes.iter().enumerate() {
                array.set_index(i as u32, byte);
            }
            array.into()
        }
        DTXTValue::Array(arr) => {
            let js_array = js_sys::Array::new();
            for item in arr {
                js_array.push(&dtxt_value_to_js(item));
            }
            js_array.into()
        }
        DTXTValue::Object(map) => {
            let obj = js_sys::Object::new();
            for (key, value) in map {
                let js_value = dtxt_value_to_js(value);
                js_sys::Reflect::set(&obj, &key.into(), &js_value).unwrap();
            }
            obj.into()
        }
    }
}

#[wasm_bindgen]
pub fn stringify(input: JsValue) -> Result<String, JsError> {
    let dtxt_value = js_to_dtxt_value(&input)?;
    Ok(stringify_value_wrapper(&dtxt_value, None))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_object() {
        let input = "{name: `John`, age: 30}";
        let mut parser = DTXTParser::new(input);
        let result = parser.parse().unwrap();
        assert_eq!(result.len(), 2);
        println!("Test result: {:?}", result);
    }

    #[test]
    fn test_nested_object() {
        let input = "{user: {name: `Alice`, active: T}}";
        let mut parser = DTXTParser::new(input);
        let result = parser.parse().unwrap();
        assert_eq!(result.len(), 1);
        println!("Test result: {:?}", result);
    }
}
