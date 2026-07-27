import plugin from './src/index.js';

export default [
  {
    plugins: { dtxt: plugin },
    rules: {
      'dtxt/no-unknown-constructor': 'error',
      'dtxt/no-duplicate-keys': 'error',
      'dtxt/no-invalid-numbers': 'error',
    },
    overrides: [
      {
        files: ['*.dtxt'],
        parser: './src/parser.js',
        rules: {
          'dtxt/no-unknown-constructor': 'error',
          'dtxt/no-duplicate-keys': 'error',
          'dtxt/no-invalid-numbers': 'error',
        }
      }
    ]
  }
];
