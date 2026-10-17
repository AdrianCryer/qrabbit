// Fetches the Node a packaged build ships: the agent adapters run on it (src/main/runtime.ts) and the npm beside it
// installs them (src/main/agent-install.ts). It takes the newest release of the pinned major for this machine's
// platform from nodejs.org, checks the download against that release's SHASUMS256.txt, and lays it out in
// vendor/node/: node.exe (bin/node elsewhere), LICENSE, and the npm package as npm/ beside them, out of any
// node_modules folder, which electron-builder leaves out of extra resources. It copies the folder to
// resources/node/. Nothing happens when that version is already in place. Usage: node scripts/fetch-node.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The README's minimum and what the adapters are tested on; src/main/runtime.ts checks for the same. */
const NODE_MAJOR = 22;
const DIST = "https://nodejs.org/dist";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "node");
const stamp = join(outDir, "VERSION");

// The build machine's own platform and architecture, which are also what electron-builder packages for.
const { platform } = process;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const flavour = platform === "win32" ? `win-${arch}.zip` : platform === "darwin" ? `darwin-${arch}.tar.gz` : `linux-${arch}.tar.gz`;
const win = platform === "win32";
/** What the build needs out of the archive, and where it lands. */
const pieces = win
  ? [["node.exe", "node.exe"], ["LICENSE", "LICENSE"], ["node_modules/npm", "npm"]]
  : [["bin/node", "bin/node"], ["LICENSE", "LICENSE"], ["lib/node_modules/npm", "npm"]];

const shasums = await fetchText(`${DIST}/latest-v${NODE_MAJOR}.x/SHASUMS256.txt`);
const line = shasums.split("\n").find((l) => l.trim().endsWith(`-${flavour}`));
if (!line) throw new Error(`fetch-node: no ${flavour} in the latest Node ${NODE_MAJOR} release`);
const [sha, file] = line.trim().split(/\s+/);
const version = /^node-(v\d+\.\d+\.\d+)-/.exec(file)?.[1];
if (!version) throw new Error(`fetch-node: cannot read a version from ${file}`);
const want = `${version}-${platform}-${arch}`;

const inPlace = pieces.every(([, to]) => existsSync(join(outDir, to)));
if (inPlace && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === want) {
  console.log(`fetch-node: Node ${version} ${platform}-${arch} already in ${outDir}`);
  process.exit(0);
}

console.log(`fetch-node: downloading Node ${version} ${platform}-${arch}`);
const archive = await fetchBytes(`${DIST}/${version}/${file}`);
const actual = createHash("sha256").update(archive).digest("hex");
if (actual !== sha) throw new Error(`fetch-node: ${file} does not match SHASUMS256.txt (${actual})`);

const tmp = mkdtempSync(join(tmpdir(), "qrabbit-node-"));
try {
  const archivePath = join(tmp, file);
  writeFileSync(archivePath, archive);
  // Windows ships bsdtar, which reads zip archives; Git's GNU tar, which may come first on PATH, does not.
  const tar = win ? join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-xf", archivePath, "-C", tmp], { stdio: "inherit" });
  const top = join(tmp, file.replace(/\.(zip|tar\.gz)$/, ""));
  rmSync(outDir, { recursive: true, force: true });
  for (const [from, to] of pieces) {
    mkdirSync(dirname(join(outDir, to)), { recursive: true });
    cpSync(join(top, from), join(outDir, to), { recursive: true });
  }
  writeFileSync(stamp, `${want}\n`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`fetch-node: Node ${version} ${platform}-${arch} -> ${outDir}`);

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch-node: ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch-node: ${url}: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}
