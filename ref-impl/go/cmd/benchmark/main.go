// Command benchmark measures payload size and throughput for the Go implementation.
//
// The dataset uses only JSON-native kinds, so the figures measure base format overhead rather
// than the constructor types, and it is generated from a fixed seed so runs are comparable to
// each other. Figures from different languages are not comparable — each implementation
// benchmarks its own dataset, against its own host's JSON parser.
//
//	go run ./cmd/benchmark
package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"time"

	"github.com/Open-Tech-Foundation/stf/ref-impl/go/stf"
)

const (
	datasetSize = 30_000
	iterations  = 5
	seed        = 0x57455354
)

func object(pairs ...any) *stf.Object {
	o := stf.NewObjectSized(len(pairs) / 2)
	for i := 0; i < len(pairs); i += 2 {
		o.Set(pairs[i].(string), pairs[i+1])
	}
	return o
}

func generate(count int) *stf.Object {
	rng := rand.New(rand.NewSource(seed))
	tags := []stf.Value{"data", "benchmark", "storage", "json", "stf"}

	entries := make([]stf.Value, 0, count)
	for i := 0; i < count; i++ {
		nested := object("a", 1.0, "b", false, "c", "nested string")
		meta := object(
			"level", float64(i%10),
			"verified", i%3 == 0,
			"note", nil,
			"nested", nested,
		)
		entries = append(entries, object(
			"id", float64(i),
			"uid", fmt.Sprintf("user-%d", i),
			"isActive", i%2 == 0,
			"score", rng.Float64()*1000,
			"tags", tags,
			"meta", meta,
		))
	}
	return object(
		"title", "STF vs JSON (Go)",
		"description", "Benchmark for base format overhead",
		"entries", entries,
	)
}

func averageMs(n int, body func()) float64 {
	var total time.Duration
	for i := 0; i < n; i++ {
		start := time.Now()
		body()
		total += time.Since(start)
	}
	return float64(total.Microseconds()) / float64(n) / 1000
}

func main() {
	fmt.Printf("Generating dataset with %d entries (seed %#x)...\n", datasetSize, seed)
	value := generate(datasetSize)

	stfText, err := stf.Serialize(value, stf.Compact())
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	jsonValue, err := stf.ToJSON(value, stf.RejectTyped)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	jsonBytes, err := json.Marshal(jsonValue)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	mb := func(n int) float64 { return float64(n) / 1024 / 1024 }
	fmt.Println("\n--- Payload Size ---")
	fmt.Printf("JSON: %.2f MB\n", mb(len(jsonBytes)))
	fmt.Printf("STF:  %.2f MB\n", mb(len(stfText)))
	fmt.Printf("STF is %.1f%% smaller\n", (1-float64(len(stfText))/float64(len(jsonBytes)))*100)

	fmt.Printf("\n--- Parsing (average of %d runs) ---\n", iterations)
	fmt.Printf("encoding/json: %.2f ms\n", averageMs(iterations, func() {
		var target any
		if err := json.Unmarshal(jsonBytes, &target); err != nil {
			panic(err)
		}
	}))
	fmt.Printf("stf.Parse:     %.2f ms\n", averageMs(iterations, func() {
		if _, err := stf.Parse(stfText); err != nil {
			panic(err)
		}
	}))

	fmt.Printf("\n--- Serialization (average of %d runs) ---\n", iterations)
	fmt.Printf("encoding/json: %.2f ms\n", averageMs(iterations, func() {
		if _, err := json.Marshal(jsonValue); err != nil {
			panic(err)
		}
	}))
	fmt.Printf("stf.Serialize: %.2f ms\n", averageMs(iterations, func() {
		if _, err := stf.Serialize(value, stf.Compact()); err != nil {
			panic(err)
		}
	}))

	dir := filepath.Join("..", "..", "benchmarks", "go")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(filepath.Join(dir, "bench_v2_go.stf"), []byte(stfText), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(filepath.Join(dir, "bench_v2_go.json"), jsonBytes, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("\nWrote %s\n", dir)
}
