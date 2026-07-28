// Command conformance runs the STF 1.0 conformance corpus against this implementation.
//
// It implements the runner contract in tests/conformance/README.md §3: error codes are
// compared exactly, values are compared by kind, Numbers by binary64 bit pattern, Decimals by
// coefficient *and* scale, and Binary by decoded octets. Nothing is skipped.
//
//	go run ./cmd/conformance [path/to/corpus.json]
package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/Open-Tech-Foundation/stf/ref-impl/go/stf"
)

type testCase struct {
	Name      string          `json:"name"`
	Group     string          `json:"group"`
	Input     string          `json:"input"`
	Value     json.RawMessage `json:"value"`
	Error     string          `json:"error"`
	Canonical *string         `json:"canonical"`
	Profile   string          `json:"profile"`
}

// tagOfKind maps an STF kind to the corpus tag for it.
var tagOfKind = map[stf.Kind]string{
	stf.KindNull:      "null",
	stf.KindBool:      "bool",
	stf.KindNumber:    "num",
	stf.KindString:    "str",
	stf.KindArray:     "arr",
	stf.KindObject:    "obj",
	stf.KindBigInt:    "bigint",
	stf.KindDecimal:   "dec",
	stf.KindDate:      "date",
	stf.KindTimestamp: "ts",
	stf.KindBinary:    "bin",
}

func tagOf(v stf.Value) string {
	if tag, ok := tagOfKind[stf.KindOf(v)]; ok {
		return tag
	}
	return "unknown"
}

func show(v stf.Value) string {
	switch value := v.(type) {
	case string:
		return fmt.Sprintf("String %q", value)
	case float64:
		text, err := stf.FormatNumber(value)
		if err != nil {
			return fmt.Sprintf("Number %v", value)
		}
		return "Number " + text
	case []byte:
		return "Binary " + stf.BinaryToBase64(value)
	case *stf.Object, []stf.Value:
		return string(stf.KindOf(v))
	}
	return fmt.Sprintf("%s %v", stf.KindOf(v), v)
}

func main() {
	path := filepath.Join("..", "..", "tests", "conformance", "corpus.json")
	if len(os.Args) > 1 {
		path = os.Args[1]
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot read corpus at %s: %v\n", path, err)
		os.Exit(1)
	}
	var cases []testCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		fmt.Fprintf(os.Stderr, "corpus at %s is not valid JSON: %v\n", path, err)
		os.Exit(1)
	}

	type counts struct{ pass, total int }
	byGroup := map[string]*counts{}
	failed := 0

	for _, c := range cases {
		g, ok := byGroup[c.Group]
		if !ok {
			g = &counts{}
			byGroup[c.Group] = g
		}
		g.total++
		if reason := runCase(c); reason == "" {
			g.pass++
		} else {
			failed++
			fmt.Printf("FAIL  %s\n        %s\n", c.Name, reason)
		}
	}

	total, passed := 0, 0
	groups := make([]string, 0, len(byGroup))
	for name, g := range byGroup {
		groups = append(groups, name)
		total += g.total
		passed += g.pass
	}
	sort.Strings(groups)

	fmt.Printf("\n%s\n", strings.Repeat("=", 64))
	fmt.Printf("STF 1.0 conformance -- Go reference implementation\n\n")
	fmt.Printf("  %-14s%6s%6s\n", "group", "pass", "fail")
	for _, name := range groups {
		g := byGroup[name]
		fmt.Printf("  %-14s%6d%6d\n", name, g.pass, g.total-g.pass)
	}
	fmt.Printf("  %s\n", strings.Repeat("-", 26))
	fmt.Printf("  %-14s%6d%6d\n", "TOTAL", passed, total-passed)
	pct := 0.0
	if total > 0 {
		pct = float64(passed) / float64(total) * 100
	}
	fmt.Printf("\n  %d/%d passing (%.1f%%)\n", passed, total, pct)
	fmt.Println(strings.Repeat("=", 64))

	if failed > 0 {
		os.Exit(1)
	}
}

// runCase returns the empty string on success, or the reason it failed.
func runCase(c testCase) string {
	isStream := c.Profile == "stream"

	if c.Error != "" {
		var err error
		if isStream {
			_, err = stf.ParseStream(c.Input)
		} else {
			_, err = stf.Parse(c.Input)
		}
		if err == nil {
			return fmt.Sprintf("expected %s, but the input parsed successfully", c.Error)
		}
		got := string(stf.CodeOf(err))
		if got == "" {
			return fmt.Sprintf("expected %s, got a non-STF error: %v", c.Error, err)
		}
		if got != c.Error {
			return fmt.Sprintf("expected %s, got %s", c.Error, got)
		}
		return ""
	}

	var expected any
	if err := json.Unmarshal(c.Value, &expected); err != nil {
		return fmt.Sprintf("corpus error: expected value is not valid JSON: %v", err)
	}

	if isStream {
		stream, err := stf.ParseStream(c.Input)
		if err != nil {
			return fmt.Sprintf("expected a value, got %v", err)
		}
		want, ok := expected.([]any)
		if !ok {
			return "a stream case must expect an array of records"
		}
		if len(stream.Records) != len(want) {
			return fmt.Sprintf("expected %d records, got %d", len(want), len(stream.Records))
		}
		for i, record := range stream.Records {
			if reason := compare(record, want[i], fmt.Sprintf("record[%d]", i)); reason != "" {
				return reason
			}
		}
		return ""
	}

	value, err := stf.Parse(c.Input)
	if err != nil {
		return fmt.Sprintf("expected a value, got %v", err)
	}
	if reason := compare(value, expected, "$"); reason != "" {
		return reason
	}

	// README §3, the SHOULD: parse(serialize(parse(input))) equals parse(input).
	for _, f := range []stf.Format{stf.Compact(), stf.Pretty("  "), stf.Canonical()} {
		text, err := stf.Serialize(value, f)
		if err != nil {
			return fmt.Sprintf("serialization failed: %v", err)
		}
		back, err := stf.Parse(text)
		if err != nil {
			return fmt.Sprintf("serialized output does not parse (%v): %s", err, text)
		}
		if !stf.Equal(back, value) {
			return fmt.Sprintf("round trip changed the value via %s", text)
		}
	}

	if c.Canonical != nil {
		got, err := stf.Serialize(value, stf.Canonical())
		if err != nil {
			return fmt.Sprintf("canonical serialization failed: %v", err)
		}
		if got != *c.Canonical {
			return fmt.Sprintf("canonical form: expected %q, got %q", *c.Canonical, got)
		}
	}
	return ""
}

// compare checks a parsed value against the corpus's tagged-JSON encoding.
//
// Kind is checked before content in every branch, so a String can never satisfy a
// dec/date/ts/bin/bigint expectation however closely the text matches.
func compare(actual stf.Value, expected any, path string) string {
	at := func(format string, args ...any) string {
		return path + ": " + fmt.Sprintf(format, args...)
	}

	switch want := expected.(type) {
	case nil:
		if tagOf(actual) != "null" {
			return at("expected Null, got %s", show(actual))
		}
		return ""
	case bool:
		got, ok := actual.(bool)
		if !ok || got != want {
			return at("expected Boolean %v, got %s", want, show(actual))
		}
		return ""
	case float64:
		return at("corpus error: bare JSON numbers are never used (README §2)")
	case string:
		got, ok := actual.(string)
		if !ok {
			return at("expected String, got %s", show(actual))
		}
		if got != want {
			return at("expected String %q, got %q", want, got)
		}
		return ""
	case []any:
		got, ok := actual.([]stf.Value)
		if !ok {
			return at("expected Array, got %s", show(actual))
		}
		if len(got) != len(want) {
			return at("expected %d elements, got %d", len(want), len(got))
		}
		for i := range want {
			if reason := compare(got[i], want[i], fmt.Sprintf("%s[%d]", path, i)); reason != "" {
				return reason
			}
		}
		return ""
	case map[string]any:
		if tag, ok := want["$"].(string); ok {
			text, _ := want["v"].(string)
			return compareTagged(actual, tag, text, path)
		}
		got, ok := actual.(*stf.Object)
		if !ok {
			return at("expected Object, got %s", show(actual))
		}
		if got.Len() != len(want) {
			return at("expected %d members, got %d", len(want), got.Len())
		}
		for key, child := range want {
			value, present := got.Get(key)
			if !present {
				return at("missing key %q", key)
			}
			if reason := compare(value, child, path+"."+key); reason != "" {
				return reason
			}
		}
		return ""
	}
	return at("corpus error: unsupported expectation %T", expected)
}

func compareTagged(actual stf.Value, tag, text, path string) string {
	at := func(format string, args ...any) string {
		return path + ": " + fmt.Sprintf(format, args...)
	}
	if got := tagOf(actual); got != tag {
		return at("expected kind %s, got %s (%s)", tag, got, show(actual))
	}

	switch tag {
	case "num":
		want, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return at("corpus error: %q is not a number", text)
		}
		// Bit comparison, so -0 never satisfies 0 (README §3.3).
		if math.Float64bits(actual.(float64)) != math.Float64bits(want) {
			return at("expected Number %s, got %s", text, show(actual))
		}
		return ""
	case "bigint":
		want, ok := new(big.Int).SetString(text, 10)
		if !ok {
			return at("corpus error: %q is not an integer", text)
		}
		if actual.(*big.Int).Cmp(want) != 0 {
			return at("expected BigInt %s, got %s", text, actual)
		}
		return ""
	case "dec":
		want, perr := stf.ParseDecimal(text)
		if perr != nil {
			return at("corpus error: DECIMAL(%s): %v", text, perr)
		}
		got := actual.(*stf.Decimal)
		// Coefficient *and* scale (README §3.4).
		if !got.Equal(want) {
			return at("expected Decimal %s (scale %d), got %s (scale %d)",
				want.Payload(), want.Scale(), got.Payload(), got.Scale())
		}
		return ""
	case "date":
		want, perr := stf.ParseDate(text)
		if perr != nil {
			return at("corpus error: DATE(%s): %v", text, perr)
		}
		if actual.(stf.Date) != want {
			return at("expected Date %s, got %s", text, actual)
		}
		return ""
	case "ts":
		want, perr := stf.ParseTimestamp(text)
		if perr != nil {
			return at("corpus error: TIMESTAMP(%s): %v", text, perr)
		}
		if actual.(stf.Timestamp) != want {
			return at("expected Timestamp %s, got %s", text, actual)
		}
		return ""
	case "bin":
		want, perr := stf.ParseBinary(text)
		if perr != nil {
			return at("corpus error: BINARY(%s): %v", text, perr)
		}
		// Octet comparison after decoding (README §3.5).
		if !stf.Equal(actual, stf.Value(want)) {
			return at("expected octets %x, got %x", want, actual)
		}
		return ""
	}
	return at("corpus error: unknown tag %s", tag)
}
