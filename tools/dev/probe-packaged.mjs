// Launches a packaged build the way a reader would, with no arguments, and prints what Electron reports about it:
// the app name and version, where it keeps its data, its resources folder and whether it sees itself as packaged.
// Usage: node tools/dev/probe-packaged.mjs <path to Qrabbit.exe>
import { _electron as electron } from "playwright-core";

const exe = process.argv[2];
if (!exe) {
  console.error("usage: node tools/dev/probe-packaged.mjs <path to Qrabbit.exe>");
  process.exit(2);
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: exe, args: [], env, timeout: 60_000 });
try {
  await app.firstWindow();
  const info = await app.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
    resourcesPath: process.resourcesPath,
  }));
  console.log(JSON.stringify(info, null, 2));
} finally {
  await app.close();
}
