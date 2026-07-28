package stf_test

import (
	"math"
	"math/big"
	"testing"

	"github.com/Open-Tech-Foundation/stf/ref-impl/go/stf"
)

// The conformance corpus (cmd/conformance) is the executable contract for the specification;
// these cover the host-language surface it cannot reach — the mapping onto Go types, JSON
// interchange, and the ordering guarantee.

func codeOf(t *testing.T, input string) stf.Code {
	t.Helper()
	_, err := stf.Parse(input)
	if err == nil {
		return "NO_ERROR"
	}
	return stf.CodeOf(err)
}

func mustParse(t *testing.T, input string) *stf.Object {
	t.Helper()
	v, err := stf.Parse(input)
	if err != nil {
		t.Fatalf("Parse(%q) failed: %v", input, err)
	}
	return v
}

func get(t *testing.T, input, key string) stf.Value {
	t.Helper()
	v, ok := mustParse(t, input).Get(key)
	if !ok {
		t.Fatalf("key %q missing from %q", key, input)
	}
	return v
}

func TestEveryConstructorHasItsOwnKind(t *testing.T) {
	const doc = "{dec: DECIMAL(1.5), big: BIGINT(1), d: DATE(2026-01-15), " +
		"t: TIMESTAMP(2026-01-15T00:00:00Z), bin: BINARY(SGVsbG8=)}"
	for key, want := range map[string]stf.Kind{
		"dec": stf.KindDecimal,
		"big": stf.KindBigInt,
		"d":   stf.KindDate,
		"t":   stf.KindTimestamp,
		"bin": stf.KindBinary,
	} {
		if got := stf.KindOf(get(t, doc, key)); got != want {
			t.Errorf("kind of %s = %s, want %s", key, got, want)
		}
	}
	// §3.1: the defect this rewrite exists to remove.
	if _, isString := get(t, doc, "dec").(string); isString {
		t.Error("DECIMAL must not be represented as a string")
	}
}

func TestStringNeverEqualsATypedValue(t *testing.T) {
	if stf.Equal(get(t, "{x: DECIMAL(1.5)}", "x"), get(t, "{x: `1.5`}", "x")) {
		t.Error("a Decimal must not equal a String of the same text")
	}
}

func TestNumberBigIntAndDecimalStayDistinct(t *testing.T) {
	n := get(t, "{x: 1}", "x")
	b := get(t, "{x: BIGINT(1)}", "x")
	d := get(t, "{x: DECIMAL(1)}", "x")
	if stf.Equal(n, b) || stf.Equal(b, d) || stf.Equal(n, d) {
		t.Error("Number, BigInt, and Decimal must not cross-compare")
	}
}

func TestDecimalEqualityIsScaleSensitive(t *testing.T) {
	a := get(t, "{x: DECIMAL(1.5)}", "x").(*stf.Decimal)
	b := get(t, "{x: DECIMAL(1.50)}", "x").(*stf.Decimal)
	if a.Equal(b) {
		t.Error("DECIMAL(1.5) must not equal DECIMAL(1.50)")
	}
	if !b.Equal(get(t, "{x: DECIMAL(1.50)}", "x").(*stf.Decimal)) {
		t.Error("DECIMAL(1.50) must equal itself")
	}
}

func TestNegativeZeroIsDistinct(t *testing.T) {
	neg := get(t, "{x: -0}", "x")
	if stf.Equal(neg, get(t, "{x: 0}", "x")) {
		t.Error("-0 must not equal 0")
	}
	if !math.Signbit(neg.(float64)) {
		t.Error("-0 must keep its sign bit")
	}
}

func TestUTCAndZeroOffsetAreDistinct(t *testing.T) {
	z := get(t, "{t: TIMESTAMP(2026-01-15T10:30:00Z)}", "t")
	plus := get(t, "{t: TIMESTAMP(2026-01-15T10:30:00+00:00)}", "t")
	if stf.Equal(z, plus) {
		t.Error("Z must not equal +00:00; the offset spelling is data")
	}
}

func TestNumbersAreBinary64NotWidened(t *testing.T) {
	// §7.2: returning an int64 here would widen the domain.
	v := get(t, "{a: 9007199254740993}", "a")
	f, ok := v.(float64)
	if !ok {
		t.Fatalf("a number must be float64, got %T", v)
	}
	if f != 9007199254740992 {
		t.Errorf("got %v, want 9007199254740992", f)
	}
}

func TestNumberDomainEdges(t *testing.T) {
	if got := codeOf(t, "{a: 1e400}"); got != stf.ErrNumberOverflow {
		t.Errorf("1e400: got %s, want %s", got, stf.ErrNumberOverflow)
	}
	if got := get(t, "{a: 1e-400}", "a").(float64); got != 0 {
		t.Errorf("1e-400: got %v, want 0", got)
	}
}

func TestFormatNumberIsShortestAndRoundTrips(t *testing.T) {
	for _, tc := range []struct {
		in   float64
		want string
	}{
		{1, "1"}, {math.Copysign(0, -1), "-0"}, {0, "0"}, {3.14, "3.14"},
	} {
		got, err := stf.FormatNumber(tc.in)
		if err != nil {
			t.Fatalf("FormatNumber(%v): %v", tc.in, err)
		}
		if got != tc.want {
			t.Errorf("FormatNumber(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
	for _, n := range []float64{1, math.Copysign(0, -1), 1e300, 3.14, 9007199254740992, 1e-320, 2.5e-3} {
		text, err := stf.FormatNumber(n)
		if err != nil {
			t.Fatalf("FormatNumber(%v): %v", n, err)
		}
		got := get(t, "{a:"+text+"}", "a").(float64)
		if math.Float64bits(got) != math.Float64bits(n) {
			t.Errorf("%v serialized as %q parsed back as %v", n, text, got)
		}
	}
}

func TestNonFiniteNumbersFailToSerialize(t *testing.T) {
	o := stf.NewObject()
	o.Set("a", math.Inf(1))
	if _, err := stf.Serialize(o, stf.Compact()); stf.CodeOf(err) != stf.ErrUnrepresentable {
		t.Errorf("got %v, want ERR_UNREPRESENTABLE", err)
	}
}

func TestMemberOrderIsPreserved(t *testing.T) {
	// §11.2. A Go map cannot do this, which is why *Object exists.
	got, err := stf.Serialize(mustParse(t, "{z: 1, a: 2, m: 3}"), stf.Compact())
	if err != nil {
		t.Fatal(err)
	}
	if got != "{z:1,a:2,m:3}" {
		t.Errorf("got %q, want {z:1,a:2,m:3}", got)
	}
}

func TestObjectEqualityIgnoresOrder(t *testing.T) {
	if !stf.Equal(mustParse(t, "{a: 1, b: 2}"), mustParse(t, "{b: 2, a: 1}")) {
		t.Error("member order must not affect equality")
	}
}

func TestStringsAreNeverPromotedToConstructors(t *testing.T) {
	// §13.2. The old implementation emitted DECIMAL(abc) here, producing unparseable text.
	const doc = "{a: `DECIMAL(1.5)`, b: `2026-01-15`, c: `$decimal:abc`}"
	v := mustParse(t, doc)
	text, err := stf.Serialize(v, stf.Compact())
	if err != nil {
		t.Fatal(err)
	}
	if text != "{a:`DECIMAL(1.5)`,b:`2026-01-15`,c:`$decimal:abc`}" {
		t.Errorf("got %q", text)
	}
	back, err := stf.Parse(text)
	if err != nil {
		t.Fatalf("serialized output does not parse: %v", err)
	}
	if !stf.Equal(back, v) {
		t.Error("round trip changed the value")
	}
}

func TestSupplementaryCharactersSurvive(t *testing.T) {
	// The previous implementation dropped non-BMP characters from interpreted strings.
	const pair = `{a: "\uD83D\uDE00"}`
	if got := get(t, pair, "a").(string); got != "\U0001F600" {
		t.Errorf("surrogate pair decoded to %q, want the emoji", got)
	}
	if got := get(t, "{a: `\U0001F600`}", "a").(string); got != "\U0001F600" {
		t.Errorf("literal emoji became %q", got)
	}
	text, err := stf.Serialize(mustParse(t, pair), stf.Canonical())
	if err != nil {
		t.Fatal(err)
	}
	// §13.5: non-ASCII scalars are emitted literally as UTF-8.
	if text != "{a:\"\U0001F600\"}" {
		t.Errorf("canonical output %q lost the character", text)
	}
}

func TestRoundTripsEveryKind(t *testing.T) {
	const doc = "{n:N,b:T,num:-2.5e-3,s:`hi`,arr:[1,`x`],obj:{k:1}," +
		"big:BIGINT(-99999999999999999999),dec:DECIMAL(1.50)," +
		"d:DATE(2024-02-29),t:TIMESTAMP(2026-01-15T10:30:00.100+05:30)," +
		"bin:BINARY(SGVsbG9X)}"
	v := mustParse(t, doc)
	for _, f := range []stf.Format{stf.Compact(), stf.Pretty("  "), stf.Canonical()} {
		text, err := stf.Serialize(v, f)
		if err != nil {
			t.Fatalf("serialize: %v", err)
		}
		back, err := stf.Parse(text)
		if err != nil {
			t.Fatalf("reparse of %q: %v", text, err)
		}
		if !stf.Equal(back, v) {
			t.Errorf("round trip changed the value via %q", text)
		}
	}
}

func TestCanonicalForm(t *testing.T) {
	canon := func(input string) string {
		t.Helper()
		out, err := stf.Serialize(mustParse(t, input), stf.Canonical())
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	for _, tc := range []struct{ in, want string }{
		{"{b: 2, a: 1, c: 3}", "{a:1,b:2,c:3}"},
		{"{a: 1, B: 2}", "{B:2,a:1}"},
		{"# lead\n{a: 1} # trail", "{a:1}"},
		{"{a: 1,}", "{a:1}"},
		{"{a: `hi`}", `{a:"hi"}`},
		{"{a: DECIMAL(1.50)}", "{a:DECIMAL(1.50)}"},
		{"{b: {d: 1, c: 2}, a: [3, 1]}", "{a:[3,1],b:{c:2,d:1}}"},
	} {
		if got := canon(tc.in); got != tc.want {
			t.Errorf("canon(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestInvalidKeysFailRatherThanEmitBadOutput(t *testing.T) {
	o := stf.NewObject()
	o.Set("a.b", nil)
	if _, err := stf.Serialize(o, stf.Compact()); stf.CodeOf(err) != stf.ErrUnrepresentable {
		t.Errorf("got %v, want ERR_UNREPRESENTABLE", err)
	}
}

func TestErrorsCarryCodeAndPosition(t *testing.T) {
	_, err := stf.Parse("{\n  a: 0x10\n}")
	if stf.CodeOf(err) != stf.ErrInvalidNumber {
		t.Fatalf("got %v, want ERR_INVALID_NUMBER", err)
	}
	e := err.(*stf.Error)
	if e.Line != 2 || e.Column != 7 {
		t.Errorf("position %d:%d, want 2:7", e.Line, e.Column)
	}
}

func TestUTF8IsEnforcedOnBytes(t *testing.T) {
	if _, err := stf.ParseBytes([]byte("{a: 1}")); err != nil {
		t.Fatalf("valid UTF-8 rejected: %v", err)
	}
	_, err := stf.ParseBytes([]byte{'{', 'a', ':', ' ', 0xff, '}'})
	if stf.CodeOf(err) != stf.ErrInvalidUTF8 {
		t.Errorf("got %v, want ERR_INVALID_UTF8", err)
	}
}

func TestDirectivesStayOutOfTheDataModel(t *testing.T) {
	doc, err := stf.ParseDocument("@schema(x)\n{a: 1}")
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Directives) != 1 || doc.Directives[0].Name != "schema" {
		t.Errorf("directives = %v", doc.Directives)
	}
	if doc.Root.Len() != 1 {
		t.Errorf("root has %d members, want 1", doc.Root.Len())
	}
	if _, err := stf.Parse("@nope(1)\n{a: 1}"); err != nil {
		t.Errorf("an unknown directive must not fail: %v", err)
	}
	if got := codeOf(t, "@schema(a)\n@schema(b)\n{a: 1}"); got != stf.ErrSyntax {
		t.Errorf("repeated directive: got %s, want ERR_SYNTAX", got)
	}
}

func TestStreamReadsRecordsAndHeader(t *testing.T) {
	s, err := stf.ParseStream("@schema(e.stf)\n{a:1}\n{a:2}\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(s.Records) != 2 {
		t.Errorf("got %d records, want 2", len(s.Records))
	}
	if len(s.Directives) != 1 {
		t.Errorf("got %d directives, want 1", len(s.Directives))
	}
}

func TestStreamReaderContinuesPastBadRecords(t *testing.T) {
	reader := stf.NewStreamReader("# note\n{a:1}\n{oops\n{b:2}\n", stf.DefaultLimits())
	var lines []int
	var codes []stf.Code
	for {
		r := reader.Next()
		if r == nil {
			break
		}
		lines = append(lines, r.Line)
		if r.Err != nil {
			codes = append(codes, r.Err.Code)
		}
	}
	if len(lines) != 3 || lines[0] != 2 || lines[1] != 3 || lines[2] != 4 {
		t.Errorf("lines = %v, want [2 3 4]", lines)
	}
	if len(codes) != 1 || codes[0] != stf.ErrMissingColon {
		t.Errorf("codes = %v, want [ERR_MISSING_COLON]", codes)
	}
}

func TestStreamWritingEscapesLineTerminators(t *testing.T) {
	// Stream §3.2 requires this rather than a failure.
	stream := &stf.Stream{Records: []*stf.Object{mustParse(t, "{msg: `one\ntwo`}")}}
	text, err := stf.SerializeStream(stream, stf.Compact())
	if err != nil {
		t.Fatal(err)
	}
	if text != "{msg:\"one\\ntwo\"}\n" {
		t.Errorf("got %q", text)
	}
	if _, err := stf.ParseStream(text); err != nil {
		t.Errorf("output does not read back: %v", err)
	}
}

func TestStreamCanonicalPreservesRecordOrder(t *testing.T) {
	s, err := stf.ParseStream("{b:1,a:2}\n{d:1,c:2}\n")
	if err != nil {
		t.Fatal(err)
	}
	text, err := stf.SerializeStream(s, stf.Canonical())
	if err != nil {
		t.Fatal(err)
	}
	if text != "{a:2,b:1}\n{c:2,d:1}\n" {
		t.Errorf("got %q", text)
	}
}

func TestJSONRefusesWhatSTFCannotExpress(t *testing.T) {
	for _, bad := range []any{[]any{}, 42.0, "x", nil} {
		if _, err := stf.FromJSON(bad); stf.CodeOf(err) != stf.ErrUnrepresentable {
			t.Errorf("FromJSON(%v): got %v, want ERR_UNREPRESENTABLE", bad, err)
		}
	}
	for _, bad := range []map[string]any{{"a.b": 1.0}, {"": 1.0}, {"café": 1.0}} {
		if _, err := stf.FromJSON(bad); stf.CodeOf(err) != stf.ErrUnrepresentable {
			t.Errorf("FromJSON(%v): got %v, want ERR_UNREPRESENTABLE", bad, err)
		}
	}
}

func TestJSONRefusesAnIntegerBinary64CannotHold(t *testing.T) {
	_, err := stf.FromJSONText(`{"id": 9007199254740993}`)
	if stf.CodeOf(err) != stf.ErrUnrepresentable {
		t.Fatalf("got %v, want ERR_UNREPRESENTABLE", err)
	}
	if _, err := stf.FromJSONText(`{"id": 9007199254740992}`); err != nil {
		t.Errorf("an exactly-representable integer must be accepted: %v", err)
	}
	if _, err := stf.FromJSONText(`{"id": "9007199254740993"}`); err != nil {
		t.Errorf("a digit run inside a string is not a number: %v", err)
	}
}

func TestJSONRefusesTypedValuesUnlessAsked(t *testing.T) {
	v := mustParse(t, "{price: DECIMAL(19.99)}")
	if _, err := stf.ToJSON(v, stf.RejectTyped); stf.CodeOf(err) != stf.ErrUnrepresentable {
		t.Errorf("got %v, want ERR_UNREPRESENTABLE", err)
	}
	out, err := stf.ToJSON(v, stf.PayloadAsString)
	if err != nil {
		t.Fatal(err)
	}
	if got := out.(map[string]any)["price"]; got != "19.99" {
		t.Errorf("got %v, want \"19.99\"", got)
	}
}

func TestTaggedJSONSeparatesKinds(t *testing.T) {
	v := mustParse(t, "{s: `1.5`, d: DECIMAL(1.50)}")
	out, err := stf.TaggedJSON(v)
	if err != nil {
		t.Fatal(err)
	}
	m := out.(map[string]any)
	if m["s"] != "1.5" {
		t.Errorf("string tagged as %v", m["s"])
	}
	dec := m["d"].(map[string]any)
	if dec["$"] != "dec" || dec["v"] != "1.50" {
		t.Errorf("decimal tagged as %v", dec)
	}
}

func TestDecimalPayloadKeepsItsScale(t *testing.T) {
	for _, tc := range []struct {
		neg   bool
		coeff int64
		scale int
		want  string
	}{
		{false, 150, 2, "1.50"},
		{true, 1, 3, "-0.001"},
		{false, 15, 0, "15"},
		// A zero coefficient has no sign.
		{true, 0, 1, "0.0"},
	} {
		d := stf.NewDecimal(tc.neg, big.NewInt(tc.coeff), tc.scale)
		if got := d.Payload(); got != tc.want {
			t.Errorf("payload = %q, want %q", got, tc.want)
		}
	}
}

func TestFormatTextIsIdempotent(t *testing.T) {
	once, err := stf.FormatText("{ b:2,a:`x`, }")
	if err != nil {
		t.Fatal(err)
	}
	twice, err := stf.FormatText(once)
	if err != nil {
		t.Fatal(err)
	}
	if once != twice {
		t.Errorf("formatting is not idempotent:\n%q\n%q", once, twice)
	}
}
