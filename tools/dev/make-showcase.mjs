#!/usr/bin/env node
// Captures the app at 1280x800 for docs/screenshots/raw/: highlight.png (a passage selected, the
// Explore toolbar up), branches.png (a list answer with a branch for two of its points), home.png
// and reading-list.png. Drives the real app to set up realistic collections and captures it.
// The promo site draws highlight.png, and stage-screenshots.mjs turns any of them into a tilted still.
// The README's showcase images are rendered from the promo site (make-readme-images.mjs), which
// captures the other views at the widths it draws them (make-site-shots.mjs).
//
// Usage: node tools/dev/make-showcase.mjs [work-dir] [--keep]
//   Build first: pnpm desktop:build. Needs network access for the articles. --keep leaves the
//   collections in place afterwards.
//
// The collections are made under ~/Documents/QRabbit so the app shows natural paths (~\Documents\…),
// marked as made by this tool, and deleted when it finishes. It will not touch that folder otherwise.
// The thread's answers are written, not asked of the agent, so the images are the same every time.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const rawDir = join(repo, "docs", "screenshots", "raw");
const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const VIEW = { width: 1280, height: 800 };
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
  {
    quote: "Actor-critic methods",
    question: "Why does the critic reduce variance?",
    answer: "The policy gradient weights each action by the return that followed it, which is noisy. The critic replaces that return with an estimate of how much better the action was than usual, the advantage $A(s,a) = Q(s,a) - V(s)$, which has the same expectation and far less spread.",
  },
  {
    quote: "Model-based methods",
    question: "When is it worth learning a model?",
    answer: "When real experience is expensive, as with robots, and the dynamics are simple enough to learn well. Planning with a wrong model compounds its errors, so model-based methods shine on short horizons and in simulators they can check against.",
  },
];

await capture();
console.log("[showcase] captures are in docs/screenshots/raw/; for the README images: pnpm site:build && node tools/dev/make-readme-images.mjs");

// ---------------------------------------------------------------------------------------------
async function capture() {
  const { _electron: electron } = await import("playwright-core");
  const log = (...a) => console.log(`[showcase] ${a.join(" ")}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const workDir = resolve(ARGS[0] ?? join(here, "out", "showcase"));
  const base = join(homedir(), "Documents", "QRabbit");
  const marker = join(base, ".made-by-qrabbit-showcase");
  if (existsSync(base) && !existsSync(marker) && !existsSync(join(base, ".made-by-qrabbit-site-shots"))) throw new Error(`${base} exists and was not made by a QRabbit tool; move it first`);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  writeFileSync(marker, "Made by tools/dev/make-showcase.mjs for the app captures; deleted when it finishes.\n");
  mkdirSync(rawDir, { recursive: true });

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const userData = join(workDir, `user-data-${Date.now()}`);
  const app = await electron.launch({ executablePath: electronBin, args: [appDir, `--user-data-dir=${userData}`], env, timeout: 60_000 });
  const page = await app.firstWindow();
  const until = async (fn, label, timeout = 30_000, arg) => {
    const t0 = Date.now();
    while (!(await page.evaluate(fn, arg))) {
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
      await sleep(200);
    }
  };
  // Captured through the DevTools protocol at scale 2, so the captures stay sharp when drawn larger:
  // Playwright's own screenshots reapply its 1x viewport emulation whatever the display density.
  let cdp = null;
  const shot = async (name) => {
    await sleep(600);
    cdp ??= await page.context().newCDPSession(page);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, ...VIEW, scale: 2 } });
    writeFileSync(join(rawDir, `${name}.png`), Buffer.from(data, "base64"));
    log("captured", name);
  };

  try {
    await page.waitForSelector(".hdr");
    await page.setViewportSize(VIEW);

    for (const c of COLLECTIONS) {
      const path = join(base, c.name);
      mkdirSync(path, { recursive: true });
      await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), path);
      for (const url of c.urls) {
        const ok = await page.evaluate((u) => window.__qrabbitStore.getState().importUrl(u).then(() => true, (e) => String(e)), url);
        log(c.name, "·", url, ok === true ? "added" : `failed: ${ok}`);
      }
      const sources = await page.evaluate(() => window.__qrabbitStore.getState().collection.sources.map((s) => ({ id: s.id, url: s.url, title: s.title })));
      const byUrl = (u) => sources.find((s) => s.url?.startsWith(u.replace(/\/$/, ""))) ?? sources.find((s) => s.url === u);
      const ordered = c.urls.map(byUrl).filter(Boolean);
      await page.evaluate(([p, ids]) => window.qrabbit.collections.setOrder(p, ids), [path, ordered.map((s) => s.id)]);
      for (const s of ordered.slice(0, c.read)) await page.evaluate(([p, id]) => window.qrabbit.sources.setRead(p, id, true), [path, s.id]);
      // A few threads so the collection reads as used; each quotes the opening of its source.
      for (const s of ordered.slice(0, c.threads)) {
        await page.evaluate(async ([p, id]) => {
          const text = (await window.qrabbit.sources.readText(p, id)) ?? "";
          const sentence = text.replace(/<!--[^>]*-->/g, "").split(/\n+/).map((l) => l.trim()).find((l) => l.length > 60 && !/^[#>!\[|-]|^Source:/.test(l)) ?? "";
          const quote = sentence.replace(/[*_`[\]]|\(http[^)]*\)/g, "").slice(0, 140);
          const t = await window.qrabbit.threads.create(p, { title: quote.slice(0, 60), anchor: { target: "source", source: id, page: 1, quote, prefix: "", suffix: "", start: 0, end: quote.length } });
          await window.qrabbit.threads.appendMessage(p, t.id, { role: "user", body: "Explain this in plain terms." });
          await window.qrabbit.threads.appendMessage(p, t.id, { role: "assistant", body: "In short: " + quote.slice(0, 80) + "…" });
        }, [path, s.id]);
      }
      if (c.name !== "Reinforcement learning") continue;

      // ----- the list answer, with a branch for two of its points -----
      const concepts = ordered[0];
      await page.evaluate(async ({ p, id, passage, question, answer, branches }) => {
        const api = window.qrabbit;
        const text = (await api.sources.readText(p, id)) ?? "";
        const at = Math.max(0, text.indexOf("rule used by an agent"));
        const root = await api.threads.create(p, { title: "What are the main ways to learn a good policy?", anchor: { target: "source", source: id, page: 1, quote: passage, prefix: "", suffix: "", start: at, end: at + passage.length } });
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
      }, { p: path, id: concepts.id, passage: PASSAGE, question: QUESTION, answer: ANSWER, branches: BRANCHES });
    }

    // Reopen the reinforcement learning collection so its reading list shows the read marks.
    const rl = join(base, "Reinforcement learning");
    await page.evaluate((p) => window.__qrabbitStore.getState().openCollection(p), rl);
    await page.evaluate(() => window.__qrabbitStore.setState({ toasts: [] }));

    // ----- the thread with its branches, paper hidden so the answer has the window -----
    const rootId = await page.evaluate(() => window.__qrabbitStore.getState().collection.threads.find((t) => !t.parent && t.title.startsWith("What are the main ways"))?.id);
    const conceptsId = await page.evaluate(() => window.__qrabbitStore.getState().collection.sources.find((s) => s.url?.includes("rl_intro.html"))?.id);
    await page.evaluate((id) => window.__qrabbitStore.getState().selectSource(id), conceptsId);
    await page.evaluate((id) => window.__qrabbitStore.getState().openThread(id), rootId);
    await until(() => document.querySelectorAll(".bmark").length >= 2, "the branch markers in the answer");
    await page.evaluate(() => { window.__qrabbitStore.getState().setFocus(true); window.__qrabbitStore.setState({ toasts: [] }); });
    await page.evaluate(() => document.activeElement?.blur());
    await shot("branches");

    // ----- highlighting: a passage selected, the toolbar up, an earlier thread's highlight above it -----
    // No thread selected, so the toolbar offers a fresh Explore rather than Ask here.
    await page.evaluate(() => { const s = window.__qrabbitStore.getState(); s.setFocus(false); s.closePanel(); window.__qrabbitStore.setState({ toasts: [], thread: null }); });
    await page.waitForSelector(".sheet.article .md p", { timeout: 10_000 });
    await sleep(400);
    await page.evaluate((selectText) => {
      const paras = [...document.querySelectorAll(".sheet.article .md p")];
      const policy = paras.find((p) => p.textContent.includes("A policy is a rule used by an agent"));
      const target = paras.find((p) => p.textContent.includes("parameterized policies"));
      const root = document.querySelector(".rscroll");
      root.scrollTop += policy.getBoundingClientRect().top - root.getBoundingClientRect().top - 150;
      // Select the start of the target paragraph up to the end of `selectText`, across its bold span.
      const end = target.textContent.indexOf(selectText) + selectText.length;
      const w = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let seen = 0;
      let started = false;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!started) { range.setStart(n, 0); started = true; }
        if (seen + n.data.length >= end) { range.setEnd(n, end - seen); break; }
        seen += n.data.length;
      }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }, "that depend on a set of parameters");
    await page.waitForSelector(".seltool", { timeout: 10_000 });
    await page.mouse.move(5, 5);
    await shot("highlight");

    // ----- the reading list -----
    await page.evaluate(() => { const s = window.__qrabbitStore.getState(); s.setFocus(false); s.closePanel(); s.showList(); window.__qrabbitStore.setState({ toasts: [] }); });
    await page.waitForSelector(".row", { timeout: 10_000 }).catch(() => {});
    await page.mouse.move(5, 5);
    await shot("reading-list");

    // ----- home: the collections -----
    await page.evaluate(() => window.__qrabbitStore.getState().goHome());
    await until(() => document.querySelectorAll(".coll").length >= 3, "the collections on the home screen");
    await page.mouse.move(5, 5);
    await shot("home");
  } finally {
    await app.close().catch(() => {});
    if (!FLAGS.has("--keep")) rmSync(base, { recursive: true, force: true });
  }
}
