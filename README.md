# QRabbit

Read difficult material with AI. Highlight a passage, explore it in a branch, go as deep as you like, and come back to exactly where you were with what you learned kept.

The plan is in [planning/plan-v2.md](planning/plan-v2.md). The clickable prototype is in [planning/prototype](planning/prototype/central-loop.html).

## Layout

```
apps/desktop/        Electron app (electron-vite, React, PDF.js)
packages/shared/     types, ids, the renderer/main API contract
packages/workspace/  the collection folder format: manifest, sources (incl. web page extraction), thread files, reader state
packages/acp-client/ generic Agent Client Protocol client (spawn, sign in, model picker, streaming, permissions)
tools/spike-acp/     step 0: drives the Claude Code ACP adapter from a script
tools/dev/           sample PDF generator and a Playwright driver for the desktop app
```

## Commands

```bash
pnpm install
pnpm typecheck                         # every package
pnpm test                              # vitest where a package has tests
pnpm spike:acp                         # run the ACP spike against Claude Code
pnpm desktop:build                     # build the app into apps/desktop/out
pnpm desktop:dev                       # dev server with a live window
pnpm desktop:drive <work-dir>          # scripted run with screenshots (see .claude/skills/run-desktop)
```

If `apps/desktop/node_modules/electron/dist` is missing after install, run `node apps/desktop/node_modules/electron/install.js` once.

## A collection is a folder

```
my-research/
  qrabbit.json         manifest
  AGENTS.md            instructions any agent reads when its session runs here
  sources/<id>/        source.pdf or source.md (a web page is saved as Markdown with its link), source.json,
                       text.md (extracted, with <!-- page N --> markers),
                       annotations.json (your bookmarks and comments; the agent never receives them)
  threads/             one Markdown file per thread; branches nest under their parent's folder
  notes/               the agent may write here
  .qrabbit/            app state; safe to delete
```

Files are the truth. Open a collection in Obsidian or track it with git whenever you like.

Sources are PDFs, Markdown files, or web pages. A page is fetched once, reduced to its article text and saved as Markdown, so it reads like a paper, works offline, and can be highlighted and explored the same way. Formulas that sites publish as images, MathML or MathJax markup are recovered as LaTeX, so they render inline and the agent can read them; macros a page declares for MathJax are kept with the source, and a few common ones (`\E`, `\Var`, `\norm`, Spinning Up's `\underE`) are built in. Code blocks keep their language and are syntax-highlighted, and admonitions ("Note", "You Should Know") become callouts.

## The agent

The app speaks the Agent Client Protocol. Opening a collection starts one agent process (Claude Code through its ACP adapter) with the collection as its working directory; each thread gets its own session. Sign-in happens in the agent's own terminal flow from the header menu, and the app never sees a credential. Reads inside the collection and writes under `notes/` are allowed automatically; anything else asks you in the thread panel.

Selecting inside an answer and choosing Explore opens a branch. The parent session writes a handoff for it in the background, the branch's own session summarises itself after each turn, and when you next ask in the parent, digests of branches active since its last turn go along with your message. Nothing is ever closed or marked done.
