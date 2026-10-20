#!/usr/bin/env node
// Renders the promo site's social preview, apps/site/public/og.jpg (1200x630), from the built site's own
// pieces: the wordmark from the nav, the hero's headline, the rabbit that peeks over the hero window, and
// the Qrabbit window from the lists section, on the theme's background (see stage-page.mjs).
//
// Usage: pnpm site:build && node tools/dev/make-og-image.mjs, then pnpm site:build again to ship it.
//   The window inside comes from make-site-shots.mjs; when the app changes, rerun that first.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const siteDist = join(repo, "apps", "site", "dist");
const out = join(repo, "apps", "site", "public", "og.jpg");
// Electron captures the frame here, and this script, back in Node, encodes it to `out`.
const capture = join(tmpdir(), "qrabbit-og-capture.png");
const electronBin = join(repo, "apps", "desktop", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");

const SIZE = { width: 1200, height: 630 };
const SUBTITLE = "Read PDFs and papers with AI, on the subscription you already have.";
// The window's place in the frame; the rabbit sits on its top edge, as it does in the hero.
const WIN = { left: 560, top: 330, width: 680 };
const RABBIT = { width: 78, left: 990 };

// Not awaited: Electron fires "ready" only after an ES-module entry finishes evaluating.
if (process.versions.electron) {
  render().catch((err) => { console.error("make-og-image:", err); process.exit(1); });
} else {
  if (!existsSync(join(siteDist, "index.html"))) {
    console.error("make-og-image: build the site first (pnpm site:build)");
    process.exit(1);
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url)], { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
  // A JPEG at a quality where nothing visibly changes, with full colour resolution so the lime headline keeps
  // clean edges, is about a quarter the size of the PNG (110 KB against 480 KB). Recompressing the PNG losslessly
  // barely helps, and a palette PNG dithers the glow.
  const { default: sharp } = await import("sharp");
  const jpeg = await sharp(readFileSync(capture)).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
  rmSync(capture);
  writeFileSync(out, jpeg);
  console.log(`[og-image] wrote apps/site/public/og.jpg (${SIZE.width}x${SIZE.height}, ${Math.round(jpeg.length / 1024)} KB)`);
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
  setTimeout(() => { console.error("make-og-image: timed out"); app.exit(2); }, 120_000).unref();
  await app.whenReady();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;

  // Offscreen, and a blank page loaded before the debugger attaches (see openStage in stage-page.mjs).
  const win = new BrowserWindow({ width: 800, height: 600, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL("about:blank");
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { ...SIZE, deviceScaleFactor: 1, mobile: false });
  await win.loadURL(url);

  // The pieces keep their components' scoped styles; only their place in the frame is set here.
  const rabbitHeight = (RABBIT.width * 132) / 160;
  const rabbitTop = WIN.top + (RABBIT.width * 12) / 160 - rabbitHeight;
  await win.webContents.insertCSS(`
    body::after { display: none !important; }
    .reveal { opacity: 1 !important; transform: none !important; transition: none !important; }
    .og { position: fixed; inset: 0; width: ${SIZE.width}px; height: ${SIZE.height}px; overflow: hidden; background: ${THEME_BACKGROUND}; }
    .og-brand { position: absolute; left: 72px; top: 64px; gap: 12px !important; font-size: 26px !important; }
    .og-brand .logo { width: 38px !important; margin-top: -11px !important; }
    .og-title { position: absolute; left: 72px; top: 158px; margin: 0; max-width: none !important; font-size: 64px !important; }
    .og-title em { display: block; }
    .og-sub { position: absolute; left: 72px; top: 318px; width: 340px; margin: 0; font-size: 24px; line-height: 1.5; color: var(--text-2); text-wrap: balance; }
    .og-win { position: absolute !important; left: ${WIN.left}px; top: ${WIN.top}px; width: ${WIN.width}px !important; margin: 0 !important; }
    .og-rabbit { position: absolute; z-index: 2; left: ${RABBIT.left}px; top: ${rabbitTop}px; width: ${RABBIT.width}px; height: auto; filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.35)); }`);
  await win.webContents.executeJavaScript(`(async () => {
    const pick = (sel, cls) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error("the site has no " + sel);
      const copy = el.cloneNode(true);
      copy.classList.add(cls);
      return copy;
    };
    const frame = document.createElement("div");
    frame.className = "og";
    const sub = document.createElement("p");
    sub.className = "og-sub";
    sub.textContent = ${JSON.stringify(SUBTITLE)};
    const win = pick("#lists .appwin", "og-win");
    // Drawn ${WIN.width}px wide here, whatever the lists section asked for.
    for (const el of win.querySelectorAll("img, source")) el.sizes = "${WIN.width * 2}px";
    frame.append(pick(".nav .brand", "og-brand"), pick(".hero .display", "og-title"), sub, pick(".hero .peeker", "og-rabbit"), win);
    document.body.replaceChildren(frame);
    const imgs = [...document.images];
    for (const img of imgs) img.loading = "eager";
    await Promise.all(imgs.map((img) => img.decode().catch(() => {})));
    await document.fonts.ready;
  })()`);
  await new Promise((r) => setTimeout(r, 400));

  const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, ...SIZE, scale: 1 } });
  writeFileSync(capture, Buffer.from(data, "base64"));
  server.close();
  app.exit(0);
}
