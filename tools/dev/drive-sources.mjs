#!/usr/bin/env node
// Drives the built desktop app through the reading list: order, read marks, removal with undo,
// adding from a folder, the switcher and the home counts. Takes screenshots and never talks to the agent.
// Usage: node tools/dev/drive-sources.mjs <work-dir> [sample.pdf]
// Build first: pnpm --filter @qrabbit/desktop build
import { _electron as electron } from "playwright-core";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const workDir = resolve(process.argv[2] ?? join(here, "out"));
const samplePdf = resolve(process.argv[3] ?? join(workDir, "sample.pdf"));
const shots = join(workDir, "shots-sources");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const run = join(workDir, "runs", runId);
const collection = join(run, "collection-sources");
const papers = join(run, "papers");
const userData = join(workDir, "user-data");
mkdirSync(shots, { recursive: true });
mkdirSync(userData, { recursive: true });
if (!existsSync(samplePdf)) throw new Error(`sample PDF missing: ${samplePdf} (run tools/dev/sample-pdf.mjs)`);

// ----- a collection with three sources, oldest first: an article, the sample PDF, a note -----
const src = (id, extra) => {
  const dir = join(collection, "sources", id);
  mkdirSync(dir, { recursive: true });
  return dir;
};
const notes = src("manifold-notes");
writeFileSync(join(notes, "source.md"), "# Manifold hypothesis notes\n\nThe representation lies near a curved surface of low dimension.\n\nPCA fits a flat subspace, so it overestimates the dimension.\n");
writeFileSync(join(notes, "text.md"), `<!-- page 1 -->\n${readFileSync(join(notes, "source.md"), "utf8")}`);
writeFileSync(join(notes, "source.json"), JSON.stringify({ id: "manifold-notes", kind: "markdown", title: "Manifold hypothesis notes", file: "source.md", pages: 1, added: "2026-09-20T10:00:00Z", hasText: true }, null, 2));
const pdf = src("intrinsic-dimension");
copyFileSync(samplePdf, join(pdf, "source.pdf"));
writeFileSync(join(pdf, "source.json"), JSON.stringify({ id: "intrinsic-dimension", kind: "pdf", title: "Intrinsic Dimension of Learned Representations", file: "source.pdf", added: "2026-09-21T10:00:00Z", hasText: false }, null, 2));
const pca = src("pca-note");
writeFileSync(join(pca, "source.md"), "# A note on PCA and curved data\n\nShort note.\n");
writeFileSync(join(pca, "text.md"), `<!-- page 1 -->\n${readFileSync(join(pca, "source.md"), "utf8")}`);
writeFileSync(join(pca, "source.json"), JSON.stringify({ id: "pca-note", kind: "markdown", title: "A note on PCA and curved data", file: "source.md", pages: 1, added: "2026-09-22T10:00:00Z", hasText: true }, null, 2));
// A fresh id per run: the app remembers the last source per collection id in local storage, and this run
// expects the first source in order to open.
writeFileSync(join(collection, "qrabbit.json"), JSON.stringify({ id: `col_drive_${runId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`, name: "Representation geometry", created: "2026-09-20T09:00:00Z", settings: {} }, null, 2));

// ----- a folder to add from: one duplicate of the PDF, two new PDFs, notes in a subfolder, one file to skip -----
mkdirSync(join(papers, "notes"), { recursive: true });
mkdirSync(join(papers, "old"), { recursive: true });
copyFileSync(samplePdf, join(papers, "facco-2017-twonn.pdf"));
copyFileSync(samplePdf, join(papers, "ansuini-2019-intrinsic-dimension.pdf"));
appendFileSync(join(papers, "ansuini-2019-intrinsic-dimension.pdf"), "\n%ansuini\n");
copyFileSync(samplePdf, join(papers, "old", "tenenbaum-2000-isomap.pdf"));
appendFileSync(join(papers, "old", "tenenbaum-2000-isomap.pdf"), "\n%isomap\n");
writeFileSync(join(papers, "notes", "reading-notes.md"), "# Reading notes\n\nTwoNN uses the two nearest neighbours.\n");
writeFileSync(join(papers, "notes", "pca-vs-twonn.md"), "# PCA vs TwoNN\n\nA comparison.\n");
writeFileSync(join(papers, "figure.png"), "not a source");

const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const log = (...a) => console.log(`[drive-sources] ${a.join(" ")}`);
async function waitFor(page, fn, { timeout = 30_000, interval = 250, label = "condition", arg = undefined } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f }); log("screenshot", f); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const order = () => JSON.parse(readFileSync(join(collection, "qrabbit.json"), "utf8")).order;
const rowIds = (page) => page.$$eval(".list .row", (rs) => rs.map((r) => r.dataset.id));
const expect = (cond, msg) => { if (!cond) throw new Error(`check failed: ${msg}`); log("ok:", msg); };

const consoleErrors = [];
const env = { ...process.env, QRABBIT_TRUST_FOLDERS: papers };
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

  // open through the store; the oldest source (the article) opens first
  await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
  await page.waitForSelector(".sheet.article", { timeout: 30_000 });
  expect(JSON.stringify(await page.evaluate(() => window.__qrabbitStore.getState().collection.sources.map((s) => s.id))) === JSON.stringify(["manifold-notes", "intrinsic-dimension", "pca-note"]), "sources listed oldest first when the manifest has no order");

  // ----- the list page -----
  await page.evaluate(() => window.__qrabbitStore.getState().showList());
  await page.waitForSelector(".list .row", { timeout: 10_000 });
  await sleep(300);
  await shot(page, "01-list");
  expect((await page.textContent(".hsrc .hpill")).includes("Reading list"), "the source pill reads Reading list");
  await page.hover(".list .row:nth-child(2)");
  await sleep(200);
  await shot(page, "02-list-hover");

  // ----- read mark -----
  await page.hover(".list .row:nth-child(3)");
  await page.click(".list .row:nth-child(3) .done");
  await waitFor(page, () => document.querySelector(".list .row:nth-child(3)")?.hasAttribute("data-read"), { label: "the read mark" });
  const readJson = JSON.parse(readFileSync(join(pca, "source.json"), "utf8"));
  expect(typeof readJson.read === "string", `source.json carries read=${readJson.read}`);
  await sleep(200);
  await shot(page, "03-read");

  // ----- drag the first row below the third -----
  const grip = await page.$(".list .row:nth-child(1) .ord");
  const target = await page.$(".list .row:nth-child(3)");
  const gb = await grip.boundingBox();
  const tb = await target.boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + 20, { steps: 4 });
  await page.mouse.move(tb.x + 200, tb.y + tb.height * 0.8, { steps: 10 });
  await sleep(100);
  await shot(page, "04-dragging");
  await page.mouse.up();
  const diag = async () => page.evaluate(() => {
    const st = window.__qrabbitStore.getState();
    return { dragging: !!document.querySelector(".row.dragging"), rows: [...document.querySelectorAll(".list .row")].map((r) => r.dataset.id), store: st.collection.sources.map((s) => s.id), toasts: st.toasts.map((t) => t.text) };
  });
  await sleep(600);
  let after = await diag();
  log("after drag:", JSON.stringify(after));
  if (after.rows[2] !== "manifold-notes") {
    log("drag did not reorder; trying once more, slower");
    const g2 = await (await page.$(".list .row:nth-child(1) .ord")).boundingBox();
    const t2 = await (await page.$(".list .row:nth-child(3)")).boundingBox();
    await page.mouse.move(g2.x + g2.width / 2, g2.y + g2.height / 2);
    await sleep(100);
    await page.mouse.down();
    await sleep(100);
    for (let i = 1; i <= 12; i++) { await page.mouse.move(g2.x + g2.width / 2 + (t2.x + 200 - g2.x) * (i / 12), g2.y + (t2.y + t2.height * 0.8 - g2.y) * (i / 12)); await sleep(30); }
    await sleep(100);
    await page.mouse.up();
    await sleep(600);
    after = await diag();
    log("after second drag:", JSON.stringify(after));
  }
  await waitFor(page, () => document.querySelector(".list .row:nth-child(3)")?.dataset.id === "manifold-notes", { label: "the drag to reorder" });
  await sleep(200);
  expect(JSON.stringify(order()) === JSON.stringify(["intrinsic-dimension", "pca-note", "manifold-notes"]), `qrabbit.json order after drag: ${JSON.stringify(order())}`);
  await shot(page, "05-reordered");

  // ----- keyboard: Ctrl+Up moves the focused row -----
  await page.focus(".list .row:nth-child(3)");
  await page.keyboard.press("Control+ArrowUp");
  await waitFor(page, () => document.querySelector(".list .row:nth-child(2)")?.dataset.id === "manifold-notes", { label: "Ctrl+Up to move the row" });
  await sleep(150);
  expect(JSON.stringify(order()) === JSON.stringify(["intrinsic-dimension", "manifold-notes", "pca-note"]), `order after Ctrl+Up: ${JSON.stringify(order())}`);
  expect(await page.evaluate(() => document.activeElement?.dataset.id) === "manifold-notes", "the moved row keeps focus");

  // ----- row menu, remove, undo -----
  await page.hover(".list .row:nth-child(1)");
  await page.click(".list .row:nth-child(1) .more");
  await page.waitForSelector(".list .row .menu", { timeout: 5_000 });
  await sleep(200);
  await shot(page, "06-row-menu");
  await page.click(".list .row .menu .mi.danger");
  await waitFor(page, () => document.querySelectorAll(".list .row").length === 2, { label: "the row to leave" });
  await page.waitForSelector(".toast .taction", { timeout: 5_000 });
  await sleep(200);
  await shot(page, "07-removed");
  const trash = join(collection, ".qrabbit", "trash");
  const stamps = existsSync(trash) ? readdirSync(trash) : [];
  expect(stamps.length === 1 && existsSync(join(trash, stamps[0], "intrinsic-dimension", "source.pdf")), `the source folder is in the trash: ${stamps[0]}`);
  expect(!existsSync(join(collection, "sources", "intrinsic-dimension")), "the source folder is gone from sources/");
  expect(JSON.stringify(order()) === JSON.stringify(["manifold-notes", "pca-note"]), `order after remove: ${JSON.stringify(order())}`);
  await page.click(".toast .taction");
  await waitFor(page, () => document.querySelectorAll(".list .row").length === 3, { label: "undo to bring the row back" });
  await sleep(200);
  expect(JSON.stringify(await rowIds(page)) === JSON.stringify(["intrinsic-dimension", "manifold-notes", "pca-note"]), `rows after undo: ${JSON.stringify(await rowIds(page))}`);
  expect(existsSync(join(collection, "sources", "intrinsic-dimension", "source.pdf")), "the source folder is back");
  expect(readdirSync(trash).length === 0, "the trash is empty again");
  await shot(page, "08-restored");

  // ----- Ctrl+L: back to the paper, then the list again -----
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Control+l");
  await page.waitForSelector(".sheet.article", { timeout: 10_000 });
  expect(true, "Ctrl+L returned to the article");
  await page.keyboard.press("Control+l");
  await page.waitForSelector(".list .row", { timeout: 10_000 });

  // ----- add from a folder (the dialog cannot be scripted, so the scan is fed to the store) -----
  const scan = await page.evaluate(async ([c, dir]) => window.qrabbit.sources.scanFolder(c, dir, { recursive: true }), [collection, papers]);
  log("scan:", JSON.stringify(scan.files.map((f) => `${f.rel}${f.existing ? " (in collection)" : ""}`)), "skipped", scan.skipped);
  expect(scan.files.length === 5 && scan.skipped === 1, "the scan lists five eligible files and skips one");
  expect(scan.files.find((f) => f.name === "facco-2017-twonn.pdf")?.existing?.id === "intrinsic-dimension", "the duplicate PDF is recognised by content");
  await page.evaluate((s) => window.__qrabbitStore.setState({ folderScan: s, folderBusy: false }), scan);
  await page.waitForSelector(".dialog.folder .frow", { timeout: 5_000 });
  await sleep(300);
  await shot(page, "09-folder");
  expect((await page.$$(".dialog.folder .frow.off")).length === 1, "the duplicate row is disabled");
  await page.click("#folder-recursive");
  await waitFor(page, () => document.querySelectorAll(".dialog.folder .frow").length === 2, { label: "subfolders to drop out of the list" });
  await page.click("#folder-recursive");
  await waitFor(page, () => document.querySelectorAll(".dialog.folder .frow").length === 5, { label: "subfolders to come back" });
  await page.click(".dialog.folder .frow:has-text('tenenbaum-2000-isomap.pdf') input");
  const footer = await page.textContent(".dialog.folder .dfoot .cnt");
  expect(footer.startsWith("3 of 4"), `footer counts the selection: ${footer}`);
  await shot(page, "10-folder-picked");
  await page.click(".dialog.folder .dfoot .btn.primary");
  await waitFor(page, () => !document.querySelector(".dialog.folder") && document.querySelectorAll(".list .row").length === 6, { label: "the picked files to be added" });
  await sleep(300);
  await shot(page, "11-added");
  const ids = await rowIds(page);
  // new sources land at the end, in the picker's order (root files first, then each subfolder, alphabetical)
  expect(JSON.stringify(ids) === JSON.stringify(["intrinsic-dimension", "manifold-notes", "pca-note", "ansuini-2019-intrinsic-dimension", "pca-vs-twonn", "reading-notes"]), `rows after adding: ${JSON.stringify(ids)}`);
  expect(JSON.stringify(order()) === JSON.stringify(ids), "qrabbit.json order matches the rows");
  const toast = await page.textContent(".toast").catch(() => "");
  log("toast:", toast);

  // ----- the switcher -----
  await page.click(".hsrc .hpill");
  await page.waitForSelector(".hsrc .menu .mi", { timeout: 5_000 });
  await sleep(250);
  await shot(page, "12-switcher");
  expect((await page.textContent(".hsrc .menu")).includes("Reading list"), "the switcher leads to the reading list");
  expect((await page.$$(".hsrc .menu .mi[data-read]")).length === 1, "the read source is marked in the switcher");
  await page.keyboard.press("Escape");

  // ----- home counts -----
  await page.evaluate(() => window.__qrabbitStore.getState().goHome());
  await waitFor(page, () => !!document.querySelector(".coll .m"), { label: "the home screen" });
  await sleep(300);
  await shot(page, "13-home");
  const home = await page.textContent(".colls");
  expect(home.includes("6 sources · 1 read"), `home shows the counts: ${home.replace(/\s+/g, " ").slice(0, 120)}`);

  log("console errors:", consoleErrors.length ? "\n" + consoleErrors.join("\n") : "(none)");
  log("done");
} finally {
  await app?.close().catch(() => {});
}
