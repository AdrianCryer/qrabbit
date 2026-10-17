import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";

// The site's origin, for the canonical link and the absolute social-preview URL: SITE_URL if set, else
// the custom domain the site deploys to (wrangler.jsonc), so a production build needs no extra setting.
function deployedOrigin() {
  const jsonc = readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
  const { routes = [] } = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, ""));
  const domain = routes.find((r) => r.custom_domain)?.pattern;
  return domain ? `https://${domain}` : undefined;
}

// A fully static site: `pnpm build` writes plain files to dist/, which Cloudflare Workers serves as assets.
export default defineConfig({
  site: process.env.SITE_URL ?? deployedOrigin(),
  devToolbar: { enabled: false },
});
