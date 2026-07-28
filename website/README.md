# STF website

The marketing site, documentation, and playground, built with
[OTF Web](https://github.com/Open-Tech-Foundation/Web-App-Framework) — the Open Tech
Foundation's own framework.

```sh
bun install
bun run dev      # dev server
bun run build    # static site into dist/
```

## Layout

| Path | What it is |
| :--- | :--- |
| `app/page.tsx` | Landing page. |
| `app/docs/` | Documentation, as MDX. `_meta.js` sets the sidebar order. |
| `app/playground/` | Playground route — a placeholder for now. |
| `otfw.config.js` | Site origin, navbar, footer, and the repository the "Edit this page" links point at. |
| `app/global.css` | Landing-page styles. The docs shell comes from `@opentf/web-docs/theme`. |

## Still to do

- **Documentation** is a single introduction page. The normative documents under `doc/` remain
  the source of truth; migrating them onto the site is a separate piece of work, and the
  decision that comes with it is whether the MDX becomes the source or stays generated from
  `doc/*.md`.
- **The playground** is a placeholder. It will run the JavaScript reference implementation
  (`ref-impl/js`) in the browser: an editor with live diagnostics carrying their normative
  error codes, and conversion to and from JSON, JSON5, NDJSON, YAML, TOML, MessagePack, and
  CBOR — refusing what a target format cannot represent rather than guessing.
- **`site.url`** in `otfw.config.js` is provisional (`stf.opentechf.org`), and no workflow
  deploys the site yet.
