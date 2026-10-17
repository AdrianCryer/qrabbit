// Cuts a release: sets the desktop app's version, commits, and tags v<version>. Pushing the tag
// (`git push --follow-tags`) starts .github/workflows/release.yml, which builds the installers onto a draft
// release for you to publish. Usage: pnpm release 0.1.0
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: pnpm release <major.minor.patch>");
  process.exit(2);
}

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

if (git("status", "--porcelain")) {
  console.error("release: the working tree has changes; commit or stash them first");
  process.exit(1);
}
if (git("tag", "--list", `v${version}`)) {
  console.error(`release: v${version} already exists`);
  process.exit(1);
}

const file = join(repo, "apps", "desktop", "package.json");
const before = readFileSync(file, "utf8");
const previous = /"version":\s*"([^"]+)"/.exec(before)?.[1];
const after = before.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`);
if (!previous || after === before) {
  console.error(`release: no version field in ${file}`);
  process.exit(1);
}
writeFileSync(file, after);

git("add", file);
git("commit", "-m", `release: v${version}`);
git("tag", "-a", `v${version}`, "-m", `Qrabbit ${version}`);
console.log(`release: ${previous} -> ${version}, tagged v${version}. Push it with: git push --follow-tags`);
