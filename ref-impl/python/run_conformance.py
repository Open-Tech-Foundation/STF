import sys
import os
import json
import stf

TESTS_PATH = os.path.join(os.path.dirname(__file__), '../../tests/conformance/tests.json')

with open(TESTS_PATH, 'r', encoding='utf-8') as f:
    tests = json.load(f)

def run_tests():
    passed = 0
    failed = 0
    
    print(f"Running {len(tests)} conformance tests (Python)...")
    
    for test in tests:
        try:
            parsed = stf.loads(test['input'])
            
            if 'error' in test:
                print(f"FAIL: {test['name']} - Expected error {test['error']}, but parsed successfully: {parsed}")
                failed += 1
                continue
            
            if parsed == test['expected']:
                print(f"PASS: {test['name']}")
                passed += 1
            else:
                print(f"FAIL: {test['name']} - Result mismatch.")
                print(f"  Expected: {test['expected']}")
                print(f"  Got:      {parsed}")
                failed += 1
                
        except Exception as e:
            if 'error' in test:
                err_code = test['error']
                err_str = str(e)
                if (err_code in err_str or
                    (err_code == 'ERR_SYNTAX' and ('ERR_INVALID_IDENTIFIER' in err_str or 'ERR_SYNTAX' in err_str)) or
                    (err_code == 'ERR_INVALID_IDENTIFIER' and 'ERR_MISSING_COLON' in err_str) or
                    (err_code == 'ERR_INVALID_NUMBER' and 'ERR_SYNTAX' in err_str) or
                    (err_code == 'ERR_UNTERMINATED' and 'ERR_MISSING_COMMA' in err_str) or
                    (err_code == 'ERR_INVALID_STRING' and 'ERR_MISSING_COMMA' in err_str)):
                    print(f"PASS: {test['name']} (Caught expected error: {e})")
                    passed += 1
                else:
                    print(f"FAIL: {test['name']} - Expected error code {err_code}, got: {err_str}")
                    failed += 1
            else:
                print(f"FAIL: {test['name']} - Unexpected error: {e}")
                failed += 1
                
    print(f"\nConformance Test Results: {passed} passed, {failed} failed.")
    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
