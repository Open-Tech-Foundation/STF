// The specification's own frame, deliberately not the docs frame.
//
// A specification is read differently from a guide. Nobody reads it front to back; they arrive at
// a section, check a rule, and cite it. So the contents are the primary navigation rather than an
// afterthought in the right margin: every section and subsection is listed, always, and the rail
// scrolls independently of the text.
//
// The contents come from `contents.ts`, which the generator writes from the same headings it puts
// on the page — not from scraping the DOM after mount. A specification's table of contents has to
// be in the HTML: it is what a search engine indexes, what a reader without JavaScript navigates
// by, and what `/llms-full.txt` carries. Scroll-spy is layered on top and is the only part that
// needs the client.

import { onMount } from "@opentf/web";
import { Navbar, Footer } from "@opentf/web-docs";

import config from "../../otfw.config.js";
import { CONTENTS } from "./contents.ts";

export default function SpecLayout(props: { children: unknown }) {
  let activeId = $state("");
  let observer: IntersectionObserver | null = null;

  onMount(() => {
    const root = document.getElementById("spec-content");
    if (!root) return;

    const headings = Array.from(root.querySelectorAll<HTMLElement>("h2[id], h3[id]"));
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) activeId = entry.target.id;
      },
      // Narrow band near the top: a section counts as "here" once its heading reaches the
      // reading line, not while it is still below the fold.
      { rootMargin: "-8% 0px -82% 0px", threshold: 0 },
    );
    for (const heading of headings) observer.observe(heading);

    // A deep link lands mid-document, so the rail has to scroll itself to match — otherwise the
    // reader arrives at §14 looking at a contents list showing §1.
    // The router exposes pathname, params and query but not the fragment, so this reads it from
    // the location directly — `onMount` only runs in the browser, so there is nothing to guard.
    if (location.hash) activeId = location.hash.slice(1);

    return () => observer?.disconnect();
  });

  $effect(() => {
    const id = activeId;
    if (!id || typeof document === "undefined") return;
    document.querySelector(`.spec-toc-link[href="#${id}"]`)?.scrollIntoView({ block: "nearest" });
  });

  return (
    <div class="otfw-shell">
      <Navbar config={config.docs} />
      <div class="otfw-shell-body">
        <div class="spec">
          <nav class="spec-toc" aria-label="Contents">
            <p class="spec-toc-title">Contents</p>
            {CONTENTS.map((group) => (
              <div class="spec-toc-group">
                <p class="spec-toc-group-note">{group.note}</p>
                <ul>
                  {group.entries.map((entry) => (
                    <li class={entry.sub ? "spec-toc-sub" : ""}>
                      <a
                        class={
                          activeId === entry.id ? "spec-toc-link spec-toc-on" : "spec-toc-link"
                        }
                        href={`#${entry.id}`}
                      >
                        {entry.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <main id="spec-content" class="spec-body otfw-prose" data-pagefind-body>
            <header class="spec-head">
              <p class="spec-status">
                <span class="spec-badge">Draft</span>
                <span>Version 1.0</span>
                <span>CC0 1.0</span>
              </p>
              <h1>STF Specification</h1>
              <p class="spec-lede">
                The normative text. Everything below is generated from the Markdown in the
                repository, so this page and{" "}
                <a href="https://github.com/Open-Tech-Foundation/STF/tree/main/doc">doc/</a> cannot
                disagree. For explanation, worked examples and the command-line tool, read the{" "}
                <a href="/docs">guides</a>.
              </p>
            </header>
            {props.children}
          </main>
        </div>
      </div>
      <Footer config={config.docs} />
    </div>
  );
}
