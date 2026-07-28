# STF 1.0 Benchmark Results

Performance of the four reference implementations against their host language's standard JSON
library.

**Dataset**: 30,000 entries of JSON-native kinds only — integers, floats, booleans, nulls,
nested objects, and strings. It deliberately does **not** exercise the constructor types, so
these figures measure base format overhead rather than what STF adds.

**Method**: each implementation generates the dataset from a fixed seed, so runs are
reproducible; the JSON baseline is minified in every language. Averages of 5 runs.

> [!IMPORTANT]
> **These figures are not comparable across languages.** Each row was produced on one machine
> by one implementation against its own host's JSON library. Compare *within* a row, never
> down a column. The Rust and Go rows compare two parsers written in the same language and are
> the meaningful ones; the JavaScript and Python rows compare an STF parser written in the host
> language against a JSON parser written in C or C++, which says nothing about the format.

Reproduce with:

```sh
cargo run --release --manifest-path ref-impl/rust/Cargo.toml --bin stf-benchmark
cd ref-impl/go && go run ./cmd/benchmark
node ref-impl/js/benchmark.ts
python3 ref-impl/python/benchmark.py
```

---

## 1. Payload Size

STF saves space by omitting quotes from keys and using the one-character `T` / `F` / `N`
literals.

| Language | JSON | STF | Reduction |
| :--- | ---: | ---: | ---: |
| Rust | 6.28 MB | 5.13 MB | **18.3% smaller** |
| Go | 6.28 MB | 5.13 MB | **18.3% smaller** |
| JavaScript | 6.28 MB | 5.13 MB | **18.3% smaller** |
| Python | 6.28 MB | 5.13 MB | **18.3% smaller** |

All four agree exactly, because all four now serialize the same logical dataset and compare
against a minified JSON baseline. Earlier revisions of this document disagreed by 3 percentage
points, which was an artefact of the Python baseline using `json.dumps` default separator
spacing and of each implementation generating a differently-shaped dataset.

---

## 2. Parsing

| Language | STF | Native JSON | |
| :--- | ---: | ---: | :--- |
| Rust | **70.07 ms** | 113.25 ms (`serde_json`) | STF 38% faster |
| Go | **73.26 ms** | 94.75 ms (`encoding/json`) | STF 23% faster |
| JavaScript (Node 24) | 163.75 ms | **32.74 ms** (`JSON.parse`) | native parser is C++ |
| Python 3.13 | 1837.43 ms | **79.01 ms** (`json.loads`) | pure-Python scanner vs C |

STF's grammar is cheap to parse — unquoted keys and one-character literals mean fewer bytes and
fewer branches — and where the comparison is like-for-like, it wins. Where the host provides a
JSON parser written in C, that parser wins, and no property of the format changes that.

---

## 3. Serialization

| Language | STF | Native JSON | |
| :--- | ---: | ---: | :--- |
| Rust | 39.99 ms | **9.63 ms** (`serde_json`) | serde_json is 4× faster |
| Go | **41.75 ms** | 85.69 ms (`encoding/json`) | STF 51% faster |
| JavaScript (Node 24) | 182.09 ms | **32.31 ms** (`JSON.stringify`) | native writer is C++ |
| Python 3.13 | 524.94 ms | **78.89 ms** (`json.dumps`) | pure-Python writer vs C |

The Rust result is the interesting one: `serde_json` is four times faster at writing than this
implementation. The STF serializer allocates a string per number and builds output through a
`String` rather than a reusable buffer. That is an implementation gap, not a format one, and it
is the clearest optimization target in the codebase.

---

## 4. Conformance

All four implementations pass the full [STF 1.0 conformance corpus](../tests/conformance/).

| Implementation | Corpus |
| :--- | ---: |
| Rust | **258 / 258** |
| JavaScript | **258 / 258** |
| Python | **258 / 258** |
| Go | **258 / 258** |

```sh
./scripts/check_conformance.sh
```

Runners compare error codes exactly, check value kinds, compare Numbers as `binary64` bit
patterns, compare Decimals on coefficient *and* scale, and verify
`parse(serialize(parse(input)))` for every value case.
