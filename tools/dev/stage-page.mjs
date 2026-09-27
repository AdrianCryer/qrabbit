// The staging page shared by stage-screenshots.mjs (stills) and record-demo.mjs (the animation):
// an app screenshot framed as the real window on a background taken from the app's own theme.

/**
 * The app's theme, not a new palette: its near-black surfaces (--bg #121417, --sunken #0c0e11)
 * lit by a single soft glow of its one accent (--accent #c9f24d), as the header's lime tile is
 * the one spot of colour in the app itself.
 */
export const THEME_BACKGROUND = [
  // A faint static grain over the gradient: a smooth dark gradient bands in 8-bit images and
  // turns blocky in video, and a little noise breaks that up without being visible as texture.
  `url("data:image/svg+xml;utf8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.045 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>")}")`,
  "radial-gradient(ellipse 65% 55% at 50% -8%, rgba(201, 242, 77, 0.16), rgba(201, 242, 77, 0.04) 45%, transparent 72%)",
  "linear-gradient(180deg, #15181c 0%, #121417 45%, #0c0e11 100%)",
].join(", ");

/** Styles for `windowHtml`: the app window's frame (corners, hairline border, caption buttons). */
export const WINDOW_CSS = `
  .appwin { position: relative; border-radius: 10px; overflow: hidden; background: #121417;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.09), 0 40px 90px rgba(0, 0, 0, 0.55), 0 14px 30px rgba(0, 0, 0, 0.35); }
  .appwin > img { display: block; width: 100%; height: 100%; }
  .appwin .caption { position: absolute; top: 0; right: 0; display: flex; }
  .appwin .caption span { display: grid; place-items: center; }
  .appwin .caption svg { stroke: #a3a8b0; stroke-width: 1; fill: none; shape-rendering: crispEdges; }`;

/**
 * A screenshot framed as the app window, `width` CSS pixels wide. `scale` is the window's scale
 * relative to the app's own 1280-pixel layout, so the caption buttons match the header's size.
 */
export function windowHtml(src, width, height, style = "") {
  const k = width / 1280;
  const cap = `height:${44 * k}px`;
  const btn = `width:${46 * k}px;height:${44 * k}px`;
  const svg = `width:${10 * k}px;height:${10 * k}px`;
  return `<div class="appwin" style="width:${width}px;height:${height}px;${style}">
    <img src="${src}" alt="">
    <div class="caption" style="${cap}">
      <span style="${btn}"><svg viewBox="0 0 10 10" style="${svg}"><path d="M0 5.5h10"/></svg></span>
      <span style="${btn}"><svg viewBox="0 0 10 10" style="${svg}"><rect x="0.5" y="0.5" width="9" height="9"/></svg></span>
      <span style="${btn}"><svg viewBox="0 0 10 10" style="${svg};shape-rendering:geometricPrecision"><path d="M0 0l10 10M10 0L0 10"/></svg></span>
    </div>
  </div>`;
}

/**
 * A full HTML page: the screenshot as the app window (Windows 11 corners, caption buttons, a hairline
 * border and a soft shadow) centred on the theme background.
 *
 * @param {object} o
 * @param {{width: number, height: number}} o.canvas  page size
 * @param {{width: number, height: number}} o.shot    screenshot size in CSS pixels
 * @param {string} o.src      image URL or data URI of the screenshot
 * @param {number} [o.tilt]   0 for a flat window; otherwise the turn in degrees (sign picks the side)
 * @param {number} [o.scale]  window scale on the canvas
 */
export function stagePage({ canvas, shot, src, tilt = 0, scale = 1 }) {
  const turn = Math.sign(tilt) || 1;
  const transform = tilt
    ? `rotateY(${tilt}deg) rotateX(7deg) rotateZ(${(-1.2 * turn).toFixed(2)}deg) scale(${scale})`
    : `scale(${scale})`;
  const shadowX = tilt ? -36 * turn : 0;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${canvas.width}px; height: ${canvas.height}px; overflow: hidden; }
  body { background: ${THEME_BACKGROUND}; display: grid; place-items: center; }
  .stage { perspective: 3200px; perspective-origin: 50% 40%; }
  .win {
    position: relative; width: ${shot.width}px; height: ${shot.height}px; border-radius: 10px; overflow: hidden;
    transform: ${transform}; transform-style: preserve-3d;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.09), ${shadowX}px 50px 110px rgba(0, 0, 0, 0.6), ${shadowX / 3}px 18px 36px rgba(0, 0, 0, 0.4);
  }
  .win img { display: block; width: 100%; height: 100%; }
  /* The window's caption buttons, which a page screenshot leaves out (title bar overlay, 44 px). */
  .caption { position: absolute; top: 0; right: 0; height: 44px; display: flex; }
  .caption span { width: 46px; height: 44px; display: grid; place-items: center; }
  .caption svg { width: 10px; height: 10px; stroke: #a3a8b0; stroke-width: 1; fill: none; shape-rendering: crispEdges; }
</style></head><body>
  <div class="stage"><div class="win">
    <img id="shot" src="${src}">
    <div class="caption">
      <span><svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg></span>
      <span><svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg></span>
      <span><svg viewBox="0 0 10 10" style="shape-rendering:geometricPrecision"><path d="M0 0l10 10M10 0L0 10"/></svg></span>
    </div>
  </div></div>
</body></html>`;
}

/**
 * The stage for an animation: the same window and background, but the page stays loaded and
 * `window.show(src, transform)` swaps the frame and moves the camera, so each tick costs one image
 * decode at most. The window is positioned at the canvas centre and every camera move is a CSS
 * transform on it (translate, rotate, scale about its centre) inside a perspective.
 */
export function cameraStagePage({ canvas, shot }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${canvas.width}px; height: ${canvas.height}px; overflow: hidden; background: ${THEME_BACKGROUND}; }
  .stage { position: absolute; inset: 0; perspective: 2600px; perspective-origin: 50% 50%; }
  .win {
    position: absolute; left: ${(canvas.width - shot.width) / 2}px; top: ${(canvas.height - shot.height) / 2}px;
    width: ${shot.width}px; height: ${shot.height}px; border-radius: 10px; overflow: hidden; transform-origin: 50% 50%;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.09), 0 40px 90px rgba(0, 0, 0, 0.6), 0 14px 30px rgba(0, 0, 0, 0.4);
  }
  .win img { display: block; width: 100%; height: 100%; }
  /* A frozen earlier frame laid over the live one, faded out to dissolve a sudden layout change. */
  .win #prev { position: absolute; inset: 0; opacity: 0; }
  /* The cursor and its click pulse, drawn per frame from the recorded trail rather than captured. */
  .cursor { position: absolute; left: 0; top: 0; display: none; z-index: 5; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.55)); }
  .cursor svg { display: block; }
  .pulse { position: absolute; width: 34px; height: 34px; border-radius: 50%; background: #c9f24d; display: none; z-index: 4; }
  .caption { position: absolute; top: 0; right: 0; height: 44px; display: flex; }
  .caption span { width: 46px; height: 44px; display: grid; place-items: center; }
  .caption svg { width: 10px; height: 10px; stroke: #a3a8b0; stroke-width: 1; fill: none; shape-rendering: crispEdges; }
</style></head><body>
  <div class="stage"><div class="win" id="win">
    <img id="shot" alt="">
    <img id="prev" alt="">
    <div id="pulse" class="pulse"></div>
    <div id="cursor" class="cursor"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15.5 11.2-6.8 1.1L9.3 21z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg></div>
    <div class="caption">
      <span><svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg></span>
      <span><svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg></span>
      <span><svg viewBox="0 0 10 10" style="shape-rendering:geometricPrecision"><path d="M0 0l10 10M10 0L0 10"/></svg></span>
    </div>
  </div></div>
  <script>
    const load = async (img, src) => { if (img.dataset.src !== src) { img.dataset.src = src; img.src = src; await img.decode(); } };
    /**
     * Show one tick: the live frame, the camera transform, optionally an earlier frame at \`alpha\`
     * over it, and the cursor and a click pulse (\`k\` from 0 to 1 through the pulse) in window pixels.
     */
    window.show = async (src, transform, prev, alpha, cursor, pulse) => {
      await load(document.getElementById("shot"), src);
      const over = document.getElementById("prev");
      if (prev && alpha > 0) { await load(over, prev); over.style.opacity = String(alpha); } else over.style.opacity = "0";
      const c = document.getElementById("cursor");
      c.style.display = cursor ? "block" : "none";
      if (cursor) c.style.transform = "translate(" + (cursor.x - 4) + "px, " + (cursor.y - 2) + "px)";
      const p = document.getElementById("pulse");
      p.style.display = pulse ? "block" : "none";
      if (pulse) {
        const k = 1 - (1 - pulse.k) * (1 - pulse.k);
        p.style.left = pulse.x + "px";
        p.style.top = pulse.y + "px";
        p.style.transform = "translate(-50%, -50%) scale(" + (0.4 + 1.2 * k) + ")";
        p.style.opacity = String(0.55 * (1 - k));
      }
      document.getElementById("win").style.transform = transform;
      await new Promise((r) => requestAnimationFrame(() => r()));
      return true;
    };
  </script>
</body></html>`;
}

/** Opens `htmlFile` (a camera stage page) offscreen at `canvas` size; `frame()` shows one tick and captures it. */
export async function openCameraStage(BrowserWindow, canvas, htmlFile) {
  const win = new BrowserWindow({ width: 800, height: 600, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(60);
  await win.loadFile(htmlFile);
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { ...canvas, deviceScaleFactor: 1, mobile: false });
  return {
    async frame(src, transform, { prev = null, alpha = 0, cursor = null, pulse = null, quality = 95, scale = 1 } = {}) {
      const args = [src, transform, prev, alpha, cursor, pulse].map((a) => JSON.stringify(a)).join(", ");
      await win.webContents.executeJavaScript(`window.show(${args})`);
      const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "jpeg", quality, captureBeyondViewport: true, clip: { x: 0, y: 0, ...canvas, scale } });
      return Buffer.from(data, "base64");
    },
  };
}

/**
 * Opens an offscreen Electron window that renders pages at `canvas` size and captures them.
 * A window cannot be larger than the display, so the size is emulated and captured through the
 * DevTools protocol. Two things that cost time: the window must be offscreen (a hidden window never
 * paints, so a capture waits forever), and it must have loaded a page before the debugger attaches
 * (sending commands to an empty offscreen window crashes Electron).
 */
export async function openStage(BrowserWindow, canvas) {
  const win = new BrowserWindow({ width: 800, height: 600, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(30);
  await win.loadURL("about:blank");
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { ...canvas, deviceScaleFactor: 1, mobile: false });
  return {
    /** Render one page and return it as an encoded image buffer. */
    /** `html` is page markup, or `{ file }` for a page on disk (large images do not fit in a data: URL). */
    async capture(html, { format = "jpeg", quality = 92 } = {}) {
      if (typeof html === "object" && html.file) await win.loadFile(html.file);
      else await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
      await win.webContents.executeJavaScript("Promise.all([...document.images].map((i) => i.decode())).then(() => document.fonts.ready).then(() => true)");
      await new Promise((r) => setTimeout(r, 120));
      const params = { format, captureBeyondViewport: true, clip: { x: 0, y: 0, ...canvas, scale: 1 } };
      if (format === "jpeg") params.quality = quality;
      const { data } = await cdp.sendCommand("Page.captureScreenshot", params);
      return Buffer.from(data, "base64");
    },
  };
}
