// Placeholder route.
//
// The playground will run the JavaScript reference implementation (`ref-impl/js`) in the
// browser: an STF editor with live diagnostics carrying their normative error codes, and
// conversion to and from JSON, JSON5, NDJSON, YAML, TOML, MessagePack, and CBOR — refusing,
// rather than guessing at, what a target format cannot represent.
export default function Playground() {
  return (
    <main class="landing">
      <section class="hero"><div class="container">
        <span class="eyebrow">
          <span class="dot" aria-hidden="true" />
          Not implemented yet
        </span>
        <h1 class="title">Playground</h1>
        <p class="lede">
          An STF editor with diagnostics as you type, and conversion between STF and JSON,
          JSON5, NDJSON, YAML, TOML, MessagePack, and CBOR — running the JavaScript reference
          implementation in the browser, so the errors reported here are the ones every other
          implementation reports.
        </p>
      </div></section>

      <section class="section"><div class="container placeholder">
        <p>
          Until it ships, the <code>stf</code> command-line tool performs the same conversions
          offline, and refuses what the target format cannot represent rather than losing the
          type:
        </p>
        <pre>
          <code>{COMMANDS}</code>
        </pre>
      </div></section>
    </main>
  );
}

const COMMANDS = `stf convert data.json --to stf
stf convert events.ndjson --to stf --stream
stf check config.stf`;
