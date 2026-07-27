package main

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"

	"github.com/Open-Tech-Foundation/dtxt/ref-impl/go/stf"
)

type TestItem struct {
	Name     string      `json:"name"`
	Input    string      `json:"input"`
	Expected interface{} `json:"expected"`
	Error    string      `json:"error"`
}

func normalizeValue(v stf.STFValue) interface{} {
	if m, ok := v.(map[string]stf.STFValue); ok {
		res := make(map[string]interface{})
		for k, val := range m {
			res[k] = normalizeValue(val)
		}
		return res
	}
	if a, ok := v.([]stf.STFValue); ok {
		res := make([]interface{}, len(a))
		for i, val := range a {
			res[i] = normalizeValue(val)
		}
		return res
	}
	return v
}

func main() {
	testsPath := "../../tests/conformance/tests.json"

	data, err := os.ReadFile(testsPath)
	if err != nil {
		fmt.Printf("Error reading tests: %v\n", err)
		os.Exit(1)
	}

	var tests []TestItem
	if err := json.Unmarshal(data, &tests); err != nil {
		fmt.Printf("Error unmarshaling tests: %v\n", err)
		os.Exit(1)
	}

	passed := 0
	failed := 0

	fmt.Printf("Running %d conformance tests...\n", len(tests))

	for _, test := range tests {
		parsed, err := stf.Parse(test.Input)

		if test.Error != "" {
			if err == nil {
				fmt.Printf("FAIL: %s - Expected error %s, but parsed successfully. Result: %v\n", test.Name, test.Error, parsed)
				failed++
			} else {
				fmt.Printf("PASS: %s (Caught expected error: %v)\n", test.Name, err)
				passed++
			}
			continue
		}

		if err != nil {
			fmt.Printf("FAIL: %s - Unexpected error: %v\n", test.Name, err)
			failed++
			continue
		}

		normalized := normalizeValue(parsed)

		if reflect.DeepEqual(normalized, test.Expected) {
			fmt.Printf("PASS: %s\n", test.Name)
			passed++
		} else {
			fmt.Printf("FAIL: %s - Result mismatch.\n", test.Name)
			fmt.Printf("  Expected: %v\n", test.Expected)
			fmt.Printf("  Got:      %v\n", normalized)
			failed++
		}
	}

	fmt.Printf("\nConformance Test Results: %d passed, %d failed.\n", passed, failed)
	if failed > 0 {
		os.Exit(1)
	}
}
