#!/usr/bin/env node
// Drives the built desktop app through Qrabbit Cloud: sign in with an emailed code (read from the local
// stack's mail catcher), keep a collection in the cloud, and check it arrived. Takes screenshots.
// Usage: node tools/dev/drive-cloud.mjs <work-dir>
// Needs the local stack (pnpm cloud:start) and a build (pnpm --filter @qrabbit/desktop build). The app is pointed at
// the local stack whatever cloud the build was made for.
import { _electron as electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const workDir = resolve(process.argv[2] ?? join(here, "out"));
const shots = join(workDir, "shots-cloud");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const collection = join(workDir, "runs", runId, "collection-cloud");
const userData = join(workDir, "user-data-cloud", runId);
const MAIL = process.env.QRABBIT_MAIL_URL ?? "http://127.0.0.1:54324";
mkdirSync(shots, { recursive: true });
mkdirSync(userData, { recursive: true });

// ----- a collection with one Markdown source, the way the app would have written it -----
const srcDir = join(collection, "sources", "reading-plan");
mkdirSync(srcDir, { recursive: true });
const md = "# Reading plan\n\nStart with the survey, then the two papers it cites most.\n";
writeFileSync(join(srcDir, "source.md"), md);
writeFileSync(join(srcDir, "text.md"), `<!-- page 1 -->\n${md}`);
writeFileSync(join(srcDir, "source.json"), JSON.stringify({ id: "reading-plan", kind: "markdown", title: "Reading plan", file: "source.md", pages: 1, added: new Date().toISOString(), hasText: true }, null, 2));

const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const log = (...a) => console.log(`[drive-cloud] ${a.join(" ")}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A capture can hang when the compositor stops producing frames (see the run-desktop skill); the checks matter more.
const shot = async (page, name) => {
  const f = join(shots, `${name}.png`);
  try {
    await page.screenshot({ path: f, timeout: 15_000 });
    log("screenshot", f);
  } catch (err) {
    log(`screenshot ${name} skipped: ${String(err.message ?? err).split("\n")[0]}`);
  }
};
async function waitFor(page, fn, { timeout = 30_000, interval = 300, label = "condition", arg = undefined } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(interval);
  }
}
const check = (cond, what) => { if (!cond) throw new Error(`check failed: ${what}`); log("ok:", what); };

/** The six-digit code from the newest message to an address, from Mailpit's API; `not` is an earlier code to wait past. */
async function codeFor(email, not = null) {
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const found = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).catch(() => null);
    if (!found?.ok) continue;
    const list = await found.json();
    const id = list.messages?.[0]?.ID;
    if (!id) continue;
    const msg = await (await fetch(`${MAIL}/api/v1/message/${id}`)).json();
    const m = /\b(\d{6})\b/.exec(`${msg.Text ?? ""} ${msg.HTML ?? ""}`);
    if (m && m[1] !== not) return m[1];
  }
  throw new Error(`no code arrived for ${email} (is the local stack running, and its mail catcher at ${MAIL}?)`);
}

/** The local stack's API URL and keys, from `supabase status` (KEY="VALUE" lines, or one JSON object when piped). */
function localStack() {
  const cloudDir = join(repo, "apps", "cloud");
  let text = "";
  try {
    text = execFileSync(process.execPath, [join(cloudDir, "node_modules", "supabase", "dist", "supabase.js"), "status", "-o", "env"], { cwd: cloudDir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 }).trim();
  } catch {
    /* reported below */
  }
  const vars = text.startsWith("{")
    ? JSON.parse(text)
    : Object.fromEntries(text.split(/\r?\n/).flatMap((line) => { const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim()); return m ? [[m[1], m[2]]] : []; }));
  if (!vars.API_URL || !vars.PUBLISHABLE_KEY || !vars.SECRET_KEY) throw new Error("the local stack is not running (pnpm cloud:start)");
  return { url: vars.API_URL, publishableKey: vars.PUBLISHABLE_KEY, secretKey: vars.SECRET_KEY };
}

const consoleErrors = [];
const stack = localStack();

/** The stack's tables with the secret key, past row-level security: to stand in for another computer and to look. */
async function rest(path, { method = "GET", body } = {}) {
  const res = await fetch(`${stack.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: stack.secretKey, authorization: `Bearer ${stack.secretKey}`, "content-type": "application/json", prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? [] : res.json();
}
const env = { ...process.env, QRABBIT_CLOUD_URL: stack.url, QRABBIT_CLOUD_PUBLISHABLE_KEY: stack.publishableKey };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ executablePath: electronBin, args: [appDir, `--user-data-dir=${userData}`], timeout: 60_000, env });
  const page = await app.firstWindow();
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  await page.waitForSelector(".hdr", { timeout: 30_000 });
  await page.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
  // A fresh profile asks which agent to read with first; the cloud needs none.
  await page.evaluate(() => window.__qrabbitStore.getState().dismissChooser());
  await waitFor(page, () => window.__qrabbitStore?.getState().cloud !== null, { label: "the cloud account to be read" });
  const account = await page.evaluate(() => window.__qrabbitStore.getState().cloud);
  check(account.available && !account.signedIn, `cloud available and signed out (${JSON.stringify(account)})`);
  await shot(page, "01-home");

  // ----- sign in from Settings with a code from the mail catcher -----
  await page.evaluate(() => window.__qrabbitStore.getState().setSettingsOpen(true, "cloud"));
  await page.waitForSelector(".dialog input[type=email]", { timeout: 10_000 });
  await shot(page, "02-settings-signed-out");
  const email = `drive-${Date.now().toString(36)}@qrabbit.test`;
  await page.fill(".dialog input[type=email]", email);
  const codeRequestedAt = Date.now();
  await page.getByRole("button", { name: /Send code/ }).click();
  await page.waitForSelector(".dialog input[inputmode=numeric]", { timeout: 15_000 });
  const code = await codeFor(email);
  log("code arrived");
  await page.fill(".dialog input[inputmode=numeric]", code);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await waitFor(page, () => !!window.__qrabbitStore.getState().cloud?.signedIn, { label: "sign-in" });
  await page.waitForSelector(".dialog .usage", { timeout: 15_000 });
  await sleep(800);
  await shot(page, "03-settings-signed-in");
  const me = await page.evaluate(() => window.__qrabbitStore.getState().cloud);
  check(me.email === email && me.quotaBytes > 0 && me.deviceId, `signed in as ${email} with a quota and a device`);
  // Signing in asks for the device twice at once (the auth event and the code exchange); it must register once.
  const devices = await page.evaluate(() => window.qrabbit.cloud.devices());
  check(devices.length === 1 && devices[0].id === me.deviceId && devices[0].current, `one device registered, this one (${devices.length})`);
  await page.evaluate(() => window.__qrabbitStore.getState().setSettingsOpen(false));

  // ----- another computer of the account: renamed in place from here, then removed -----
  const [{ id: uid }] = await rest(`profiles?email=eq.${encodeURIComponent(email)}&select=id`);
  const [old] = await rest("devices", { method: "POST", body: { user_id: uid, name: "Old laptop", platform: "darwin" } });
  await page.evaluate(() => window.__qrabbitStore.getState().setSettingsOpen(true, "cloud"));
  await waitFor(page, () => document.querySelectorAll(".dialog .machines li").length >= 2, { label: "both computers to be listed" });
  await sleep(300);
  await shot(page, "03b-computers");
  const names = () => page.evaluate(() => [...document.querySelectorAll(".dialog .machines .name")].map((n) => n.textContent));
  const rowOf = (name) => page.locator(".dialog .machines li", { has: page.locator(".name", { hasText: name }) });
  await rowOf("Old laptop").getByRole("button", { name: /^Rename/ }).click();
  await page.waitForSelector(".dialog .machines input.rename", { timeout: 5_000 });
  await page.keyboard.type("Study Mac");
  await page.keyboard.press("Enter");
  await waitFor(page, () => [...document.querySelectorAll(".dialog .machines .name")].some((n) => n.textContent === "Study Mac"), { label: "the new name to show" });
  check((await rest(`devices?id=eq.${old.id}&select=name`))[0]?.name === "Study Mac", "renamed in place, and the cloud has the new name");
  await rowOf("Study Mac").getByRole("button", { name: /^Rename/ }).click();
  await page.waitForSelector(".dialog .machines input.rename", { timeout: 5_000 });
  await page.keyboard.type("Not this");
  await page.keyboard.press("Escape");
  await sleep(400);
  check((await names()).includes("Study Mac") && (await rest(`devices?id=eq.${old.id}&select=name`))[0]?.name === "Study Mac", "Escape drops a rename");
  await shot(page, "03c-renamed");
  const thisRow = page.locator(".dialog .machines li", { has: page.locator(".this") });
  check((await thisRow.getByRole("button", { name: "Remove" }).count()) === 0, "this computer is not offered for removal; it signs out instead");
  await rowOf("Study Mac").getByRole("button", { name: "Remove" }).click();
  await rowOf("Study Mac").getByRole("button", { name: "Really remove" }).click();
  await waitFor(page, () => document.querySelectorAll(".dialog .machines li").length === 1, { label: "the removed computer to leave the list" });
  check((await rest(`devices?id=eq.${old.id}&select=id`)).length === 0, "removed from the account");
  await page.waitForSelector(".toasts", { timeout: 5_000 }).catch(() => {});
  await shot(page, "03d-removed");
  await page.evaluate(() => window.__qrabbitStore.getState().setSettingsOpen(false));

  // ----- open the collection and keep it in the cloud -----
  await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
  await page.waitForSelector(".cloudpill", { timeout: 30_000 });
  await sleep(600);
  await shot(page, "04-reader");
  await page.click(".pop:has(.cloudpill) > button");
  await page.waitForSelector(".menu", { timeout: 5_000 });
  await shot(page, "05-cloud-menu");
  await page.getByRole("menuitem", { name: /in the cloud/ }).click();
  await waitFor(page, () => { const s = window.__qrabbitStore.getState().cloudSync; return !!s && s.phase === "idle" && !!s.lastSync; }, { label: "the first sync", timeout: 60_000 });
  // Our own commit comes back over the live channel and the next run records the revision.
  const stateFile = join(collection, ".qrabbit", "cloud.json");
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000 && (!existsSync(stateFile) || JSON.parse(readFileSync(stateFile, "utf8")).rev < 1)) await sleep(500);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  check(state.rev >= 1 && Object.keys(state.tree).length >= 6, `synced ${Object.keys(state.tree).length} files at revision ${state.rev}`);
  const sync = await page.evaluate(() => window.__qrabbitStore.getState().cloudSync);
  check(sync.phase === "idle" && sync.unsaved === 0, `sync state idle with nothing unsaved (${JSON.stringify(sync)})`);
  log("live channel in the app:", sync.live ? "up" : "not up (polling every few minutes instead)");
  await page.click(".pop:has(.cloudpill) > button");
  await page.waitForSelector(".menu .state", { timeout: 5_000 });
  await shot(page, "06-synced");
  await page.keyboard.press("Escape");

  // ----- a change made in the folder goes up by itself -----
  writeFileSync(join(collection, "notes", "from-the-driver.md"), "Written beside the app, as Obsidian would.\n");
  const t1 = Date.now();
  while (Date.now() - t1 < 30_000 && !(JSON.parse(readFileSync(stateFile, "utf8")).tree["notes/from-the-driver.md"])) await sleep(500);
  check(!!JSON.parse(readFileSync(stateFile, "utf8")).tree["notes/from-the-driver.md"], "a file written outside the app was pushed by the folder watcher");

  // ----- the home screen shows the collection as kept in the cloud -----
  await page.evaluate(() => window.__qrabbitStore.getState().goHome());
  await waitFor(page, () => !!document.querySelector(".coll .meta svg"), { label: "the cloud mark on the home screen" });
  await sleep(500);
  await shot(page, "07-home-cloud");
  const cloudCollections = await page.evaluate(() => window.__qrabbitStore.getState().cloudCollections);
  check(cloudCollections.some((c) => c.name === "collection-cloud" && c.localPath), "the account lists the collection with its local folder");

  // ----- removed from another computer: the next push finds this device gone, and the app signs itself out and says why -----
  // Standing in for `remove_device` run elsewhere: the row goes (the session it would also end stays, so the token still
  // works until it expires, which is the window this path covers).
  await rest(`devices?id=eq.${me.deviceId}`, { method: "DELETE" });
  writeFileSync(join(collection, "notes", "after-removal.md"), "Written after this computer was removed from the account.\n");
  await waitFor(page, () => { const c = window.__qrabbitStore.getState().cloud; return c?.signedIn === false && !!c.notice; }, { label: "the app to sign itself out", timeout: 60_000 });
  const removed = await page.evaluate(() => window.__qrabbitStore.getState().cloud);
  check(/removed from the account/.test(removed.notice), `signed out with the reason shown: "${removed.notice}"`);
  await page.evaluate(() => window.__qrabbitStore.getState().setSettingsOpen(true, "cloud"));
  await page.waitForSelector(".dialog input[type=email]", { timeout: 10_000 });
  await sleep(300);
  await shot(page, "08-removed-elsewhere");

  // ----- signing in again registers a fresh device and clears the notice -----
  await page.fill(".dialog input[type=email]", email);
  // The stack sends one code per address a minute.
  await sleep(Math.max(0, 61_000 - (Date.now() - codeRequestedAt)));
  await page.getByRole("button", { name: /Send code/ }).click();
  await page.waitForSelector(".dialog input[inputmode=numeric]", { timeout: 15_000 });
  const code2 = await codeFor(email, code);
  await page.fill(".dialog input[inputmode=numeric]", code2);
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await waitFor(page, () => !!window.__qrabbitStore.getState().cloud?.signedIn, { label: "the second sign-in" });
  const again = await page.evaluate(() => window.__qrabbitStore.getState().cloud);
  const devices2 = await page.evaluate(() => window.qrabbit.cloud.devices());
  check(again.deviceId && again.deviceId !== me.deviceId && !again.notice, "signed in again as a new device, with the notice gone");
  check(devices2.length === 1 && devices2[0].current, `the account lists one computer again (${devices2.length})`);
  await sleep(500);
  await shot(page, "09-signed-in-again");
  await page.keyboard.press("Escape");

  // ----- sign out -----
  await page.evaluate(() => window.__qrabbitStore.getState().cloudSignOut("local"));
  await waitFor(page, () => window.__qrabbitStore.getState().cloud?.signedIn === false, { label: "sign-out" });
  check(!(await page.evaluate(() => window.__qrabbitStore.getState().cloud?.notice)), "signed out by choice, with nothing to explain");
  log("done");
} finally {
  if (consoleErrors.length) { log("renderer console errors/warnings:"); for (const e of consoleErrors) console.log("  " + e); }
  await app?.close().catch(() => {});
}
