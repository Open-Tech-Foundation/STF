export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow duplicate keys in DTXT objects',
    },
    schema: [],
    messages: {
      duplicate: "Duplicate key '{{key}}' found."
    }
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    const source = sourceCode.getText();

    return {
      Program() {
        const keyRegex = /^\s*([A-Za-z0-9_-]+)\s*:/gm;
        let match;
        const seen = new Map();

        while ((match = keyRegex.exec(source)) !== null) {
          const key = match[1];
          if (seen.has(key)) {
            const prevIndex = seen.get(key);
            const lines1 = source.substring(0, prevIndex).split('\n');
            const line1 = lines1.length;

            const lines2 = source.substring(0, match.index).split('\n');
            const line2 = lines2.length;
            const col2 = lines2[lines2.length - 1].length;

            context.report({
              loc: { start: { line: line2, column: col2 }, end: { line: line2, column: col2 + key.length } },
              messageId: 'duplicate',
              data: { key }
            });
          } else {
            seen.set(key, match.index);
          }
        }
      }
    };
  }
};
