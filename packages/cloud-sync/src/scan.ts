import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { isSyncedPath, STATE_DIR, STATE_SYNCED, syncPathProblem } from "@qrabbit/cloud-api";
import type { SyncedFile } from "./state.js";

export type LocalFile = SyncedFile & { path: string };
/** A file that syncs by its place in the folder but not by its name: other systems could not write it. */
export type Skipped = { path: string; reason: string };

export async function hashFile(full: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(full), hash);
  return hash.digest("hex");
}

/**
 * Every synced file in the folder with its hash. A file whose size and modification time match what the last
 * sync recorded keeps its hash; only changed files are read.
 */
export async function scanCollection(dir: string, known: Record<string, SyncedFile>): Promise<{ files: Map<string, LocalFile>; skipped: Skipped[] }> {
  const candidates: Array<{ full: string; path: string }> = [];
  const skipped: Skipped[] = [];
  const consider = (full: string, path: string) => {
    if (!isSyncedPath(path)) return;
    const problem = syncPathProblem(path);
    if (problem) skipped.push({ path, reason: problem });
    else candidates.push({ full, path });
  };
  const walk = (sub: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(sub, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(sub, e.name);
      const path = relative(dir, full).split(sep).join("/");
      if (e.isDirectory()) {
        // App state stays local, except the reading positions.
        if (path === STATE_DIR) {
          const positions = join(dir, STATE_SYNCED);
          if (existsSync(positions)) consider(positions, STATE_SYNCED);
          continue;
        }
        if (isSyncedPath(`${path}/.`)) walk(full);
        continue;
      }
      // Links are left alone: they point outside the folder or repeat what is in it.
      if (e.isFile()) consider(full, path);
    }
  };
  walk(dir);

  const files = new Map<string, LocalFile>();
  for (const { full, path } of candidates) {
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    const k = known[path];
    const sha256 = k && k.size === st.size && k.mtimeMs === st.mtimeMs ? k.sha256 : await hashFile(full);
    files.set(path, { path, sha256, size: st.size, mtimeMs: st.mtimeMs });
  }
  return { files, skipped };
}
