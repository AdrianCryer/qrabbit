# QRabbit promo site

A single static page: the features, the rabbit hole, bring your own subscription, pricing and downloads. Built with Astro; `pnpm build` writes plain files to `dist/` for any static host.

```bash
pnpm site:dev      # from the repo root, http://localhost:4321
pnpm site:build    # dist/
pnpm --filter @qrabbit/site run typecheck
```

Set `SITE_URL` when building for a real domain (`SITE_URL=https://example.com pnpm site:build`) so the social preview and canonical link get absolute URLs.

## What to edit

- **Release details** live in `src/site.ts`: the download link for each platform (all point at GitHub Releases for now, which is private until the repo is public), the formats shown, and the Cloud price.
- **App screenshots** are imported straight from `docs/screenshots/raw/`, the captures behind the README images, so rerunning `tools/dev/make-showcase.mjs` updates the site too. Astro turns them into responsive WebP at build time.
- **The demo video** is left out of git. Put `demo.mp4` from `tools/dev/record-demo.mjs` (and optionally a `demo-poster.jpg`) in `public/` and a "See it move" section appears after the rabbit hole.
- **`public/og.png`** is the 1200×630 social preview, rendered from the site's own components.

## Design

The page follows the app's theme strictly: its near-black surfaces, the paper, and the single lime accent, as in the README images. The white rabbit (`src/components/Rabbit.astro`) is inline SVG in the same neutrals, with the accent only in its ears: it peeks over the app window in the hero, hops down the burrow in the rabbit-hole section, sits on the Cloud card, and dives into its hole at the end.

Motion is progressive: content is visible without scripts, the burrow and the closing scene sit still for reduced motion, and the hero window's settle-on-scroll only runs where the browser supports scroll-driven animation.
