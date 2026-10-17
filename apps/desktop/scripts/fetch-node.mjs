// Fetches the Node that a packaged Windows build ships for the agent adapters (see src/main/runtime.ts): node.exe
// and its LICENSE into vendor/node/, which electron-builder copies to resources/node/. It takes the newest release
// of the pinned major from nodejs.org, checks the download against that release's SHASUMS256.txt, and does nothing
// when that version is already in place. Other platforms run the adapters on Electron's own Node and need nothing.
// Usage: node scripts/fetch-node.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The README's minimum and what the adapters are tested on; src/main/runtime.ts checks for the same. */
const NODE_MAJOR = 22;
const DIST = "https://nodejs.org/dist";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "node");
const stamp = join(outDir, "VERSION");

if (process.platform !== "win32") {
  console.log("fetch-node: only Windows builds ship a Node; nothing to do");
  process.exit(0);
}

// The build machine's own architecture, which is also what electron-builder packages for.
const arch = process.arch === "arm64" ? "arm64" : "x64";
const suffix = `-win-${arch}.zip`;

const shasums = await fetchText(`${DIST}/latest-v${NODE_MAJOR}.x/SHASUMS256.txt`);
const line = shasums.split("\n").find((l) => l.trim().endsWith(suffix));
if (!line) throw new Error(`fetch-node: no ${suffix} in the latest Node ${NODE_MAJOR} release`);
const [sha, file] = line.trim().split(/\s+/);
const version = /^node-(v\d+\.\d+\.\d+)-/.exec(file)?.[1];
if (!version) throw new Error(`fetch-node: cannot read a version from ${file}`);
const want = `${version}-${arch}`;

if (existsSync(join(outDir, "node.exe")) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === want) {
  console.log(`fetch-node: Node ${version} ${arch} already in ${outDir}`);
  process.exit(0);
}

console.log(`fetch-node: downloading Node ${version} ${arch}`);
const zip = await fetchBytes(`${DIST}/${version}/${file}`);
const actual = createHash("sha256").update(zip).digest("hex");
if (actual !== sha) throw new Error(`fetch-node: ${file} does not match SHASUMS256.txt (${actual})`);

const tmp = mkdtempSync(join(tmpdir(), "qrabbit-node-"));
try {
  const zipPath = join(tmp, file);
  writeFileSync(zipPath, zip);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const top = file.slice(0, -".zip".length);
  // Windows ships bsdtar, which reads zip archives; Git's GNU tar, which may come first on PATH, does not.
  const tar = join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe");
  execFileSync(tar, ["-xf", zipPath, "-C", outDir, "--strip-components=1", `${top}/node.exe`, `${top}/LICENSE`], { stdio: "inherit" });
  writeFileSync(stamp, `${want}\n`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`fetch-node: Node ${version} ${arch} -> ${outDir}`);

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
