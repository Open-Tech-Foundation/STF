// Screenshots every route, light and dark, against a running dev server.
//
// `bun run shots` — start `bun run dev` first, or pass a base URL as the first argument.
//
// This exists because reasoning about CSS is not the same as looking at it. The specification page
// shipped with two navbars, and nothing in the pre-rendered HTML said so: the markup was valid, the
// anchors resolved, the build was green. One screenshot would have caught it before the commit.
//
// Two environment notes, both learned the hard way:
//
//   * Playwright's bundled Chromium is pinned to a revision that may not be the one cached on this
//     machine, and `playwright install` downloads ~150MB to fix a problem the system browser does
//     not have. `CHROME` overrides the path; it defaults to the system Chromium.
//   * A screenshot taken too soon catches the page mid-scroll and looks like a layout bug. The
//     settle wait is not superstition — without it the sticky navbar photographs halfway down.

import { chromium } from "playwright";
import { mkdirSync, rmSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3001";
const CHROME = process.env.CHROME ?? "/usr/bin/chromium";
const OUT = "screenshots";

const ROUTES = [
  ["home", "/"],
  ["spec", "/spec"],
  ["docs", "/docs"],
  ["playground", "/playground"],
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const problems = [];

for (const theme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // The theme toggle persists to localStorage and applies `data-theme` on mount, so seeding the
  // key before the first script runs is what avoids photographing a flash of the other theme.
  await context.addInitScript(`try { localStorage.setItem("theme", "${theme}") } catch {}`);

  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && problems.push(`${theme}: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`${theme}: pageerror: ${e.message}`));

  for (const [name, path] of ROUTES) {
    await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForTimeout(800);

    // A page that scrolls sideways is a layout bug every time, and it is invisible in a viewport
    // screenshot — the overflow is off-screen by definition.
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (wide) problems.push(`${theme}: ${path} scrolls horizontally`);

    await page.screenshot({ path: `${OUT}/${name}-${theme}.png` });
    console.log(`  ${OUT}/${name}-${theme}.png`);
  }
  await context.close();
}

await browser.close();
console.log(problems.length ? `\nproblems:\n  ${problems.join("\n  ")}` : "\nno console errors");
