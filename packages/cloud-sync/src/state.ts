import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJson } from "@qrabbit/workspace";

/** Local only: which cloud collection this folder is, and what the two last agreed on. Never synced itself. */
export const STATE_FILE = ".qrabbit/cloud.json";

export type SyncedFile = {
  sha256: string;
  size: number;
  /** The file's modification time when it last matched `sha256`; -1 forces a fresh hash on the next scan. */
  mtimeMs: number;
};

export type SyncState = {
  version: 1;
  /** The cloud collection: the manifest's own id. */
  collectionId: string;
  /** The cloud revision fully applied to this folder. */
  rev: number;
  /** Every synced path as the folder and the cloud last agreed on it. */
  tree: Record<string, SyncedFile>;
  /** Paths that did not fit in the quota last time; tried again on every run. */
  unsaved?: string[];
  lastSync?: string;
};

export function readSyncState(dir: string): SyncState | null {
  const s = readJson<SyncState>(join(dir, STATE_FILE));
  if (!s || s.version !== 1 || typeof s.collectionId !== "string") return null;
  return { ...s, rev: typeof s.rev === "number" ? s.rev : 0, tree: s.tree ?? {} };
}

export function writeSyncState(dir: string, state: SyncState): void {
  writeJson(join(dir, STATE_FILE), state);
}

export function clearSyncState(dir: string): void {
  rmSync(join(dir, STATE_FILE), { force: true });
}

/** Whether the folder is kept in the cloud from this machine. */
export function isCloudCollection(dir: string): boolean {
  return existsSync(join(dir, STATE_FILE));
}
