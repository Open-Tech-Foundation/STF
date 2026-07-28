#!/bin/bash

# STF 1.0 conformance — runs every implementation that has a 1.0 corpus runner.
#
# The corpus (tests/conformance/corpus.json) is the executable contract. Runners must compare
# error codes exactly and check value kinds; see tests/conformance/README.md §3.
#
# This script does NOT stop at the first failure: the point is to see where every
# implementation stands. It exits non-zero if any runner failed.

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FAILED=()
SKIPPED=()

run_impl() {
  local name="$1"
  shift
  echo -e "\n${BLUE}== ${name} ==${NC}"
  if ! (cd "$ROOT_DIR" && "$@"); then
    FAILED+=("$name")
  fi
}

echo -e "${BLUE}STF 1.0 Conformance${NC}"
echo "==================="

if command -v node >/dev/null 2>&1; then
  run_impl "JavaScript" node tests/conformance/run_js.mjs
else
  SKIPPED+=("JavaScript (node not found)")
fi

if command -v python3 >/dev/null 2>&1; then
  run_impl "Python" python3 tests/conformance/run_python.py
else
  SKIPPED+=("Python (python3 not found)")
fi

if command -v cargo >/dev/null 2>&1; then
  run_impl "Rust" env CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/cargo-stf}" \
    cargo run --quiet --release --manifest-path ref-impl/rust/Cargo.toml --bin stf-conformance
else
  SKIPPED+=("Rust (cargo not found)")
fi

# Go still runs the superseded pre-1.0 suite; it is migrated in a later change.
SKIPPED+=("Go (no 1.0 corpus runner yet)")

echo
for s in "${SKIPPED[@]}"; do
  echo -e "${YELLOW}skipped${NC} $s"
done

if [ ${#FAILED[@]} -eq 0 ]; then
  echo -e "\n${GREEN}All runnable implementations are conformant.${NC}"
  exit 0
fi

echo -e "\n${RED}Not conformant: ${FAILED[*]}${NC}"
exit 1
