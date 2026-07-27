package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"time"

	"github.com/Open-Tech-Foundation/dtxt/ref-impl/go/stf"
	"github.com/bytedance/sonic"
)

func generateLargeData(count int) map[string]stf.STFValue {
	entries := make([]stf.STFValue, 0, count)
	for i := 0; i < count; i++ {
		meta := map[string]stf.STFValue{
			"level":    float64(i % 10),
			"verified": i%3 == 0,
			"note":     nil,
			"nested": map[string]stf.STFValue{
				"a": 1.0,
				"b": false,
				"c": "nested string",
			},
		}

		entry := map[string]stf.STFValue{
			"id":       float64(i),
			"uid":      fmt.Sprintf("user-%d", i),
			"isActive": i%2 == 0,
			"score":    rand.Float64() * 1000,
			"tags":     []stf.STFValue{"data", "benchmark", "storage", "json", "stf"},
			"meta":     meta,
		}
		entries = append(entries, entry)
	}

	return map[string]stf.STFValue{
		"title":       "STF vs JSON (Go)",
		"description": "Benchmark for base format overhead",
		"entries":     entries,
	}
}

const datasetSize = 30000

func main() {
	fmt.Printf("Generating dataset with %d entries...\n", datasetSize)
	rawData := generateLargeData(datasetSize)

	// Payload Size Comparison
	jsonBytes, _ := json.Marshal(rawData)
	stfStr := stf.Stringify(rawData, "")

	os.WriteFile("../../benchmarks/go/bench_v2_go.json", jsonBytes, 0644)
	os.WriteFile("../../benchmarks/go/bench_v2_go.stf", []byte(stfStr), 0644)

	jsonSize := len(jsonBytes)
	stfSize := len(stfStr)

	fmt.Println("\n--- Payload Size ---")
	fmt.Printf("JSON: %.2f MB\n", float64(jsonSize)/1024/1024)
	fmt.Printf("STF:  %.2f MB\n", float64(stfSize)/1024/1024)
	fmt.Printf("Reduction: %.1f%%\n", (1.0-float64(stfSize)/float64(jsonSize))*100)

	// Performance Comparison
	iterations := 5

	fmt.Printf("\n--- Parsing Performance (Average of %d runs) ---\n", iterations)

	var jsonParseTotal time.Duration
	for i := 0; i < iterations; i++ {
		start := time.Now()
		var target interface{}
		json.Unmarshal(jsonBytes, &target)
		jsonParseTotal += time.Since(start)
	}
	fmt.Printf("json.Unmarshal:  %.2f ms\n", float64(jsonParseTotal.Milliseconds())/float64(iterations))

	var sonicParseTotal time.Duration
	for i := 0; i < iterations; i++ {
		start := time.Now()
		var target interface{}
		sonic.Unmarshal(jsonBytes, &target)
		sonicParseTotal += time.Since(start)
	}
	fmt.Printf("sonic.Unmarshal: %.2f ms\n", float64(sonicParseTotal.Milliseconds())/float64(iterations))

	var stfParseTotal time.Duration
	for i := 0; i < iterations; i++ {
		start := time.Now()
		stf.Parse(stfStr)
		stfParseTotal += time.Since(start)
	}
	fmt.Printf("stf.Parse:      %.2f ms\n", float64(stfParseTotal.Milliseconds())/float64(iterations))

	fmt.Printf("\n--- Serialization Performance (Average of %d runs) ---\n", iterations)

	var jsonStringifyTotal time.Duration
	for i := 0; i < iterations; i++ {
		start := time.Now()
		json.Marshal(rawData)
		jsonStringifyTotal += time.Since(start)
	}
	fmt.Printf("json.Marshal:    %.2f ms\n", float64(jsonStringifyTotal.Milliseconds())/float64(iterations))

	var sonicStringifyTotal time.Duration
	for i := 0; i < iterations; i++ {
		start := time.Now()
		sonic.Marshal(rawData)
		sonicStringifyTotal += time.Since(start)
	}
	fmt.Printf("sonic.Marshal:   %.2f ms\n", float64(sonicStringifyTotal.Milliseconds())/float64(iterations))

	var stfStringifyTotal time.Duration
	for i := 0; i < iterations; i++ {
		start := time.Now()
		stf.Stringify(rawData, "")
		stfStringifyTotal += time.Since(start)
	}
	fmt.Printf("stf.Stringify:  %.2f ms\n", float64(stfStringifyTotal.Milliseconds())/float64(iterations))
}
