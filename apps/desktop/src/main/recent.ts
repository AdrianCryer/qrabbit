import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { CollectionInfo } from "@qrabbit/shared";
import { readJson, writeJson } from "@qrabbit/workspace";

const MAX = 20;
const file = () => join(app.getPath("userData"), "recent-collections.json");

export function recentCollections(): CollectionInfo[] {
  const list = readJson<CollectionInfo[]>(file()) ?? [];
  return list.filter((c) => existsSync(join(c.path, "qrabbit.json"))).sort((a, b) => ((a.lastOpened ?? "") < (b.lastOpened ?? "") ? 1 : -1));
}

export function touchRecent(info: CollectionInfo): CollectionInfo[] {
  const rest = recentCollections().filter((c) => c.path !== info.path);
  const next = [{ ...info, lastOpened: new Date().toISOString() }, ...rest].slice(0, MAX);
  writeJson(file(), next);
  return next;
}

export function forgetRecent(path: string): CollectionInfo[] {
  const next = recentCollections().filter((c) => c.path !== path);
  writeJson(file(), next);
  return next;
}
