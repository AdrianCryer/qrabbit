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
const collection = join(workDir, "collection-test");
mkdirSync(shots, { recursive: true });

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
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f }); log("screenshot", f); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const consoleErrors = [];
// Tools that themselves run inside Electron export ELECTRON_RUN_AS_NODE, which would turn our
// app into a bare Node process. The app must not inherit it.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronBin, args: [appDir], timeout: 60_000, env });
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
  await page.waitForFunction(() => !document.querySelector(".rstatus"), null, { timeout: 30_000 });
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

  // Explore → a thread anchored to the selection
  await page.evaluate(() => document.querySelector(".seltool .primary").click());
  await page.waitForSelector(".panel", { timeout: 10_000 });
  await page.waitForSelector(".hl", { timeout: 10_000 });
  await sleep(500);
  await shot(page, "04-thread");
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
  await page.evaluate(() => document.querySelector(".composer .send").click());
  await page.waitForSelector(".msg.user .quote", { timeout: 10_000 });
  await sleep(500);
  await shot(page, "05-askhere");
  for (const f of readdirSync(threadsDir).filter((x) => x.endsWith(".md"))) console.log("----- " + f + " (after Ask here)\n" + readFileSync(join(threadsDir, f), "utf8"));

  // reader state was saved?
  const rs = join(collection, ".qrabbit", "reader-state.json");
  log("reader-state:", existsSync(rs) ? readFileSync(rs, "utf8").replace(/\s+/g, " ") : "(none yet)");
  const textMd = readFileSync(join(srcDir, "text.md"), "utf8");
  log("text.md head:", JSON.stringify(textMd.slice(0, 160)));
} finally {
  if (consoleErrors.length) { console.log("----- renderer console"); for (const e of consoleErrors) console.log(e); }
  await app?.close().catch(() => {});
}
