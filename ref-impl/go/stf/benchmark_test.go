package stf

import (
	"testing"
	"encoding/json"
	"math/rand"
	"strings"
	"time"
)

const benchmarkDatasetSize = 30000

func generateBenchmarkData() string {
	var sb strings.Builder
	sb.WriteString("{title: `DTXT vs JSON (Go)`, description: `Benchmark`, entries: [")
	
	for i := 0; i < benchmarkDatasetSize; i++ {
		if i > 0 {
			sb.WriteString(", ")
		}
		sb.WriteString("{")
		sb.WriteString("id: ")
		sb.WriteString(string(rune(i)))
		sb.WriteString(", uid: `user-")
		sb.WriteString(string(rune(i)))
		sb.WriteString("`, isActive: ")
		if i%2 == 0 {
			sb.WriteString("T")
		} else {
			sb.WriteString("F")
		}
		sb.WriteString(", score: ")
		sb.WriteString(string(rune(rand.Float64() * 1000)))
		sb.WriteString(", tags: [`data`, `benchmark`, `storage`, `json`, `dtxt`], ")
		sb.WriteString("meta: {level: ")
		sb.WriteString(string(rune(i % 10)))
		sb.WriteString(", verified: ")
		if i%3 == 0 {
			sb.WriteString("T")
		} else {
			sb.WriteString("F")
		}
		sb.WriteString(", note: N, nested: {a: 1, b: F, c: `nested string`}}")
		sb.WriteString("}")
	}
	
	sb.WriteString("]}")
	return sb.String()
}

func BenchmarkJSONParse(b *testing.B) {
	jsonStr := "{}" // Simplified for now
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		var result interface{}
		json.Unmarshal([]byte(jsonStr), &result)
	}
}

func BenchmarkDTXTParse(b *testing.B) {
	dtxtStr := generateBenchmarkData()
	
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		Parse(dtxtStr)
	}
}

func init() {
	rand.Seed(time.Now().UnixNano())
}
