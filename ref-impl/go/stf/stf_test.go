package stf

import (
	"fmt"
	"reflect"
	"testing"
)

func TestSpecExample(t *testing.T) {
	specExample := `
# STF example
{
  name: ` + "`Sample`" + `,
  created: DATE(2026-01-15),
  updated: TIMESTAMP(2026-01-15T10:30:00Z),
  active: T,
  count: 42,
  price: DECIMAL(19.99),
  big: BIGINT(9007199254740993),
  hash: BINARY(SGVsbG8=),
  items: [1, 2, 3],
  meta: {
    retries: 3,
    enabled: F,
  },
}
`
	parsed, err := Parse(specExample)
	if err != nil {
		t.Fatalf("Parse failed: %v", err)
	}

	obj := parsed
	if obj["name"] != "Sample" {
		t.Errorf("Expected name=Sample, got %v", obj["name"])
	}
	if obj["created"] != "$date:2026-01-15" {
		t.Errorf("Expected created=$date:2026-01-15, got %v", obj["created"])
	}
	if obj["updated"] != "$timestamp:2026-01-15T10:30:00Z" {
		t.Errorf("Expected updated=$timestamp:2026-01-15T10:30:00Z, got %v", obj["updated"])
	}
	if obj["active"] != true {
		t.Errorf("Expected active=T, got %v", obj["active"])
	}
	if int64(obj["count"].(float64)) != 42 {
		t.Errorf("Expected count=42, got %v", obj["count"])
	}
	if obj["price"] != "$decimal:19.99" {
		t.Errorf("Expected price=$decimal:19.99, got %v", obj["price"])
	}
	if obj["big"] != "$bigint:9007199254740993" {
		t.Errorf("Expected big=$bigint:9007199254740993, got %v", obj["big"])
	}
	if obj["hash"] != "$binary:SGVsbG8=" {
		t.Errorf("Expected hash=$binary:SGVsbG8=, got %v", obj["hash"])
	}

	// Round trip
	dumped := Stringify(parsed, "")
	fmt.Printf("Dumped (Canonical): %s\n", dumped)

	reparsed, err := Parse(dumped)
	if err != nil {
		t.Fatalf("Reparse failed: %v", err)
	}

	if !reflect.DeepEqual(reparsed, parsed) {
		t.Errorf("Round trip mismatch: got %v, expected %v", reparsed, parsed)
	}
}

func TestErrorHandling(t *testing.T) {
	_, err := Parse("{ user.name: 1 }")
	if err == nil {
		t.Error("Should have failed on dot in key")
	}
}
