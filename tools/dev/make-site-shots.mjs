#!/usr/bin/env node
// Captures app screenshots for the promo site (apps/site) at the sizes it draws them. The README
// captures (make-showcase.mjs) are 1280 wide, where the home screen and the reading list sit in a
// column with wide margins and a focused thread spans the whole window; drawn in a site column,
// their text comes out too small to read. Here each view is captured in a window about as wide as its
// column, and again at a phone's width, so it reads at page size on both.
//
// Usage: node tools/dev/make-site-shots.mjs [work-dir]
//   Build first: pnpm desktop:build. Needs network access for the articles.
//   Writes to apps/site/src/assets/, at scale 2 whatever the display's scaling:
//     home.png, home-narrow.png                  the collections on the home screen
//     reading-list.png, reading-list-narrow.png  a collection's sources in reading order, one read
//     branches.png, branches-narrow.png          the list answer with a branch for two of its points
//   Home and the reading list are as tall as their content; the thread holds the outline, the whole
//   answer and the composer. The site crops off the header, which is cramped at these widths.
//
// The collections are the README's, made under ~\Documents\Qrabbit so the app shows natural paths
// (~\…), marked as made by a tool, and deleted when it finishes; it will not touch that folder
// otherwise. The thread's answers are written, not asked of the agent, so the captures are the same
// every time.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const outDir = join(repo, "apps", "site", "src", "assets");

const WIDE = 720;
const NARROW = 400;
const SPINNING_UP = "https://spinningup.openai.com/en/latest/spinningup";
const COLLECTIONS = [
  { name: "Protein structure", urls: ["https://en.wikipedia.org/wiki/AlphaFold", "https://en.wikipedia.org/wiki/Protein_structure_prediction"], read: 1, threads: 1 },
  { name: "Transformers", urls: ["https://jalammar.github.io/illustrated-transformer/", "https://en.wikipedia.org/wiki/Attention_(machine_learning)", "https://arxiv.org/abs/1706.03762"], read: 2, threads: 2 },
  { name: "Reinforcement learning", urls: [`${SPINNING_UP}/rl_intro.html`, `${SPINNING_UP}/rl_intro2.html`, `${SPINNING_UP}/rl_intro3.html`, "https://en.wikipedia.org/wiki/Q-learning"], read: 1, threads: 0 },
];
const PASSAGE = "A policy is a rule used by an agent to decide what actions to take.";
const QUESTION = "What are the main ways to learn a good policy?";
const ANSWER = [
  "There are four main families, and most practical methods mix them:",
  "",
  "1. **Policy gradient methods** adjust the policy directly, raising the probability of actions that led to high return. Simple and stable, but hungry for samples.",
  "2. **Value-based methods** such as Q-learning learn how good each action is, $Q(s,a)$, and act greedily on it. Sample-efficient, but less stable with function approximation.",
  "3. **Actor-critic methods** combine the two: a critic estimates value to cut the variance of the actor's policy gradient.",
  "4. **Model-based methods** learn a model of the environment and plan with it, trading real experience for model error.",
].join("\n");
const BRANCHES = [
  { quote: "Actor-critic methods", question: "Why does the critic reduce variance?", answer: "The critic replaces the noisy return with an estimate of the advantage, which has the same expectation and far less spread." },
  { quote: "Model-based methods", question: "When is it worth learning a model?", answer: "When real experience is expensive and the dynamics are simple enough to learn well." },
];

const { _electron: electron } = await import("playwright-core");
const log = (...a) => console.log(`[site-shots] ${a.join(" ")}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const workDir = resolve(process.argv[2] ?? join(here, "out", "site-shots"));
const base = join(homedir(), "Documents", "Qrabbit");
const marker = join(base, ".made-by-qrabbit-site-shots");
if (existsSync(base) && !existsSync(marker) && !existsSync(join(base, ".made-by-qrabbit-showcase"))) {
  throw new Error(`${base} exists and was not made by a Qrabbit tool; move it first`);
}
rmSync(base, { recursive: true, force: true });
mkdirSync(base, { recursive: true });
writeFileSync(marker, "Made by tools/dev/make-site-shots.mjs for the promo site's images; deleted when it finishes.\n");
mkdirSync(outDir, { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [appDir, `--user-data-dir=${join(workDir, `user-data-${Date.now()}`)}`], env, timeout: 60_000 });
const page = await app.firstWindow();
const until = async (fn, label, timeout = 30_000) => {
  const t0 = Date.now();
  while (!(await page.evaluate(fn))) {
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await sleep(200);
  }
};
const store = (fn, arg) => page.evaluate(fn, arg);

// Through the DevTools protocol at scale 2: Playwright's own screenshots stay at 1x (see make-showcase.mjs).
let cdp = null;
/**
 * Captures the window at `width`, `height` tall or, when `fit` names the view's content column, as
 * tall as that content. `before` runs once the window has its size, to scroll or settle the view.
 */
async function capture(name, width, { height = 900, fit = null, before = null } = {}) {
  await page.setViewportSize({ width, height });
  await page.mouse.move(2, height - 2);
  // Give the view a moment to lay out at this width; the thread's branch markers follow it.
  await sleep(900);
  if (fit) {
    const bottom = await page.evaluate((sel) => Math.ceil(document.querySelector(sel).getBoundingClientRect().bottom), fit);
    height = bottom + 28;
    await page.setViewportSize({ width, height });
    await page.mouse.move(2, height - 2);
    await sleep(600);
  }
  if (before) await before();
  cdp ??= await page.context().newCDPSession(page);
  // The display's own scaling multiplies the clip's scale, and the page cannot see it under
  // Playwright's emulation, so capture once, measure, and capture again at the corrected scale.
  const shot = async (scale) => Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale } })).data, "base64");
  const pngWidth = (png) => png.readUInt32BE(16);
  let png = await shot(2);
  if (pngWidth(png) !== width * 2) png = await shot((2 * width * 2) / pngWidth(png));
  writeFileSync(join(outDir, name), png);
  log("wrote", name, `${width}x${height}`);
}

try {
  await page.waitForSelector(".hdr");
  await page.setViewportSize({ width: WIDE, height: 900 });

  // ----- the collections, as on the README: sources in reading order, some read, a few threads -----
  let rootId = null;
  let conceptsId = null;
  for (const c of COLLECTIONS) {
    const path = join(base, c.name);
    mkdirSync(path, { recursive: true });
    await store((p) => window.__qrabbitStore.getState().openCollection(p), path);
    for (const url of c.urls) {
      const ok = await store((u) => window.__qrabbitStore.getState().importUrl(u).then(() => true, (e) => String(e)), url);
      log(c.name, "·", url, ok === true ? "added" : `failed: ${ok}`);
    }
    const sources = await store(() => window.__qrabbitStore.getState().collection.sources.map((s) => ({ id: s.id, url: s.url })));
    const byUrl = (u) => sources.find((s) => s.url?.startsWith(u.replace(/\/$/, ""))) ?? sources.find((s) => s.url === u);
    const ordered = c.urls.map(byUrl).filter(Boolean);
    await store(([p, ids]) => window.qrabbit.collections.setOrder(p, ids), [path, ordered.map((s) => s.id)]);
    for (const s of ordered.slice(0, c.read)) await store(([p, id]) => window.qrabbit.sources.setRead(p, id, true), [path, s.id]);
    // A few threads so the collection reads as used; each quotes the opening of its source.
    for (const s of ordered.slice(0, c.threads)) {
      await store(async ([p, id]) => {
        const text = (await window.qrabbit.sources.readText(p, id)) ?? "";
        const sentence = text.replace(/<!--[^>]*-->/g, "").split(/\n+/).map((l) => l.trim()).find((l) => l.length > 60 && !/^[#>!\[|-]|^Source:/.test(l)) ?? "";
        const quote = sentence.replace(/[*_`[\]]|\(http[^)]*\)/g, "").slice(0, 140);
        const t = await window.qrabbit.threads.create(p, { title: quote.slice(0, 60), anchor: { target: "source", source: id, page: 1, quote, prefix: "", suffix: "", start: 0, end: quote.length } });
        await window.qrabbit.threads.appendMessage(p, t.id, { role: "user", body: "Explain this in plain terms." });
        await window.qrabbit.threads.appendMessage(p, t.id, { role: "assistant", body: "In short: " + quote.slice(0, 80) + "…" });
      }, [path, s.id]);
    }
    if (c.name !== "Reinforcement learning") continue;

    // The list answer, with a branch for two of its points.
    conceptsId = ordered[0].id;
    rootId = await store(async ({ p, id, passage, question, answer, branches }) => {
      const api = window.qrabbit;
      // A fixed time of day on the messages, so the captures come out the same whenever they are made.
      const clock = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
      const text = (await api.sources.readText(p, id)) ?? "";
      const at = Math.max(0, text.indexOf("rule used by an agent"));
      const root = await api.threads.create(p, { title: question, anchor: { target: "source", source: id, page: 1, quote: passage, prefix: "", suffix: "", start: at, end: at + passage.length } });
      await api.threads.appendMessage(p, root.id, { role: "user", body: question, at: clock(10, 41) });
      const withAnswer = await api.threads.appendMessage(p, root.id, { role: "assistant", body: answer, at: clock(10, 42) });
      const answerId = withAnswer.messages.at(-1).id;
      for (const b of branches) {
        const start = answer.indexOf(b.quote);
        const child = await api.threads.create(p, { title: b.quote, parent: { thread: root.id, message: answerId }, anchor: { target: "message", thread: root.id, message: answerId, quote: b.quote, prefix: "", suffix: "", start, end: start + b.quote.length } });
        await api.threads.appendMessage(p, child.id, { role: "user", body: b.question, at: clock(10, 44) });
        await api.threads.appendMessage(p, child.id, { role: "assistant", body: b.answer, at: clock(10, 45) });
      }
      return root.id;
    }, { p: path, id: conceptsId, passage: PASSAGE, question: QUESTION, answer: ANSWER, branches: BRANCHES });
  }

  // Reopen the reinforcement learning collection so the store sees the threads and read marks
  // written behind its back.
  await store((p) => window.__qrabbitStore.getState().openCollection(p), join(base, "Reinforcement learning"));

  // ----- the thread with its branches, paper hidden so the answer has the window -----
  await store((id) => window.__qrabbitStore.getState().selectSource(id), conceptsId);
  await store((id) => window.__qrabbitStore.getState().openThread(id), rootId);
  await until(() => document.querySelectorAll(".bmark").length >= 2, "the branch markers in the answer");
  await store(() => { window.__qrabbitStore.getState().setFocus(true); window.__qrabbitStore.setState({ toasts: [] }); });
  await page.evaluate(() => document.activeElement?.blur());
  // The composer's account chip reads "Claude Code" until the agent reports the sign-in, and the
  // model and effort chips join it once the session reports its options, which changes the
  // composer's height; wait for both before framing anything.
  await until(() => !/agentclientprotocol/.test(document.querySelector(".agent")?.textContent ?? "x"), "the agent's account label").catch(() => log("the agent did not report an account; the chip says Claude Code"));
  await until(() => /model/.test(document.querySelector(".composer")?.textContent ?? ""), "the model picker").catch(() => log("the session reported no model options"));
  // Start at the answer, so no message is cut in half under the outline.
  const toAnswer = () => page.evaluate(() => {
    const msgs = document.querySelector(".msgs");
    const answer = [...msgs.querySelectorAll(".msg.assistant")].at(-1);
    msgs.scrollTop += answer.getBoundingClientRect().top - msgs.getBoundingClientRect().top - 14;
  }).then(() => sleep(600));
  // The wide view is no taller than the outline, the answer and the composer: the question above the
  // answer would show only in part.
  await capture("branches.png", WIDE, { height: 568, before: toAnswer });
  await capture("branches-narrow.png", NARROW, { height: 800, before: toAnswer });

  // ----- the reading list -----
  await store(() => { const s = window.__qrabbitStore.getState(); s.setFocus(false); s.closePanel(); s.showList(); window.__qrabbitStore.setState({ toasts: [] }); });
  await page.waitForSelector(".row", { timeout: 10_000 });
  // The list's column at full width (760 and its padding): at 760 or narrower the app hides each
  // row's read status.
  await capture("reading-list.png", 808, { fit: ".list .col" });
  await capture("reading-list-narrow.png", NARROW, { fit: ".list .col" });

  // ----- home: the collections -----
  await store(() => window.__qrabbitStore.getState().goHome());
  await until(() => document.querySelectorAll(".coll").length >= 3, "the collections on the home screen");
  await capture("home.png", WIDE, { fit: ".home .col" });
  await capture("home-narrow.png", NARROW, { fit: ".home .col" });
} finally {
  await app.close().catch(() => {});
  // The agent a collection started may hold its folder for a moment after the app closes.
  try {
    rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (err) {
    log(`left ${base} behind: ${err.message}`);
  }
}
