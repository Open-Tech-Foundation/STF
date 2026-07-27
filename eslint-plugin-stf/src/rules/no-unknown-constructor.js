export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow unknown constructor types in STF',
    },
    schema: [],
    messages: {
      unknown: "Unknown constructor '{{name}}'. Valid constructors are BIGINT, DECIMAL, DATE, TIMESTAMP, BINARY."
    }
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    const source = sourceCode.getText();

    return {
      Program() {
        const knownConstructors = ['BIGINT', 'DECIMAL', 'DATE', 'TIMESTAMP', 'BINARY'];
        const ctorRegex = /\b([A-Za-z0-9_-]+)\s*\(/g;
        let match;

        while ((match = ctorRegex.exec(source)) !== null) {
          const name = match[1];
          if (!knownConstructors.includes(name)) {
            const lines = source.substring(0, match.index).split('\n');
            const line = lines.length;
            const column = lines[lines.length - 1].length;

            context.report({
              loc: { start: { line, column }, end: { line, column: column + name.length } },
              messageId: 'unknown',
              data: { name }
            });
          }
        }
      }
    };
  }
};
