// The Open Tech Foundation footer, shared across the org's sites.
//
// The structure and class names match tsr.opentechf.org exactly — org logo linking to
// opentechf.org, the project's licence, and the "Built with OTF Web" badge — so the footer
// reads the same wherever someone lands. The docs theme's `Footer` only renders a text line
// and links, which is why this replaces it rather than configuring it.
//
// The badge keeps its own brand colours (white field, black OTF, orange Web) in both themes;
// it is a mark, not page furniture.

export default function SiteFooter(props: { license: string }) {
  return (
    <footer class="otfw-footer">
      <div class="otfw-footer-inner">
        <div class="otfw-footer-org">
          <a
            href="https://opentechf.org"
            target="_blank"
            rel="noreferrer"
            class="otfw-footer-org-link"
          >
            <img
              src="/img/otf-logo.svg"
              alt=""
              width="24"
              height="24"
              class="otfw-footer-org-logo"
            />
            <span>© Open Tech Foundation</span>
          </a>
          <span class="otfw-footer-license">— {props.license}</span>
        </div>

        <a
          href="https://web.opentechf.org"
          target="_blank"
          rel="noreferrer"
          class="otfw-footer-badge"
          aria-label="Built with OTF Web"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 22 22"
            aria-hidden="true"
            class="otfw-footer-badge-mark"
          >
            <rect width="22" height="22" rx="6" fill="var(--otfw-accent-soft)" />
            <path
              d="M6.5 6.5h3.75v9H6.5v-9zm5.25 0H15.5v9h-3.75v-9z"
              fill="none"
              stroke="var(--otfw-accent)"
              stroke-width="1.35"
              stroke-linejoin="round"
            />
            <path
              d="M10.25 6.5v9M6.5 9.25h3.75M11.75 9.25H15.5M6.5 12h3.75M11.75 12H15.5"
              fill="none"
              stroke="var(--otfw-accent)"
              stroke-width="1.1"
              stroke-linecap="round"
              opacity="0.55"
            />
          </svg>
          <span class="otfw-footer-badge-copy">
            <span class="otfw-footer-badge-muted">Built with</span>
            <span class="otfw-footer-badge-brand">
              <span class="otfw-footer-badge-brand-otf">OTF</span>{" "}
              <span class="otfw-footer-badge-brand-web">Web</span>
            </span>
          </span>
        </a>
      </div>
    </footer>
  );
}
