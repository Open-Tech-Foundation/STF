import { Navbar } from "@opentf/web-docs";
import config from "../otfw.config.js";
import SiteFooter from "../components/SiteFooter.tsx";

export default function Layout(props: { children: unknown }) {
  return (
    <div class="otfw-shell">
      <Navbar config={config.docs} />
      <div class="otfw-shell-body">{props.children}</div>
      {/* The org-wide footer, not the theme's, so every OTF site ends the same way. */}
      <SiteFooter license="CC0 1.0" />
    </div>
  );
}
