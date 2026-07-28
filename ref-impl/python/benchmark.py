"""Payload-size and throughput benchmark for the Python implementation.

The dataset uses only JSON-native kinds, so the figures measure base format overhead rather
than the constructor types, and it is generated from a **fixed seed** so runs are comparable
to each other. Figures from different languages are not comparable — each implementation
benchmarks its own dataset, against its own host's JSON parser.

The JSON baseline uses ``separators=(",", ":")``. Python's ``json.dumps`` default inserts a
space after every separator, which would have inflated the JSON side by roughly the margin
being measured.

Run with: python3 ref-impl/python/benchmark.py
"""

from __future__ import annotations

import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import stf  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE.parent.parent / "benchmarks" / "python"
DATASET_SIZE = 30_000
ITERATIONS = 5
SEED = 0x57455354


def generate(count: int) -> dict:
    rng = random.Random(SEED)
    entries = []
    for i in range(count):
        entries.append(
            {
                "id": i,
                "uid": f"user-{i}",
                "isActive": i % 2 == 0,
                "score": rng.random() * 1000,
                "tags": ["data", "benchmark", "storage", "json", "stf"],
                "meta": {
                    "level": i % 10,
                    "verified": i % 3 == 0,
                    "note": None,
                    "nested": {"a": 1, "b": False, "c": "nested string"},
                },
            }
        )
    return {
        "title": "STF vs JSON (Python)",
        "description": "Benchmark for base format overhead",
        "entries": entries,
    }


def average_ms(iterations: int, body) -> float:
    total = 0.0
    for _ in range(iterations):
        start = time.perf_counter()
        body()
        total += (time.perf_counter() - start) * 1000
    return total / iterations


def main() -> None:
    print(f"Generating dataset with {DATASET_SIZE} entries (seed {SEED:#x})...")
    raw = generate(DATASET_SIZE)
    value = stf.from_json(raw)

    json_value = stf.to_json(value)
    json_text = json.dumps(json_value, separators=(",", ":"))
    stf_text = stf.serialize(value, stf.COMPACT)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "bench_v2.json").write_text(json_text, encoding="utf-8")
    (OUT_DIR / "bench_v2.stf").write_text(stf_text, encoding="utf-8")

    mb = lambda n: n / 1024 / 1024  # noqa: E731
    print("\n--- Payload Size ---")
    print(f"JSON: {mb(len(json_text.encode())):.2f} MB")
    print(f"STF:  {mb(len(stf_text.encode())):.2f} MB")
    print(f"STF is {(1 - len(stf_text) / len(json_text)) * 100:.1f}% smaller")

    print(f"\n--- Parsing (average of {ITERATIONS} runs) ---")
    print(f"json.loads: {average_ms(ITERATIONS, lambda: json.loads(json_text)):.2f} ms")
    print(f"stf.parse:  {average_ms(ITERATIONS, lambda: stf.parse(stf_text)):.2f} ms")

    print(f"\n--- Serialization (average of {ITERATIONS} runs) ---")
    print(
        "json.dumps:    "
        f"{average_ms(ITERATIONS, lambda: json.dumps(json_value, separators=(',', ':'))):.2f} ms"
    )
    print(
        "stf.serialize: "
        f"{average_ms(ITERATIONS, lambda: stf.serialize(value, stf.COMPACT)):.2f} ms"
    )


if __name__ == "__main__":
    main()
