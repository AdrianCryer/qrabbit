// Renders the app icon (the header's lime "Q" tile) with Electron itself and writes
// apps/desktop/resources/icon.svg, icon.png (512 px) and icon.ico (16 to 256 px, PNG entries).
// Usage: node tools/dev/make-icon.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const outDir = join(repo, "apps", "desktop", "resources");
const SIZE = 512;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect x="0" y="0" width="512" height="512" rx="112" fill="#c9f24d"/>
  <text x="256" y="278" text-anchor="middle" dominant-baseline="central"
        font-family="Inter, 'Segoe UI', system-ui, Arial, sans-serif" font-weight="700" font-size="340" fill="#101407">Q</text>
</svg>`;

if (!process.versions.electron) {
  // Re-run this file as an Electron app so it can rasterise the SVG with Chromium.
  const electronBin = join(repo, "apps", "desktop", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url)], { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}

const { app, BrowserWindow, nativeImage } = await import("electron");

/** An .ico container holding one PNG-compressed image per size. */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// Offscreen rendering draws with the software compositor; the GPU is neither needed nor, on this
// machine, reliable for a first paint. And never wait forever on a paint that does not come.
app.disableHardwareAcceleration();
setTimeout(() => { console.error("make-icon: timed out waiting for the page to render"); app.exit(2); }, 20_000).unref();
const step = (s) => console.error(`make-icon: ${s}`);
// Electron emits "ready" only after an ES-module entry has finished evaluating, so awaiting it at
// top level would wait forever; everything runs from the callback instead.
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, transparent: true, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(30);
  const html = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`;
  const painted = new Promise((r) => { win.webContents.once("paint", () => { step("paint"); setTimeout(r, 300); }); setTimeout(r, 3000); });
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  step("loaded");
  await painted;
  step("capturing");
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  step(`captured ${image.getSize().width}x${image.getSize().height}`);
  const corner = image.toBitmap().readUInt8(3); // alpha of the top-left pixel, outside the rounded corner
  if (corner !== 0) console.warn(`warning: the corner is not transparent (alpha ${corner})`);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "icon.svg"), svg);
  writeFileSync(join(outDir, "icon.png"), image.toPNG());
  const entries = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: image.resize({ width: size, height: size, quality: "best" }).toPNG() }));
  writeFileSync(join(outDir, "icon.ico"), ico(entries));
  console.log(`wrote ${outDir}: icon.svg, icon.png (${SIZE}px), icon.ico (${entries.map((e) => e.size).join(", ")})`);
  app.exit(0);
}).catch((err) => { console.error("make-icon:", err); app.exit(1); });

