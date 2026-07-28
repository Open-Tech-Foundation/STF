import { defineDocsConfig } from "@opentf/web-docs/config";

export default defineDocsConfig({
  // Canonical site origin, required by production builds. Provisional: this follows the
  // org's existing pattern (the framework's docs are at web.opentechf.org). Change it here
  // if STF is deployed elsewhere — nothing else refers to the origin.
  site: { url: "https://stf.opentechf.org" },

  docs: {
    title: "STF",
    // Also used as the summary at the top of the generated /llms.txt.
    description:
      "The Structured Text Format: a human-readable data format whose dates, decimals, big integers, and binary values are explicit in the syntax rather than encoded in strings.",
    dir: "docs",
    nav: [
      { label: "Docs", href: "/docs" },
      { label: "Playground", href: "/playground" },
      { label: "GitHub", href: "https://github.com/Open-Tech-Foundation/STF" },
    ],
    footer: {
      text: "STF — a project of the Open Tech Foundation. Public domain under CC0 1.0.",
    },
    // Per-page "Last updated" (from git) and "Edit this page" (GitHub); links use
    // <repoUrl>/edit/main/<source-path>.
    repoUrl: "https://github.com/Open-Tech-Foundation/STF",
    lastUpdated: true,
  },
});
