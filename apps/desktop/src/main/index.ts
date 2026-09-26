import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { disposeAgents, registerIpc } from "./ipc";

const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: "#121417",
    titleBarStyle: "hidden",
    ...(process.platform === "win32"
      ? { titleBarOverlay: { color: "#121417", symbolColor: "#a3a8b0", height: 44 } }
      : {}),
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // `ready-to-show` waits for the compositor's first non-empty paint, and on this Windows GPU
  // stack that report sometimes never comes for the first window of a process ("GPU state
  // invalid after WaitForGetOffsetInRange" in the log), leaving a loaded page in an invisible
  // window that looks like a hang at "starting electron app". Show on whichever comes first:
  // the paint report, the page having loaded, or a deadline; the background colour covers
  // the flash the paint report exists to avoid.
  let shown = false;
  const show = (why: string) => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
    if (why !== "ready-to-show") console.warn(`[qrabbit] window shown on ${why}; ready-to-show never fired`);
  };
  win.once("ready-to-show", () => show("ready-to-show"));
  win.webContents.once("did-finish-load", () => setTimeout(() => show("did-finish-load"), 200));
  win.webContents.once("did-fail-load", (_e, code, desc, url) => {
    console.error(`[qrabbit] renderer failed to load ${url}: ${code} ${desc}`);
    show("did-fail-load");
  });
  setTimeout(() => show("deadline"), 5000);
  // Links in articles open in the system browser; the window itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    e.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  if (rendererUrl) void win.loadURL(rendererUrl);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
  return win;
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void disposeAgents();
});
