import { format } from './dtxt.ts';

const input = `{
  title: \`Welcome to DTXT\`
  features: [
    \`Fast\`
    \`Clean\`
    \`Type-Safe\`
  ]
  metrics: {
    reduction: 0.183
    isActive: T
  }
   timestamp: Date(2026-01-17)
}`;

console.log("--- Input ---");
console.log(input);
console.log("\n--- Output ---");
console.log(format(input));
