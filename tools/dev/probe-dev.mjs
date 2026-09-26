// Launch the app against an already-running electron-vite dev server (http://localhost:5173) in a
// separate profile and report the state of the window the app created. It never touches the
// developer's own instance. Usage: node tools/dev/probe-dev.mjs <profile-dir>
import { _electron as electron } from "playwright-core";
import { join, resolve } from "node:path";

const appDir = resolve("apps/desktop");
const userData = process.argv[2] ?? join(process.env.TEMP ?? ".", "qrabbit-probe-profile");
const electronBin = join(appDir, "node_modules", "electron", "dist", "electron.exe");
const env = { ...process.env, ELECTRON_RENDERER_URL: process.env.DEV_URL ?? "http://localhost:5173" };
delete env.ELECTRON_RUN_AS_NODE;

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const app = await electron.launch({ executablePath: electronBin, args: [appDir, `--user-data-dir=${userData}`], env, timeout: 60_000 });
app.process().stderr?.on("data", (d) => log("main stderr:", String(d).trim().slice(0, 400)));
app.process().stdout?.on("data", (d) => log("main stdout:", String(d).trim().slice(0, 400)));
const page = await app.firstWindow();
page.on("pageerror", (e) => log("pageerror:", e.message.slice(0, 300)));
for (let i = 0; i < 4; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const info = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { visible: w.isVisible(), url: w.webContents.getURL(), loading: w.webContents.isLoading(), readyListeners: w.listenerCount("ready-to-show") };
  });
  log("app window:", JSON.stringify(info), "hdr:", !!(await page.$(".hdr")));
  if (info.visible) break;
}
await app.close();
