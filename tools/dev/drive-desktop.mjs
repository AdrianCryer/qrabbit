#!/usr/bin/env node
// Drives the built desktop app through the step-1 flow and takes screenshots.
// Usage: node tools/dev/drive-desktop.mjs <work-dir> [sample.pdf]
//   work-dir receives a test collection folder and a shots/ folder.
// Build first: pnpm --filter @qrabbit/desktop build
import { _electron as electron } from "playwright-core";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const workDir = resolve(process.argv[2] ?? join(here, "out"));
const samplePdf = resolve(process.argv[3] ?? join(workDir, "sample.pdf"));
const shots = join(workDir, "shots");
// A fresh collection per run: nothing has to be deleted, so a straggling process cannot block a run.
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const collection = join(workDir, "runs", runId, "collection-test");
// A private user-data folder: test collections must not appear in the developer's own Recent list.
const userData = join(workDir, "user-data");
mkdirSync(shots, { recursive: true });
mkdirSync(userData, { recursive: true });

// ----- a collection with one source, the way the app would have written it -----
const srcDir = join(collection, "sources", "intrinsic-dimension");
mkdirSync(srcDir, { recursive: true });
if (!existsSync(samplePdf)) throw new Error(`sample PDF missing: ${samplePdf} (run tools/dev/sample-pdf.mjs)`);
copyFileSync(samplePdf, join(srcDir, "source.pdf"));
writeFileSync(
  join(srcDir, "source.json"),
  JSON.stringify({ id: "intrinsic-dimension", kind: "pdf", title: "Intrinsic Dimension of Learned Representations", file: "source.pdf", added: new Date().toISOString(), hasText: false }, null, 2),
);

const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const log = (...a) => console.log(`[drive] ${a.join(" ")}`);
// The renderer's CSP forbids eval, which Playwright's waitForFunction relies on; poll with evaluate instead.
async function waitFor(page, fn, { timeout = 30_000, interval = 300, label = "condition", arg = undefined } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f }); log("screenshot", f); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const consoleErrors = [];
// Tools that themselves run inside Electron export ELECTRON_RUN_AS_NODE, which would turn our
// app into a bare Node process. The app must not inherit it.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronBin, args: [appDir, `--user-data-dir=${userData}`], timeout: 60_000, env });
  log("collection:", collection);
  const page = await app.firstWindow();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.waitForSelector(".hdr", { timeout: 30_000 });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  await sleep(500);
  await shot(page, "01-home");

  // open the collection through the store (the folder dialog cannot be scripted)
  await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
  await page.waitForSelector(".page canvas", { timeout: 30_000 });
  await page.waitForSelector(".textLayer span", { timeout: 30_000 });
  await waitFor(page, () => !document.querySelector(".rstatus"), { label: "text extraction" });
  await sleep(600);
  await shot(page, "02-reader");
  log("text.md written:", existsSync(join(srcDir, "text.md")));

  // select three lines of the first page by building a DOM range over text-layer spans
  const selected = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".page[data-page='1'] .textLayer span")];
    const a = spans.find((s) => s.textContent.includes("We hypothesise"));
    const b = spans.find((s) => s.textContent.includes("stable across the later layers"));
    if (!a || !b) return { ok: false, count: spans.length, sample: spans.slice(0, 5).map((s) => s.textContent) };
    const range = document.createRange();
    range.setStart(a.firstChild, 0);
    range.setEnd(b.firstChild, b.firstChild.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.querySelector(".rscroll").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { ok: true, text: sel.toString().slice(0, 120) };
  });
  log("selection:", JSON.stringify(selected));
  const debug = await page.evaluate(() => {
    const pageEl = document.querySelector(".page[data-page='1']");
    const tl = pageEl.querySelector(".textLayer");
    const span = [...tl.querySelectorAll("span")].find((s) => s.textContent.includes("We hypothesise"));
    const cs = getComputedStyle(span);
    const r = span.getBoundingClientRect();
    const pr = pageEl.getBoundingClientRect();
    const c = document.createElement("canvas").getContext("2d");
    c.font = `${cs.fontSize} ${cs.fontFamily}`;
    return {
      pageWidth: pr.width,
      tlVars: { sf: tl.style.getPropertyValue("--scale-factor"), tsf: tl.style.getPropertyValue("--total-scale-factor") },
      inline: span.getAttribute("style"),
      computed: { fontFamily: cs.fontFamily, fontSize: cs.fontSize, transform: cs.transform, letterSpacing: cs.letterSpacing },
      rect: { left: r.left - pr.left, width: r.width, height: r.height },
      measuredAtComputedFont: c.measureText(span.textContent).width,
      text: span.textContent,
    };
  });
  log("span-debug:", JSON.stringify(debug));
  await page.waitForSelector(".seltool", { timeout: 10_000 });
  await sleep(300);
  await shot(page, "03-selection");

  // Explore → a thread anchored to the selection; then Undo on the toast removes it again
  await page.evaluate(() => document.querySelector(".seltool .primary").click());
  await page.waitForSelector(".panel", { timeout: 10_000 });
  await page.waitForSelector(".hl", { timeout: 10_000 });
  await page.waitForSelector(".toast .taction", { timeout: 5_000 });
  await sleep(300);
  await shot(page, "04a-thread-undo");
  await page.evaluate(() => document.querySelector(".toast .taction").click());
  await waitFor(page, () => !document.querySelector(".panel") && !document.querySelector(".hl"), { label: "the undo to remove the thread" });
  const afterUndo = existsSync(join(collection, "threads")) ? readdirSync(join(collection, "threads")).filter((f) => f.endsWith(".md")) : [];
  log("thread files after undo:", afterUndo.join(", ") || "(none)");
  // …and Explore once more to carry on
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".page[data-page='1'] .textLayer span")];
    const a = spans.find((s) => s.textContent.includes("We hypothesise"));
    const b = spans.find((s) => s.textContent.includes("stable across the later layers"));
    const range = document.createRange();
    range.setStart(a.firstChild, 0);
    range.setEnd(b.firstChild, b.firstChild.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.querySelector(".rscroll").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.waitForSelector(".seltool", { timeout: 10_000 });
  await page.evaluate(() => document.querySelector(".seltool .primary").click());
  await page.waitForSelector(".panel", { timeout: 10_000 });
  await page.waitForSelector(".hl", { timeout: 10_000 });
  await sleep(500);
  await shot(page, "04-thread");
  const layout = await page.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) }; };
    return {
      innerWidth: window.innerWidth,
      app: r(".app"), main: r(".main"), reader: r(".reader"), divider: r(".divider"), panel: r(".panel"), phead: r(".phead"), composer: r(".composer"), pactions: r(".pactions"),
      columns: getComputedStyle(document.querySelector(".main")).gridTemplateColumns,
      panelVar: getComputedStyle(document.querySelector(".app")).getPropertyValue("--panel-w"),
    };
  });
  log("layout:", JSON.stringify(layout));

  // Keyboard: Escape collapses the panel, Ctrl+B brings it back, Ctrl+, opens Settings, Escape closes it.
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Escape");
  await waitFor(page, () => !window.__qrabbitStore.getState().panelOpen, { label: "panel to collapse on Escape" });
  await page.keyboard.press("Control+b");
  await waitFor(page, () => window.__qrabbitStore.getState().panelOpen, { label: "panel to reopen on Ctrl+B" });
  await page.keyboard.press("Control+,");
  await page.waitForSelector(".dialog", { timeout: 5_000 });
  await sleep(300);
  await shot(page, "04b-settings");
  await page.keyboard.press("Escape");
  await waitFor(page, () => !document.querySelector(".dialog"), { label: "settings to close on Escape" });
  log("keyboard: escape, ctrl+b, ctrl+, all handled");
  const threadsDir = join(collection, "threads");
  const files = existsSync(threadsDir) ? readdirSync(threadsDir).filter((f) => f.endsWith(".md")) : [];
  log("thread files:", files.join(", ") || "(none)");
  for (const f of files) console.log("----- " + f + "\n" + readFileSync(join(threadsDir, f), "utf8"));

  // Ask here → quote lands in the composer of the focused thread, then a message is saved
  const selected2 = await page.evaluate(() => {
    const spans = [...document.querySelectorAll(".page[data-page='1'] .textLayer span")];
    const a = spans.find((s) => s.textContent.includes("PCA retaining"));
    if (!a) return { ok: false };
    const range = document.createRange();
    range.selectNodeContents(a);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.querySelector(".rscroll").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { ok: true, text: sel.toString() };
  });
  log("selection 2:", JSON.stringify(selected2));
  await page.waitForSelector(".seltool", { timeout: 10_000 });
  const primaryLabel = await page.evaluate(() => document.querySelector(".seltool .primary")?.textContent?.trim());
  log("primary action with a thread focused:", primaryLabel);
  await page.evaluate(() => document.querySelector(".seltool .primary").click());
  await page.waitForSelector(".cq", { timeout: 10_000 });
  await page.fill(".composer textarea", "Why does a flat subspace overestimate k?");
  await shot(page, "05-askhere");
  if (process.env.DRIVE_NO_AGENT) {
    log("DRIVE_NO_AGENT set: stopping before any agent turn");
    throw Object.assign(new Error("early stop"), { name: "EarlyStop" });
  }
  await page.evaluate(() => document.querySelector(".composer .send").click());
  await page.waitForSelector(".msg.user .quote", { timeout: 30_000 });
  await sleep(500);

  // The send goes to the real agent over ACP. Watch the turn stream, then wait for it to finish.
  const agentStatus = await page.evaluate(() => window.__qrabbitStore.getState().agent);
  log("agent status:", JSON.stringify(agentStatus));
  await sleep(4000);
  await shot(page, "06-working");
  const midTurn = await page.evaluate(() => {
    const s = window.__qrabbitStore.getState();
    const t = s.thread ? s.turns[s.thread.id] : null;
    return t ? { running: t.running, activity: t.activity.map((a) => `${a.title} [${a.kind ?? "?"}:${a.status ?? "?"}]`), textLen: t.text.length, permission: t.permission?.title ?? null } : null;
  });
  log("mid-turn:", JSON.stringify(midTurn));
  await waitFor(
    page,
    () => {
      const s = window.__qrabbitStore.getState();
      return !!(s.thread && !s.turns[s.thread.id] && s.thread.messages.some((m) => m.role === "assistant"));
    },
    { timeout: 240_000, interval: 1000, label: "the agent's reply" },
  );
  await sleep(600);
  await shot(page, "07-answer");
  const options = await page.evaluate(() => {
    const s = window.__qrabbitStore.getState();
    return (s.thread && s.configOptions[s.thread.id]) ? s.configOptions[s.thread.id].map((o) => `${o.id}=${o.currentValue}`) : null;
  });
  log("config options:", JSON.stringify(options));
  for (const f of readdirSync(threadsDir).filter((x) => x.endsWith(".md"))) console.log("----- " + f + " (after the agent answered)\n" + readFileSync(join(threadsDir, f), "utf8"));

  // ----- branching: select inside the answer, Explore, wait for the handoff, ask in the branch -----
  const parentId = await page.evaluate(() => window.__qrabbitStore.getState().thread.id);
  const picked = await page.evaluate(() => {
    const md = [...document.querySelectorAll(".msg.assistant[data-msg-id] .md")].pop();
    const p = md?.querySelector("p");
    const walker = p ? document.createTreeWalker(p, NodeFilter.SHOW_TEXT) : null;
    const node = walker?.nextNode();
    if (!node || node.data.trim().length < 20) return { ok: false };
    const words = node.data.split(" ");
    const end = Math.min(node.data.length, words.slice(0, 6).join(" ").length);
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, end);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.querySelector(".msgs").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { ok: true, text: sel.toString() };
  });
  log("answer selection:", JSON.stringify(picked));
  await page.waitForSelector(".seltool.msg-tool", { timeout: 10_000 });
  await shot(page, "08-answer-selection");
  await page.evaluate(() => document.querySelector(".seltool.msg-tool .primary").click());
  await waitFor(page, () => { const s = window.__qrabbitStore.getState(); return !!(s.thread && s.thread.parent); }, { label: "branch to open" });
  await sleep(500);
  await shot(page, "09-branch");
  await waitFor(page, () => !!window.__qrabbitStore.getState().thread?.handoff, { timeout: 180_000, interval: 1000, label: "the handoff" });
  await sleep(400);
  await shot(page, "10-handoff");
  log("handoff:", JSON.stringify((await page.evaluate(() => window.__qrabbitStore.getState().thread.handoff)).slice(0, 300)));

  await page.fill(".composer textarea", "Give me the simplest concrete example of this, in one short paragraph.");
  await page.evaluate(() => document.querySelector(".composer .send").click());
  await waitFor(page, () => { const s = window.__qrabbitStore.getState(); return !!(s.thread && s.thread.parent && !s.turns[s.thread.id] && s.thread.messages.some((m) => m.role === "assistant")); }, { timeout: 240_000, interval: 1000, label: "the branch answer" });
  await sleep(500);
  await shot(page, "11-branch-answer");

  // ----- back to the parent by breadcrumb: the branch is marked in the answer; asking again attaches its digest -----
  await page.evaluate(() => document.querySelector(".crumbs button").click());
  await waitFor(page, (id) => window.__qrabbitStore.getState().thread?.id === id, { label: "parent to open", arg: parentId });
  await page.waitForSelector(".bmark", { timeout: 15_000 }).catch(() => log("no branch marker rendered in the parent answer"));
  await sleep(400);
  await shot(page, "12-parent-marker");
  await sleep(4000); // let the branch summary land
  await page.fill(".composer textarea", "Given what I explored in the branch, what should I read next in this paper?");
  await page.evaluate(() => document.querySelector(".composer .send").click());
  await waitFor(page, () => { const s = window.__qrabbitStore.getState(); return !!(s.thread && !s.thread.parent && !s.turns[s.thread.id] && s.thread.messages.filter((m) => m.role === "assistant").length >= 2); }, { timeout: 240_000, interval: 1000, label: "the second parent answer" });
  await sleep(500);
  await shot(page, "13-parent-again");
  const ctx = await page.evaluate(() => { const s = window.__qrabbitStore.getState(); const u = [...s.thread.messages].reverse().find((m) => m.role === "user"); return u?.context ?? null; });
  log("context on the last parent message:", JSON.stringify(ctx));
  const walkAll = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkAll(join(d, e.name)) : e.name.endsWith(".md") ? [join(d, e.name)] : []));
  for (const f of walkAll(threadsDir)) console.log("----- " + f.slice(threadsDir.length + 1) + "\n" + readFileSync(f, "utf8"));

  // reader state was saved?
  const rs = join(collection, ".qrabbit", "reader-state.json");
  log("reader-state:", existsSync(rs) ? readFileSync(rs, "utf8").replace(/\s+/g, " ") : "(none yet)");
  const textMd = readFileSync(join(srcDir, "text.md"), "utf8");
  log("text.md head:", JSON.stringify(textMd.slice(0, 160)));
} catch (err) {
  if (err?.name !== "EarlyStop") throw err;
} finally {
  if (consoleErrors.length) { console.log("----- renderer console"); for (const e of consoleErrors) console.log(e); }
  await app?.close().catch(() => {});
}
