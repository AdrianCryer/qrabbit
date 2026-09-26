// Stages flat app screenshots as promo stills: each one framed as the real window, tilted in 3D
// and set on the app's own theme (see stage-page.mjs). Renders with Electron, no design tools needed.
//
// Usage: node tools/dev/stage-screenshots.mjs [raw-dir] [out-dir]
//   defaults: docs/screenshots/raw -> docs/screenshots
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openStage, stagePage } from "./stage-page.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const rawDir = resolve(process.argv[2] ?? join(repo, "docs", "screenshots", "raw"));
const outDir = resolve(process.argv[3] ?? join(repo, "docs", "screenshots"));

if (!process.versions.electron) {
  const electronBin = join(repo, "apps", "desktop", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url), rawDir, outDir], { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}

const { app, BrowserWindow } = await import("electron");
const CANVAS = { width: 1800, height: 1160 };
const ORDER = ["thread.png", "branch.png", "web-page.png", "web-maths.png"];
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

setTimeout(() => { console.error("stage-screenshots: timed out"); app.exit(2); }, 120_000).unref();

// Electron fires "ready" only after an ES-module entry finishes evaluating, so no top-level await on it.
app.whenReady().then(async () => {
  const files = readdirSync(rawDir).filter((f) => f.toLowerCase().endsWith(".png"));
  if (files.length === 0) throw new Error(`no PNG files in ${rawDir}`);
  files.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  mkdirSync(outDir, { recursive: true });
  const stage = await openStage(BrowserWindow, CANVAS);
  for (const [i, file] of files.entries()) {
    const buf = readFileSync(join(rawDir, file));
    // The window turns one way and then the other down the page.
    const html = stagePage({ canvas: CANVAS, shot: pngSize(buf), src: `data:image/png;base64,${buf.toString("base64")}`, tilt: i % 2 ? 12 : -12, scale: 0.92 });
    const jpg = await stage.capture(html);
    const out = join(outDir, basename(file, ".png") + ".jpg");
    writeFileSync(out, jpg);
    console.log(`staged ${file} -> ${out} (${Math.round(jpg.length / 1024)} KB)`);
  }
  app.exit(0);
}).catch((err) => { console.error("stage-screenshots:", err); app.exit(1); });
