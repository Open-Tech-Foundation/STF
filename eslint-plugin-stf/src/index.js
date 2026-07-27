import noUnknownConstructor from './rules/no-unknown-constructor.js';
import noDuplicateKeys from './rules/no-duplicate-keys.js';
import noInvalidNumbers from './rules/no-invalid-numbers.js';
import { parser } from './parser.js';

const plugin = {
  rules: {
    'no-unknown-constructor': noUnknownConstructor,
    'no-duplicate-keys': noDuplicateKeys,
    'no-invalid-numbers': noInvalidNumbers,
  },
  configs: {
    recommended: {
      plugins: ['dtxt'],
      rules: {
        'dtxt/no-unknown-constructor': 'error',
        'dtxt/no-duplicate-keys': 'error',
        'dtxt/no-invalid-numbers': 'error',
      },
      overrides: [
        {
          files: ['*.dtxt'],
          parser: './parser.js',
        }
      ]
    }
  },
  parser
};

export const rules = plugin.rules;
export const configs = plugin.configs;
export { parser };
export default plugin;
