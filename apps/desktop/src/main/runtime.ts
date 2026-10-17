import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { promisify } from "node:util";

/**
 * What runs the agent adapters, which are Node programs, and npm, which downloads them (agent-install.ts).
 *
 * A packaged build carries its own Node under resources/node (scripts/fetch-node.mjs), so the adapters run on the
 * runtime they are tested on, with npm beside it. In development the first Node on PATH that is new enough
 * serves, with the npm Node installs beside it. Electron's own Node is the last resort: it has no npm, so no
 * agent can be downloaded on it, and on Windows it is a GUI program with no console to pass down, so a console
 * program an adapter starts without hiding it (Codex's `codex.exe`, a shell command, the PowerShell that opens a
 * sign-in page) gets a console of its own, which Windows 11 shows as a Windows Terminal window. Started hidden,
 * `node.exe` gets a console without a window, and everything below it inherits that console however it was
 * started. Zed and JetBrains run the adapters on Node this way.
 */
export type AdapterRuntime = {
  kind: "node" | "electron";
  command: string;
  env: Record<string, string>;
  /** npm's CLI script beside this Node, or null when there is none (Electron's). */
  npm: string | null;
};

/** The README's minimum; the adapters are tested on it. */
const MIN_NODE_MAJOR = 22;
const run = promisify(execFile);
const exe = process.platform === "win32" ? "node.exe" : "node";
let found: Promise<AdapterRuntime> | null = null;

export function adapterRuntime(): Promise<AdapterRuntime> {
  found ??= pick();
  return found;
}

async function pick(): Promise<AdapterRuntime> {
  const node = await findNode();
  if (node) {
    const npm = npmBeside(node);
    console.log(`[agent] adapters run on ${node}${npm ? "" : " (no npm beside it: agents cannot be downloaded)"}`);
    return { kind: "node", command: node, env: {}, npm };
  }
  console.warn(`[agent] no Node ${MIN_NODE_MAJOR} or later found; adapters run on Electron, no agent can be downloaded${process.platform === "win32" ? ", and agents may open console windows" : ""}`);
  return { kind: "electron", command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ATTACH_CONSOLE: "1" }, npm: null };
}

/** A packaged build's own Node, else the first on PATH that is new enough. */
async function findNode(): Promise<string | null> {
  const own = process.platform === "win32" ? join(process.resourcesPath, "node", exe) : join(process.resourcesPath, "node", "bin", exe);
  const onPath = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, exe));
  for (const candidate of [own, ...onPath]) {
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

/**
 * npm beside the Node: as a packaged build lays it out (npm/ next to node.exe, or next to bin/), else as Node
 * installs it (node_modules/npm beside node.exe on Windows, lib/node_modules/npm above bin/ elsewhere).
 */
function npmBeside(node: string): string | null {
  const dir = dirname(node);
  const candidates = [join(dir, "npm"), join(dir, "..", "npm"), join(dir, "node_modules", "npm"), join(dir, "..", "lib", "node_modules", "npm")];
  return candidates.map((d) => join(d, "bin", "npm-cli.js")).find((cli) => existsSync(cli)) ?? null;
}
