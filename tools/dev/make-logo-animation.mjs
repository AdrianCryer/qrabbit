#!/usr/bin/env node
// Renders the logo animation: a line of Alice's Adventures in Wonderland with "rabbit-hole"
// highlighted in the accent, the highlight folding into the app's lime tile, the Q written onto it,
// then a fall through the Q's counter, where a smaller Q waits inside every Q, each a quarter turn
// round from the last, landing on the tile again as it opens into the wordmark. Nothing but the
// app's theme: its near-black surfaces, its text greys and the one lime accent.
//
// Every frame is a pure function of time: the page drawn by logoPage() shows moment t on request and
// Electron captures it offscreen, as record-demo.mjs frames its takes. Each video frame averages a
// few captures spread over half a frame's time, so the fall is motion-blurred rather than strobing.
//
// Usage: node tools/dev/make-logo-animation.mjs [out-dir] [--preview] [--stills=1.2,3.4]
//   Writes logo.mp4 (1920x1080, 60 fps, ends on the lockup) and logo.webp (960x540, 30 fps, loops
//   through a short fade back to the background) in out-dir, by default tools/dev/out/logo.
//   --preview  half size, 30 fps, no motion blur: a quick look at the timing, as preview.mp4.
//   --stills   PNGs of the given moments in seconds, for checking single frames.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_BACKGROUND } from "./stage-page.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const electronBin = join(repo, "apps", "desktop", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");

const CANVAS = { width: 1920, height: 1080 };
const FPS = 60;
/**
 * Captures averaged into each frame, spread over half a frame's time (a 180° shutter): many through
 * the fall, where the camera moves every pixel and five left visible steps along the fastest edges,
 * a few for the gentler moves, and one on the holds. Each row is [from, to, captures] in seconds.
 */
const SAMPLES = [[0, 0.1, 1], [0.1, 3.25, 4], [3.25, 5.6, 12], [5.6, 7.0, 4], [7.0, Infinity, 1]];
const SHUTTER = 0.5;
/** The MP4 ends here, on the lockup; the WebP carries on through a fade to the background so its loop is seamless. */
const END = 8.2;
const OUTRO = 0.6;

if (process.versions.electron) {
  const { app, BrowserWindow, nativeImage } = await import("electron");
  const job = JSON.parse(readFileSync(process.argv.at(-1), "utf8"));
  // Offscreen capture draws with the software compositor, as make-icon.mjs does; the GPU adds nothing here.
  app.disableHardwareAcceleration();
  setTimeout(() => { console.error("make-logo-animation: timed out"); app.exit(2); }, 1_800_000).unref();
  // Electron emits "ready" only after an ES-module entry has finished evaluating, so nothing awaits it at top level.
  app.whenReady()
    .then(() => film(BrowserWindow, nativeImage, job))
    .then(() => app.exit(0), (err) => { console.error("make-logo-animation:", err); app.exit(1); });
} else {
  main();
}

function main() {
  const args = process.argv.slice(2);
  const outDir = resolve(args.find((a) => !a.startsWith("--")) ?? join(here, "out", "logo"));
  const stills = args.find((a) => a.startsWith("--stills="))?.slice(9).split(",").map(Number) ?? null;
  const job = { outDir, preview: args.includes("--preview"), stills, ffmpeg: createRequire(import.meta.url)("ffmpeg-static") };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "logo.html"), logoPage());
  writeFileSync(join(outDir, "job.json"), JSON.stringify(job));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url), join(outDir, "job.json")], { stdio: "inherit", env });
  if (r.status !== 0) process.exit(r.status ?? 1);
  const kb = (f) => `${Math.round(statSync(join(outDir, f)).size / 1024)} KB`;
  if (stills) console.log(`[logo] wrote ${stills.length} stills to ${outDir}`);
  else if (job.preview) console.log(`[logo] wrote ${join(outDir, "preview.mp4")} (${kb("preview.mp4")})`);
  else console.log(`[logo] wrote ${join(outDir, "logo.mp4")} (${kb("logo.mp4")}) and logo.webp (${kb("logo.webp")})`);
}

/** Runs inside Electron: opens the page offscreen at canvas size and captures each moment into ffmpeg. */
async function film(BrowserWindow, nativeImage, job) {
  const win = new BrowserWindow({ width: 800, height: 600, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(60);
  await win.loadFile(join(job.outDir, "logo.html"));
  // A window cannot be larger than the display, so the canvas size is emulated (see stage-page.mjs).
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { ...CANVAS, deviceScaleFactor: 1, mobile: false });
  await win.webContents.executeJavaScript("window.ready()");
  const scale = job.preview ? 0.5 : 1;
  const shoot = async (t, format = "jpeg") => {
    await win.webContents.executeJavaScript(`window.draw(${t})`);
    const params = { format, captureBeyondViewport: true, clip: { x: 0, y: 0, ...CANVAS, scale } };
    if (format === "jpeg") params.quality = 95;
    const { data } = await cdp.sendCommand("Page.captureScreenshot", params);
    return Buffer.from(data, "base64");
  };

  if (job.stills) {
    for (const t of job.stills) writeFileSync(join(job.outDir, `still-${t.toFixed(2)}.png`), await shoot(t, "png"));
    return;
  }

  const fps = job.preview ? 30 : FPS;
  const size = `${CANVAS.width * scale}x${CANVAS.height * scale}`;
  // Frames go to ffmpeg raw: the captures for each are decoded and averaged here, however many it has.
  const input = ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgra", "-s", size, "-framerate", String(fps), "-i", "-"];
  const frames = Math.round((END + OUTRO) * fps) + 1;
  // Each encoder takes frames up to its own end: the MP4 stops on the lockup, the WebP runs on
  // through the fade. (Trimming with -t instead makes ffmpeg close its input while frames still come.)
  const encoders = job.preview
    ? [{ frames, args: [...input, "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "fast", join(job.outDir, "preview.mp4")] }]
    : [
        // As in record-demo.mjs: aq-mode 3 spends more bits on the dark, flat background, which otherwise turns blocky.
        { frames: Math.round(END * fps), args: [...input, "-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-x264-params", "aq-mode=3", "-movflags", "+faststart", join(job.outDir, "logo.mp4")] },
        { frames, args: [...input, "-vf", "fps=30,scale=960:-2:flags=lanczos", "-c:v", "libwebp_anim", "-quality", "88", "-compression_level", "6", "-loop", "0", join(job.outDir, "logo.webp")] },
      ];
  const procs = encoders.map(({ frames, args }) => {
    const p = spawn(job.ffmpeg, args, { stdio: ["pipe", "inherit", "inherit"] });
    p.frames = frames;
    p.done = new Promise((ok, fail) => p.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`)))));
    return p;
  });
  const write = (p, buf) => new Promise((ok, fail) => p.stdin.write(buf, (err) => (err ? fail(err) : ok())));

  /** Frame f as raw BGRA: one capture, or the mean of several across the shutter. */
  let sum = null;
  const frameAt = async (f) => {
    const t = f / fps;
    const n = job.preview ? 1 : SAMPLES.find(([a, b]) => t >= a && t < b)[2];
    for (let i = 0; i < n; i++) {
      const at = n > 1 ? t + (i / (n - 1) - 0.5) * (SHUTTER / fps) : t;
      const bgra = nativeImage.createFromBuffer(await shoot(Math.max(0, at))).toBitmap();
      if (n === 1) return bgra;
      sum ??= new Uint32Array(bgra.length);
      for (let j = 0; j < bgra.length; j++) sum[j] += bgra[j];
    }
    const mean = Buffer.allocUnsafe(sum.length);
    for (let j = 0; j < sum.length; j++) mean[j] = Math.round(sum[j] / n);
    sum.fill(0);
    return mean;
  };

  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    for (const p of procs) if (f === p.frames) p.stdin.end();
    const frame = await frameAt(f);
    await Promise.all(procs.filter((p) => f < p.frames).map((p) => write(p, frame)));
    if (f % 60 === 59) console.log(`[logo] ${f + 1} of ${frames} frames (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  for (const p of procs) if (p.stdin.writable) p.stdin.end();
  console.log("[logo] captured every frame; encoding…");
  await Promise.all(procs.map((p) => p.done));
}

/** The animation as a page: `ready()` lays it out once, and `draw(t)` shows moment t (in seconds). */
function logoPage() {
  const { width: W, height: H } = CANVAS;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #121417; }
  #bg, #veil, #fade { position: absolute; inset: 0; background: ${THEME_BACKGROUND}; }
  #veil { display: none; }
  #fade { opacity: 0; }
  #glow { position: absolute; left: 0; top: 0; width: 1100px; height: 1100px; margin: -550px 0 0 -550px; border-radius: 50%; opacity: 0;
    background: radial-gradient(closest-side, rgba(201, 242, 77, 0.17), rgba(201, 242, 77, 0.06) 42%, rgba(201, 242, 77, 0) 100%); }
  svg.layer { position: absolute; left: 0; top: 0; overflow: visible; }
  .passage { position: absolute; width: 1160px; font-family: "STIX Two Text", Georgia, "Times New Roman", serif; font-size: 46px; line-height: 1.62; color: #a3a8b0; }
  .passage p { margin: 0; }
  .passage .w { display: inline-block; }
  .passage .src { font-family: "JetBrains Mono", ui-monospace, Consolas, monospace; font-size: 17px; line-height: 1; letter-spacing: 0.06em; text-transform: uppercase; color: #6e747d; margin-bottom: 34px; width: max-content; }
  #hi { position: absolute; inset: 0; }
  #passage2 .w, #passage2 .src { visibility: hidden; }
  #passage2 .w.ph { visibility: visible; color: #101407; }
  #ibeam { position: absolute; left: 0; top: 0; opacity: 0; }
  .ui { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; }
</style></head><body>
  <div id="bg"></div>
  <div id="glow"></div>
  <div id="passage" class="passage"></div>
  <svg id="world" class="layer" width="${W}" height="${H}">
    <defs>
      <!-- The Q exactly as make-icon.mjs draws it, in the icon's 512 units. -->
      <text id="qglyph" x="256" y="278" text-anchor="middle" dominant-baseline="central"
        font-family="Inter, 'Segoe UI', system-ui, Arial, sans-serif" font-weight="700" font-size="340" fill="#101407">Q</text>
      <!-- Writes the Q: a sector sweeping round the ring, then a band drawn out along the tail. -->
      <mask id="qmask" maskUnits="userSpaceOnUse" x="-200" y="-200" width="912" height="912">
        <path id="qsector" fill="#fff"/>
        <rect id="qtail" fill="#fff" x="100" y="-25" width="0" height="115" transform="translate(255.5 299.5) rotate(45)"/>
      </mask>
    </defs>
    <rect id="tile" fill="#c9f24d"/>
    <use id="q0" href="#qglyph"/>
    <g id="kids"></g>
  </svg>
  <div id="hi"><div id="passage2" class="passage"></div></div>
  <svg id="ibeam" width="20" height="66" viewBox="0 0 20 66">
    <path d="M4 2Q10 2 10 8V58Q10 64 4 64M16 2Q10 2 10 8V58Q10 64 16 64" fill="none" stroke="#0c0e11" stroke-width="5" stroke-linecap="round"/>
    <path d="M4 2Q10 2 10 8V58Q10 64 4 64M16 2Q10 2 10 8V58Q10 64 16 64" fill="none" stroke="#e9ebee" stroke-width="2.2" stroke-linecap="round"/>
  </svg>
  <div id="veil"></div>
  <svg id="type" class="layer ui" width="${W}" height="${H}">
    <defs><clipPath id="reveal"><rect id="revealRect" x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>
    <text id="wordFull" font-size="136" font-weight="600" letter-spacing="-2.7" visibility="hidden">QRabbit</text>
    <g clip-path="url(#reveal)">
      <g id="letters" font-size="136" font-weight="600" fill="#e9ebee"></g>
      <text id="tag" font-size="34" fill="#a3a8b0" opacity="0">Read difficult material with AI.</text>
    </g>
  </svg>
  <div id="fade"></div>
<script>
const W = ${W}, H = ${H}, O = { x: W / 2, y: H / 2 };
const END = ${END}, OUTRO = ${OUTRO};
// The icon in its own 512 units (make-icon.mjs): the tile's centre and corner radius, and the centre
// of the Q's counter, measured from icon.png (the counter spans x 196-315, y 223-376; the ring's
// inner radius is 60 to 78, its outer 115 to 123).
const TILE_C = { x: 256, y: 256 }, RX = 112 / 512, C = { x: 255.5, y: 299.5 };
const COUNTER = 60, RING = 123;
/** Each Q's counter holds the next Q at this size, turned this far; the fall goes this many deep. */
const NEST = 4, TURN = Math.PI / 2, DEPTH = 4;
/** The tile's size while it is written and fallen into, and in the lockup beside the wordmark. */
const T = 320, T_LOCK = 204, GAP = 60, TAG_GAP = 70;
const PASSAGE = "In another moment down went Alice after it, never once considering how in the world she was to get out again. The [rabbit-hole] went straight on like a tunnel for some way, and then dipped suddenly down\\u2026";
const SOURCE = "Alice\\u2019s Adventures in Wonderland \\u00b7 Chapter I";

/** When each beat happens, in seconds. */
const AT = {
  textIn: [0.1, 0.7], beamIn: [0.42, 0.58], sweep: [0.6, 1.14], beamOut: [1.2, 1.36],
  fall: 1.34, morph: 1.55, ring: [2.18, 2.66], tail: [2.62, 2.78],
  kids: [3.12, 3.48], dive: [3.3, 5.4], land: [4.95, 5.4], parentsOut: [4.8, 5.2], kidsOut: [4.9, 5.3],
  lockup: [5.62, 6.42], letters: 5.8, tag: [6.34, 6.9],
};
const LANDED = AT.dive[1];

const $ = (id) => document.getElementById(id);
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const seg = (t, [a, b]) => clamp((t - a) / (b - a));
const mix = (a, b, p) => a + (b - a) * p;
const inOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const out = (p) => 1 - (1 - p) ** 3;
const easeIn = (p) => p * p * p;
const sine = (p) => (1 - Math.cos(Math.PI * p)) / 2;
const back = (p) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
/** A damped spring from 0 to 1, s seconds after release: it overshoots a little and settles. */
const spring = (s, hz = 2.2, zeta = 0.62) => {
  if (s <= 0) return 0;
  const w = 2 * Math.PI * hz, wd = w * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w * s) * (Math.cos(wd * s) + ((zeta * w) / wd) * Math.sin(wd * s));
};
/** A knock that dies away: nothing at the moment of impact, then up, a little under, and still. */
const knock = (s) => (s <= 0 ? 0 : Math.sin(2 * Math.PI * 2.4 * s) * Math.exp(-7 * s));
const attrs = (el, a) => { for (const k in a) el.setAttribute(k, a[k]); };

/** A rounded rectangle centred on (cx, cy), turned by phi, as path data. */
function rrect(cx, cy, w, h, r, phi) {
  const cs = Math.cos(phi), sn = Math.sin(phi);
  const pt = (x, y) => (cx + x * cs - y * sn).toFixed(2) + " " + (cy + x * sn + y * cs).toFixed(2);
  const arc = (x, y) => "A" + r.toFixed(2) + " " + r.toFixed(2) + " 0 0 1 " + pt(x, y);
  const a = w / 2, b = h / 2;
  return "M" + pt(-a + r, -b) + "L" + pt(a - r, -b) + arc(a, -b + r) + "L" + pt(a, b - r) + arc(a - r, b)
    + "L" + pt(-a + r, b) + arc(-a, b - r) + "L" + pt(-a, -b + r) + arc(-a + r, -b) + "Z";
}

function fill(el) {
  const src = document.createElement("div");
  src.className = "src";
  src.textContent = SOURCE;
  const p = document.createElement("p");
  PASSAGE.split(" ").forEach((word, i) => {
    if (i) p.append(" ");
    const span = document.createElement("span");
    span.className = word.startsWith("[") ? "w ph" : "w";
    span.textContent = word.replace(/[\\[\\]]/g, "");
    p.append(span);
  });
  el.append(src, p);
}

let words, phrase, kids, lock, letters;
window.ready = async () => {
  await document.fonts.ready;
  const pa = $("passage"), pb = $("passage2");
  fill(pa);
  fill(pb);
  const left = (W - pa.offsetWidth) / 2, top = (H - pa.offsetHeight) / 2;
  phrase = pa.querySelector(".ph");
  const pc = { x: phrase.offsetLeft + phrase.offsetWidth / 2, y: phrase.offsetTop + phrase.offsetHeight / 2 };
  for (const el of [pa, pb]) Object.assign(el.style, { left: left + "px", top: top + "px", transformOrigin: pc.x + "px " + pc.y + "px" });
  // Everything but the highlight is drawn in towards it, the farthest words first.
  words = [...pa.querySelectorAll(".w:not(.ph), .src")].map((el) => {
    const dx = pc.x - (el.offsetLeft + el.offsetWidth / 2), dy = pc.y - (el.offsetTop + el.offsetHeight / 2);
    return { el, dx, dy, d: Math.hypot(dx, dy) };
  });
  const far = Math.max(...words.map((w) => w.d));
  for (const w of words) w.delay = (1 - w.d / far) * 0.3;

  kids = [];
  for (let k = 1; k <= DEPTH + 2; k++) {
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#qglyph");
    $("kids").append(use);
    kids.push(use);
  }

  // The lockup: tile, gap, wordmark, centred as a group; the wordmark's cap height and the tagline
  // below it are centred on the tile. Each letter is its own text at its place in the whole word, so
  // kerning survives while the letters move one by one.
  const full = $("wordFull");
  const n = full.textContent.length;
  const starts = [...Array(n).keys()].map((i) => full.getStartPositionOfChar(i).x);
  const wordW = full.getEndPositionOfChar(n - 1).x;
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = "600 136px " + getComputedStyle($("type")).fontFamily;
  const cap = ctx.measureText("R").actualBoundingBoxAscent;
  const x0 = (W - (T_LOCK + GAP + wordW)) / 2;
  lock = { x: x0 + T_LOCK / 2, y: O.y, word: x0 + T_LOCK + GAP };
  const base = lock.y - (cap + TAG_GAP) / 2 + cap;
  letters = [...full.textContent].map((ch, i) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
    attrs(el, { x: lock.word + starts[i], y: base });
    el.textContent = ch;
    $("letters").append(el);
    return el;
  });
  attrs($("tag"), { x: lock.word + 3, y: base + TAG_GAP });
  return true;
};

window.draw = async (t) => {
  // ----- the passage, pushed in slowly, and the highlight dragged across "rabbit-hole" -----
  const push = 1 + 0.045 * out(seg(t, [0, 2.3]));
  const shown = inOut(seg(t, AT.textIn));
  for (const el of [$("passage"), $("passage2")]) Object.assign(el.style, { transform: "scale(" + push + ")", opacity: shown });
  for (const w of words) {
    const p = clamp((t - AT.fall - w.delay) / 0.42);
    const pull = easeIn(p);
    w.el.style.opacity = 1 - inOut(p);
    w.el.style.transform = p ? "translate(" + (w.dx * 0.32 * pull).toFixed(2) + "px," + (w.dy * 0.32 * pull).toFixed(2) + "px) scale(" + (1 - 0.18 * pull).toFixed(4) + ")" : "";
    w.el.style.filter = p ? "blur(" + (6 * pull).toFixed(2) + "px)" : "";
  }
  phrase.style.opacity = t < AT.sweep[1] ? 1 : 0;

  const r = phrase.getBoundingClientRect();
  const hl = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width + 16 * push, h: 1.3 * 46 * push, r: 7 * push };
  const swept = inOut(seg(t, AT.sweep));
  const edge = hl.cx - hl.w / 2 + hl.w * swept;
  const beam = inOut(seg(t, AT.beamIn)) * (1 - inOut(seg(t, AT.beamOut)));
  Object.assign($("ibeam").style, { opacity: beam, transform: "translate(" + (edge - 10).toFixed(2) + "px," + (hl.cy - 33).toFixed(2) + "px)" });

  // ----- the highlight folds into the tile: it springs square while it travels to the centre -----
  let bar;
  if (t < AT.morph) {
    const w = hl.w * swept;
    bar = { cx: hl.cx - hl.w / 2 + w / 2, cy: hl.cy, w, h: hl.h, r: Math.min(hl.r, w / 2) };
  } else {
    // It sets off as a bar and only then springs square, so the fold reads as the highlight's own.
    const s = t - AT.morph, p = inOut(clamp(s / 0.6));
    const w = mix(hl.w, T, spring(s - 0.16)), h = mix(hl.h, T, spring(s - 0.21));
    bar = { cx: mix(hl.cx, O.x, p), cy: mix(hl.cy, O.y, p), w, h, r: mix(hl.r, RX * Math.min(w, h), p) };
  }
  let P = { x: bar.cx, y: bar.cy };
  let knocked = 1 + 0.05 * knock(t - AT.tail[1]);
  if (t >= LANDED) {
    // Landed: the tile knocks once more, then steps aside for the wordmark.
    const e = inOut(seg(t, AT.lockup));
    const size = mix(T, T_LOCK, e);
    P = { x: mix(O.x, lock.x, e), y: mix(O.y, lock.y, e) };
    bar = { cx: P.x, cy: P.y, w: size, h: size, r: RX * size };
    knocked = 1 + 0.045 * knock(t - LANDED);
  }
  const S = Math.sqrt(bar.w * bar.h) * knocked;
  const $hi = $("hi");
  $hi.style.opacity = 1 - seg(t, [AT.morph, AT.morph + 0.14]);
  $hi.style.clipPath = "inset(" + [bar.cy - bar.h / 2, W - bar.cx - bar.w / 2, H - bar.cy - bar.h / 2, bar.cx - bar.w / 2].map((v) => v.toFixed(2) + "px").join(" ") + " round " + bar.r.toFixed(2) + "px)";

  // ----- the fall: the camera zooms into the counter, turning so that each Q lands upright -----
  const u = seg(t, AT.dive);
  const L = t >= LANDED ? 0 : DEPTH * sine(u) - (u < 0.2 ? 0.07 * Math.sin((Math.PI * u) / 0.2) : 0);
  const s0 = S / 512;
  const Pc = { x: P.x + s0 * (C.x - TILE_C.x), y: P.y + s0 * (C.y - TILE_C.y) };
  const reach = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - Pc.x, y - Pc.y)));
  /** Where level k sits: level 0 is the tile's own Q, level k is nested k counters deep. */
  const level = (k, a = 1) => {
    const sig = s0 * Math.pow(NEST, L - k) * a, phi = (k - L) * TURN;
    const cs = sig * Math.cos(phi), sn = sig * Math.sin(phi);
    return { sig, phi, m: "matrix(" + [cs, sn, -sn, cs, Pc.x - (cs * C.x - sn * C.y), Pc.y - (sn * C.x + cs * C.y)].map((v) => v.toFixed(5)).join(" ") + ")" };
  };
  // A Q can be skipped once its counter is wider than the frame, or while it is smaller than a pixel.
  const inView = (lv) => COUNTER * lv.sig < reach && RING * lv.sig > 0.4;
  // On landing the Qs already fallen through rush outward, past the landed tile's corners, rather
  // than fading: a dark ring faded over the lime would be a colour the theme does not have.
  const parents = 1 + 2.5 * inOut(seg(t, AT.parentsOut));

  const tile = $("tile"), l0 = level(0);
  if (bar.w < 0.5) tile.setAttribute("display", "none");
  else if (l0.sig > 6) attrs(tile, { display: "inline", x: 0, y: 0, width: W, height: H, rx: 0, transform: "" });
  else {
    const w = (bar.w * knocked) / s0, h = (bar.h * knocked) / s0;
    attrs(tile, { display: "inline", x: 256 - w / 2, y: 256 - h / 2, width: w, height: h, rx: (bar.r * knocked) / s0, transform: l0.m });
  }

  // The tile's own Q, written with the mask and then drawn plainly.
  const q0 = $("q0"), g0 = t >= LANDED ? l0 : level(0, parents), ring = inOut(seg(t, AT.ring)), tail = out(seg(t, AT.tail));
  if (t < AT.ring[0] || !inView(g0)) q0.setAttribute("display", "none");
  else {
    attrs(q0, { display: "inline", transform: g0.m });
    if (tail >= 1) q0.removeAttribute("mask");
    else {
      q0.setAttribute("mask", "url(#qmask)");
      const R = 140, a0 = -Math.PI / 2, a1 = a0 - 2 * Math.PI * ring;
      $("qsector").setAttribute("d", ring >= 1 ? "M-200 -200H712V712H-200Z" : ring <= 0 ? "" :
        "M" + C.x + " " + C.y + "L" + (C.x + R * Math.cos(a0)) + " " + (C.y + R * Math.sin(a0)) +
        "A" + R + " " + R + " 0 " + (ring > 0.5 ? 1 : 0) + " 0 " + (C.x + R * Math.cos(a1)).toFixed(3) + " " + (C.y + R * Math.sin(a1)).toFixed(3) + "Z");
      $("qtail").setAttribute("width", 115 * tail);
    }
  }

  // The Qs inside it: they pop into the counter, the camera falls through them, and the ones below
  // the landing shrink away so the landed Q's counter is empty again, like the icon's.
  const grown = t >= LANDED ? 0 : back(seg(t, AT.kids));
  kids.forEach((use, i) => {
    const k = i + 1;
    const a = grown * (k > DEPTH ? 1 - easeIn(seg(t, AT.kidsOut)) : k < DEPTH ? parents : 1);
    const lv = level(k, a);
    if (a <= 0 || !inView(lv)) return use.setAttribute("display", "none");
    attrs(use, { display: "inline", transform: lv.m });
  });

  // Landing: the background closes in round the landed tile, from past the corners of the frame.
  const veil = $("veil");
  if (t >= AT.land[0] && t < LANDED) {
    const lv = level(DEPTH), vx = TILE_C.x - C.x, vy = TILE_C.y - C.y;
    const cx = Pc.x + lv.sig * (Math.cos(lv.phi) * vx - Math.sin(lv.phi) * vy);
    const cy = Pc.y + lv.sig * (Math.sin(lv.phi) * vx + Math.cos(lv.phi) * vy);
    const f = Math.pow(24, 1 - inOut(seg(t, AT.land)));
    veil.style.display = "block";
    veil.style.clipPath = "path(evenodd, 'M0 0H" + W + "V" + H + "H0Z " + rrect(cx, cy, 512 * lv.sig * f, 512 * lv.sig * f, 112 * lv.sig * f, lv.phi) + "')";
  } else veil.style.display = "none";

  // The accent's glow behind the tile: up as the Q is written, gone for the fall, back with a flash on landing.
  const glow = t >= LANDED
    ? mix(0, 1, out(seg(t, [LANDED, LANDED + 0.14]))) - 0.35 * inOut(seg(t, [LANDED + 0.14, LANDED + 1]))
    : 0.65 * inOut(seg(t, [AT.ring[0], AT.tail[1] + 0.2])) * (1 - inOut(seg(t, [AT.dive[0], AT.dive[0] + 0.3])));
  Object.assign($("glow").style, { opacity: glow.toFixed(3), transform: "translate(" + P.x.toFixed(2) + "px," + P.y.toFixed(2) + "px) scale(" + (S / T).toFixed(4) + ")" });

  // ----- the wordmark slides out from behind the tile, then the tagline -----
  $("type").style.display = t >= LANDED ? "block" : "none";
  if (t >= LANDED) {
    $("revealRect").setAttribute("x", (P.x + S / 2 + 6).toFixed(2));
    letters.forEach((el, i) => {
      const s = t - AT.letters - i * 0.045;
      el.setAttribute("transform", "translate(" + (-80 * (1 - out(clamp(s / 0.6)))).toFixed(2) + " 0)");
      el.setAttribute("opacity", clamp(s / 0.3).toFixed(3));
    });
    const tg = out(seg(t, AT.tag));
    attrs($("tag"), { opacity: tg.toFixed(3), transform: "translate(0 " + (14 * (1 - tg)).toFixed(2) + ")" });
  }
  $("fade").style.opacity = inOut(seg(t, [END, END + OUTRO])).toFixed(3);

  await new Promise((r) => requestAnimationFrame(() => r()));
  return true;
};
</script>
</body></html>`;
}
