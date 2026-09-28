#!/usr/bin/env node
// Captures app screenshots that the promo site (apps/site) needs at a size of their own. The README
// captures (make-showcase.mjs) are 1280 wide, where a focused thread spans the whole window; drawn in
// a site column, its text comes out too small to read. Here the thread is captured in a narrower
// window, so its lines wrap to a column that reads at page size.
//
// Usage: node tools/dev/make-site-shots.mjs [work-dir]
//   Build first: pnpm desktop:build. Needs network access for the article.
//   Writes the list answer with a branch for two of its points, Focus on, at scale 2 whatever the
//   display's scaling, to apps/site/src/assets/:
//     branches.png         720x568: the outline, the whole answer and the composer, for wide screens
//     branches-narrow.png  400x800: the same, wrapped to a phone's width
//   The site crops off the header, which is cramped at these widths. The thread's answers are
//   written, not asked of the agent, so the captures are the same every time (the same thread as the
//   README's lists image).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const outDir = join(repo, "apps", "site", "src", "assets");

// Each view holds the outline, the whole answer and the composer. The wide one is no taller: the
// question above the answer would show only in part.
const SHOTS = [
  { name: "branches.png", view: { width: 720, height: 568 } },
  { name: "branches-narrow.png", view: { width: 400, height: 800 } },
];
const ARTICLE = "https://spinningup.openai.com/en/latest/spinningup/rl_intro.html";
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
const collection = join(workDir, `run-${Date.now()}`, "Reinforcement learning");
mkdirSync(collection, { recursive: true });
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

try {
  await page.waitForSelector(".hdr");
  await page.setViewportSize(SHOTS[0].view);
  await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
  const imported = await page.evaluate((u) => window.__qrabbitStore.getState().importUrl(u).then(() => true, (e) => String(e)), ARTICLE);
  if (imported !== true) throw new Error(`importing ${ARTICLE} failed: ${imported}`);
  const sourceId = await page.evaluate(() => window.__qrabbitStore.getState().collection.sources[0]?.id);
  log("imported", ARTICLE);

  const rootId = await page.evaluate(async ({ p, id, passage, question, answer, branches }) => {
    const api = window.qrabbit;
    const text = (await api.sources.readText(p, id)) ?? "";
    const at = Math.max(0, text.indexOf("rule used by an agent"));
    const root = await api.threads.create(p, { title: question, anchor: { target: "source", source: id, page: 1, quote: passage, prefix: "", suffix: "", start: at, end: at + passage.length } });
    await api.threads.appendMessage(p, root.id, { role: "user", body: question });
    const withAnswer = await api.threads.appendMessage(p, root.id, { role: "assistant", body: answer });
    const answerId = withAnswer.messages.at(-1).id;
    for (const b of branches) {
      const start = answer.indexOf(b.quote);
      const child = await api.threads.create(p, { title: b.quote, parent: { thread: root.id, message: answerId }, anchor: { target: "message", thread: root.id, message: answerId, quote: b.quote, prefix: "", suffix: "", start, end: start + b.quote.length } });
      await api.threads.appendMessage(p, child.id, { role: "user", body: b.question });
      await api.threads.appendMessage(p, child.id, { role: "assistant", body: b.answer });
    }
    return root.id;
  }, { p: collection, id: sourceId, passage: PASSAGE, question: QUESTION, answer: ANSWER, branches: BRANCHES });

  // Reopen so the store picks up the threads written behind its back, then show the root thread
  // with the paper hidden, as the README's capture does.
  await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), collection);
  await page.evaluate((id) => window.__qrabbitStore.getState().selectSource(id), sourceId);
  await page.evaluate((id) => window.__qrabbitStore.getState().openThread(id), rootId);
  await until(() => document.querySelectorAll(".bmark").length >= 2, "the branch markers in the answer");
  await page.evaluate(() => { window.__qrabbitStore.getState().setFocus(true); window.__qrabbitStore.setState({ toasts: [] }); });
  await page.evaluate(() => document.activeElement?.blur());
  // The composer's account chip reads "Claude Code" until the agent reports the sign-in.
  await until(() => !/agentclientprotocol/.test(document.querySelector(".agent")?.textContent ?? "x"), "the agent's account label", 30_000).catch(() => log("the agent did not report an account; the chip says Claude Code"));
  // The model and effort chips join it once the session reports its options, which changes the
  // composer's height, so wait for them before framing anything.
  await until(() => /model/.test(document.querySelector(".composer")?.textContent ?? ""), "the model picker", 30_000).catch(() => log("the session reported no model options"));

  // Through the DevTools protocol at scale 2: Playwright's own screenshots stay at 1x (see make-showcase.mjs).
  const cdp = await page.context().newCDPSession(page);
  for (const { name, view } of SHOTS) {
    await page.setViewportSize(view);
    await page.mouse.move(2, view.height - 2);
    // Give the answer a moment to re-wrap at this width; the branch markers follow it.
    await sleep(900);
    // Start at the answer, so no message is cut in half under the outline.
    await page.evaluate(() => {
      const msgs = document.querySelector(".msgs");
      const answer = [...msgs.querySelectorAll(".msg.assistant")].at(-1);
      msgs.scrollTop += answer.getBoundingClientRect().top - msgs.getBoundingClientRect().top - 14;
    });
    await sleep(600);
    // The display's own scaling multiplies the clip's scale, and the page cannot see it under
    // Playwright's emulation, so capture once, measure, and capture again at the corrected scale.
    const shot = async (scale) => Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, ...view, scale } })).data, "base64");
    const pngWidth = (png) => png.readUInt32BE(16);
    let png = await shot(2);
    if (pngWidth(png) !== view.width * 2) png = await shot((2 * view.width * 2) / pngWidth(png));
    writeFileSync(join(outDir, name), png);
    log("wrote", join(outDir, name));
  }
} finally {
  await app.close().catch(() => {});
  // The agent the collection started may hold its folder for a moment after the app closes.
  try {
    rmSync(dirname(collection), { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (err) {
    log(`left ${dirname(collection)} behind: ${err.message}`);
  }
}
