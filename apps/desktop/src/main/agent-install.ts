import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { AGENTS, agentInfo, type AgentId, type AgentInstall } from "@qrabbit/shared";
import { adapterRuntime } from "./runtime";

/**
 * The agents are not in the install. Each adapter brings its vendor's CLI, hundreds of megabytes per agent and
 * per platform, so bundling them would make the app several times its own size and every agent added would add
 * its own. Instead an agent's adapter is an npm package downloaded the first time the agent is picked, into the
 * app's data folder (`agents/<id>/<version>/node_modules`), by the npm that ships beside the Node the adapters run
 * on (runtime.ts). Zed does the same for its external agents.
 *
 * A development build has the adapters as devDependencies next to the app and uses those; `QRABBIT_AGENTS_MANAGED`
 * makes it download like a packaged build, for checking this path.
 */

/** Written once npm has finished, so a download that stopped halfway is done again rather than trusted. */
const STAMP = ".ready";

const root = () => join(app.getPath("userData"), "agents");
const dirOf = (id: AgentId) => join(root(), id, agentInfo(id).adapter.version);
const entryIn = (dir: string, id: AgentId) => join(dir, "node_modules", "@agentclientprotocol", agentInfo(id).adapter.pkg, "dist", "index.js");

function bundledEntry(id: AgentId): string | null {
  if (app.isPackaged || process.env["QRABBIT_AGENTS_MANAGED"]) return null;
  try {
    return require.resolve(`@agentclientprotocol/${agentInfo(id).adapter.pkg}/dist/index.js`);
  } catch {
    return null;
  }
}

/** The adapter's server script: next to the app in development, else in the download, there or not yet. */
export function adapterEntry(id: AgentId): string {
  return bundledEntry(id) ?? entryIn(dirOf(id), id);
}

type Listener = (install: AgentInstall) => void;
const listeners = new Set<Listener>();
const states = new Map<AgentId, AgentInstall>();
const jobs = new Map<AgentId, Promise<AgentInstall>>();

export function onInstall(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function set(install: AgentInstall): AgentInstall {
  states.set(install.id, install);
  for (const cb of listeners) cb(install);
  return install;
}

export function installState(id: AgentId): AgentInstall {
  const known = states.get(id);
  if (known) return known;
  const { version } = agentInfo(id).adapter;
  if (bundledEntry(id)) return set({ id, version, state: "ready", bytes: 0, bundled: true });
  const dir = dirOf(id);
  const ready = existsSync(join(dir, STAMP)) && existsSync(entryIn(dir, id));
  return set({ id, version, state: ready ? "ready" : "missing", bytes: ready ? dirSize(dir) : 0 });
}

export function installs(): AgentInstall[] {
  return AGENTS.map((a) => installState(a.id));
}

/** The download if it is there, else the download now: one at a time per agent, shared by whoever else asks. */
export function ensureInstalled(id: AgentId): Promise<AgentInstall> {
  const current = installState(id);
  if (current.state === "ready") return Promise.resolve(current);
  return install(id);
}

export function install(id: AgentId): Promise<AgentInstall> {
  const running = jobs.get(id);
  if (running) return running;
  const job = download(id).finally(() => jobs.delete(id));
  jobs.set(id, job);
  return job;
}

async function download(id: AgentId): Promise<AgentInstall> {
  const info = agentInfo(id);
  const { pkg, version } = info.adapter;
  const dir = dirOf(id);
  const cache = join(root(), ".npm-cache");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // A manifest of its own, so npm resolves the adapter's dependency tree as it would for any project.
  const manifest = { name: `qrabbit-agent-${id}`, private: true, dependencies: { [`@agentclientprotocol/${pkg}`]: version } };
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  set({ id, version, state: "installing", bytes: 0 });

  // Whatever goes wrong from here, the install state says so.
  let log = "";
  let failed: string | null = null;
  try {
    const runtime = await adapterRuntime();
    if (!runtime.npm) throw new Error("no npm to download it with: Qrabbit needs Node 22 or later with npm beside it");
    // No install scripts: neither adapter has any, and a pinned package gets no chance to run code at install time.
    const args = [runtime.npm, "install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--no-progress", "--loglevel=error", `--cache=${cache}`];
    const child = spawn(runtime.command, args, {
      cwd: dir,
      env: { ...process.env, ...runtime.env, NO_UPDATE_NOTIFIER: "1", npm_config_update_notifier: "false" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout?.on("data", (d: Buffer) => { log += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { log += d.toString(); });
    // npm says nothing until it is done; what has landed on disk so far is the progress there is to show.
    const tick = setInterval(() => set({ ...states.get(id)!, bytes: dirSize(dir) + dirSize(cache) }), 1000);
    const code = await new Promise<number>((resolve) => {
      child.on("error", (err) => { log += `\n${err.message}`; resolve(1); });
      child.on("exit", (c) => resolve(c ?? 1));
    }).finally(() => clearInterval(tick));
    if (code !== 0) failed = tail(log) || `npm exited with code ${code}`;
    else if (!existsSync(entryIn(dir, id))) failed = "npm finished but the adapter is not there";
  } catch (err) {
    failed = String((err as Error)?.message ?? err);
  }
  // The cache holds the compressed tarballs, which would double the space taken.
  rmSync(cache, { recursive: true, force: true });

  if (failed) {
    rmSync(dir, { recursive: true, force: true });
    console.warn(`[agent] ${info.title} download failed: ${failed}\n${log.trim()}`);
    set({ id, version, state: "error", bytes: 0, error: failed });
    throw new Error(`${info.title} could not be downloaded: ${failed}`);
  }
  writeFileSync(join(dir, STAMP), `${new Date().toISOString()}\n`);
  const done = set({ id, version, state: "ready", bytes: dirSize(dir) });
  console.log(`[agent] ${info.title} ${version} downloaded to ${dir} (${Math.round(done.bytes / 1e6)} MB)`);
  return done;
}

/** Delete the download. The caller makes sure the agent is not the one in use. */
export function uninstall(id: AgentId): AgentInstall {
  if (jobs.has(id)) throw new Error(`${agentInfo(id).title} is still downloading`);
  rmSync(join(root(), id), { recursive: true, force: true });
  return set({ id, version: agentInfo(id).adapter.version, state: "missing", bytes: 0 });
}

/** Downloads of versions this build no longer wants, left by earlier builds, and a cache a crash left behind. Once, at startup. */
export function pruneAgents(): void {
  for (const a of AGENTS) {
    const dir = join(root(), a.id);
    if (!existsSync(dir)) continue;
    for (const v of readdirSync(dir)) if (v !== a.adapter.version) rmSync(join(dir, v), { recursive: true, force: true });
  }
  rmSync(join(root(), ".npm-cache"), { recursive: true, force: true });
}

function dirSize(dir: string): number {
  let total = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) total += dirSize(p);
      else if (entry.isFile()) total += statSync(p).size;
    }
  } catch {
    /* gone or unreadable: counts for nothing */
  }
  return total;
}

/** What npm said that reads as the reason: its last error line, else its last words, without its chatter. */
function tail(s: string): string {
  const lines = s.trim().split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^npm (warn|notice)/i.test(l));
  const error = [...lines].reverse().find((l) => /\berr(or)?\b/i.test(l));
  return (error ?? lines.slice(-2).join(" ")).replace(/\s+/g, " ").slice(0, 160);
}
