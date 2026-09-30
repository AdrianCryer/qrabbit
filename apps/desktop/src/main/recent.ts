import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { CollectionInfo } from "@qrabbit/shared";
import { isCloudCollection } from "@qrabbit/cloud-sync";
import { collectionCounts, readJson, writeJson } from "@qrabbit/workspace";

const MAX = 20;
const file = () => join(app.getPath("userData"), "recent-collections.json");

function stored(): CollectionInfo[] {
  const list = readJson<CollectionInfo[]>(file()) ?? [];
  return list
    .filter((c) => existsSync(join(c.path, "qrabbit.json")))
    .map(({ counts: _stale, ...c }) => c)
    .sort((a, b) => ((a.lastOpened ?? "") < (b.lastOpened ?? "") ? 1 : -1));
}

/** The recent list with fresh counts for the home screen; the counts and the cloud flag are read from the folders, never stored. */
export function recentCollections(): CollectionInfo[] {
  return stored().map((c) => {
    try {
      return { ...c, counts: collectionCounts(c.path), cloud: isCloudCollection(c.path) };
    } catch {
      return c;
    }
  });
}

export function touchRecent(info: CollectionInfo): CollectionInfo[] {
  const { counts: _counts, cloud: _cloud, ...bare } = info;
  const rest = stored().filter((c) => c.path !== info.path);
  const next = [{ ...bare, lastOpened: new Date().toISOString() }, ...rest].slice(0, MAX);
  writeJson(file(), next);
  return next;
}

export function forgetRecent(path: string): CollectionInfo[] {
  const next = stored().filter((c) => c.path !== path);
  writeJson(file(), next);
  return recentCollections();
}
