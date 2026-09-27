#!/usr/bin/env node
// Records a short feature demo of the desktop app for the README: highlight a passage, explore it
// in a thread, branch from a phrase in the answer, and come back. The app is the real built app,
// driven with a visible cursor; the recording is framed on the stage page (the app window on its own
// theme) and encoded as an animated WebP and an MP4.
//
// A virtual camera follows the action: while recording, the script notes the region that matters
// at each step (the passage being selected, the composer, the answer as it streams, the breadcrumb),
// and while framing, each tick's camera eases towards the latest region, zooming to fit it and
// turning the window a little differently for each shot.
//
// The two answers are scripted and streamed into the panel the way the agent's replies arrive, so
// the demo is the same every time and costs nothing. Everything else is the app itself; the branch
// asks the real agent for its handoff in the background, as it always does.
//
// Usage: node tools/dev/record-demo.mjs [work-dir] [out-dir] [--record-only]
//        node tools/dev/record-demo.mjs --reframe <run-dir> [out-dir] [--preview]
//   Build first: pnpm desktop:build. Needs network access for the article.
//   Writes <out-dir>/demo.webp (default docs/screenshots) and an MP4 in the run's work directory.
//   --record-only  drive and record the app (about a minute, in a visible window) and stop, so the
//                  take can be watched and approved before the slow framing and encoding.
//   --reframe      film and encode a saved take again, for camera changes, without driving the app.
//   --preview      with --reframe: a quick half-size, 15 fps MP4 of the camera, in the run folder only.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const VIEW = { width: 1280, height: 800 };
const CANVAS = { width: 1440, height: 940 };
// Capture at the display's own density: forcing 2x cut the screencast to ~3 fps and slowed the app.
const FPS = 30;
const TAIL_SECONDS = 2.5;
/** The camera starts moving a little before the action it frames, and takes this long to arrive. */
const CAMERA_LEAD = 0.35;
const CAMERA_MOVE = 0.95;

// ----- the camera -----
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Where the camera sits for a shot: fit its region (or the whole window) and keep the window covering the frame. */
function cameraFor(shot) {
  const { width: W, height: H } = VIEW;
  const { width: CW, height: CH } = CANVAS;
  const wide = Math.min((CW * 0.84) / W, (CH * 0.84) / H);
  const r = shot.rect ?? { x: 0, y: 0, w: W, h: H };
  const z = shot.rect ? clamp(Math.min((CW * 0.86) / r.w, (CH * 0.82) / r.h), wide * 1.15, shot.maxZoom ?? 1.5) : wide;
  // A zoomed window may show its edges, up to this far inside the frame, so the tilt stays visible
  // and a region at the window's edge (the thread panel) can still be brought into view.
  // Shots of the thread panel, at the window's right edge, allow more so the panel can sit centred.
  const margin = shot.margin ?? 110;
  const along = (full, size, c) => {
    const lo = (size / 2 - margin) / z;
    const hi = full - lo;
    return lo > hi ? full / 2 : clamp(c, lo, hi);
  };
  return { z, cx: along(W, CW, r.x + r.w / 2), cy: along(H, CH, r.y + r.h / 2), rx: shot.rx ?? 0, ry: shot.ry ?? 0 };
}

function lerpCamera(a, b, p) {
  const mix = (x, y) => x + (y - x) * p;
  return { z: Math.exp(mix(Math.log(a.z), Math.log(b.z))), cx: mix(a.cx, b.cx), cy: mix(a.cy, b.cy), rx: mix(a.rx, b.rx), ry: mix(a.ry, b.ry) };
}

/** One camera key per shot; the first is where the film opens, the rest ease in slightly ahead of their action. */
const keysFor = (shots, frames) =>
  shots.map((s, i) => ({ start: i === 0 ? frames[0].t - 1 : s.t - (s.lead ?? CAMERA_LEAD), duration: i === 0 ? 0 : (s.move ?? CAMERA_MOVE), cam: cameraFor(s) }));

/** The camera at time `t`: each key eases in from wherever the camera was when it began. */
function cameraAt(keys, t) {
  let cam = keys[0].cam;
  for (const k of keys) {
    if (t < k.start) break;
    cam = lerpCamera(cam, k.cam, k.duration ? easeInOut(clamp((t - k.start) / k.duration, 0, 1)) : 1);
  }
  return cam;
}

const transformFor = (c) =>
  `translate(${((VIEW.width / 2 - c.cx) * c.z).toFixed(2)}px, ${((VIEW.height / 2 - c.cy) * c.z).toFixed(2)}px) rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg) scale(${c.z.toFixed(4)})`;
const ARTICLE = "https://spinningup.openai.com/en/latest/spinningup/rl_intro.html";

const Q1 = "Why can the value be split like that? Isn't it just the sum of all future rewards?";
const A1 = [
  "It is the sum of all future rewards; the Bellman equation just writes that sum recursively.",
  "",
  "The return from $s$ is $r_0 + \\gamma r_1 + \\gamma^2 r_2 + \\dots$, and everything after $r_0$ is $\\gamma$ times the return from wherever you land next. Take expectations over the action and the next state and you get",
  "",
  "$$V^{\\pi}(s) = \\mathbb{E}_{a \\sim \\pi,\\, s' \\sim P}\\left[\\, r(s,a) + \\gamma\\, V^{\\pi}(s') \\,\\right]$$",
  "",
  "The discount factor is what makes the tail a scaled copy of the same quantity, so the value at one state can be written in terms of the value one step later.",
].join("\n");
const BRANCH_PHRASE = "discount factor";
const Q2 = "Why discount future rewards at all?";
const A2 = [
  "Two reasons. Mathematically, with $\\gamma < 1$ an infinite sum of bounded rewards converges:",
  "",
  "$$\\sum_{t=0}^{\\infty} \\gamma^t r_t \\;\\le\\; \\frac{r_{\\max}}{1-\\gamma}$$",
  "",
  "Practically, it encodes a preference for reward sooner rather than later, and it makes learning easier because distant, uncertain consequences count for less. Setting $\\gamma = 1$ only works when every episode is guaranteed to end.",
].join("\n");

// ---------------------------------------------------------------------------------------------
// Phase 2 runs inside Electron: film each tick through the camera on the stage page.
if (process.versions.electron) {
  const { app, BrowserWindow } = await import("electron");
  const { cameraStagePage, openCameraStage } = await import("./stage-page.mjs");
  const [indexPath] = process.argv.slice(-1);
  const index = JSON.parse(readFileSync(indexPath, "utf8"));
  setTimeout(() => { console.error("record-demo: framing timed out"); app.exit(2); }, 1_500_000).unref();
  app.whenReady().then(async () => {
    const html = join(dirname(indexPath), "stage.html");
    writeFileSync(html, cameraStagePage({ canvas: CANVAS, shot: VIEW }));
    const stage = await openCameraStage(BrowserWindow, CANVAS, html);
    const { frames, shots, blends = [], cursor = [], clicks = [], outDir, fps = FPS, scale = 1 } = index;
    // The cursor at time t, between the two trail samples around it; the trail is sampled every
    // animation frame, so straight lines between samples are exact enough.
    let ci = 0;
    const cursorAt = (t) => {
      if (!cursor.length) return null;
      while (ci + 1 < cursor.length && cursor[ci + 1].t <= t) ci++;
      const a = cursor[ci];
      const b = cursor[ci + 1];
      if (!b || t <= a.t) return { x: a.x, y: a.y };
      const k = (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    };
    const PULSE = 0.45;
    const pulseAt = (t) => {
      const c = clicks.find((x) => t >= x.t && t < x.t + PULSE);
      return c ? { x: c.x, y: c.y, k: (t - c.t) / PULSE } : null;
    };
    const keys = keysFor(shots, frames);
    mkdirSync(outDir, { recursive: true });
    const end = frames.at(-1).t + TAIL_SECONDS;
    const frameAt = (t) => {
      let k = 0;
      while (k + 1 < frames.length && frames[k + 1].t <= t) k++;
      return pathToFileURL(frames[k].file).href;
    };
    let j = 0;
    let n = 0;
    for (let t = frames[0].t; t <= end; t += 1 / fps) {
      while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
      // A dissolve: the frame from the blend's start fades out over the live frames.
      const b = blends.find((x) => t >= x.t && t < x.t + x.duration);
      const over = b ? { prev: frameAt(b.t), alpha: 1 - easeInOut((t - b.t) / b.duration) } : {};
      const jpg = await stage.frame(pathToFileURL(frames[j].file).href, transformFor(cameraAt(keys, t)), { ...over, scale, cursor: cursorAt(t), pulse: pulseAt(t) });
      writeFileSync(join(outDir, `c${String(n++).padStart(5, "0")}.jpg`), jpg);
      if (n % 100 === 0) console.log(`[demo] framed ${n} of ${Math.ceil((end - frames[0].t) * fps)}`);
    }
    app.exit(0);
  }).catch((err) => { console.error("record-demo:", err); app.exit(1); });
} else if (FLAGS.has("--reframe")) {
  const runDir = resolve(ARGS[0]);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const recording = JSON.parse(readFileSync(join(runDir, "recording.json"), "utf8"));
  frameAndEncode(runDir, recording, resolve(ARGS[1] ?? join(repo, "docs", "screenshots")), env, { preview: FLAGS.has("--preview") });
} else {
  await main();
}

async function main() {
  const { _electron: electron } = await import("playwright-core");
  const workDir = resolve(ARGS[0] ?? join(here, "out", "demo"));
  const outDir = resolve(ARGS[1] ?? join(repo, "docs", "screenshots"));
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(workDir, runId);
  const collection = join(runDir, "reinforcement-learning");
  const framesDir = join(runDir, "frames");
  mkdirSync(collection, { recursive: true });
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  const log = (...a) => console.log(`[demo] ${a.join(" ")}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: electronBin, args: [appDir, `--user-data-dir=${join(runDir, "user-data")}`], env, timeout: 60_000 });
  const page = await app.firstWindow();
  const until = async (fn, label, timeout = 30_000, arg) => {
    const t0 = Date.now();
    while (!(await page.evaluate(fn, arg))) {
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
      await sleep(200);
    }
  };

  try {
    // ----- set the scene (not recorded) -----
    await page.waitForSelector(".hdr");
    await page.setViewportSize(VIEW);
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
    await page.evaluate((u) => window.__qrabbitStore.getState().importUrl(u), ARTICLE);
    await page.waitForSelector(".sheet.article .md blockquote", { timeout: 30_000 });
    await until(() => !!window.__qrabbitStore.getState().agent?.connected, "the agent to connect", 60_000);
    await page.evaluate(() => {
      window.__qrabbitStore.setState({ toasts: [] });
      const q = [...document.querySelectorAll(".sheet.article blockquote p")].find((p) => p.textContent.includes("The value of your starting point"));
      const root = document.querySelector(".rscroll");
      root.scrollTop += q.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientHeight * 0.4;
      // The cursor is not drawn in the page: captures arrive unevenly, and a cursor inside them
      // jumps whenever one is late. Its path is logged here, every animation frame, and drawn
      // at the exact position for each output frame when the film is made.
      const pos = { x: 904, y: 622 };
      const trail = [{ t: Date.now() / 1000, x: pos.x, y: pos.y }];
      const clicks = [];
      const place = () => trail.push({ t: Date.now() / 1000, x: pos.x, y: pos.y });
      // Motion, typing and streaming run in the page on timers, so the recording keeps real-time
      // pace instead of paying a script round trip per step.
      const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      window.__demo = {
        trail,
        clicks,
        click: () => clicks.push({ t: Date.now() / 1000, x: pos.x, y: pos.y }),
        glide: (x, y, ms) => new Promise((resolve) => {
          const from = { ...pos };
          const t0 = performance.now();
          const frame = (now) => {
            const k = ease(Math.min(1, (now - t0) / ms));
            pos.x = from.x + (x - from.x) * k;
            pos.y = from.y + (y - from.y) * k;
            place();
            if (k < 1) requestAnimationFrame(frame); else resolve();
          };
          requestAnimationFrame(frame);
        }),
        type: (text) => new Promise((resolve) => {
          const ta = document.querySelector(".composer textarea");
          const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
          let i = 0;
          const step = () => {
            i++;
            set.call(ta, text.slice(0, i));
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            if (i < text.length) setTimeout(step, 22 + Math.random() * 26); else resolve();
          };
          step();
        }),
        /**
         * Select `text` inside the first matching `root` the way a drag does, a character at a time,
         * with the cursor riding the end of the selection. Resolves with the point where it ends.
         */
        select: (root, text, ms) => new Promise((resolve, reject) => {
          let node = null;
          let at = -1;
          for (const r of document.querySelectorAll(root)) {
            const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
            for (let n = w.nextNode(); n && !node; n = w.nextNode()) if ((at = n.data.indexOf(text)) !== -1) node = n;
            if (node) break;
          }
          if (!node) { reject(new Error(`text not found in ${root}: ${text}`)); return; }
          const sel = window.getSelection();
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at);
          sel.removeAllRanges();
          sel.addRange(range);
          const probe = document.createRange();
          const t0 = performance.now();
          const frame = (now) => {
            const k = Math.max(1, Math.round(ease(Math.min(1, (now - t0) / ms)) * text.length));
            range.setEnd(node, at + k);
            sel.removeAllRanges();
            sel.addRange(range);
            probe.setStart(node, at + k - 1);
            probe.setEnd(node, at + k);
            const r = probe.getBoundingClientRect();
            pos.x = r.right + 1;
            pos.y = r.top + r.height / 2;
            place();
            if (k < text.length) { requestAnimationFrame(frame); return; }
            node.parentElement.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: pos.x, clientY: pos.y }));
            resolve({ x: pos.x, y: pos.y });
          };
          requestAnimationFrame(frame);
        }),
        // Text arrives the way the agent's does, in uneven lumps a few hundred milliseconds apart;
        // smoothing it into a steady reveal, and following it down the panel, is the app's job.
        stream: (answer) => new Promise((resolve) => {
          const s = window.__qrabbitStore;
          const id = s.getState().thread.id;
          const tokens = answer.match(/\S+\s*|\s+/g) ?? [];
          let i = 0;
          const step = () => {
            i = Math.min(tokens.length, i + 4 + Math.floor(Math.random() * 9));
            const text = tokens.slice(0, i).join("");
            s.setState((x) => ({ turns: { ...x.turns, [id]: { ...x.turns[id], text } } }));
            if (i < tokens.length) setTimeout(step, 110 + Math.random() * 140); else resolve();
          };
          step();
        }),
      };
    });
    await sleep(800);

    // ----- cursor helpers -----
    let cur = { x: 904, y: 622 };
    /** Glide the visible cursor in the page, then put the real mouse where it ended (for hover and clicks). */
    const moveTo = async (x, y, ms = 650) => {
      await page.evaluate(([px, py, d]) => window.__demo.glide(px, py, d), [x, y, ms]);
      await page.mouse.move(x, y);
      cur = { x, y };
    };
    /** A real click where the cursor is; the page notes it so the film can draw the click pulse. */
    const click = async () => { await page.evaluate(() => window.__demo.click()); await page.mouse.down(); await sleep(70); await page.mouse.up(); };
    const centre = (selector, text) => page.evaluate(([sel, t]) => {
      const el = [...document.querySelectorAll(sel)].find((e) => !t || e.textContent.includes(t));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, [selector, text]);
    /** Screen points just before the first and just after the last character of `text` inside `root`. */
    const span = (root, text) => page.evaluate(([sel, t]) => {
      for (const r of document.querySelectorAll(sel)) {
        const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const i = n.data.indexOf(t);
          if (i === -1) continue;
          const range = document.createRange();
          range.setStart(n, i); range.setEnd(n, i + 1);
          const a = range.getBoundingClientRect();
          range.setStart(n, i + t.length - 1); range.setEnd(n, i + t.length);
          const b = range.getBoundingClientRect();
          return { start: { x: a.left - 1, y: a.top + a.height / 2 }, end: { x: b.right + 1, y: b.top + b.height / 2 } };
        }
      }
      return null;
    }, [root, text]);
    /** Glide to the start of `text`, then select it in the page at reading pace (about 22 ms a character). */
    const dragSelect = async (root, text) => {
      const s = await span(root, text);
      if (!s) throw new Error(`text not found in ${root}: ${text}`);
      await moveTo(s.start.x, s.start.y, 700);
      await sleep(120);
      const ms = clamp(text.length * 22, 450, 1600);
      cur = await page.evaluate(([r, t, d]) => window.__demo.select(r, t, d), [root, text, ms]);
      await page.mouse.move(cur.x, cur.y);
    };
    const type = (text) => page.evaluate((t) => window.__demo.type(t), text);

    // ----- camera notes: the region that matters from now on, and how the window is turned -----
    const shots = [];
    /** The union of the first (or last) element matching each spec, padded; a spec is a selector or [selector, text, "last"]. */
    const regionOf = (specs, pad) => page.evaluate(([list, p]) => {
      let u = null;
      for (const spec of list) {
        const [sel, text, which] = Array.isArray(spec) ? spec : [spec];
        const all = [...document.querySelectorAll(sel)].filter((e) => !text || e.textContent.includes(text));
        const el = which === "last" ? all.at(-1) : all[0];
        if (!el) continue;
        const b = el.getBoundingClientRect();
        u = u ? { l: Math.min(u.l, b.left), t: Math.min(u.t, b.top), r: Math.max(u.r, b.right), b: Math.max(u.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
      }
      return u && { x: u.l - p, y: u.t - p, w: u.r - u.l + 2 * p, h: u.b - u.t + 2 * p };
    }, [specs, pad]);
    const focus = async (specs, look = {}) => {
      const rect = specs ? await regionOf(specs, look.pad ?? 24) : null;
      if (rect && look.roomAbove) { rect.y -= look.roomAbove; rect.h += look.roomAbove; }
      shots.push({ wall: look.at ?? Date.now() / 1000, rect, rx: look.rx ?? 0, ry: look.ry ?? 0, lead: look.lead, move: look.move, margin: look.margin, maxZoom: look.maxZoom });
    };
    /** Dissolve from the frame at `at` into what follows, to soften a sudden layout change. */
    const blends = [];
    const dissolve = (at, duration = 0.45) => blends.push({ wall: at, duration });

    /** Sends the composer's text as a message and streams `answer` back the way the agent's replies arrive. */
    const scriptedTurn = async (answer) => {
      await sleep(300);
      await page.evaluate(async () => {
        const ta = document.querySelector(".composer textarea");
        const body = ta.value;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, "");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        const s = window.__qrabbitStore;
        const st = s.getState();
        const id = st.thread.id;
        const updated = await window.qrabbit.threads.appendMessage(st.collection.info.path, id, { role: "user", body });
        const src = st.collection.sources.find((x) => x.id === st.thread.anchor?.source) ?? st.collection.sources[0];
        s.setState((x) => ({ thread: updated, turns: { ...x.turns, [id]: { running: true, text: "", activity: [{ id: "read", title: `Read sources/${src.id}/text.md`, kind: "read", status: "in_progress" }], permission: null, error: null } } }));
      });
      // Follow the answer as it arrives.
      await focus([".panel .msgs"], { pad: 6, rx: 3, ry: -5, margin: 360 });
      await sleep(900);
      await page.evaluate(() => {
        const s = window.__qrabbitStore;
        const id = s.getState().thread.id;
        s.setState((x) => ({ turns: { ...x.turns, [id]: { ...x.turns[id], activity: x.turns[id].activity.map((a) => ({ ...a, status: "completed" })) } } }));
      });
      await sleep(400);
      // Regression check: while the answer streams, the panel should start overflowing at most once,
      // not flip in and out (which showed as a flickering scrollbar).
      await page.evaluate(() => {
        const msgs = document.querySelector(".msgs");
        let over = msgs.scrollHeight > msgs.clientHeight;
        window.__demo.flips = 0;
        window.__demo.watching = true;
        const tick = () => {
          const now = msgs.scrollHeight > msgs.clientHeight;
          if (now !== over) { window.__demo.flips++; over = now; }
          if (window.__demo.watching) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.evaluate((a) => window.__demo.stream(a), answer);
      await page.evaluate(async (body) => {
        const s = window.__qrabbitStore;
        const st = s.getState();
        const id = st.thread.id;
        const updated = await window.qrabbit.threads.appendMessage(st.collection.info.path, id, { role: "assistant", body });
        s.setState((x) => { const turns = { ...x.turns }; delete turns[id]; return { thread: updated, turns }; });
        await st.refreshThreads();
      }, answer);
      // The saved answer carries on revealing from where the stream got to; wait for its last words.
      const tail = answer.trim().split(/\s+/).slice(-3).join(" ");
      await until((t) => [...document.querySelectorAll(".msg.assistant .md")].at(-1)?.textContent?.replace(/\s+/g, " ").includes(t), "the answer to finish revealing", 15_000, tail);
      await sleep(500);
      const flips = await page.evaluate(() => { window.__demo.watching = false; return window.__demo.flips; });
      log(`panel overflow flips while the answer streamed: ${flips}${flips > 1 ? " (scrollbar flicker)" : ""}`);
    };
    const clearToasts = () => page.evaluate(() => window.__qrabbitStore.setState({ toasts: [] }));

    // ----- record -----
    const frames = [];
    let pending = Promise.resolve();
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      // Acknowledge first: the next capture waits for the ack, so it should not also wait on the disk.
      pending = cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const file = join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
      frames.push({ file, t: metadata.timestamp, recv: Date.now() / 1000 });
      writeFileSync(file, Buffer.from(data, "base64"));
    });
    // A cheaper JPEG per capture means more captures a second and smoother motion.
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
    await focus(null, { rx: 8, ry: -11 });
    await sleep(1900);

    log("highlight and explore");
    const PASSAGE = "The value of your starting point is the reward you expect to get from being there, plus the value of wherever you land next.";
    await focus([[".sheet.article blockquote", PASSAGE]], { pad: 40, roomAbove: 70, rx: 5, ry: 7 });
    await dragSelect(".sheet.article blockquote p", PASSAGE);
    await sleep(700);
    const explore = await centre(".seltool button", "Explore");
    await moveTo(explore.x, explore.y, 600);
    await sleep(250);
    // Opening the panel narrows the article and re-wraps the passage under the camera. It opens
    // about a second after the click (the thread is created and loaded first), so time the
    // dissolve and the move to the panel from when it appears, noted inside the page.
    const panelOpened = page.evaluate(() => new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        if (!document.querySelector(".panel")) return;
        mo.disconnect();
        resolve(Date.now() / 1000);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }));
    await click();
    const openedAt = await panelOpened;
    dissolve(openedAt - 0.06, 0.45);
    await page.waitForSelector(".panel .composer textarea", { timeout: 10_000 });
    await sleep(250);
    await focus([".composer"], { pad: 16, roomAbove: 260, rx: 4, ry: -8, margin: 360, maxZoom: 1.6, at: openedAt, lead: 0.06, move: 1.0 });
    await sleep(700);
    await clearToasts();
    await type(Q1);
    await scriptedTurn(A1);
    await sleep(1400);

    log("branch from the answer");
    await focus([[".msg.assistant .body", BRANCH_PHRASE, "last"]], { pad: 30, roomAbove: 40, rx: 4, ry: 6, margin: 360 });
    await sleep(500);
    await dragSelect(".msg.assistant .body", BRANCH_PHRASE);
    await sleep(600);
    const branchBtn = await centre(".seltool.msg-tool button", "Explore");
    await moveTo(branchBtn.x, branchBtn.y, 550);
    await sleep(250);
    // Regression check: once clicked, the toolbar must not come back while the branch is created.
    const toolbarReturned = page.evaluate(() => new Promise((resolve) => {
      let seenGone = false;
      const t0 = performance.now();
      const tick = () => {
        const shown = !!document.querySelector(".seltool.msg-tool");
        if (!shown) seenGone = true;
        else if (seenGone) return resolve(true);
        if (performance.now() - t0 > 1500) return resolve(false);
        requestAnimationFrame(tick);
      };
      tick();
    }));
    await click();
    log(`answer toolbar after the Explore click: ${(await toolbarReturned) ? "came back (flicker)" : "stayed hidden"}`);
    await until(() => !!window.__qrabbitStore.getState().thread?.parent, "the branch to open", 15_000);
    await sleep(200);
    // The whole chat window for the branch: outline, handoff, where it started and the composer.
    await focus([".panel"], { pad: 8, rx: 4, ry: -6, margin: 360 });
    await sleep(1300);
    await clearToasts();
    await type(Q2);
    await scriptedTurn(A2);
    await sleep(1400);

    log("back to the parent");
    // The way back sits just above the composer, so the camera stays on the chat window.
    await focus([".panel"], { pad: 8, rx: 4, ry: -6, margin: 360 });
    const back = await centre(".toparent");
    if (!back) throw new Error("the Back to parent link is missing");
    await moveTo(back.x, back.y, 700);
    await sleep(250);
    await click();
    await until(() => !window.__qrabbitStore.getState().thread?.parent, "the parent to open", 10_000);
    await sleep(300);
    // Pull back to the whole window, turned the other way: passage, marker and thread together.
    await focus(null, { rx: 7, ry: 10 });
    const marker = await centre(".bmark");
    if (marker) await moveTo(marker.x + 40, marker.y + 30, 700);
    await sleep(1400);

    await cdp.send("Page.stopScreencast");
    await pending;
    const { trail, clicks } = await page.evaluate(() => ({ trail: window.__demo.trail, clicks: window.__demo.clicks }));
    log(`captured ${frames.length} frames, ${trail.length} cursor samples`);
    // The app is done with; framing and encoding take a few minutes and need no window.
    await app.close().catch(() => {});

    // Shots, cursor and clicks were noted on the wall clock; frames carry both clocks, so put
    // everything on the screencast's.
    const offsets = frames.map((f) => f.t - f.recv).sort((a, b) => a - b);
    const offset = offsets[Math.floor(offsets.length / 2)];
    const recording = {
      frames: frames.map(({ file, t }) => ({ file, t })),
      shots: shots.map(({ wall, ...s }) => ({ ...s, t: wall + offset })),
      blends: blends.map(({ wall, duration }) => ({ t: wall + offset, duration })),
      cursor: trail.map((p) => ({ ...p, t: p.t + offset })),
      clicks: clicks.map((c) => ({ ...c, t: c.t + offset })),
    };
    writeFileSync(join(runDir, "recording.json"), JSON.stringify(recording));
    log(`${shots.length} camera shots`);
    if (FLAGS.has("--record-only")) {
      const me = "node tools/dev/record-demo.mjs";
      log(`recorded ${runDir}`);
      log(`camera preview (fast, half size): ${me} --reframe "${runDir}" --preview`);
      log(`final WebP for the README:        ${me} --reframe "${runDir}"`);
      return;
    }
    log("framing and encoding (a few minutes)…");
    frameAndEncode(runDir, recording, outDir, env);
  } finally {
    await app.close().catch(() => {});
  }
}

/**
 * Films each tick through the camera (in Electron), then encodes the WebP for the README and an MP4.
 * With `preview`, a quick check of the camera instead: half size, 15 fps, an MP4 in the run folder only.
 */
function frameAndEncode(runDir, recording, outDir, env, { preview = false } = {}) {
  const log = (...a) => console.log(`[demo] ${a.join(" ")}`);
  const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
  const fps = preview ? 15 : FPS;
  const composed = join(runDir, preview ? "composed-preview" : "composed");
  const indexPath = join(runDir, preview ? "frames-preview.json" : "frames.json");
  writeFileSync(indexPath, JSON.stringify({ ...recording, outDir: composed, fps, scale: preview ? 0.5 : 1 }));
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url), indexPath], { stdio: "inherit", env });
  if (r.status !== 0) throw new Error("framing failed");
  // The encodes print nothing while they run, and the WebP takes a few minutes; say so.
  log(`framed every frame; encoding ${preview ? "the preview" : "the WebP, then the MP4 (a few quiet minutes)"}…`);

  const run = (args, what) => {
    const t0 = Date.now();
    const res = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(fps), "-i", join(composed, "c%05d.jpg"), ...args], { stdio: "inherit" });
    if (res.status !== 0) throw new Error(`ffmpeg failed: ${what}`);
    log(`encoded the ${what} in ${Math.round((Date.now() - t0) / 1000)} s`);
  };
  if (preview) {
    const out = join(runDir, "preview.mp4");
    run(["-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "fast", out], "preview");
    log(`preview: ${out}`);
    return;
  }
  const webp = join(runDir, "demo.webp");
  const mp4 = join(runDir, "demo.mp4");
  // A moving camera changes every pixel of every frame, which animated WebP stores poorly. The README
  // shows it at about 880 px wide, so 1000 px keeps the full 30 fps (15 fps looked stuttery) near 6 MB.
  run(["-vf", "scale=1000:-2:flags=lanczos", "-c:v", "libwebp_anim", "-lossless", "0", "-quality", "66", "-compression_level", "6", "-loop", "0", webp], "WebP");
  // aq-mode 3 spends more bits on dark, flat areas, where the background gradient otherwise turns blocky.
  run(["-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-x264-params", "aq-mode=3", "-movflags", "+faststart", mp4], "MP4");
  // The WebP goes in the repo: GitHub plays it inline in the README. A video file in the repo only
  // renders as a download link there, so the MP4 stays in the work directory for sharing elsewhere.
  mkdirSync(outDir, { recursive: true });
  copyFileSync(webp, join(outDir, "demo.webp"));
  const kb = (p) => Math.round(readFileSync(p).length / 1024);
  const secs = recording.frames.at(-1).t - recording.frames[0].t + TAIL_SECONDS;
  log(`wrote ${join(outDir, "demo.webp")} (${kb(webp)} KB, ${secs.toFixed(1)} s); MP4 for sharing: ${mp4} (${kb(mp4)} KB)`);
}
