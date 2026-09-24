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

Screenshots land in `$WORK/shots/` (`01-home`, `02-reader`, `03-selection`, `04-thread`, `05-askhere`). The driver prints the thread file it created and the head of the extracted `text.md`. **Look at the screenshots**; the log alone does not prove the page rendered. Then delete `$WORK/collection-test` before the next run, or the driver reuses it.

To poke at something else, edit the driver: it exposes the app's store as `window.__qrabbitStore`, so `page.evaluate(() => window.__qrabbitStore.getState().openCollection(path))` opens a collection without the folder dialog, and any store action can be called the same way.

## Run (human path)

```bash
pnpm --filter @qrabbit/desktop dev      # dev server with hot reload, opens a window
pnpm --filter @qrabbit/desktop preview  # runs the last build
```

## Gotchas

- **`ELECTRON_RUN_AS_NODE=1` in the environment** (set by tools that themselves run inside Electron, such as the Claude Code VS Code extension) turns `electron.exe` into plain Node: `electron --version` prints a Node version and Playwright reports "Process failed to launch!". The driver strips the variable; do the same for any other launch.
- **pnpm did not run Electron's post-install download.** If `apps/desktop/node_modules/electron/dist` is missing, run `node apps/desktop/node_modules/electron/install.js`.
- **Version pins.** electron-vite 5 requires Vite 7, and `@vitejs/plugin-react` 6 requires Vite 8, so the app pins `vite ^7` with `@vitejs/plugin-react ^5`.
- **PDF.js 6 text layer.** Spans carry `--font-height`, `--scale-x` and `--rotate`; the stylesheet in `src/renderer/src/styles.css` turns them into `font-size` and `transform`, and the reader sets `--total-scale-factor` on the layer. Without both, selections and highlights come out narrower than the printed text.
- **Folder and file dialogs cannot be scripted.** Prepare the collection on disk (the driver shows the layout) and open it through the store.
