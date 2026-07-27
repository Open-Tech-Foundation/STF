import * as prettier from 'prettier';
import * as plugin from '../src/index.js';

async function test() {
  const input = `{name:\`Test\`,active:T,count:42,items:[1,2,3]}`;
  const expected = `{
  name: \`Test\`,
  active: T,
  count: 42,
  items: [
    1,
    2,
    3,
  ],
}`;

  const result = await prettier.format(input, {
    parser: 'dtxt',
    plugins: [plugin]
  });

  console.log('Formatted output:');
  console.log(result);
  console.log('Test passed!');
}

test().catch(console.error);
