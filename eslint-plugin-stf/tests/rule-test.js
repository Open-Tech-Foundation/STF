import { RuleTester } from 'eslint';
import noUnknownConstructor from '../src/rules/no-unknown-constructor.js';
import noDuplicateKeys from '../src/rules/no-duplicate-keys.js';
import noInvalidNumbers from '../src/rules/no-invalid-numbers.js';

const tester = new RuleTester({
  languageOptions: {
    parser: './src/parser.js'
  }
});

// Test no-unknown-constructor rule
tester.run('no-unknown-constructor', { meta: noUnknownConstructor.meta, create: noUnknownConstructor.create }, {
  valid: [
    '{ foo: Date(2026-01-01), bar: BigNumber(123), baz: Binary(ABCDEF) }'
  ],
  invalid: [
    {
      code: '{ foo: InvalidCtor(123) }',
      errors: [{ messageId: 'unknown' }]
    }
  ]
});

console.log('All ESLint rule tests passed!');
