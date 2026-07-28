# STF website

The marketing site, documentation, and playground, built with
[OTF Web](https://github.com/Open-Tech-Foundation/Web-App-Framework) — the Open Tech
Foundation's own framework.

```sh
bun install
bun run dev      # dev server
bun run build    # static site into dist/
```

The toolchain is pinned in [`mise.toml`](mise.toml), so with
[mise](https://mise.jdx.dev) installed the right bun is used automatically:

```sh
mise install                 # once
mise exec -- bun install
```

The pin matters. `bun.lock` is written in a version-specific format, and a *newer* bun writes a
lockfile older ones refuse to parse — a 1.4 canary writes `lockfileVersion: 2`, which no
released bun can read.

## Deploying (Cloudflare)

Cloudflare's build image ships an older bun than this project uses, and its default fails with:

```
error: Unknown lockfile version at bun.lock:2:22
warn: Ignoring lockfile
error: lockfile had changes, but lockfile is frozen
```

The lockfile is fine; the build image's bun is too old to read it. Set these in the Workers
Builds settings — the version can only be pinned there, not from the repository:

| Setting | Value | Where |
| :--- | :--- | :--- |
| `BUN_VERSION` | `1.3.14` | Environment variable — dashboard only |
| Build command | `bun install --frozen-lockfile && bun run build` | Dashboard |
| Root directory | `website` | Dashboard |
| Assets directory | `./dist` | [`wrangler.jsonc`](wrangler.jsonc) |

`wrangler.jsonc` already points at `./dist`, so the served files come from there; the settings
above are the ones Cloudflare cannot read from the repository.

The build command has to run `bun install` itself: Cloudflare installs dependencies
automatically for package managers it detects, but **not** once `BUN_VERSION` is set.

Keep `BUN_VERSION`, [`mise.toml`](mise.toml), `.bun-version`, and the `bun-version` pinned in
`.github/workflows/ci.yml` on the same value. If they drift, CI and the deployment disagree
about the lockfile and only one of them fails.

## Layout

| Path | What it is |
| :--- | :--- |
| `app/page.tsx` | Landing page. |
| `app/docs/` | Documentation, as MDX. `_meta.js` sets the sidebar order. |
| `app/playground/` | Playground: Monaco plus the JavaScript reference implementation. |
| `lib/convert.ts` | The playground's conversions, testable without a browser. |
| `lib/monaco-stf.ts` | Monaco's STF language, theme, and Monarch grammar. |
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
- **Monaco is bundled separately** by `bun run monaco`, which `dev` and `build` both run first.
  It cannot go through the site's bundler: Monaco's modules import CSS and Rolldown has removed
  CSS bundling. The output lands in `public/monaco/` and is gitignored.
- **The playground depends on `../ref-impl/js` through a `file:` dependency.** When that package
  is published, only `website/package.json` changes.
- **`site.url`** in `otfw.config.js` is provisional (`stf.opentechf.org`), and no workflow
  deploys the site yet.
