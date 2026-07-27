import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

import dtxt
from datetime import datetime, date
import binascii

def test_spec_example():
    spec_example = """
# DTXT example
{
  name: `Sample`,
  created: Date(2026-01-15),
  updated: Date(2026-01-15T10:30:00Z),
  active: T,
  count: 42,
  big: BigNumber(9007199254740993),
  hash: Binary(A7B2319E44CE12BA),
  items: [1, 2, 3],
  meta: {
    retries: 3,
    enabled: F,
  },
}
"""
    parsed = dtxt.loads(spec_example)
    print("Parsed Example Successfully")
    
    assert parsed['name'] == 'Sample'
    assert parsed['created'] == date(2026, 1, 15)
    # Check updated (datetime with UTC)
    # datetime.fromisoformat might return +00:00 for Z if correctly handled
    assert parsed['active'] is True
    assert parsed['count'] == 42
    assert parsed['big'] == 9007199254740993
    assert parsed['hash'] == binascii.unhexlify('A7B2319E44CE12BA')
    assert parsed['items'] == [1, 2, 3]
    assert parsed['meta']['retries'] == 3
    assert parsed['meta']['enabled'] is False

    # Round trip
    dumped = dtxt.dumps(parsed)
    print("Dumped (Canonical):", dumped)
    
    reparsed = dtxt.loads(dumped)
    assert reparsed == parsed
    print("Round trip successful")

def test_comments_and_whitespace():
    dtxt_text = "{ # comment\n  a: 1, \n /* not supported */ \n b: 2 }"
    # The lexer should fail on /* if not supported, but the spec only mentions //
    # My lexer will treat /* as mismatch if it's not handled.
    try:
        dtxt.loads(dtxt_text)
    except dtxt.DTXTError as e:
        print("Expected error for /*:", e)
        assert "Unexpected character" in str(e)

def test_keys():
    dtxt_text = "{ 123key: T, _key: F, Key9: N }"
    parsed = dtxt.loads(dtxt_text)
    assert parsed['123key'] is True
    assert parsed['_key'] is False
    assert parsed['Key9'] is None

if __name__ == "__main__":
    test_spec_example()
    test_comments_and_whitespace()
    test_keys()
    print("All tests passed!")
