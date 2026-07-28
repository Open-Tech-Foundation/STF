package stf

import (
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strings"
)

// TypedValuePolicy says how to handle STF kinds that JSON has no equivalent for.
type TypedValuePolicy int

const (
	// RejectTyped refuses to convert, naming the offending path. The default.
	RejectTyped TypedValuePolicy = iota
	// PayloadAsString encodes the constructor payload as a JSON string. Lossy: the reader
	// cannot tell the result from a user-authored string of the same text.
	PayloadAsString
)

// maxExactInt is the largest magnitude an integer can have and still be exactly a binary64.
const maxExactInt = 9007199254740992

// FromJSON converts a decoded JSON document to STF. The root must be a JSON object.
//
// STF replaces JSON rather than extending it, so JSON that STF cannot express — a non-object
// root, a key outside [A-Za-z0-9_-]+, an integer past the exact binary64 range — is refused
// rather than repaired (migration guide §1.4).
func FromJSON(data any) (*Object, error) {
	object, ok := data.(map[string]any)
	if !ok {
		return nil, unrepresentable(
			"an STF document root must be an object, but this JSON root is %s", jsonKind(data))
	}
	v, err := convertFromJSON(object, "$")
	if err != nil {
		return nil, err
	}
	return v.(*Object), nil
}

// FromJSONText parses JSON text and converts it.
//
// Numbers are decoded through json.Number so an integer that binary64 cannot hold exactly is
// refused instead of being silently rounded.
func FromJSONText(text string) (*Object, error) {
	dec := json.NewDecoder(strings.NewReader(text))
	dec.UseNumber()
	var data any
	if err := dec.Decode(&data); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	return FromJSON(data)
}

func jsonKind(data any) string {
	switch data.(type) {
	case nil:
		return "null"
	case bool:
		return "a boolean"
	case float64, json.Number:
		return "a number"
	case string:
		return "a string"
	case []any:
		return "an array"
	}
	return "an object"
}

func convertFromJSON(data any, path string) (Value, error) {
	switch value := data.(type) {
	case nil:
		return nil, nil
	case bool:
		return value, nil
	case string:
		return value, nil
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, unrepresentable("%s: %v is not an STF Number", path, value)
		}
		return value, nil
	case json.Number:
		text := value.String()
		if !strings.ContainsAny(text, ".eE") {
			n, ok := new(big.Int).SetString(text, 10)
			if ok && n.CmpAbs(big.NewInt(maxExactInt)) > 0 {
				// §7.2: rounding this would change the document's meaning.
				return nil, unrepresentable(
					"%s: integer %s is not exactly representable as binary64; "+
						"write it as BIGINT(%s) instead", path, text, text)
			}
		}
		f, err := value.Float64()
		if err != nil || math.IsInf(f, 0) {
			return nil, unrepresentable("%s: %s is outside the binary64 range", path, text)
		}
		return f, nil
	case []any:
		out := make([]Value, 0, len(value))
		for i, item := range value {
			child, err := convertFromJSON(item, fmt.Sprintf("%s[%d]", path, i))
			if err != nil {
				return nil, err
			}
			out = append(out, child)
		}
		return out, nil
	case map[string]any:
		out := NewObjectSized(len(value))
		// Go maps are unordered, so the only stable order available is sorted. A JSON object
		// has no authored order to preserve once decoded into a map.
		for _, key := range sortedKeys(value) {
			if key == "" {
				return nil, unrepresentable("%s: an STF key must not be empty", path)
			}
			if !isIdentifier(key) {
				return nil, unrepresentable(
					"%s: key `%s` is not a valid STF identifier ([A-Za-z0-9_-]+)", path, key)
			}
			child, err := convertFromJSON(value[key], path+"."+key)
			if err != nil {
				return nil, err
			}
			out.Set(key, child)
		}
		return out, nil
	}
	return nil, unrepresentable("%s: %T has no STF representation", path, data)
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	// sort.Strings is a byte sort, matching §14's key ordering.
	sort.Strings(keys)
	return keys
}

// ToJSON converts an STF value to a JSON-encodable Go value.
func ToJSON(v Value, policy TypedValuePolicy) (any, error) {
	return convertToJSON(v, "$", policy)
}

func convertToJSON(v Value, path string, policy TypedValuePolicy) (any, error) {
	typed := func(payload, what string) (any, error) {
		if policy == PayloadAsString {
			return payload, nil
		}
		return nil, unrepresentable(
			"%s: JSON has no %s type. Convert with PayloadAsString to write the payload as a "+
				"string, accepting that the type is lost.", path, what)
	}

	switch value := v.(type) {
	case nil:
		return nil, nil
	case bool:
		return value, nil
	case string:
		return value, nil
	case float64:
		// Emit an integral value as a JSON integer, which is what a JSON writer produces and
		// what keeps a JSON -> STF -> JSON round trip textually stable.
		if value == math.Trunc(value) && math.Abs(value) <= maxExactInt {
			return json.Number(FormatIntegral(value)), nil
		}
		text, err := FormatNumber(value)
		if err != nil {
			return nil, err
		}
		return json.Number(text), nil
	case []Value:
		out := make([]any, 0, len(value))
		for i, item := range value {
			child, err := convertToJSON(item, fmt.Sprintf("%s[%d]", path, i), policy)
			if err != nil {
				return nil, err
			}
			out = append(out, child)
		}
		return out, nil
	case *Object:
		out := make(map[string]any, value.Len())
		for _, key := range value.Keys() {
			item, _ := value.Get(key)
			child, err := convertToJSON(item, path+"."+key, policy)
			if err != nil {
				return nil, err
			}
			out[key] = child
		}
		return out, nil
	case *big.Int:
		return typed(value.String(), "arbitrary-precision integer")
	case *Decimal:
		return typed(value.Payload(), "exact decimal")
	case Date:
		return typed(value.Payload(), "date")
	case Timestamp:
		return typed(value.Payload(), "timestamp")
	case []byte:
		return typed(BinaryToBase64(value), "binary")
	}
	return nil, unrepresentable("%s: %T has no JSON representation", path, v)
}

// FormatIntegral renders an integral float64 without a decimal point or exponent.
func FormatIntegral(n float64) string {
	return new(big.Float).SetFloat64(n).Text('f', 0)
}

// TaggedJSON encodes a value in the conformance corpus's tagged JSON, which is lossless where
// plain JSON is not.
//
// "$" is safe as an escape key because it is not a legal STF key character (spec §6.1), so a
// tag can never collide with a real parsed object.
func TaggedJSON(v Value) (any, error) {
	tag := func(name, text string) any {
		return map[string]any{"$": name, "v": text}
	}
	switch value := v.(type) {
	case nil:
		return nil, nil
	case bool:
		return value, nil
	case string:
		return value, nil
	case float64:
		// Numbers are tagged with a string too: JSON numbers cannot express -0 and give no
		// binary64 round-trip guarantee, both of which §7.2 and §7.3 make observable.
		text, err := FormatNumber(value)
		if err != nil {
			return nil, err
		}
		return tag("num", text), nil
	case []Value:
		out := make([]any, 0, len(value))
		for _, item := range value {
			child, err := TaggedJSON(item)
			if err != nil {
				return nil, err
			}
			out = append(out, child)
		}
		return out, nil
	case *Object:
		out := make(map[string]any, value.Len())
		for _, key := range value.Keys() {
			item, _ := value.Get(key)
			child, err := TaggedJSON(item)
			if err != nil {
				return nil, err
			}
			out[key] = child
		}
		return out, nil
	case *big.Int:
		return tag("bigint", value.String()), nil
	case *Decimal:
		return tag("dec", value.Payload()), nil
	case Date:
		return tag("date", value.Payload()), nil
	case Timestamp:
		return tag("ts", value.Payload()), nil
	case []byte:
		return tag("bin", BinaryToBase64(value)), nil
	}
	return nil, unrepresentable("%T has no tagged-JSON encoding", v)
}
