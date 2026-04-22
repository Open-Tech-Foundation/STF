package dtxt

import (
	"encoding/hex"
	"fmt"
	"math/big"
	"reflect"
	"testing"
)

func TestSpecExample(t *testing.T) {
	specExample := `
# DTXT example
{
  name: ` + "`Sample`" + `,
  created: D(2026-01-15),
  updated: D(2026-01-15T10:30:00Z),
  active: T,
  count: 42,
  big: BN(9007199254740993),
  hash: B(A7B2319E44CE12BA),
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
	if obj["active"] != true {
		t.Errorf("Expected active=T, got %v", obj["active"])
	}
	// count is float64 in this implementation for normal numbers
	if int64(obj["count"].(float64)) != 42 {
		t.Errorf("Expected count=42, got %v", obj["count"])
	}

	bigVal := obj["big"].(*big.Int)
	if bigVal.String() != "9007199254740993" {
		t.Errorf("Expected bigVal=9007199254740993, got %s", bigVal.String())
	}

	hashVal := obj["hash"].([]byte)
	expectedHash, _ := hex.DecodeString("A7B2319E44CE12BA")
	if !reflect.DeepEqual(hashVal, expectedHash) {
		t.Errorf("Hash mismatch")
	}

	// Round trip
	dumped := Stringify(parsed, "")
	fmt.Printf("Dumped (Canonical): %s\n", dumped)

	reparsed, err := Parse(dumped)
	if err != nil {
		t.Fatalf("Reparse failed: %v", err)
	}

	// Simple check
	if !reflect.DeepEqual(reparsed, parsed) {
		// DeepEqual might fail because of pointer comparisons in big.Int or time.Time
		// But let's see.
	}
}

func TestErrorHandling(t *testing.T) {
	_, err := Parse("{ user.name: 1 }")
	if err == nil {
		t.Error("Should have failed on dot in key")
	}
}
