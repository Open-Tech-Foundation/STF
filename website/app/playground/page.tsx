// Placeholder route.
//
// The playground will run the JavaScript reference implementation (`ref-impl/js`) in the
// browser: an STF editor with live diagnostics carrying their normative error codes, and
// conversion to and from JSON, JSON5, NDJSON, YAML, TOML, MessagePack, and CBOR — refusing,
// rather than guessing at, what a target format cannot represent.
export default function Playground() {
  return (
    <main class="landing">
      <section class="hero">
        <p class="eyebrow">Playground</p>
        <h1>Not built yet.</h1>
        <p class="lead">
          This is where you will be able to write STF, see errors as you type, and convert
          between STF and other formats without installing anything.
        </p>
      </section>

      <section class="placeholder">
        <p>
          Until then, the <code>stf</code> command-line tool does the same conversions
          offline:
        </p>
        <pre>
          <code>{"stf convert data.json --to stf\nstf check config.stf\nstf fmt --write config.stf"}</code>
        </pre>
      </section>
    </main>
  );
}
