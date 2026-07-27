// Minimal DTXT parser for ESLint - returns proper AST structure
export const parser = {
  parseForESLint(code) {
    // Tokenize the code to create proper tokens array
    const tokens = [];
    const comments = [];
    let pos = 0;

    while (pos < code.length) {
      const ch = code[pos];

      // Skip whitespace
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        pos++;
        continue;
      }

      // Comments
      if (ch === '#') {
        const start = pos;
        while (pos < code.length && code[pos] !== '\n') pos++;
        comments.push({
          type: 'Line',
          value: code.slice(start, pos),
          range: [start, pos],
          loc: getLoc(code, start, pos)
        });
        continue;
      }

      // Strings
      if (ch === '`' || ch === '"') {
        const start = pos;
        const quote = ch;
        pos++; // skip opening quote
        while (pos < code.length && code[pos] !== quote) {
          if (code[pos] === '\\') pos++; // skip escape
          pos++;
        }
        pos++; // skip closing quote
        tokens.push({
          type: 'String',
          value: code.slice(start, pos),
          range: [start, pos],
          loc: getLoc(code, start, pos)
        });
        continue;
      }

      // Numbers
      if (ch === '-' || (ch >= '0' && ch <= '9')) {
        const start = pos;
        while (pos < code.length && /[\d.\-eE]/.test(code[pos])) pos++;
        tokens.push({
          type: 'Numeric',
          value: code.slice(start, pos),
          range: [start, pos],
          loc: getLoc(code, start, pos)
        });
        continue;
      }

      // Identifiers and booleans
      if (/[A-Za-z_]/.test(ch)) {
        const start = pos;
        while (pos < code.length && /[A-Za-z0-9_\-]/.test(code[pos])) pos++;
        const value = code.slice(start, pos);
        const isKeyword = ['T', 'F', 'N', 'Date', 'BigNumber', 'Binary'].includes(value);
        tokens.push({
          type: isKeyword ? 'Keyword' : 'Identifier',
          value,
          range: [start, pos],
          loc: getLoc(code, start, pos)
        });
        continue;
      }

      // Punctuation
      if ('{}[],:()'.includes(ch)) {
        tokens.push({
          type: 'Punctuator',
          value: ch,
          range: [pos, pos + 1],
          loc: getLoc(code, pos, pos + 1)
        });
        pos++;
        continue;
      }

      pos++;
    }

    return {
      ast: {
        type: 'Program',
        body: [],
        sourceType: 'script',
        range: [0, code.length],
        loc: {
          start: { line: 1, column: 0 },
          end: { line: code.split('\n').length, column: 0 }
        },
        tokens,
        comments
      }
    };
  }
};

function getLoc(code, start, end) {
  const lines = code.substring(0, start).split('\n');
  const startLine = lines.length;
  const startCol = lines[lines.length - 1].length;

  const lines2 = code.substring(0, end).split('\n');
  const endLine = lines2.length;
  const endCol = lines2[lines2.length - 1].length;

  return {
    start: { line: startLine, column: startCol },
    end: { line: endLine, column: endCol }
  };
}
