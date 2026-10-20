import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { defineConfig } from "astro/config";

// The site's origin, for the canonical link and the absolute social-preview URL: SITE_URL if set, else
// the custom domain the site deploys to (wrangler.jsonc), so a production build needs no extra setting.
function deployedOrigin() {
  const jsonc = readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
  const { routes = [] } = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, ""));
  const domain = routes.find((r) => r.custom_domain)?.pattern;
  return domain ? `https://${domain}` : undefined;
}

const xmlEscape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Writes sitemap.xml, listing every page the build produced (error pages aside) on the site's origin, and a
// robots.txt that points crawlers at it. Both need absolute URLs, so a build without an origin skips them.
function sitemap() {
  let site;
  return {
    name: "qrabbit:sitemap",
    hooks: {
      "astro:config:done": ({ config }) => {
        site = config.site;
      },
      "astro:build:done": async ({ pages, dir, logger }) => {
        if (!site) {
          logger.warn("No site origin (SITE_URL or a custom domain in wrangler.jsonc): skipping sitemap.xml and robots.txt.");
          return;
        }
        const urls = pages
          .filter((p) => !/^\/?(404|500)\/?$/.test(p.pathname))
          .map((p) => new URL(p.pathname, site).href)
          .sort();
        const entries = urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`).join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
        const robots = `User-agent: *\nAllow: /\n\nSitemap: ${new URL("/sitemap.xml", site).href}\n`;
        await writeFile(new URL("sitemap.xml", dir), xml);
        await writeFile(new URL("robots.txt", dir), robots);
        logger.info(`sitemap.xml: ${urls.length} page${urls.length === 1 ? "" : "s"}`);
      },
    },
  };
}

// A fully static site: `pnpm build` writes plain files to dist/, which Cloudflare Workers serves as assets.
export default defineConfig({
  site: process.env.SITE_URL ?? deployedOrigin(),
  devToolbar: { enabled: false },
  // The CSS goes inside each page rather than in files the page must fetch before it can draw anything: on a
  // slow phone connection that's a round trip saved before the first paint, and the whole site's CSS is ~10 KB
  // compressed. Pages are revalidated on every visit anyway, so nothing is lost to caching.
  build: { inlineStylesheets: "always" },
  integrations: [sitemap()],
});
