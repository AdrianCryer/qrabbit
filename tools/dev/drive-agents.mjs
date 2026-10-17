#!/usr/bin/env node
// Switches the agent from Claude Code to Codex and back in the built app, and checks what each step shows:
// the status pill and its menu, the sign-in methods offered (ChatGPT, never an API key), Settings, a thread
// while Codex is signed out, per-agent defaults, and, on Windows, that the adapter runs on a console Node and
// no console window appears for either agent's processes.
// With Codex signed in it checks the thread's session and models instead; DRIVE_PROMPT=1 then also sends
// one short question (spends a little of the ChatGPT plan). Never opens a sign-in page.
// Usage: node tools/dev/drive-agents.mjs <work-dir>
// Build first: pnpm --filter @qrabbit/desktop build
import { _electron as electron } from "playwright-core";
import { appLaunch } from "./launch.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const workDir = resolve(process.argv[2] ?? join(here, "out"));
const shots = join(workDir, "shots-agents");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const collection = join(workDir, "runs", runId, "collection-agents");
const userData = join(workDir, "user-data-agents");
mkdirSync(shots, { recursive: true });
mkdirSync(userData, { recursive: true });

const notes = join(collection, "sources", "notes");
mkdirSync(notes, { recursive: true });
writeFileSync(join(notes, "source.md"), "# Notes\n\nGradient descent takes small steps against the gradient of the loss.\n");
writeFileSync(join(notes, "text.md"), "<!-- page 1 -->\n# Notes\n\nGradient descent takes small steps against the gradient of the loss.\n");
writeFileSync(join(notes, "source.json"), JSON.stringify({ id: "notes", kind: "markdown", title: "Notes", file: "source.md", pages: 1, added: "2026-10-01T10:00:00Z", hasText: true }, null, 2));
writeFileSync(join(collection, "qrabbit.json"), JSON.stringify({ id: `col_agents_${runId.replace(/[^a-z0-9]/gi, "").toLowerCase()}`, name: "Agents check", created: "2026-10-01T09:00:00Z", settings: {} }, null, 2));

const { executablePath, args: appArgs } = appLaunch(appDir);
const log = (...a) => console.log(`[drive-agents] ${a.join(" ")}`);
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
const state = (page) => page.evaluate(() => {
  const s = window.__qrabbitStore.getState();
  return { agentId: s.agentId, agent: s.agent, toasts: s.toasts.map((t) => t.text) };
});
const prefs = () => JSON.parse(readFileSync(join(userData, "preferences.json"), "utf8"));
/**
 * Processes that could host a console window, with a visible top-level window and its title. A console that
 * popped up for Codex's binary shows here, in conhost or, on Windows 11, as a Windows Terminal window or tab.
 */
function codexWindows() {
  if (process.platform !== "win32") return [];
  const names = "codex*, conhost, OpenConsole, WindowsTerminal, cmd";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process ${names} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { "$($_.ProcessName) $($_.Id) $($_.MainWindowTitle)" }; exit 0`], { encoding: "utf8", windowsHide: true });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}
/** The executables running a script whose command line mentions `needle` (Windows), e.g. which program hosts an adapter. */
function hostsOf(needle) {
  if (process.platform !== "win32") return [];
  const out = execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${needle}*' -and $_.Name -ne 'powershell.exe' } | ForEach-Object { $_.ExecutablePath }; exit 0`], { encoding: "utf8", windowsHide: true });
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
// Taken before the app starts, so a window opened on Claude Code's side counts too.
const before = codexWindows();
let app;
try {
  app = await electron.launch({ executablePath, args: [...appArgs, `--user-data-dir=${userData}`], timeout: 60_000, env });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".hdr", { timeout: 30_000 });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});

  // Start from Claude Code, the default, and give it a collection default of its own.
  await page.evaluate(() => window.__qrabbitStore.getState().chooseAgent("claude-code"));
  await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
  await page.waitForSelector(".sheet.article", { timeout: 30_000 });
  await waitFor(page, () => { const a = window.__qrabbitStore.getState().agent; return a?.id === "claude-code" && a.connected; }, { label: "Claude Code to connect" });
  let s = await state(page);
  log("claude status:", JSON.stringify(s.agent));
  await page.evaluate(() => window.__qrabbitStore.getState().updateAgentDefaults({ effort: "low" }));

  // Switch to Codex.
  await page.evaluate(() => window.__qrabbitStore.getState().chooseAgent("codex"));
  await waitFor(page, () => { const a = window.__qrabbitStore.getState().agent; return a?.id === "codex" && a.connected && !!a.auth; }, { timeout: 90_000, label: "Codex to connect and report its account" });
  s = await state(page);
  log("codex status:", JSON.stringify(s.agent));
  expect(prefs().agent === "codex", "preferences.json remembers Codex");
  expect(/codex/i.test(s.agent.agent?.name ?? ""), `the adapter is Codex's: ${s.agent.agent?.name} ${s.agent.agent?.version}`);
  expect(JSON.stringify(s.agent.authMethods.map((m) => m.id)) === '["chat-gpt"]', "the only sign-in offered is ChatGPT (no API key)");
  const signedIn = s.agent.auth.kind !== "none";
  log("codex account:", s.agent.auth.kind, s.agent.auth.label);
  if (process.platform === "win32") {
    // On Electron there is no console to inherit, and Codex's processes would open windows (runtime.ts).
    const adapterHosts = hostsOf("codex-acp");
    const launcherHosts = hostsOf("codex.js");
    log("codex-acp runs on:", adapterHosts.join(", ") || "(not found)", "· codex.js runs on:", launcherHosts.join(", ") || "(not found)");
    expect(adapterHosts.length > 0 && adapterHosts.every((p) => basename(p).toLowerCase() === "node.exe"), "the Codex adapter runs on a console Node, not Electron");
    // A packaged build carries its own Node (resources/node) and must prefer it to whatever is on PATH.
    if (process.env.QRABBIT_APP) {
      const own = join(dirname(process.env.QRABBIT_APP), "resources", "node").toLowerCase();
      expect(adapterHosts.every((p) => p.toLowerCase().startsWith(own)), "the packaged build's own Node hosts the adapter");
    }
  }

  await page.click(".hdr .agent");
  await page.waitForSelector(".menu [role=menuitemradio]", { timeout: 10_000 });
  await sleep(250);
  await shot(page, "01-agent-menu");
  const menuText = await page.$eval(".menu", (m) => m.innerText);
  expect(menuText.includes("Sign in · ChatGPT subscription"), "the menu offers ChatGPT sign-in");
  expect(menuText.includes("Claude Code") && menuText.includes("Codex"), "the menu lists both agents");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+,");
  await page.waitForSelector("#settings-agent", { timeout: 10_000 });
  expect((await page.$eval("#settings-agent", (el) => el.value)) === "codex", "Settings shows Codex as this computer's agent");
  if (signedIn) {
    await waitFor(page, () => document.querySelectorAll("#settings-model option").length > 1, { timeout: 90_000, label: "Codex's models in Settings" });
    log("codex models:", JSON.stringify(await page.$$eval("#settings-model option", (os) => os.map((o) => o.textContent))));
  } else {
    await waitFor(page, () => document.querySelector(".dialog")?.textContent?.includes("Sign in to Codex to see its models"), { timeout: 60_000, label: "the sign-in hint in Settings" });
    log("ok: Settings asks for sign-in instead of an error");
  }
  expect((await page.$eval("#settings-effort", (el) => el.value)) === "", "Claude Code's effort default does not carry over to Codex");
  await sleep(250);
  await shot(page, "02-settings-codex");
  await page.keyboard.press("Escape");

  const thread = await page.evaluate((p) => window.qrabbit.threads.create(p, { title: "Codex check" }), collection);
  await page.evaluate((id) => window.__qrabbitStore.getState().openThread(id), thread.id);
  await page.waitForSelector(".crow", { timeout: 10_000 });
  if (!signedIn) {
    await page.evaluate(() => window.__qrabbitStore.getState().sendMessage("What does this note say?"));
    await waitFor(page, () => window.__qrabbitStore.getState().toasts.some((t) => t.text.includes("Not signed in to Codex")), { timeout: 60_000, label: "the not-signed-in toast" });
    s = await state(page);
    log("toast:", s.toasts.find((t) => t.includes("Codex")));
    expect(!s.toasts.some((t) => t.includes("Error invoking")), "the toast has no IPC wrapper");
    expect(readFileSync(join(collection, thread.file), "utf8").includes("What does this note say?"), "the unanswered message is still saved in the thread file");
  } else {
    await waitFor(page, (id) => !!window.__qrabbitStore.getState().configOptions[id], { arg: thread.id, timeout: 90_000, label: "the Codex thread's session" });
    const opts = await page.evaluate((id) => window.__qrabbitStore.getState().configOptions[id].map((o) => `${o.id}(${o.category})=${o.currentValue}`), thread.id);
    log("codex session options:", opts.join(", "));
    if (process.env.DRIVE_PROMPT === "1") {
      await page.evaluate(() => window.__qrabbitStore.getState().sendMessage("In one sentence, what does the note in this collection say?"));
      await waitFor(page, (id) => window.__qrabbitStore.getState().thread?.messages.some((m) => m.role === "assistant") && !window.__qrabbitStore.getState().turns[id]?.running, { arg: thread.id, timeout: 240_000, interval: 1000, label: "Codex's answer" });
      const file = readFileSync(join(collection, thread.file), "utf8");
      log("thread file:\n" + file);
      expect(/^agent: codex$/m.test(file), "the thread file records agent: codex");
    }
  }
  await sleep(400);
  await shot(page, "03-thread-codex");
  const popped = codexWindows().filter((w) => !before.includes(w));
  log("new console windows:", popped.length ? popped.join(" | ") : "(none)");
  expect(popped.length === 0, "no console window appeared for either agent");

  // And back: the open thread re-warms on Claude Code with Claude's options.
  await page.evaluate(() => window.__qrabbitStore.getState().chooseAgent("claude-code"));
  await waitFor(page, () => { const a = window.__qrabbitStore.getState().agent; return a?.id === "claude-code" && a.connected; }, { timeout: 90_000, label: "Claude Code to reconnect" });
  await waitFor(page, (id) => !!window.__qrabbitStore.getState().configOptions[id], { arg: thread.id, timeout: 90_000, label: "the thread's Claude session" });
  const effort = await page.evaluate((id) => window.__qrabbitStore.getState().configOptions[id].find((o) => o.category === "thought_level")?.currentValue, thread.id);
  expect(effort === "low", `the thread runs Claude Code's collection default again: effort=${effort}`);
  expect(prefs().agent === "claude-code", "preferences.json remembers Claude Code");
  await sleep(400);
  await shot(page, "04-back-to-claude");
  log("manifest settings:", JSON.stringify(JSON.parse(readFileSync(join(collection, "qrabbit.json"), "utf8")).settings));

  log("page errors:", errors.length ? errors.join("\n") : "(none)");
  log("done");
} finally {
  await app?.close().catch(() => {});
}
