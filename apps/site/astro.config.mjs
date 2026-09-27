import { defineConfig } from "astro/config";

// A fully static site: `pnpm build` writes plain files to dist/ for any static host.
// Set SITE_URL at build time (e.g. https://example.com) so social previews get absolute image URLs.
export default defineConfig({
  site: process.env.SITE_URL,
  devToolbar: { enabled: false },
});
