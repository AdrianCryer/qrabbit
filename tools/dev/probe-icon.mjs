// Launches the built app in a separate profile and saves the icon Windows attached to its window
// (what the title bar and taskbar show) as a PNG. Usage: node tools/dev/probe-icon.mjs <out.png>
import { _electron as electron } from "playwright-core";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const appDir = resolve("apps/desktop");
const out = resolve(process.argv[2] ?? "window-icon.png");
const electronBin = join(appDir, "node_modules", "electron", "dist", "electron.exe");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const userData = join(process.env.TEMP ?? ".", "qrabbit-probe-icon-profile");

const app = await electron.launch({ executablePath: electronBin, args: [appDir, `--user-data-dir=${userData}`], env, timeout: 60_000 });
await app.firstWindow();
// The window's own HWND, once it is shown, rather than .NET's guess at a "main window".
const win = await app.evaluate(async ({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0];
  for (let i = 0; i < 40 && !w.isVisible(); i++) await new Promise((r) => setTimeout(r, 250));
  const buf = w.getNativeWindowHandle();
  return { visible: w.isVisible(), hwnd: (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))).toString() };
});
console.log("window:", JSON.stringify(win));
const ps = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }
"@
Add-Type -AssemblyName System.Drawing
$h = [IntPtr]::new([Int64]"${win.hwnd}")
$big = [W]::SendMessage($h, 0x7F, [IntPtr]1, [IntPtr]0)
if ($big -eq 0) { Write-Output "no ICON_BIG set on the window (Windows would fall back to the exe icon)"; exit 2 }
[System.Drawing.Icon]::FromHandle($big).ToBitmap().Save("${out.replace(/\\/g, "\\\\")}")
Write-Output "saved ${out}"
`;
const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
console.log((r.stdout + r.stderr).trim());
await app.close();
