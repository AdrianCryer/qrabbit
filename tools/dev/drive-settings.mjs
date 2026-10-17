#!/usr/bin/env node
// Checks that Settings offers the agent's models before any thread exists, that a collection default
// is applied to a new thread's session, and that the agent's own default is named. Starts agent
// sessions (needs the machine's Claude Code sign-in) but sends no prompt, so it spends no usage.
// Usage: node tools/dev/drive-settings.mjs <work-dir>
// Build first: pnpm --filter @qrabbit/desktop build
import { _electron as electron } from "playwright-core";
import { appLaunch } from "./launch.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const workDir = resolve(process.argv[2] ?? join(here, "out"));
const shots = join(workDir, "shots-settings");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const collection = join(workDir, "runs", runId, "collection-settings");
const userData = join(workDir, "user-data");
mkdirSync(shots, { recursive: true });
mkdirSync(userData, { recursive: true });

const notes = join(collection, "sources", "notes");
mkdirSync(notes, { recursive: true });
writeFileSync(join(notes, "source.md"), "# Notes\n\nA short note to have something open.\n");
writeFileSync(join(notes, "text.md"), "<!-- page 1 -->\n# Notes\n\nA short note to have something open.\n");
writeFileSync(join(notes, "source.json"), JSON.stringify({ id: "notes", kind: "markdown", title: "Notes", file: "source.md", pages: 1, added: "2026-09-20T10:00:00Z", hasText: true }, null, 2));
writeFileSync(join(collection, "qrabbit.json"), JSON.stringify({ id: `col_settings_${runId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`, name: "Settings check", created: "2026-09-20T09:00:00Z", settings: {} }, null, 2));

const { executablePath, args: appArgs } = appLaunch(appDir);
const log = (...a) => console.log(`[drive-settings] ${a.join(" ")}`);
async function waitFor(page, fn, { timeout = 60_000, interval = 300, label = "condition", arg = undefined } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
const shot = async (page, name) => { const f = join(shots, `${name}.png`); await page.screenshot({ path: f }); log("screenshot", f); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const expect = (cond, msg) => { if (!cond) throw new Error(`check failed: ${msg}`); log("ok:", msg); };

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath, args: [...appArgs, `--user-data-dir=${userData}`], timeout: 60_000, env });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".hdr", { timeout: 30_000 });
  // A packaged build, or a dev build asked to behave like one, downloads the agent on its first pick: minutes, once.
  const DOWNLOAD_MS = process.env.QRABBIT_APP || process.env.QRABBIT_AGENTS_MANAGED ? 600_000 : 0;
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  // The agent choice persists in the user-data folder; this check is about Claude Code's options.
  await page.evaluate(() => window.__qrabbitStore.getState().chooseAgent("claude-code"));
  await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
  await page.waitForSelector(".sheet.article", { timeout: 30_000 });

  // Settings straight away, before any thread: the lists must fill from a probe session.
  await page.keyboard.press("Control+,");
  await page.waitForSelector("#settings-model", { timeout: 10_000 });
  await waitFor(page, () => document.querySelectorAll("#settings-model option").length > 1, { timeout: 90_000 + DOWNLOAD_MS, label: "the model list to fill" });
  await sleep(300);
  await shot(page, "01-settings-models");
  const models = await page.$$eval("#settings-model option", (os) => os.map((o) => ({ value: o.value, text: o.textContent })));
  const efforts = await page.$$eval("#settings-effort option", (os) => os.map((o) => ({ value: o.value, text: o.textContent })));
  log("models:", JSON.stringify(models));
  log("efforts:", JSON.stringify(efforts));
  expect(models.length > 2, "the model list has the agent's models");
  expect(/^Agent default \(.+\)$/.test(models[0].text), `the agent's own default is named: ${models[0].text}`);
  expect(efforts.length > 1, "the effort list has the agent's levels");

  // Pick a default that differs from what the agent starts on, then check a new thread's session lands on it.
  const agentDefault = await page.evaluate(() => window.__qrabbitStore.getState().knownOptions.find((o) => o.id === "model")?.currentValue);
  const pick = models.find((m) => m.value && m.value !== agentDefault && m.value !== "default") ?? models.find((m) => m.value && m.value !== agentDefault);
  expect(!!pick, `a model other than the agent default (${agentDefault}) to pick: ${pick?.value}`);
  await page.selectOption("#settings-model", pick.value);
  await waitFor(page, (v) => window.__qrabbitStore.getState().collection.manifest.settings.agents?.["claude-code"]?.model === v, { arg: pick.value, label: "the manifest to hold the default" });
  const manifest = JSON.parse(readFileSync(join(collection, "qrabbit.json"), "utf8"));
  const saved = manifest.settings.agents?.["claude-code"]?.model;
  expect(saved === pick.value, `qrabbit.json settings.agents["claude-code"].model = ${saved}`);
  await shot(page, "02-settings-picked");
  await page.keyboard.press("Escape");

  const thread = await page.evaluate((p) => window.qrabbit.threads.create(p, { title: "Default check" }), collection);
  await page.evaluate((id) => window.__qrabbitStore.getState().openThread(id), thread.id);
  await waitFor(page, (id) => !!window.__qrabbitStore.getState().configOptions[id], { arg: thread.id, timeout: 90_000 + DOWNLOAD_MS, label: "the thread's session" });
  const current = await page.evaluate((id) => window.__qrabbitStore.getState().configOptions[id].find((o) => o.id === "model")?.currentValue, thread.id);
  expect(current === pick.value, `the new thread's session runs the collection default: ${current}`);
  await sleep(300);
  await shot(page, "03-thread-picker");
  const file = readFileSync(join(collection, thread.file), "utf8");
  expect(!/^model:/m.test(file), "the thread file records no model until one is picked in its composer");

  log("page errors:", errors.length ? errors.join("\n") : "(none)");
  log("done");
} finally {
  await app?.close().catch(() => {});
}
