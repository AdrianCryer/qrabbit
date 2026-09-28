#!/usr/bin/env node
// Renders the README's showcase images from the promo site, so the README and the site show the same
// thing: the highlighting and lists comparisons (a mock of one long chat against the real app) and
// collections (home and a reading list), each section on the app's theme with its glow, as the
// README images have always been (see stage-page.mjs).
//
// Usage: pnpm site:build && node tools/dev/make-readme-images.mjs
//   Writes docs/screenshots/highlight.png, lists.png and collections.png, 1800 wide: the site laid
//   out at 1440 and captured at 1.25x. The app captures inside them come from make-showcase.mjs (the
//   highlighting capture in docs/screenshots/raw/) and make-site-shots.mjs (the thread, home and the
//   reading list); when the app changes, rerun those and rebuild the site first.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const siteDist = join(repo, "apps", "site", "dist");
const outDir = join(repo, "docs", "screenshots");
const electronBin = join(repo, "apps", "desktop", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");

const LAYOUT = { width: 1440, height: 1000 };
const SCALE = 1.25;
// Each image is one of the site's sections, by id. Collections leaves out the folder listing under
// its windows, which the README shows as a code block of its own.
const IMAGES = [
  { name: "highlight.png", section: "#features" },
  { name: "lists.png", section: "#lists" },
  { name: "collections.png", section: "#collections", hide: ["#collections .files"] },
];

// Not awaited: Electron fires "ready" only after an ES-module entry finishes evaluating.
if (process.versions.electron) {
  render().catch((err) => { console.error("make-readme-images:", err); process.exit(1); });
} else {
  if (!existsSync(join(siteDist, "index.html"))) {
    console.error("make-readme-images: build the site first (pnpm site:build)");
    process.exit(1);
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url)], { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}

/** Serves the built site on a free local port, as a static host would. */
function serve() {
  const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = normalize(join(siteDist, path));
    if (!file.startsWith(siteDist)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

async function render() {
  const { app, BrowserWindow } = await import("electron");
  const { THEME_BACKGROUND } = await import("./stage-page.mjs");
  setTimeout(() => { console.error("make-readme-images: timed out"); app.exit(2); }, 120_000).unref();
  await app.whenReady();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;

  // Offscreen, and a blank page loaded before the debugger attaches (see openStage in stage-page.mjs);
  // the site loads once the size is emulated, so its images are chosen for this width and scale.
  const win = new BrowserWindow({ width: 800, height: 600, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL("about:blank");
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { ...LAYOUT, deviceScaleFactor: SCALE, mobile: false });
  await win.loadURL(url);

  // The page as a still: no header, no fade-ins, every image loaded, and each section framed on the
  // theme's background, which carries its own grain.
  await win.webContents.insertCSS(`
    .nav { display: none !important; }
    body::after { display: none !important; }
    .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
    ${IMAGES.flatMap((i) => i.hide ?? []).join(", ")} { display: none !important; }
    .readme-frame { background: ${THEME_BACKGROUND} !important; padding: 76px 0 76px !important; }`);
  await win.webContents.executeJavaScript(`(async () => {
    for (const sel of ${JSON.stringify(IMAGES.map((i) => i.section))}) document.querySelector(sel).classList.add("readme-frame");
    const imgs = [...document.images];
    for (const img of imgs) img.loading = "eager";
    await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
    await document.fonts.ready;
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  for (const { name, section } of IMAGES) {
    const box = await win.webContents.executeJavaScript(`(() => {
      // Whole pixels, a pixel inside the section: at 1.25x a fractional edge picks up a line of
      // whatever sits right above it, such as the hero window's border.
      const r = document.querySelector(${JSON.stringify(section)}).getBoundingClientRect();
      const top = Math.ceil(r.top + scrollY) + 1;
      return { x: 0, y: top, width: ${LAYOUT.width}, height: Math.floor(r.bottom + scrollY) - top };
    })()`);
    const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...box, scale: 1 } });
    const png = Buffer.from(data, "base64");
    writeFileSync(join(outDir, name), png);
    console.log(`[readme-images] wrote docs/screenshots/${name} (${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, ${Math.round(png.length / 1024)} KB)`);
  }
  server.close();
  app.exit(0);
}
