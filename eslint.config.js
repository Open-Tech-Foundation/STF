import dtxtPlugin from './eslint-plugin-dtxt/src/index.js';

export default [
  {
    files: ['**/*.dtxt'],
    plugins: { dtxt: dtxtPlugin },
    languageOptions: {
      parser: dtxtPlugin.parser
    },
    rules: {
      'dtxt/no-unknown-constructor': 'error',
      'dtxt/no-duplicate-keys': 'error',
      'dtxt/no-invalid-numbers': 'error',
    }
  }
];
