#!/bin/bash

# STF Conformance Test Unified Runner
# This script runs the conformance tests for all active reference implementations (JS, Python, Go, Rust).

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

ROOT_DIR=$(pwd)

echo -e "${BLUE}STF Conformance Test Suite${NC}"
echo "================================="

# JavaScript / TypeScript
echo -e "\n${BLUE}Running JS/TS conformance tests...${NC}"
cd "$ROOT_DIR/ref-impl/js"
bun run run_conformance.ts

# Python
echo -e "\n${BLUE}Running Python conformance tests...${NC}"
cd "$ROOT_DIR/ref-impl/python"
python3 run_conformance.py

# Go
echo -e "\n${BLUE}Running Go conformance tests...${NC}"
cd "$ROOT_DIR/ref-impl/go"
go run cmd/conformance/main.go

# Rust
echo -e "\n${BLUE}Running Rust conformance tests...${NC}"
cd "$ROOT_DIR/ref-impl/rust"
cargo run --quiet --bin run_conformance

echo -e "\n${GREEN}All reference implementations passed conformance tests successfully!${NC}"
