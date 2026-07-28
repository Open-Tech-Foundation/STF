export default function Home() {
  return (
    <main class="landing">
      <section class="hero">
        <p class="eyebrow">Structured Text Format</p>
        <h1>A data format that knows what its values are.</h1>
        <p class="lead">
          JSON forces every date, decimal, and big integer through a string, so a reader
          cannot tell one from a value that merely looks like one. STF makes the type
          explicit at the point of use — no schema, no convention, no guessing.
        </p>
        <div class="actions">
          <a href="/docs" class="btn primary">
            Read the spec
          </a>
          <a href="/playground" class="btn secondary">
            Open the playground
          </a>
        </div>
      </section>

      <section class="sample" aria-label="An STF document">
        <pre>
          <code>{SAMPLE}</code>
        </pre>
      </section>

      <section class="features" aria-label="Highlights">
        <article>
          <h2>Explicit types</h2>
          <p>
            <code>DATE</code>, <code>TIMESTAMP</code>, <code>DECIMAL</code>,{" "}
            <code>BIGINT</code>, and <code>BINARY</code> are part of the syntax, so
            <code>19.99</code> can be exactly 19.99 and an id can survive a round trip.
          </p>
        </article>
        <article>
          <h2>Strict by design</h2>
          <p>
            STF replaces JSON rather than extending it. Every rejection maps to exactly one
            documented error code, and a conversion that cannot be represented fails loudly
            instead of quietly losing information.
          </p>
        </article>
        <article>
          <h2>Four conformant implementations</h2>
          <p>
            Rust, JavaScript, Python, and Go all pass the same 258-case corpus, which is the
            executable contract for the specification rather than a test suite per project.
          </p>
        </article>
      </section>
    </main>
  );
}

const SAMPLE = `# A configuration file
{
  service: \`checkout-api\`,
  port: 8080,
  enabled: T,
  deploy_after: TIMESTAMP(2026-01-15T10:30:00Z),
  price_cap: DECIMAL(199.00),        # exact — scale is preserved
  account_id: BIGINT(9007199254740993),
  regions: [\`eu-west-1\`, \`us-east-1\`],
}`;
