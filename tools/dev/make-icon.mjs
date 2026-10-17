// Renders the app icon from one square SVG with Electron itself, drawing each size straight from the
// vector rather than shrinking one large bitmap, and writes every copy the repo ships:
//   apps/desktop/resources/icon.svg        the source, which a bare rerun reads
//   apps/desktop/resources/icon.png        1024 px: the macOS dock and the Linux window, and what
//                                          electron-builder makes the macOS .icns and Linux icons from
//   apps/desktop/resources/icon.ico        16 to 256 px: the Windows window, taskbar, executable and installer
//   apps/site/public/favicon.svg           the site's tab icon
//   apps/site/public/favicon.ico           16, 32 and 48 px, for browsers that skip SVG favicons
//   apps/site/public/apple-touch-icon.png  180 px, for home screens
// Given a second SVG, the mark (the tile with the glyph cut out, so the surface shows through), it also
// writes that to apps/desktop/resources/mark.svg and apps/site/public/mark.svg: the logo as the app's
// header and the site draw it on the theme's own surfaces. The icon keeps its solid glyph, since a
// taskbar, dock or tab bar may be light.
// Usage: node tools/dev/make-icon.mjs [icon.svg] [mark.svg]   (without any, it renders the current icon.svg again)
// Each SVG needs a square viewBox; its width and height do not matter, so an editor's "100%" is fine.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const desktopDir = join(repo, "apps", "desktop", "resources");
const siteDir = join(repo, "apps", "site", "public");

const PNG_SIZE = 1024;
const TOUCH_SIZE = 180;
/** What the Windows shell asks for: small icons at 100 to 250% scale, large ones, and Explorer's views. */
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const FAVICON_SIZES = [16, 32, 48];

if (!process.versions.electron) {
  // Re-run this file as an Electron app so it can rasterise the SVG with Chromium.
  const [icon = join(desktopDir, "icon.svg"), mark] = process.argv.slice(2);
  const electronBin = join(repo, "apps", "desktop", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url), ...[icon, mark].filter(Boolean).map((p) => resolve(p))], { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}

const { app, BrowserWindow } = await import("electron");
const [source, markSource] = process.argv.slice(2).filter((a) => !a.startsWith("--"));

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

/** Runs in the page: why the SVG cannot be used, or the warnings worth printing. */
function inspect(svgText) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const broken = doc.querySelector("parsererror");
  if (broken) return { error: `not well-formed XML: ${broken.textContent.trim().split("\n")[0]}` };
  const root = doc.documentElement;
  if (root.localName !== "svg") return { error: `the root element is <${root.localName}>, not <svg>` };
  const box = (root.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || box.some((n) => !Number.isFinite(n))) return { error: "it has no viewBox, so it cannot be scaled; export it with one" };
  const warnings = [];
  if (box[2] !== box[3]) warnings.push(`the viewBox is ${box[2]}x${box[3]}, not square, so it will be fitted inside each square size`);
  // A drawing that stops a hair short of the artboard leaves a faint transparent strip along that
  // edge of every size. Real padding is wider than this, and is left alone.
  const svg = document.importNode(root, true);
  document.body.append(svg);
  const b = svg.getBBox();
  svg.remove();
  const gaps = { left: b.x - box[0], top: b.y - box[1], right: box[0] + box[2] - (b.x + b.width), bottom: box[1] + box[3] - (b.y + b.height) };
  const slight = Object.entries(gaps).filter(([, g]) => g > box[2] * 0.001 && g < box[2] * 0.01);
  if (slight.length) {
    const fit = `${+b.x.toFixed(3)} ${+b.y.toFixed(3)} ${+b.width.toFixed(3)} ${+b.height.toFixed(3)}`;
    warnings.push(`the drawing stops ${slight.map(([side, g]) => `${+g.toFixed(2)} short of the ${side} edge`).join(" and ")} of the viewBox; trim the artboard to it (viewBox="${fit}")`);
  }
  return { warnings };
}

/**
 * Runs in the page: the SVG drawn at size x size, as a PNG data URL. The root's width and height are
 * set to the size first, so Chromium rasterises the vector at that size rather than scaling a bitmap.
 */
async function rasterise(svgText, size) {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  doc.documentElement.setAttribute("width", String(size));
  doc.documentElement.setAttribute("height", String(size));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("Chromium could not load the SVG"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d").drawImage(img, 0, 0, size, size);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const shown = (path) => (relative(repo, path).startsWith("..") ? path : relative(repo, path));

// Software rendering: the GPU is neither needed nor, on this machine, reliable. And never wait forever.
app.disableHardwareAcceleration();
setTimeout(() => { console.error("make-icon: timed out"); app.exit(2); }, 20_000).unref();
// Electron emits "ready" only after an ES-module entry has finished evaluating, so awaiting it at
// top level would wait forever; everything runs from the callback instead.
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL("data:text/html;charset=utf-8,<!doctype html>");
  const run = (fn, ...args) => win.webContents.executeJavaScript(`(${fn})(${args.map((a) => JSON.stringify(a)).join(", ")})`);

  const svgs = [[source, readFileSync(source, "utf8")], ...(markSource ? [[markSource, readFileSync(markSource, "utf8")]] : [])];
  for (const [path, text] of svgs) {
    const { error, warnings = [] } = await run(inspect, text);
    if (error) {
      console.error(`make-icon: ${shown(path)}: ${error}`);
      app.exit(1);
      return;
    }
    for (const w of warnings) console.warn(`make-icon: warning: ${shown(path)}: ${w}`);
  }
  const [[, svg], [, mark] = []] = svgs;

  const png = new Map();
  for (const size of new Set([PNG_SIZE, TOUCH_SIZE, ...ICO_SIZES, ...FAVICON_SIZES])) {
    const dataUrl = await run(rasterise, svg, size);
    png.set(size, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
  }
  const at = (sizes) => sizes.map((size) => ({ size, png: png.get(size) }));

  const outputs = [
    [join(desktopDir, "icon.svg"), svg],
    [join(desktopDir, "icon.png"), png.get(PNG_SIZE)],
    [join(desktopDir, "icon.ico"), ico(at(ICO_SIZES))],
    [join(siteDir, "favicon.svg"), svg],
    [join(siteDir, "favicon.ico"), ico(at(FAVICON_SIZES))],
    [join(siteDir, "apple-touch-icon.png"), png.get(TOUCH_SIZE)],
    ...(mark ? [[join(desktopDir, "mark.svg"), mark], [join(siteDir, "mark.svg"), mark]] : []),
  ];
  for (const [path, data] of outputs) writeFileSync(path, data);
  console.log(`make-icon: rendered ${svgs.map(([path]) => shown(path)).join(" and ")} to\n${outputs.map(([path]) => `  ${shown(path)}`).join("\n")}`);
  app.exit(0);
}).catch((err) => { console.error("make-icon:", err); app.exit(1); });
