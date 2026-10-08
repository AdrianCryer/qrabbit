import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";

/**
 * What runs the agent adapters, which are Node programs.
 *
 * On Windows it has to be a console program. QRabbit has no console, so a console program that an adapter starts
 * without hiding it (Codex's `codex.exe`, a shell command an agent runs, the PowerShell that opens a sign-in page)
 * gets a console of its own, and Windows 11 shows it as a Windows Terminal window. Started hidden, `node.exe` gets a
 * console without a window, and everything below it inherits that console however it was started. Electron running
 * as Node is a GUI program with no console to pass down. Zed and JetBrains run the same adapters on Node this way.
 *
 * Other platforms have no consoles, and there Electron's own Node saves needing one installed.
 */
export type AdapterRuntime = {
  kind: "node" | "electron";
  command: string;
  env: Record<string, string>;
};

/** The README's minimum; the adapters are tested on it. */
const MIN_NODE_MAJOR = 22;
const run = promisify(execFile);
let found: Promise<AdapterRuntime> | null = null;

export function adapterRuntime(): Promise<AdapterRuntime> {
  found ??= pick();
  return found;
}

async function pick(): Promise<AdapterRuntime> {
  const node = process.platform === "win32" ? await consoleNode() : null;
  if (node) {
    console.log(`[agent] adapters run on ${node}`);
    return { kind: "node", command: node, env: {} };
  }
  if (process.platform === "win32") {
    console.warn(`[agent] no Node ${MIN_NODE_MAJOR} or later found; adapters run on Electron, so agents may open console windows`);
  }
  return { kind: "electron", command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ATTACH_CONSOLE: "1" } };
}

/** A packaged build's own `resources/node/node.exe`, else the first `node.exe` on PATH that is new enough. */
async function consoleNode(): Promise<string | null> {
  const onPath = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "node.exe"));
  for (const candidate of [join(process.resourcesPath, "node", "node.exe"), ...onPath]) {
    if (!existsSync(candidate)) continue;
    try {
      const { stdout } = await run(candidate, ["--version"], { timeout: 10_000, windowsHide: true });
      const major = Number(/^v(\d+)\./.exec(stdout.trim())?.[1]);
      if (major >= MIN_NODE_MAJOR) return candidate;
    } catch {
      /* not runnable; try the next */
    }
  }
  return null;
}
