import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { newId, type CollectionInfo, type CollectionManifest } from "@qrabbit/shared";
import { agentsMd } from "./agents-md.js";
import { readJson, writeAtomic, writeJson } from "./fs.js";

export const MANIFEST = "qrabbit.json";
export const DIRS = { sources: "sources", threads: "threads", notes: "notes", state: ".qrabbit" } as const;

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
  if (!existsSync(gitignore)) writeAtomic(gitignore, `${DIRS.state}/index.sqlite\n${DIRS.state}/*.tmp\n`);
  return manifest;
}

export function openCollection(dir: string): { info: CollectionInfo; manifest: CollectionManifest } {
  const manifest = initCollection(dir);
  return { info: { path: dir, name: manifest.name, id: manifest.id, lastOpened: new Date().toISOString() }, manifest };
}

export function updateSettings(dir: string, patch: CollectionManifest["settings"]): CollectionManifest {
  const manifest = initCollection(dir);
  manifest.settings = { ...manifest.settings, ...patch };
  writeJson(join(dir, MANIFEST), manifest);
  return manifest;
}
