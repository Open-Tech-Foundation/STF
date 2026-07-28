# STF website

The marketing site, documentation, and playground, built with
[OTF Web](https://github.com/Open-Tech-Foundation/Web-App-Framework) — the Open Tech
Foundation's own framework.

```sh
bun install
bun run dev      # dev server
bun run build    # static site into dist/
```

Commit `bun.lock` only from a **released** bun. The format is version-specific, and a 1.4
canary writes `lockfileVersion: 2`, which no released bun — including the one that builds the
deployment — can parse.

## Deploying (Cloudflare)

| Setting | Value | Where |
| :--- | :--- | :--- |
| Build command | `bun install --frozen-lockfile && bun run build` | Dashboard |
| Root directory | `website` | Dashboard |
| Assets directory | `./dist` | [`wrangler.jsonc`](wrangler.jsonc) |

If the build fails with `Unknown lockfile version`, the committed `bun.lock` was written by a
bun newer than the build image's — regenerate it with a released bun.

## Layout

| Path | What it is |
| :--- | :--- |
| `app/page.tsx` | Landing page. |
| `app/docs/` | Documentation, as MDX. `_meta.js` sets the sidebar order. |
| `app/playground/` | Playground: Monaco plus the JavaScript reference implementation. |
| `lib/convert.ts` | The playground's conversions, testable without a browser. |
| `lib/codemirror-stf.ts` | CodeMirror's STF language, colours, theme, and parser-backed linter. |
| `otfw.config.js` | Site origin, navbar, footer, and the repository the "Edit this page" links point at. |
| `app/global.css` | Landing-page styles. The docs shell comes from `@opentf/web-docs/theme`. |

## Still to do

- **Syntax highlighting in docs fences.** The theme highlights fenced Markdown at build time
  with syntect, which has no STF grammar, so ```` ```stf ```` blocks render unhighlighted. The
  landing page's panels use the tokenizer in `lib/highlight.ts` instead; wiring that into MDX
  fences, or contributing an STF grammar upstream, is open.
- **Docs are written from `doc/*.md`, not generated from them.** The normative documents remain
  the source of truth, so a change to the specification needs a matching edit here. Whether to
  generate instead is still open.
- **The playground converts to JSON, tagged kinds, canonical form, and formatted STF.** YAML,
  TOML, JSON5, NDJSON, MessagePack, and CBOR are not wired up yet, and neither is a share link.
- **The playground depends on `../ref-impl/js` through a `file:` dependency.** When that package
  is published, only `website/package.json` changes.
- **`site.url`** in `otfw.config.js` is provisional (`stf.opentechf.org`), and no workflow
  deploys the site yet.
