// Which app the drivers launch. By default the dev build: Electron from apps/desktop/node_modules with the app
// directory as its argument. With QRABBIT_APP naming a packaged build's executable
// (apps/desktop/dist/win-unpacked/Qrabbit.exe after `pnpm desktop:pack`), that build instead, so the same drivers
// check the packaged layout: the adapters resolved from its node_modules, the bundled Node on Windows.
import { join } from "node:path";

/** The executable to launch and the arguments that go before the driver's own. */
export function appLaunch(appDir) {
  const packaged = process.env["QRABBIT_APP"];
  if (packaged) return { executablePath: packaged, args: [] };
  const bin = join(appDir, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  return { executablePath: bin, args: [appDir] };
}
