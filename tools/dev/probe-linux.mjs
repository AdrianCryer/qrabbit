#!/usr/bin/env node
// Checks what is Linux's own in a packaged Linux build: the bundled Node downloading and hosting Claude Code, the
// window-controls overlay and the room the header leaves for it, the desktop name the window reports, and Claude
// Code's sign-in terminal, first with none on PATH (the app must show a toast that says what to run, not crash),
// then with a stand-in x-terminal-emulator that records its arguments, whose script must parse and name a real Node.
// It never runs the sign-in itself. Page screenshots leave out the window buttons, which the window manager draws;
// PROBE_HOLD_MS keeps the first window open that long so it can be captured from outside, and then stops.
// Usage: QRABBIT_APP=apps/desktop/dist/linux-unpacked/qrabbit node tools/dev/probe-linux.mjs <work-dir>
// PROBE_KEEP=1 keeps the profile from the last run, and with it the downloaded agent (about 280 MB).
import { _electron as electron } from "playwright-core";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const exe = process.env.QRABBIT_APP;
if (!exe || !process.argv[2]) {
  console.error("usage: QRABBIT_APP=<linux-unpacked/qrabbit> node tools/dev/probe-linux.mjs <work-dir>");
  process.exit(2);
}
const work = resolve(process.argv[2]);
const userData = join(work, "user-data-linux");
const collection = join(work, "collection-linux");
const shots = join(work, "shots-linux");
const fakeBin = join(work, "fake-terminal");
const termLog = join(work, "fake-terminal.log");
const extraArgs = process.env.PROBE_X11 ? ["--ozone-platform=x11"] : [];
if (!process.env.PROBE_KEEP) rmSync(userData, { recursive: true, force: true });
rmSync(collection, { recursive: true, force: true });
mkdirSync(shots, { recursive: true });
const notes = join(collection, "sources", "notes");
mkdirSync(notes, { recursive: true });
writeFileSync(join(notes, "source.md"), "# Notes\n\nGradient descent takes small steps against the gradient of the loss.\n");
writeFileSync(join(notes, "text.md"), "<!-- page 1 -->\n# Notes\n\nGradient descent takes small steps against the gradient of the loss.\n");
writeFileSync(join(notes, "source.json"), JSON.stringify({ id: "notes", kind: "markdown", title: "Notes", file: "source.md", pages: 1, added: "2026-10-01T10:00:00Z", hasText: true }, null, 2));
writeFileSync(join(collection, "qrabbit.json"), JSON.stringify({ id: "col_probe_linux", name: "Linux probe", created: "2026-10-01T09:00:00Z", settings: {} }, null, 2));

const log = (...a) => console.log(`[probe-linux] ${a.join(" ")}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expect = (cond, msg) => { if (!cond) throw new Error(`check failed: ${msg}`); log("ok:", msg); };
async function waitFor(page, fn, timeout, label) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(300);
  }
}

/** Opens the app with PATH as given, connects Claude Code, checks the window, and starts sign-in; returns the toasts. */
async function run(label, path) {
  const env = { ...process.env, PATH: path };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${userData}`, ...extraArgs], timeout: 60_000, env });
  const out = [];
  for (const name of ["stdout", "stderr"]) app.process()[name]?.on("data", (d) => out.push(d.toString()));
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".hdr", { timeout: 30_000 });
    await page.evaluate(() => window.__qrabbitStore.getState().chooseAgent("claude-code"));
    await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
    await page.waitForSelector(".sheet.article", { timeout: 30_000 });
    // A first run downloads the agent with the build's own npm.
    await waitFor(page, () => { const a = window.__qrabbitStore.getState().agent; return a?.id === "claude-code" && a.connected; }, 600_000, "Claude Code to connect");
    const s = await page.evaluate(() => {
      const hdr = getComputedStyle(document.querySelector(".hdr"));
      const r = navigator.windowControlsOverlay?.getTitlebarAreaRect();
      return {
        platform: document.querySelector(".app")?.dataset.platform,
        width: innerWidth,
        padding: [parseFloat(hdr.paddingLeft), parseFloat(hdr.paddingRight)],
        overlay: navigator.windowControlsOverlay?.visible ?? false,
        area: r ? { x: r.x, width: r.width, height: r.height } : null,
      };
    });
    log(label, "window:", JSON.stringify(s));
    expect(s.platform === "linux", "the renderer knows it is on Linux");
    expect(s.overlay && s.area, "the window controls overlay is on");
    expect(s.padding[0] === 12 + s.area.x && s.padding[1] === 6 + s.width - s.area.x - s.area.width, "the header leaves the overlay's room on both sides");
    const main = await app.evaluate(({ app: a }) => ({ name: a.getName(), desktop: process.env.CHROME_DESKTOP ?? null }));
    log(label, "main:", JSON.stringify(main));
    expect(main.desktop === "qrabbit.desktop", "the window is tied to qrabbit.desktop");
    await page.screenshot({ path: join(shots, `${label}.png`) });
    if (process.env.PROBE_X11) {
      // On X11 the app can capture its own window, buttons and all; Wayland would ask the user through a portal.
      await sleep(1000);
      const png = await app.evaluate(async ({ desktopCapturer }) => {
        const [source] = (await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 2000, height: 1400 } })).filter((s) => s.name.includes("Qrabbit"));
        return source ? source.thumbnail.toPNG().toString("base64") : null;
      });
      if (png) {
        writeFileSync(join(shots, `${label}-window.png`), Buffer.from(png, "base64"));
        log(label, "window capture:", join(shots, `${label}-window.png`));
      } else log(label, "no window to capture");
    }
    if (process.env.PROBE_HOLD_MS) {
      log(label, `holding the window open for ${process.env.PROBE_HOLD_MS} ms`);
      await sleep(Number(process.env.PROBE_HOLD_MS));
    }
    await page.evaluate(() => window.__qrabbitStore.getState().loginAgent("claude-ai-login"));
    await sleep(1500);
    return await page.evaluate(() => window.__qrabbitStore.getState().toasts.map((t) => t.text));
  } finally {
    await app.close().catch(() => {});
    const lines = out.join("").split("\n").filter((l) => /\[agent\]|\[qrabbit\]/.test(l));
    if (lines.length) log(label, "app log:\n  " + lines.join("\n  "));
  }
}

// No terminal on PATH: sign-in fails with a toast naming the script to run.
const bare = process.env.PATH.split(":").filter((d) => !["x-terminal-emulator", "xdg-terminal-exec", "gnome-terminal", "konsole", "xterm"].some((t) => existsSync(join(d, t)))).join(":");
let toasts = await run("no-terminal", bare);
log("toasts:", JSON.stringify(toasts));
expect(toasts.some((t) => t.includes("No terminal app found") && t.includes("sign-in.sh")), "with no terminal, sign-in says what to run");
if (process.env.PROBE_HOLD_MS) process.exit(0);

// A stand-in x-terminal-emulator that records how it was called.
mkdirSync(fakeBin, { recursive: true });
rmSync(termLog, { force: true });
writeFileSync(join(fakeBin, "x-terminal-emulator"), `#!/bin/bash\nprintf '%s\\n' "$@" > '${termLog}'\n`);
chmodSync(join(fakeBin, "x-terminal-emulator"), 0o755);
toasts = await run("fake-terminal", `${fakeBin}:${bare}`);
log("toasts:", JSON.stringify(toasts));
expect(toasts.some((t) => t.startsWith("A terminal window opened")), "with a terminal, sign-in says one opened");
await sleep(500);
expect(existsSync(termLog), "the terminal was started");
const args = readFileSync(termLog, "utf8").trim().split("\n");
log("terminal args:", JSON.stringify(args));
expect(args[0] === "-e" && args[1] === "bash" && args.length === 3, "x-terminal-emulator gets -e bash <script>");
const script = readFileSync(args[2], "utf8");
log("script:\n" + script);
execFileSync("bash", ["-n", args[2]]);
log("ok: the script parses as bash");
const node = /^'([^']+)'/.exec(script.split("\n").find((l) => l.includes("'auth' 'login'")) ?? "")?.[1];
expect(node && existsSync(node) && node.includes("/resources/node/"), `the sign-in runs on the build's own Node: ${node}`);
log("done");
