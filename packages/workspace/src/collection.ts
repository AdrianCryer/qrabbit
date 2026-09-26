import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { newId, type CollectionCounts, type CollectionInfo, type CollectionManifest, type SourceInfo } from "@qrabbit/shared";
import { agentsMd } from "./agents-md.js";
import { readJson, writeAtomic, writeJson } from "./fs.js";

export const MANIFEST = "qrabbit.json";
export const DIRS = { sources: "sources", threads: "threads", notes: "notes", state: ".qrabbit" } as const;
/** Removed sources wait here (relative to the collection) until `purgeTrash` lets them go. */
export const TRASH = `${DIRS.state}/trash`;
const TRASH_DAYS = 7;

export function isCollection(dir: string): boolean {
  return existsSync(join(dir, MANIFEST));
}

/** Create the folder layout and manifest. Safe to call on an existing collection. */
export function initCollection(dir: string, name?: string): CollectionManifest {
  mkdirSync(dir, { recursive: true });
  for (const d of Object.values(DIRS)) mkdirSync(join(dir, d), { recursive: true });
  const existing = readJson<CollectionManifest>(join(dir, MANIFEST));
  const manifest: CollectionManifest = existing ?? {
    id: newId("col"),
    name: name ?? basename(dir),
    created: new Date().toISOString(),
    settings: {},
  };
  if (!existing) writeJson(join(dir, MANIFEST), manifest);
  const agents = join(dir, "AGENTS.md");
  if (!existsSync(agents)) {
    writeAtomic(agents, agentsMd(manifest.name));
    writeAtomic(join(dir, "CLAUDE.md"), agentsMd(manifest.name));
  }
  const gitignore = join(dir, ".gitignore");
  const trashLine = `${TRASH}/`;
  if (!existsSync(gitignore)) writeAtomic(gitignore, `${DIRS.state}/index.sqlite\n${DIRS.state}/*.tmp\n${trashLine}\n`);
  else {
    // Collections made before the trash existed learn about it once.
    const current = readFileSync(gitignore, "utf8");
    if (!current.split(/\r?\n/).includes(trashLine)) writeAtomic(gitignore, `${current.replace(/\n*$/, "\n")}${trashLine}\n`);
  }
  return manifest;
}

export function openCollection(dir: string): { info: CollectionInfo; manifest: CollectionManifest } {
  const manifest = initCollection(dir);
  purgeTrash(dir);
  return { info: { path: dir, name: manifest.name, id: manifest.id, lastOpened: new Date().toISOString() }, manifest };
}

export function updateSettings(dir: string, patch: CollectionManifest["settings"]): CollectionManifest {
  const manifest = initCollection(dir);
  manifest.settings = { ...manifest.settings, ...patch };
  writeJson(join(dir, MANIFEST), manifest);
  return manifest;
}

// ---------- reading order ----------
/** The ids the manifest lists, in reading order. Ids without a folder are tolerated here and dropped by `setOrder`. */
export function readOrder(dir: string): string[] {
  const manifest = readJson<CollectionManifest>(join(dir, MANIFEST));
  return Array.isArray(manifest?.order) ? manifest.order.filter((id): id is string => typeof id === "string") : [];
}

/** Write the reading order: the whole list, duplicates removed. */
export function setOrder(dir: string, ids: string[]): CollectionManifest {
  const manifest = initCollection(dir);
  manifest.order = [...new Set(ids)];
  writeJson(join(dir, MANIFEST), manifest);
  return manifest;
}

// ---------- trash ----------
/** A folder name for the moment of removal that is safe on every file system. */
export function trashStamp(at = new Date()): string {
  return at.toISOString().replace(/[:.]/g, "-");
}

function stampTime(name: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

/** Delete removed sources that have waited longer than a week. Returns the stamps it emptied. */
export function purgeTrash(dir: string, maxAgeDays = TRASH_DAYS, now = Date.now()): string[] {
  const root = join(dir, TRASH);
  if (!existsSync(root)) return [];
  const gone: string[] = [];
  for (const name of readdirSync(root)) {
    const when = stampTime(name);
    if (!Number.isFinite(when) || now - when <= maxAgeDays * 86_400_000) continue;
    rmSync(join(root, name), { recursive: true, force: true });
    gone.push(name);
  }
  return gone;
}

// ---------- counts for the home screen ----------
function countThreadFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countThreadFiles(join(dir, e.name));
    else if (e.isFile() && e.name.endsWith(".md")) n++;
  }
  return n;
}

/** Sources, read sources and thread files, from the files alone; cheap enough for the recent list. */
export function collectionCounts(dir: string): CollectionCounts {
  const root = join(dir, DIRS.sources);
  let sources = 0;
  let read = 0;
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      const sub = join(root, name);
      if (!statSync(sub).isDirectory()) continue;
      const info = readJson<SourceInfo>(join(sub, "source.json"));
      if (!info) continue;
      sources++;
      if (info.read) read++;
    }
  }
  return { sources, read, threads: countThreadFiles(join(dir, DIRS.threads)) };
}
