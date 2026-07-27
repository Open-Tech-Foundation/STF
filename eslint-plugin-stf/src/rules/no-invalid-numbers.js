export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow invalid number formats in DTXT',
    },
    schema: [],
    messages: {
      leadingZero: "Invalid number: '{{num}}' has a leading zero.",
      trailingDot: "Invalid number: '{{num}}' has a trailing dot."
    }
  },
  create(context) {
    const sourceCode = context.sourceCode || context.getSourceCode();
    const source = sourceCode.getText();

    return {
      Program() {
        // Check for leading zeros
        const leadingZeroRegex = /(?<!\w)(-?)0(\d+)(\.\d+)?([eE][+-]?\d+)?/g;
        let match;

        while ((match = leadingZeroRegex.exec(source)) !== null) {
          if (match[2] && /^\d/.test(match[2])) {
            const lines = source.substring(0, match.index).split('\n');
            const line = lines.length;
            const col = lines[lines.length - 1].length;

            context.report({
              loc: { start: { line, column: col }, end: { line, column: col + match[0].length } },
              messageId: 'leadingZero',
              data: { num: match[0] }
            });
          }
        }

        // Check for trailing dots
        const trailingDotRegex = /(?<!\w)(-?\d+)\.(?!\d)/g;
        while ((match = trailingDotRegex.exec(source)) !== null) {
          const lines = source.substring(0, match.index).split('\n');
          const line = lines.length;
          const col = lines[lines.length - 1].length;

          context.report({
            loc: { start: { line, column: col }, end: { line, column: col + match[0].length } },
            messageId: 'trailingDot',
            data: { num: match[0] }
          });
        }
      }
    };
  }
};
