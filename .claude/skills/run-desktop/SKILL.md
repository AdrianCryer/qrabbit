---
name: run-desktop
description: Build, run, and drive the QRabbit Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, build it, or verify a change in the real window.
---

QRabbit's desktop app lives in `apps/desktop` (electron-vite, React, PDF.js). For agent use, drive it with the scripted Playwright driver at `tools/dev/drive-desktop.mjs`; it launches the built app, opens a test collection, renders a sample PDF, makes a real text selection, runs Explore and Ask here, and writes screenshots.

All commands run from the repo root.

## Build

```bash
pnpm install
node apps/desktop/node_modules/electron/install.js   # only if apps/desktop/node_modules/electron/dist is missing
pnpm --filter @qrabbit/desktop build                  # writes apps/desktop/out/
```

## Run (agent path)

```bash
WORK=/path/to/scratch
node tools/dev/sample-pdf.mjs "$WORK/sample.pdf"
node tools/dev/drive-desktop.mjs "$WORK" "$WORK/sample.pdf"
```

Screenshots land in `$WORK/shots/` (`01-home` through `13-parent-again`: home, reader, selection, thread with undo, thread, settings dialog, Ask here, working, answer, answer selection, branch, handoff, branch answer, parent with marker, parent asked again). The quick run also presses Escape, Ctrl+B and Ctrl+comma to check the shortcuts, then adds a comment (`04c-comment-editor`), a page bookmark and opens the Marks menu (`04d-marks`), printing the source's `annotations.json`. It then fetches a live web page into the collection (a Wikipedia article by default; set `DRIVE_URL` to use another), reads it in the article view (`04e-web`, plus `04e2-web-scrolled` at the first heading or paragraph containing `DRIVE_WEB_SCROLL` when that is set, which is how formula rendering was checked on Spinning Up), selects a sentence and starts a thread from it (`04f-web-thread`), and prints the head of the page's `text.md`; without network the import logs its error and the step is skipped. Under heavy machine load the renderer build has taken close to an hour and 10-second waits have timed out; rerun before treating a timeout as a bug. The driver prints the thread files it created and the head of the extracted `text.md`. **Look at the screenshots**; the log alone does not prove the page rendered. Each run builds a fresh collection under `$WORK/runs/<timestamp>/` and uses its own Electron user-data folder under `$WORK/user-data/`, so runs never collide with each other or with the developer's Recent list; prune `$WORK/runs/` now and then.

Set `DRIVE_NO_AGENT=1` for a cheap regression run that stops after the Ask here screenshot and never talks to the agent. From the Ask here step on, the driver otherwise sends real messages to Claude Code through ACP: one in the root thread, one in a branch, and one back in the root, plus the hidden handoff and summary turns. A full run takes three to four minutes, needs the machine's Claude Code sign-in, and spends a small amount of the plan's usage. The driver prints the agent status (account label, auth methods) and the config options the session reported.

To poke at something else, edit the driver: it exposes the app's store as `window.__qrabbitStore`, so `page.evaluate(() => window.__qrabbitStore.getState().openCollection(path))` opens a collection without the folder dialog, and any store action can be called the same way.

## Run (human path)

```bash
pnpm --filter @qrabbit/desktop dev      # dev server, opens a window; renderer hot-reloads, main/preload restart the app
pnpm --filter @qrabbit/desktop preview  # runs the last build
```

The dev script passes `--watch`, so a change under `src/main` or `src/preload` restarts Electron. Without it only the renderer reloads, and a renderer that calls a new IPC channel hits "No handler registered for '…'" until the app is restarted.

## Gotchas

- **`ELECTRON_RUN_AS_NODE=1` in the environment** (set by tools that themselves run inside Electron, such as the Claude Code VS Code extension) turns `electron.exe` into plain Node: `electron --version` prints a Node version and Playwright reports "Process failed to launch!". The driver strips the variable; do the same for any other launch.
- **pnpm did not run Electron's post-install download.** If `apps/desktop/node_modules/electron/dist` is missing, run `node apps/desktop/node_modules/electron/install.js`.
- **Version pins.** electron-vite 5 requires Vite 7, and `@vitejs/plugin-react` 6 requires Vite 8, so the app pins `vite ^7` with `@vitejs/plugin-react ^5`. The app's `katex` (whose stylesheet is imported) must be the same major.minor as the one `rehype-katex` renders with (0.16.x): KaTeX 0.18 renamed `.sizing` to `.katex-sizing`, and with mismatched versions subscripts and superscripts render at full size on the baseline.
- **PDF.js 6 text layer.** Spans carry `--font-height`, `--scale-x` and `--rotate`; the stylesheet in `src/renderer/src/styles.css` turns them into `font-size` and `transform`, and the reader sets `--total-scale-factor` on the layer. Without both, selections and highlights come out narrower than the printed text.
- **A test folder that cannot be deleted** is held by a process working in it: the Claude Code binary an adapter spawned there. `killTree` in `acp-client` now ends the whole tree, and the driver uses a fresh folder per run, so this should not recur; if it does, list processes with `Get-CimInstance Win32_Process` and stop only the tree in question. **Do not `taskkill` every `electron.exe`**: the user's own `pnpm desktop:dev` instance runs under the same image name and would be killed with it.
- **Folder and file dialogs cannot be scripted.** Prepare the collection on disk (the driver shows the layout) and open it through the store.
- **The renderer's CSP forbids eval**, and Playwright's `waitForFunction` compiles its predicate with eval. Use the driver's `waitFor` helper, which polls with `page.evaluate` and a real function.
- **A main-process module that cannot be resolved shows an error dialog instead of exiting**, so Playwright reports `electron.launch: Timeout` rather than a crash. Launch `electron.exe apps/desktop` directly and read its stderr to see the real error. The web-extraction libraries (`@mozilla/readability`, `linkedom`, `turndown`, `turndown-plugin-gfm`) are used by `@qrabbit/workspace` but are listed as dependencies of `apps/desktop` on purpose: electron-vite bundles the workspace package and keeps those libraries external, so Electron must be able to resolve them from the app's `node_modules`.
- **Closing the panel re-renders the PDF pages at the new fit width.** A selection built on the old text-layer spans collapses when they are replaced, so the driver's `settle` helper waits for the page width to hold still after Undo before selecting again.
- **The agent runs on Electron's bundled Node.** The main process spawns the ACP adapter with `process.execPath` and `ELECTRON_RUN_AS_NODE=1` set for that child only, so no system Node is needed. The adapter is resolved from `apps/desktop/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js`.
