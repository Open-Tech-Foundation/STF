import { DocsLayout } from "@opentf/web-docs";
import config from "../../otfw.config.js";

export default function Layout(props: { children: unknown }) {
  return (
    <DocsLayout config={config.docs} frame={false}>
      {props.children}
    </DocsLayout>
  );
}
