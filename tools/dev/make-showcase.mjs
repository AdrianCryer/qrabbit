#!/usr/bin/env node
// Makes the README's showcase images: the list problem (one long chat against a branch per point)
// and collection management. Drives the real app to set up realistic collections and capture it,
// then composes each image with its headline on the app's theme (see stage-page.mjs).
//
// Usage: node tools/dev/make-showcase.mjs [work-dir] [--compose-only]
//   Build first: pnpm desktop:build. Needs network access for the articles.
//   Captures go to docs/screenshots/raw/ (branches.png, home.png, reading-list.png), images to
//   docs/screenshots/ (lists.png, collections.png). --compose-only rebuilds the images from the captures.
//
// The collections are made under ~/Documents/QRabbit so the app shows natural paths (~\Documents\…),
// marked as made by this tool, and deleted when it finishes. It will not touch that folder otherwise.
// The thread's answers are written, not asked of the agent, so the images are the same every time.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const appDir = join(repo, "apps", "desktop");
const electronBin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const rawDir = join(repo, "docs", "screenshots", "raw");
const outDir = join(repo, "docs", "screenshots");
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

// Not awaited: Electron fires "ready" only after an ES-module entry finishes evaluating.
if (process.versions.electron) {
  compose().catch((err) => { console.error("make-showcase:", err); process.exit(1); });
} else {
  if (!FLAGS.has("--compose-only")) await capture();
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electronBin, [fileURLToPath(import.meta.url)], { stdio: "inherit", env });
  process.exit(r.status ?? 1);
}

// ---------------------------------------------------------------------------------------------
async function capture() {
  const { _electron: electron } = await import("playwright-core");
  const log = (...a) => console.log(`[showcase] ${a.join(" ")}`);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const workDir = resolve(ARGS[0] ?? join(here, "out", "showcase"));
  const base = join(homedir(), "Documents", "QRabbit");
  const marker = join(base, ".made-by-qrabbit-showcase");
  if (existsSync(base) && !existsSync(marker)) throw new Error(`${base} exists and was not made by this tool; move it first`);
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  writeFileSync(marker, "Made by tools/dev/make-showcase.mjs for the README images; deleted when it finishes.\n");
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
  // Captured through the DevTools protocol at scale 2, so the composed images stay sharp: Playwright's
  // own screenshots reapply its 1x viewport emulation whatever the display density.
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

// ---------------------------------------------------------------------------------------------
async function compose() {
  const { app, BrowserWindow } = await import("electron");
  const { openStage, THEME_BACKGROUND, WINDOW_CSS, windowHtml } = await import("./stage-page.mjs");
  // Pages are written next to the captures and load them by path: they are too large for data: URLs.
  const img = (name) => pathToFileURL(join(rawDir, name)).href;
  setTimeout(() => { console.error("make-showcase: composing timed out"); app.exit(2); }, 120_000).unref();

  const page = (width, height, body, css = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
    body { background: ${THEME_BACKGROUND}; color: #e9ebee; font-family: "Inter", "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
    .head { position: absolute; left: 96px; right: 96px; top: 76px; display: grid; gap: 14px; }
    h1 { margin: 0; font-size: 50px; line-height: 1.12; font-weight: 650; letter-spacing: -0.02em; max-width: 1200px; text-wrap: balance; }
    h1 em { font-style: normal; color: #c9f24d; }
    .sub { margin: 0; font-size: 21px; line-height: 1.5; color: #a3a8b0; max-width: 1020px; }
    .label { font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6e747d; margin: 0 0 14px 4px; }
    .label.accent { color: #c9f24d; }
    ${WINDOW_CSS}
    ${css}
  </style></head><body>${body}</body></html>`;

  // ----- the list problem: one long chat, against a branch per point -----
  const LISTS = { width: 1800, height: 990 };
  // The app window fills the right-hand column; the mock chat beside it matches its height.
  const appW = LISTS.width - 96 * 2 - 560 - 56;
  const appH = Math.round((appW * VIEW.height) / VIEW.width);
  const listsCss = `
    .cols { position: absolute; left: 96px; right: 96px; top: 272px; display: grid; grid-template-columns: 560px 1fr; gap: 56px; align-items: start; }
    .mock { position: relative; height: ${appH}px; border-radius: 14px; overflow: hidden; background: #17191d; box-shadow: 0 0 0 1px rgba(255,255,255,0.08), 0 30px 70px rgba(0,0,0,0.45); }
    .mock .bar { height: 44px; border-bottom: 1px solid rgba(255,255,255,0.07); display: flex; align-items: center; gap: 7px; padding: 0 16px; }
    .mock .bar i { width: 10px; height: 10px; border-radius: 50%; background: #2c3036; }
    .mock .bar span { margin-left: 10px; font-size: 13px; color: #6e747d; }
    .mock .flow { position: absolute; left: 0; right: 14px; bottom: 0; padding: 0 28px 26px; display: flex; flex-direction: column; gap: 16px; font-size: 15.5px; line-height: 1.55; }
    .mock .a { color: #c8ccd2; }
    .mock .a ol { margin: 6px 0 0; padding-left: 22px; display: grid; gap: 6px; }
    .mock .u { align-self: flex-end; max-width: 80%; background: #262a31; color: #e9ebee; padding: 10px 14px; border-radius: 14px 14px 4px 14px; }
    .mock .u.lost { background: #2d2a1f; box-shadow: 0 0 0 1px rgba(201,242,77,0.35); }
    .mock .fade { position: absolute; left: 0; right: 0; top: 44px; height: 170px; background: linear-gradient(#17191d 20%, rgba(23,25,29,0)); pointer-events: none; }
    .mock .up { position: absolute; top: 62px; left: 50%; transform: translateX(-50%); font-size: 13px; color: #a3a8b0; background: #22252b; border: 1px solid rgba(255,255,255,0.1); padding: 6px 12px; border-radius: 999px; white-space: nowrap; }
    .mock .scroll { position: absolute; right: 5px; top: 52px; bottom: 8px; width: 4px; border-radius: 4px; background: rgba(255,255,255,0.04); }
    .mock .scroll b { position: absolute; left: 0; right: 0; bottom: 0; height: 22%; border-radius: 4px; background: rgba(255,255,255,0.22); }
    .muted { color: #8a9099; }`;
  const mock = `
    <div class="mock">
      <div class="bar"><i></i><i></i><i></i><span>One long chat</span></div>
      <div class="flow">
        <div class="a"><ol start="3"><li><b>Actor-critic methods</b> combine the two: a critic estimates value to cut the variance…</li><li><b>Model-based methods</b> learn a model of the environment and plan with it…</li></ol></div>
        <div class="u">Can you go deeper on actor-critic?</div>
        <div class="a">The policy gradient weights each action by the return that followed it, which is noisy. The critic replaces that return with an estimate of the advantage, which has the same expectation and far less spread. In practice this is why A2C and PPO train so much more reliably than plain REINFORCE…</div>
        <div class="u">And the model-based ones?</div>
        <div class="a">They learn the dynamics and plan with them. That saves real experience, but a wrong model compounds its errors over long horizons, so…</div>
        <div class="u lost">Sorry, what was the second family again?</div>
      </div>
      <div class="fade"></div>
      <div class="up">↑ The list is three answers up</div>
      <div class="scroll"><b></b></div>
    </div>`;
  const lists = page(LISTS.width, LISTS.height, `
    <div class="head">
      <h1>Answers come as lists. <em>Follow-ups bury them.</em></h1>
      <p class="sub">Ask about the third point, then the fourth, and the list scrolls out of sight while the conversation wanders. In QRabbit each point you ask about opens its own branch, and the answer stays where it was.</p>
    </div>
    <div class="cols">
      <div><div class="label">A typical chat</div>${mock}</div>
      <div><div class="label accent">QRabbit</div>${windowHtml(img("branches.png"), appW, appH)}</div>
    </div>`, listsCss);

  // ----- managing collections: home behind, a reading list in front -----
  // The reading list runs off the bottom edge, so its empty lower half takes no room.
  const COLL = { width: 1800, height: 1000 };
  const homeW = 980;
  const listW = 1080;
  const collections = page(COLL.width, COLL.height, `
    <div class="head">
      <h1>Manage collections</h1>
      <p class="sub">A collection is a reading list and a plain folder on disk. Keep one per subject, put its sources in the order you'll read them, tick off what you've finished, and pick up where you left off.</p>
    </div>
    ${windowHtml(img("home.png"), homeW, Math.round((homeW * VIEW.height) / VIEW.width), "position:absolute;left:96px;top:272px;")}
    ${windowHtml(img("reading-list.png"), listW, Math.round((listW * VIEW.height) / VIEW.width), "position:absolute;right:96px;top:392px;")}`);

  await app.whenReady();
  // ----- highlighting instead of copying: a pasted passage without its context, against a selection -----
  const pasteCss = `
    .mock .paste { display: grid; gap: 8px; }
    .mock .paste q { display: block; quotes: none; font-style: italic; color: #b9bec5; border-left: 2px solid #3a3f47; padding-left: 10px; }
    .keys { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: #8a9099; margin: 0 4px 2px auto; }
    .keys kbd { font: 600 11.5px "Segoe UI", system-ui, sans-serif; color: #c8ccd2; background: #22252b; border: 1px solid rgba(255,255,255,0.12); border-bottom-width: 2px; border-radius: 5px; padding: 2px 6px; }`;
  const pasteMock = `
    <div class="mock">
      <div class="bar"><i></i><i></i><i></i><span>One long chat</span></div>
      <div class="flow">
        <div class="u">So how do the four value functions relate?</div>
        <div class="a">The optimal ones are the best the on-policy ones can be, <i>V</i>*(<i>s</i>) = max<sub>π</sub> <i>V</i><sup>π</sup>(<i>s</i>), and the same holds for <i>Q</i>. Each can be written in terms of the other, so learning one is often enough…</div>
        <div class="keys"><kbd>Ctrl</kbd><kbd>C</kbd> in the paper <span>→</span> <kbd>Alt</kbd><kbd>Tab</kbd> <span>→</span> <kbd>Ctrl</kbd><kbd>V</kbd></div>
        <div class="u paste"><q>In deep RL, we deal with parameterized policies: policies whose outputs are computable functions that depend on a set of parameters</q>What does this mean?</div>
        <div class="a">Which text is this from? Without the paragraphs around it, I can only guess what the parameters are, and whether this is the same policy we were discussing.</div>
        <div class="u lost">It's from the Spinning Up page I pasted earlier. Section 3, I think?</div>
      </div>
      <div class="scroll"><b></b></div>
    </div>`;
  const highlight = page(LISTS.width, LISTS.height, `
    <div class="head">
      <h1>No more copying text. <em>Just highlight it.</em></h1>
      <p class="sub">Select a passage and choose Explore. The thread opens beside the paper with the passage and the text around it already in hand, and the highlight stays in the paper as your way back to it.</p>
    </div>
    <div class="cols">
      <div><div class="label">A typical chat</div>${pasteMock}</div>
      <div><div class="label accent">QRabbit</div>${windowHtml(img("highlight.png"), appW, appH)}</div>
    </div>`, listsCss + pasteCss);

  for (const [name, html, size] of [["highlight", highlight, LISTS], ["lists", lists, LISTS], ["collections", collections, COLL]]) {
    const stage = await openStage(BrowserWindow, size);
    const file = join(rawDir, `.${name}.html`);
    writeFileSync(file, html);
    const png = await stage.capture({ file }, { format: "png" });
    rmSync(file, { force: true });
    writeFileSync(join(outDir, `${name}.png`), png);
    console.log(`[showcase] wrote docs/screenshots/${name}.png (${Math.round(png.length / 1024)} KB)`);
  }
  app.exit(0);
}
