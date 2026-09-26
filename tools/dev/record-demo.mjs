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
// Usage: node tools/dev/record-demo.mjs [work-dir] [out-dir]
//        node tools/dev/record-demo.mjs --reframe <run-dir> [out-dir]
//   Build first: pnpm desktop:build. Needs network access for the article.
//   Writes <out-dir>/demo.webp (default docs/screenshots) and an MP4 in the run's work directory.
//   --reframe films and encodes an earlier run's recording again, for camera changes, without
//   driving the app.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");

const VIEW = { width: 1280, height: 800 };
const CANVAS = { width: 1440, height: 940 };
// Capture at the display's own density: forcing 2x cut the screencast to ~3 fps and slowed the app.
const FPS = 20;
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
  const z = shot.rect ? clamp(Math.min((CW * 0.86) / r.w, (CH * 0.82) / r.h), wide * 1.15, 1.5) : wide;
  // A zoomed window may show its edges, up to this far inside the frame, so the tilt stays visible
  // and a region at the window's edge (the thread panel) can still be brought into view.
  const margin = 110;
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
  shots.map((s, i) => ({ start: i === 0 ? frames[0].t - 1 : s.t - CAMERA_LEAD, duration: i === 0 ? 0 : CAMERA_MOVE, cam: cameraFor(s) }));

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
    const { frames, shots, outDir } = index;
    const keys = keysFor(shots, frames);
    mkdirSync(outDir, { recursive: true });
    const end = frames.at(-1).t + TAIL_SECONDS;
    let j = 0;
    let n = 0;
    for (let t = frames[0].t; t <= end; t += 1 / FPS) {
      while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
      const jpg = await stage.frame(pathToFileURL(frames[j].file).href, transformFor(cameraAt(keys, t)));
      writeFileSync(join(outDir, `c${String(n++).padStart(5, "0")}.jpg`), jpg);
      if (n % 100 === 0) console.log(`[demo] framed ${n} of ${Math.ceil((end - frames[0].t) * FPS)}`);
    }
    app.exit(0);
  }).catch((err) => { console.error("record-demo:", err); app.exit(1); });
} else if (process.argv[2] === "--reframe") {
  const runDir = resolve(process.argv[3]);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  frameAndEncode(runDir, JSON.parse(readFileSync(join(runDir, "recording.json"), "utf8")), resolve(process.argv[4] ?? join(repo, "docs", "screenshots")), env);
} else {
  await main();
}

async function main() {
  const { _electron: electron } = await import("playwright-core");
  const workDir = resolve(process.argv[2] ?? join(here, "out", "demo"));
  const outDir = resolve(process.argv[3] ?? join(repo, "docs", "screenshots"));
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
      // A visible cursor: page captures never include the real one.
      const c = document.createElement("div");
      c.id = "demo-cursor";
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15.5 11.2-6.8 1.1L9.3 21z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.55))", transform: "translate(900px, 620px)" });
      document.body.appendChild(c);
      const style = document.createElement("style");
      style.textContent = "@keyframes demo-pulse { from { transform: translate(-50%,-50%) scale(.4); opacity: .55 } to { transform: translate(-50%,-50%) scale(1.6); opacity: 0 } } .demo-pulse { position: fixed; width: 34px; height: 34px; border-radius: 50%; background: #c9f24d; pointer-events: none; z-index: 2147483646; animation: demo-pulse .45s ease-out forwards }";
      document.head.appendChild(style);
      // Motion, typing and streaming run in the page on timers, so the recording keeps real-time
      // pace instead of paying a script round trip per step.
      const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      const pos = { x: 904, y: 622 };
      window.__demo = {
        glide: (x, y, ms) => new Promise((resolve) => {
          const from = { ...pos };
          const t0 = performance.now();
          const frame = (now) => {
            const k = ease(Math.min(1, (now - t0) / ms));
            pos.x = from.x + (x - from.x) * k;
            pos.y = from.y + (y - from.y) * k;
            c.style.transform = `translate(${pos.x - 4}px, ${pos.y - 2}px)`;
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
        stream: (answer) => new Promise((resolve) => {
          const s = window.__qrabbitStore;
          const id = s.getState().thread.id;
          const tokens = answer.match(/\S+\s*|\s+/g) ?? [];
          let i = 0;
          const step = () => {
            i = Math.min(tokens.length, i + 3);
            const text = tokens.slice(0, i).join("");
            s.setState((x) => ({ turns: { ...x.turns, [id]: { ...x.turns[id], text } } }));
            const msgs = document.querySelector(".msgs");
            if (msgs) msgs.scrollTop = msgs.scrollHeight;
            if (i < tokens.length) setTimeout(step, 34); else resolve();
          };
          step();
        }),
      };
    });
    await sleep(800);

    // ----- cursor helpers -----
    let cur = { x: 904, y: 622 };
    const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    /** Glide the visible cursor; `realSteps` real mouse moves along the way (for drags), else one at the end. */
    const moveTo = async (x, y, ms = 650, realSteps = 0) => {
      const from = { ...cur };
      const glide = page.evaluate(([px, py, d]) => window.__demo.glide(px, py, d), [x, y, ms]);
      for (let i = 1; i <= realSteps; i++) {
        await sleep(ms / realSteps);
        const k = ease(i / realSteps);
        await page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      }
      await glide;
      await page.mouse.move(x, y);
      cur = { x, y };
    };
    const pulse = () => page.evaluate(([x, y]) => {
      const d = document.createElement("div");
      d.className = "demo-pulse";
      Object.assign(d.style, { left: `${x}px`, top: `${y}px` });
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 500);
    }, [cur.x, cur.y]);
    const click = async () => { await pulse(); await page.mouse.down(); await sleep(70); await page.mouse.up(); };
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
    const dragSelect = async (root, text) => {
      const s = await span(root, text);
      if (!s) throw new Error(`text not found in ${root}: ${text}`);
      await moveTo(s.start.x, s.start.y, 850);
      await sleep(180);
      await page.mouse.down();
      await moveTo(s.end.x, s.end.y, 1000, 14);
      await page.mouse.up();
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
      shots.push({ wall: Date.now() / 1000, rect, rx: look.rx ?? 0, ry: look.ry ?? 0 });
    };

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
      await focus([".panel .msgs"], { pad: 6, rx: 3, ry: -5 });
      await sleep(900);
      await page.evaluate(() => {
        const s = window.__qrabbitStore;
        const id = s.getState().thread.id;
        s.setState((x) => ({ turns: { ...x.turns, [id]: { ...x.turns[id], activity: x.turns[id].activity.map((a) => ({ ...a, status: "completed" })) } } }));
      });
      await sleep(400);
      await page.evaluate((a) => window.__demo.stream(a), answer);
      await page.evaluate(async (body) => {
        const s = window.__qrabbitStore;
        const st = s.getState();
        const id = st.thread.id;
        const updated = await window.qrabbit.threads.appendMessage(st.collection.info.path, id, { role: "assistant", body });
        s.setState((x) => { const turns = { ...x.turns }; delete turns[id]; return { thread: updated, turns }; });
        await st.refreshThreads();
      }, answer);
    };
    const clearToasts = () => page.evaluate(() => window.__qrabbitStore.setState({ toasts: [] }));

    // ----- record -----
    const frames = [];
    let pending = Promise.resolve();
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      const file = join(framesDir, `f${String(frames.length).padStart(5, "0")}.jpg`);
      frames.push({ file, t: metadata.timestamp, recv: Date.now() / 1000 });
      writeFileSync(file, Buffer.from(data, "base64"));
      pending = cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
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
    await click();
    await page.waitForSelector(".panel .composer textarea", { timeout: 10_000 });
    await sleep(250);
    await focus([".panel .msgs .quote", ".composer"], { pad: 20, rx: 4, ry: -8 });
    await sleep(700);
    await clearToasts();
    await type(Q1);
    await scriptedTurn(A1);
    await sleep(1400);

    log("branch from the answer");
    await focus([[".msg.assistant .body", BRANCH_PHRASE, "last"]], { pad: 30, roomAbove: 40, rx: 4, ry: 6 });
    await sleep(500);
    await dragSelect(".msg.assistant .body", BRANCH_PHRASE);
    await sleep(600);
    const branchBtn = await centre(".seltool.msg-tool button", "Explore");
    await moveTo(branchBtn.x, branchBtn.y, 550);
    await sleep(250);
    await click();
    await until(() => !!window.__qrabbitStore.getState().thread?.parent, "the branch to open", 15_000);
    await sleep(200);
    // The branch in the outline, its handoff and where it started.
    await focus([".crumbs", ".outline", ".panel .msgs .quote"], { pad: 16, rx: 5, ry: -4 });
    await sleep(1500);
    await clearToasts();
    await focus([".panel .msgs .quote", ".composer"], { pad: 20, rx: 3, ry: -7 });
    await sleep(500);
    await type(Q2);
    await scriptedTurn(A2);
    await sleep(1400);

    log("back to the parent");
    await focus([".crumbs", ".outline"], { pad: 40, rx: 5, ry: -3 });
    const parentCrumb = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".crumbs button")].filter((x) => x.textContent.trim() && !/^Threads/.test(x.textContent.trim()));
      const r = b[0]?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    });
    await moveTo(parentCrumb.x, parentCrumb.y, 700);
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
    log(`captured ${frames.length} frames`);
    // The app is done with; framing and encoding take a few minutes and need no window.
    await app.close().catch(() => {});
    log("framing and encoding (a few minutes)…");

    // Shots were noted on the wall clock; frames carry both clocks, so put the shots on the screencast's.
    const offsets = frames.map((f) => f.t - f.recv).sort((a, b) => a - b);
    const offset = offsets[Math.floor(offsets.length / 2)];
    const recording = { frames: frames.map(({ file, t }) => ({ file, t })), shots: shots.map(({ wall, ...s }) => ({ ...s, t: wall + offset })) };
    writeFileSync(join(runDir, "recording.json"), JSON.stringify(recording));
    log(`${shots.length} camera shots`);
    frameAndEncode(runDir, recording, outDir, env);
  } finally {
    await app.close().catch(() => {});
  }
}

/** Films each tick through the camera (in Electron), then encodes the WebP for the README and an MP4. */
function frameAndEncode(runDir, recording, outDir, env) {
  const log = (...a) => console.log(`[demo] ${a.join(" ")}`);
  const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
  const composed = join(runDir, "composed");
  const indexPath = join(runDir, "frames.json");
  writeFileSync(indexPath, JSON.stringify({ ...recording, outDir: composed }));
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url), indexPath], { stdio: "inherit", env });
  if (r.status !== 0) throw new Error("framing failed");

  const run = (args, what) => {
    const res = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(FPS), "-i", join(composed, "c%05d.jpg"), ...args], { stdio: "inherit" });
    if (res.status !== 0) throw new Error(`ffmpeg failed: ${what}`);
  };
  const webp = join(runDir, "demo.webp");
  const mp4 = join(runDir, "demo.mp4");
  // A moving camera changes every pixel of every frame, which animated WebP stores poorly; the README
  // shows it at about 880 px wide, so 1080 px at 15 fps keeps it near 5 MB without visible loss.
  run(["-vf", "fps=15,scale=1080:-2:flags=lanczos", "-c:v", "libwebp_anim", "-lossless", "0", "-quality", "64", "-compression_level", "6", "-loop", "0", webp], "webp");
  run(["-vf", "format=yuv420p", "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", mp4], "mp4");
  // The WebP goes in the repo: GitHub plays it inline in the README. A video file in the repo only
  // renders as a download link there, so the MP4 stays in the work directory for sharing elsewhere.
  mkdirSync(outDir, { recursive: true });
  copyFileSync(webp, join(outDir, "demo.webp"));
  const kb = (p) => Math.round(readFileSync(p).length / 1024);
  const secs = recording.frames.at(-1).t - recording.frames[0].t + TAIL_SECONDS;
  log(`wrote ${join(outDir, "demo.webp")} (${kb(webp)} KB, ${secs.toFixed(1)} s); MP4 for sharing: ${mp4} (${kb(mp4)} KB)`);
}
