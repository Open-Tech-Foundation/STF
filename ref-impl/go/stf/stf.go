// Package stf is the Go reference implementation of STF 1.0 — the Structured Text Format.
//
// The normative documents are doc/spec.md and doc/error-codes.md; section references
// throughout this package point at them. The executable contract is the corpus under
// tests/conformance/.
//
//	value, err := stf.Parse("{ price: DECIMAL(19.99), tags: [`a`, `b`] }")
//	if err != nil {
//	    log.Fatalf("%s", stf.CodeOf(err))
//	}
//	text, _ := stf.Serialize(value, stf.Canonical())
//	// {price:DECIMAL(19.99),tags:["a","b"]}
package stf

import (
	"unicode/utf8"
)

// Parse parses a document and returns its root object.
func Parse(input string) (*Object, error) {
	doc, err := ParseDocument(input)
	if err != nil {
		return nil, err
	}
	return doc.Root, nil
}

// ParseDocument parses a document, keeping its directives (spec §5.1), which are metadata
// rather than data.
func ParseDocument(input string) (*Document, error) {
	return ParseDocumentWithLimits(input, DefaultLimits())
}

// ParseDocumentWithLimits is ParseDocument with explicit resource limits (spec §15).
func ParseDocumentWithLimits(input string, limits Limits) (*Document, error) {
	p := &parser{src: input, limits: limits, mode: modeDocument}
	doc, err := p.parseDocument()
	if err != nil {
		return nil, err
	}
	return doc, nil
}

// ParseBytes parses raw bytes, enforcing the UTF-8 requirement of spec §2.
//
// Substituting U+FFFD is prohibited, so malformed input is rejected outright.
func ParseBytes(input []byte) (*Object, error) {
	if !utf8.Valid(input) {
		return nil, detachedError(ErrInvalidUTF8, "input is not well-formed UTF-8")
	}
	return Parse(string(input))
}

// FormatText parses then reserializes with two-space indentation.
func FormatText(input string) (string, error) {
	doc, err := ParseDocument(input)
	if err != nil {
		return "", err
	}
	return SerializeDocument(doc, Pretty("  "))
}
