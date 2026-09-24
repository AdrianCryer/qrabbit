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

  win.on("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
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
