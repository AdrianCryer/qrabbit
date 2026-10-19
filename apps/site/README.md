# Qrabbit promo site

A single static page: the features, the rabbit hole, bring your own subscription, pricing and downloads. Built with Astro; `pnpm build` writes plain files to `dist/`, which Cloudflare Workers serves as static assets (see Deploying).

```bash
pnpm site:dev      # from the repo root, http://localhost:4321
pnpm site:build    # dist/
pnpm --filter @qrabbit/site run typecheck
```

The social preview, the canonical link and `sitemap.xml` (written at build time with every page built, and linked from a generated `robots.txt`) are absolute URLs on the site's origin, which the build takes from the custom domain in `wrangler.jsonc`; set `SITE_URL` to build for another origin.

## What to edit

- **Release details** live in `src/site.ts`: the download link for each platform (Windows links its installer's fixed asset name under the latest GitHub Release; macOS and Linux point at the releases page until they are built), the formats shown, and the Cloud price.
- **App screenshots**: the highlighting comparison is imported straight from `docs/screenshots/raw/`, the capture behind the README image, so rerunning `tools/dev/make-showcase.mjs` updates it too. The thread, the home screen and the reading list are captured by `node tools/dev/make-site-shots.mjs` (after `pnpm desktop:build`) into `src/assets/`, at about the width the site draws them and again at a phone's width: at the README's 1280 their text comes out too small. Each capture's layout width is recorded in `src/shots.ts`, and crops are given in that layout. Astro turns them all into responsive WebP at build time.
- **The demo video** is left out of git. Put `demo.mp4` from `tools/dev/record-demo.mjs` (and optionally a `demo-poster.jpg`) in `public/` and a "See it move" section appears after the rabbit hole.
- **`public/og.png`** is the 1200×630 social preview, rendered from the site's own components by `node tools/dev/make-og-image.mjs` after `pnpm site:build` (build again to ship it).
- **The README's images** (`docs/screenshots/highlight.png`, `lists.png`, `collections.png`) are this site's sections, rendered by `node tools/dev/make-readme-images.mjs` after `pnpm site:build`. Change the comparisons here and render them again, rather than editing the images.

## Deploying

The site is hosted on Cloudflare Workers as static assets (`wrangler.jsonc`): `dist/` is uploaded as-is and there is no Worker code. The custom domains are declared there too, so a deploy creates their DNS records and certificates. Cloudflare builds it from git (Workers Builds) on every push to `main` that touches the site; nothing routine deploys from a laptop.

The Worker's build settings, in the dashboard under Settings → Build:

| Setting | Value |
| --- | --- |
| Root directory | `apps/site` |
| Build command | `pnpm install --frozen-lockfile --filter @qrabbit/site && pnpm build` |
| Deploy command | `npx wrangler deploy` |
| Build watch paths | `apps/site/**`, `docs/screenshots/raw/**`, `pnpm-lock.yaml` |

Production answers only on the custom domains (`workers_dev` is off); a push to any other branch builds too and gets a preview URL (`preview_urls`).

Build variables:

| Variable | Value | Why |
| --- | --- | --- |
| `SKIP_DEPENDENCY_INSTALL` | `1` | Cloudflare's own install step would install the whole workspace, Electron and the Supabase CLI included. The build command installs only this package. |
| `NODE_VERSION` | `22` | What the repo requires (`engines` in the root package.json). |
| `PNPM_VERSION` | `8.6.9` | Must match `packageManager` in the root package.json: the image's default pnpm refuses this lockfile under `--frozen-lockfile`. Bump both together. |

To deploy by hand, or just to check the config, run `pnpm build && pnpm exec wrangler deploy` here (`--dry-run` validates without uploading). Run a deploy that adds a custom domain from a real terminal: without a TTY, wrangler replaces any DNS record already at that name without asking, where a terminal gets a prompt.

The `www` host redirects to the apex with a Redirect Rule on the zone (Rules → Redirect Rules, the "redirect from WWW to root" template), which is outside wrangler's reach.

## Design

The page follows the app's theme strictly: its near-black surfaces, the paper, and the single lime accent, as in the README images. The white rabbit (`src/components/Rabbit.astro`) is inline SVG in the same neutrals, with the accent only in its ears: it peeks over the app window in the hero, hops down the burrow in the rabbit-hole section, sits on the Cloud card, and dives into its hole at the end.

Motion is progressive: content is visible without scripts, the burrow and the closing scene sit still for reduced motion, and the hero window's settle-on-scroll only runs where the browser supports scroll-driven animation.
