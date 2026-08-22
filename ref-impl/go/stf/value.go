package stf

import (
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"strings"
)

// Kind is one of the eleven STF value kinds (spec §3).
type Kind string

// The eleven kinds.
const (
	KindNull      Kind = "Null"
	KindBool      Kind = "Boolean"
	KindNumber    Kind = "Number"
	KindString    Kind = "String"
	KindArray     Kind = "Array"
	KindObject    Kind = "Object"
	KindBigInt    Kind = "BigInt"
	KindDecimal   Kind = "Decimal"
	KindDate      Kind = "Date"
	KindTimestamp Kind = "Timestamp"
	KindBinary    Kind = "Binary"
	KindGeometry  Kind = "Geometry"
	KindTime      Kind = "Time"
	KindDuration  Kind = "Duration"
)

// Value is any STF value.
//
// Spec §3.1 forbids representing a typed value as a string carrying a marker prefix, so the
// concrete types keep every kind distinguishable:
//
//	Null       nil
//	Boolean    bool
//	Number     float64 — always, because §7.2 makes Number exactly binary64
//	String     string
//	Array      []Value
//	Object     *Object — ordered, as §11.2 requires
//	BigInt     *big.Int
//	Decimal    *Decimal
//	Date       Date
//	Timestamp  Timestamp
//	Binary     []byte
//	Geometry   *Geometry
//	Time       Time
//	Duration   Duration
type Value interface{}

// KindOf reports the STF kind of a host value.
func KindOf(v Value) Kind {
	switch v.(type) {
	case nil:
		return KindNull
	case bool:
		return KindBool
	case float64:
		return KindNumber
	case string:
		return KindString
	case []Value:
		return KindArray
	case *Object:
		return KindObject
	case *big.Int:
		return KindBigInt
	case *Decimal:
		return KindDecimal
	case Date:
		return KindDate
	case Timestamp:
		return KindTimestamp
	case []byte:
		return KindBinary
	case *Geometry:
		return KindGeometry
	case Time:
		return KindTime
	case Duration:
		return KindDuration
	}
	return Kind(fmt.Sprintf("<%T>", v))
}

// Object is an ordered map of unique keys to values.
//
// Spec §11.2 requires member order to be preserved so documents round-trip as authored, and
// §3.2 requires order not to affect equality. A Go map cannot do the first, so entries are
// kept in a slice with an index alongside for lookup.
type Object struct {
	keys   []string
	values map[string]Value
}

// NewObject returns an empty object.
func NewObject() *Object {
	return &Object{values: make(map[string]Value)}
}

// NewObjectSized returns an empty object with room for n members.
func NewObjectSized(n int) *Object {
	return &Object{keys: make([]string, 0, n), values: make(map[string]Value, n)}
}

// Set appends a member. It reports false without inserting if the key is already present,
// which the parser reports as ERR_DUPLICATE_KEY (spec §11.2).
func (o *Object) Set(key string, value Value) bool {
	if _, exists := o.values[key]; exists {
		return false
	}
	o.keys = append(o.keys, key)
	o.values[key] = value
	return true
}

// Get returns the value for key.
func (o *Object) Get(key string) (Value, bool) {
	v, ok := o.values[key]
	return v, ok
}

// Has reports whether key is present.
func (o *Object) Has(key string) bool {
	_, ok := o.values[key]
	return ok
}

// Keys returns the member keys in authored order.
func (o *Object) Keys() []string {
	return o.keys
}

// Len returns the number of members.
func (o *Object) Len() int {
	if o == nil {
		return 0
	}
	return len(o.keys)
}

// Decimal is an exact signed decimal: a coefficient and a scale (spec §10.2).
//
// DECIMAL(1.5) and DECIMAL(1.50) are distinct values, so the scale is data and is never
// normalized away. The sign is dropped when the coefficient is zero, since zero has one
// mathematical value.
type Decimal struct {
	negative    bool
	coefficient *big.Int
	scale       int
}

// NewDecimal builds a decimal from an unsigned coefficient and a scale.
func NewDecimal(negative bool, coefficient *big.Int, scale int) *Decimal {
	if coefficient.Sign() == 0 {
		negative = false
	}
	return &Decimal{negative: negative, coefficient: new(big.Int).Set(coefficient), scale: scale}
}

// Negative reports whether the value is negative.
func (d *Decimal) Negative() bool { return d.negative }

// Coefficient returns the unsigned coefficient.
func (d *Decimal) Coefficient() *big.Int { return new(big.Int).Set(d.coefficient) }

// Scale returns the number of digits after the decimal point.
func (d *Decimal) Scale() int { return d.scale }

// Payload returns the canonical payload text, reproducing the authored spelling exactly.
func (d *Decimal) Payload() string {
	digits := d.coefficient.String()
	sign := ""
	if d.negative {
		sign = "-"
	}
	if d.scale == 0 {
		return sign + digits
	}
	if len(digits) > d.scale {
		cut := len(digits) - d.scale
		return sign + digits[:cut] + "." + digits[cut:]
	}
	return sign + "0." + strings.Repeat("0", d.scale-len(digits)) + digits
}

func (d *Decimal) String() string { return d.Payload() }

// Equal reports scale-sensitive equality (spec §3.2): coefficient *and* scale must match.
func (d *Decimal) Equal(other *Decimal) bool {
	if d == nil || other == nil {
		return d == other
	}
	return d.negative == other.negative &&
		d.scale == other.scale &&
		d.coefficient.Cmp(other.coefficient) == 0
}

// Date is a wall date with no time and no offset (spec §10.4).
type Date struct {
	Year  int
	Month int
	Day   int
}

// Payload returns the canonical YYYY-MM-DD text.
func (d Date) Payload() string {
	return fmt.Sprintf("%04d-%02d-%02d", d.Year, d.Month, d.Day)
}

func (d Date) String() string { return d.Payload() }

// Offset is the zone designator of a Timestamp.
//
// UTC (a literal Z) stays distinct from +00:00, because spec §3.2 makes the offset spelling
// preserved data.
type Offset struct {
	UTC      bool
	Negative bool
	Hours    int
	Minutes  int
}

// Text returns the canonical offset spelling.
func (o Offset) Text() string {
	if o.UTC {
		return "Z"
	}
	sign := "+"
	if o.Negative {
		sign = "-"
	}
	return fmt.Sprintf("%s%02d:%02d", sign, o.Hours, o.Minutes)
}

// Timestamp is an absolute instant with a mandatory UTC offset (spec §10.4).
//
// Fraction holds the fractional-second digits as text, because trailing zeros are preserved
// data: ".100" is not ".1". An empty Fraction means there was no fractional part.
type Timestamp struct {
	Date     Date
	Hour     int
	Minute   int
	Second   int
	Fraction string
	Offset   Offset
}

// Payload returns the canonical payload text.
func (t Timestamp) Payload() string {
	frac := ""
	if t.Fraction != "" {
		frac = "." + t.Fraction
	}
	return fmt.Sprintf("%sT%02d:%02d:%02d%s%s",
		t.Date.Payload(), t.Hour, t.Minute, t.Second, frac, t.Offset.Text())
}

func (t Timestamp) String() string { return t.Payload() }

// GeometryType enumerates GeoJSON geometry types.
type GeometryType string

const (
	GeometryPoint           GeometryType = "Point"
	GeometryLineString      GeometryType = "LineString"
	GeometryPolygon         GeometryType = "Polygon"
	GeometryMultiPoint      GeometryType = "MultiPoint"
	GeometryMultiLineString GeometryType = "MultiLineString"
	GeometryMultiPolygon    GeometryType = "MultiPolygon"
)

// Geometry is a native STF spatial value.
type Geometry struct {
	Type        GeometryType `json:"type"`
	Coordinates interface{}  `json:"coordinates"`
}

// Time is a wall time without date or offset.
type Time struct {
	Hour     int
	Minute   int
	Second   *int
	Fraction string
}

// Payload returns HH:mm[:ss[.fraction]].
func (t Time) Payload() string {
	if t.Second == nil {
		return fmt.Sprintf("%02d:%02d", t.Hour, t.Minute)
	}
	if t.Fraction != "" {
		return fmt.Sprintf("%02d:%02d:%02d.%s", t.Hour, t.Minute, *t.Second, t.Fraction)
	}
	return fmt.Sprintf("%02d:%02d:%02d", t.Hour, t.Minute, *t.Second)
}
func (t Time) String() string { return t.Payload() }

// Duration is an ISO-8601 duration string.
type Duration string

func (d Duration) Payload() string { return string(d) }
func (d Duration) String() string  { return string(d) }

// Directive is a document-level directive (spec §5.1). Metadata, not data.
type Directive struct {
	Name    string
	Payload string
}

// Document is a parsed document: its directives plus its root object.
type Document struct {
	Directives []Directive
	Root       *Object
}

// Equal reports value equality per spec §3.2.
//
// Kinds never cross-compare, Numbers keep -0 distinct from 0, Decimals are scale-sensitive,
// Binary compares octets, and object member order is ignored.
func Equal(a, b Value) bool {
	ka, kb := KindOf(a), KindOf(b)
	if ka != kb {
		return false
	}

	switch ka {
	case KindNull:
		return true
	case KindBool:
		return a.(bool) == b.(bool)
	case KindNumber:
		// NaN cannot occur (§7.3), so bit equality is total and keeps -0 distinct from 0.
		return math.Float64bits(a.(float64)) == math.Float64bits(b.(float64))
	case KindString:
		return a.(string) == b.(string)
	case KindBigInt:
		return a.(*big.Int).Cmp(b.(*big.Int)) == 0
	case KindDecimal:
		return a.(*Decimal).Equal(b.(*Decimal))
	case KindDate:
		return a.(Date) == b.(Date)
	case KindTimestamp:
		return a.(Timestamp) == b.(Timestamp)
	case KindBinary:
		x, y := a.([]byte), b.([]byte)
		if len(x) != len(y) {
			return false
		}
		for i := range x {
			if x[i] != y[i] {
				return false
			}
		}
		return true
	case KindArray:
		x, y := a.([]Value), b.([]Value)
		if len(x) != len(y) {
			return false
		}
		for i := range x {
			if !Equal(x[i], y[i]) {
				return false
			}
		}
		return true
	case KindObject:
		x, y := a.(*Object), b.(*Object)
		if x.Len() != y.Len() {
			return false
		}
		for _, key := range x.Keys() {
			xv, _ := x.Get(key)
			yv, ok := y.Get(key)
			if !ok || !Equal(xv, yv) {
				return false
			}
		}
		return true
	case KindGeometry:
		x, y := a.(*Geometry), b.(*Geometry)
		if x.Type != y.Type {
			return false
		}
		// Compare coordinates via JSON marshaling for simplicity.
		xb, _ := json.Marshal(x.Coordinates)
		yb, _ := json.Marshal(y.Coordinates)
		return string(xb) == string(yb)
	case KindTime:
		return a.(Time) == b.(Time)
	case KindDuration:
		return a.(Duration) == b.(Duration)
	}
	return false
}
