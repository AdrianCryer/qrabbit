import { mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { CloudError, sha256Hex, syncPathProblem, type CloudClient, type FileChange, type FileEntry } from "@qrabbit/cloud-api";
import type { CloudChanged, CloudSyncState, CollectionManifest } from "@qrabbit/shared";
import { MANIFEST, readJson, writeAtomic } from "@qrabbit/workspace";
import { fileKind, mergeFiles, sibling } from "./merge.js";
import { scanCollection, type LocalFile, type Skipped } from "./scan.js";
import { clearSyncState, readSyncState, writeSyncState, type SyncState } from "./state.js";

export type SyncReport = {
  rev: number;
  /** Files written from the cloud, and files removed because the cloud had removed them. */
  pulled: number;
  deleted: number;
  /** Files sent up, and removals recorded there. */
  pushed: number;
  removed: number;
  /** Files changed on both sides: merged by format, or kept both. */
  merged: number;
  kept: number;
  conflicts: number;
  unsaved: string[];
  skipped: Skipped[];
  /** Files over the cloud's limit per file. They stay here as they are, and the cloud keeps the version it had. */
  tooLarge: string[];
  changed: CloudChanged;
};

export type SyncLogger = { info(message: string): void; warn(message: string): void };

export type CloudSyncOptions = {
  dir: string;
  client: CloudClient;
  /** This machine's device id in the account; other machines see it as who changed what. */
  deviceId?: string;
  log?: SyncLogger;
  onState?(state: CloudSyncState): void;
  /** Fires after a pull wrote or removed files, so the app can refresh what it shows. */
  onChanged?(changed: CloudChanged): void;
};

const RESERVE_BATCH = 500;
const COMMIT_BATCH = 1000;
const noChange = (): CloudChanged => ({ manifest: false, sources: false, threads: false, annotations: false, readerState: false });

function markChanged(changed: CloudChanged, path: string): void {
  switch (fileKind(path)) {
    case "manifest":
      changed.manifest = true;
      break;
    case "source":
    case "sourceFile":
      changed.sources = true;
      break;
    case "annotations":
      changed.annotations = true;
      break;
    case "readerState":
      changed.readerState = true;
      break;
    case "thread":
      changed.threads = true;
      break;
    default:
      break;
  }
}

const errText = (err: unknown) => (err instanceof CloudError ? err.message : String((err as Error)?.message ?? err));

/**
 * One folder kept in step with its cloud collection. A run pulls what the cloud changed, merges what changed on
 * both sides, then pushes what changed here. Runs never overlap; a request during a run queues one more.
 */
export class CloudSync {
  state: CloudSyncState;
  private running: Promise<SyncReport> | null = null;
  private again = false;
  private disposed = false;

  constructor(private readonly opts: CloudSyncOptions) {
    const s = readSyncState(opts.dir);
    if (!s) throw new Error("This collection is not kept in the cloud");
    this.state = { collectionId: s.collectionId, phase: "idle", live: false, rev: s.rev, unsaved: s.unsaved?.length ?? 0, skipped: 0, tooLarge: 0, ...(s.lastSync ? { lastSync: s.lastSync } : {}) };
  }

  get dir(): string {
    return this.opts.dir;
  }

  setLive(live: boolean): void {
    if (this.state.live !== live) this.emit({ live });
  }

  /** Run a sync, or queue one more behind the run in progress. Resolves with the last run's report. */
  requestSync(): Promise<SyncReport> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
  }

  private async loop(): Promise<SyncReport> {
    let report: SyncReport;
    do {
      this.again = false;
      report = await this.runOnce();
    } while (this.again && !this.disposed);
    return report;
  }

  private async runOnce(): Promise<SyncReport> {
    this.emit({ phase: "syncing", error: undefined });
    try {
      const report = await this.sync();
      this.emit({ phase: "idle", rev: report.rev, lastSync: new Date().toISOString(), unsaved: report.unsaved.length, skipped: report.skipped.length, tooLarge: report.tooLarge.length, error: undefined });
      return report;
    } catch (err) {
      this.emit({ phase: "error", error: errText(err) });
      throw err;
    }
  }

  private emit(patch: Partial<CloudSyncState>): void {
    this.state = { ...this.state, ...patch };
    this.opts.onState?.(this.state);
  }

  // ---------- one run ----------
  private async sync(): Promise<SyncReport> {
    const { dir, client, log } = this.opts;
    const state = readSyncState(dir);
    if (!state) throw new Error("This collection is no longer kept in the cloud");
    const report: SyncReport = { rev: state.rev, pulled: 0, deleted: 0, pushed: 0, removed: 0, merged: 0, kept: 0, conflicts: 0, unsaved: [], skipped: [], tooLarge: [], changed: noChange() };
    const scan = await scanCollection(dir, state.tree);
    report.skipped = scan.skipped;
    report.tooLarge = scan.tooLarge;
    const local = scan.files;
    // Too large to go up, and not to be replaced from the cloud either: missing from `local`, they are not removals.
    const held = new Set(scan.tooLarge);

    // ----- pull -----
    const pull = async () => {
      const entries: FileEntry[] = [];
      let cursor = null;
      let rev = state.rev;
      do {
        const page = await client.changes(state.collectionId, { since: state.rev, cursor, limit: 1000 });
        entries.push(...page.entries);
        cursor = page.next;
        rev = page.rev;
      } while (cursor);
      // Removals first, a source's json before its files; then writes, a source's json last. Anyone reading the
      // folder meanwhile never sees a source without its file.
      const isSourceJson = (p: string) => fileKind(p) === "source";
      const removals = entries.filter((e) => e.deleted).sort((a, b) => Number(isSourceJson(b.path)) - Number(isSourceJson(a.path)));
      const writes = entries.filter((e) => !e.deleted).sort((a, b) => Number(isSourceJson(a.path)) - Number(isSourceJson(b.path)));
      for (const e of [...removals, ...writes]) await this.apply(e, state, local, held, report);
      state.rev = rev;
      writeSyncState(dir, state);
    };
    await pull();

    // ----- push -----
    const adds = [...local.values()].filter((f) => f.sha256 !== state.tree[f.path]?.sha256);
    const gone = Object.keys(state.tree).filter((p) => !local.has(p) && !held.has(p));
    if (adds.length || gone.length) {
      const bySha = new Map<string, LocalFile[]>();
      for (const f of adds) bySha.set(f.sha256, [...(bySha.get(f.sha256) ?? []), f]);
      const unique = [...bySha.entries()].map(([sha256, files]) => ({ sha256, size: files[0]!.size }));
      const noRoom = new Set<string>();
      for (let i = 0; i < unique.length; i += RESERVE_BATCH) {
        const reserved = await client.reserveBlobs(unique.slice(i, i + RESERVE_BATCH));
        for (const item of reserved.items) {
          if (item.status === "quota") noRoom.add(item.sha256);
          else if (item.status === "upload") await client.putBlob(item.sha256, readFileSync(join(dir, bySha.get(item.sha256)![0]!.path)));
        }
      }
      const changes: FileChange[] = [];
      for (const f of adds) {
        if (noRoom.has(f.sha256)) report.unsaved.push(f.path);
        else changes.push({ path: f.path, sha256: f.sha256 });
      }
      for (const p of gone) changes.push({ path: p, deleted: true });
      for (let i = 0; i < changes.length; i += COMMIT_BATCH) {
        const result = await client.commit(state.collectionId, { base: state.rev, changes: changes.slice(i, i + COMMIT_BATCH), ...(this.opts.deviceId ? { deviceId: this.opts.deviceId } : {}) });
        for (const a of result.applied) {
          if (a.deleted) {
            delete state.tree[a.path];
            report.removed++;
          } else {
            const f = local.get(a.path)!;
            state.tree[a.path] = { sha256: f.sha256, size: f.size, mtimeMs: f.mtimeMs };
            report.pushed++;
          }
        }
        // A conflict here means another machine changed the path after our pull; the pull below brings it.
        report.conflicts += result.conflicts.length;
      }
      // The revision advances through pulls only: another machine may have committed between our pull and this
      // push, and that must not be skipped. Pulling again now brings it, and our own entries come back and are
      // recognised as already in place.
      if (changes.length) await pull();
    }
    state.unsaved = report.unsaved;
    state.lastSync = new Date().toISOString();
    writeSyncState(dir, state);
    report.rev = state.rev;
    if (Object.values(report.changed).some(Boolean)) this.opts.onChanged?.(report.changed);
    if (report.unsaved.length) log?.warn(`${report.unsaved.length} file(s) did not fit in the cloud`);
    if (report.tooLarge.length) log?.warn(`${report.tooLarge.length} file(s) are over the cloud's limit per file and stay on this machine`);
    return report;
  }

  /** Bring one cloud entry into the folder, or settle it against a local change. */
  private async apply(e: FileEntry, state: SyncState, local: Map<string, LocalFile>, held: ReadonlySet<string>, report: SyncReport): Promise<void> {
    const { dir, client } = this.opts;
    const path = e.path;
    // Never write outside the folder, whatever the cloud says.
    if (syncPathProblem(path)) return;
    const synced = state.tree[path];
    const loc = local.get(path);
    const remoteSha = e.deleted ? null : e.sha256;
    const syncedSha = synced?.sha256 ?? null;
    const localSha = loc?.sha256 ?? null;
    if (remoteSha === syncedSha) return;

    if (held.has(path)) {
      // The file here is too large to merge or send up, and nothing replaces it: a removal leaves it here alone,
      // and a change goes beside it, as when two versions cannot be merged.
      report.conflicts++;
      report.kept++;
      if (remoteSha === null) {
        delete state.tree[path];
        return;
      }
      const beside = sibling(path);
      local.set(beside, this.writeFile(beside, await client.getBlob(remoteSha), remoteSha));
      state.tree[path] = { sha256: remoteSha, size: e.size, mtimeMs: -1 };
      markChanged(report.changed, path);
      return;
    }

    if (localSha === syncedSha) {
      // Only the cloud changed: take it.
      if (remoteSha === null) {
        this.removeFile(path);
        local.delete(path);
        delete state.tree[path];
        report.deleted++;
      } else {
        const f = this.writeFile(path, await client.getBlob(remoteSha), remoteSha);
        local.set(path, f);
        state.tree[path] = f;
        report.pulled++;
      }
      markChanged(report.changed, path);
      return;
    }
    if (localSha === remoteSha) {
      // Both sides made the same change.
      if (loc) state.tree[path] = { sha256: loc.sha256, size: loc.size, mtimeMs: loc.mtimeMs };
      else delete state.tree[path];
      return;
    }
    report.conflicts++;
    if (remoteSha === null) {
      // Removed in the cloud, changed here: the change stays and goes back up.
      delete state.tree[path];
      report.kept++;
      return;
    }
    if (!loc) {
      // Removed here, changed in the cloud: a change is worth more than a removal.
      const f = this.writeFile(path, await client.getBlob(remoteSha), remoteSha);
      local.set(path, f);
      state.tree[path] = f;
      report.pulled++;
      markChanged(report.changed, path);
      return;
    }
    // Changed on both sides: merge by format, against the last synced version while the cloud still has it.
    const remote = await client.getBlob(remoteSha);
    const base = synced ? await this.tryGetBlob(synced.sha256) : null;
    const result = mergeFiles({ path, local: readFileSync(join(dir, path)), remote, base });
    if (result.kind === "merged") {
      local.set(path, this.writeFile(path, result.bytes, await sha256Hex(result.bytes)));
      report.merged++;
    } else {
      const beside = sibling(path);
      local.set(beside, this.writeFile(beside, remote, remoteSha));
      report.kept++;
    }
    // The cloud's version is the new base; what is here differs from it and goes up on the push.
    state.tree[path] = { sha256: remoteSha, size: e.size, mtimeMs: -1 };
    markChanged(report.changed, path);
  }

  private async tryGetBlob(sha256: string): Promise<Uint8Array | null> {
    try {
      return await this.opts.client.getBlob(sha256);
    } catch {
      return null;
    }
  }

  private writeFile(path: string, bytes: Uint8Array, sha256: string): LocalFile {
    const full = join(this.opts.dir, path);
    writeAtomic(full, bytes);
    const st = statSync(full);
    return { path, sha256, size: st.size, mtimeMs: st.mtimeMs };
  }

  private removeFile(path: string): void {
    const { dir } = this.opts;
    const full = join(dir, path);
    rmSync(full, { force: true });
    // Folders left empty go too, down to the collection's own top-level folders.
    let d = dirname(full);
    while (d !== dir && dirname(d) !== dir) {
      try {
        if (readdirSync(d).length) break;
        rmdirSync(d);
      } catch {
        break;
      }
      d = dirname(d);
    }
  }
}

// ---------- turning it on and off ----------
/** Start keeping a collection folder in the cloud. Idempotent; the first run pushes everything. */
export async function enableCloud(dir: string, client: CloudClient): Promise<SyncState> {
  const existing = readSyncState(dir);
  if (existing) return existing;
  const manifest = readJson<CollectionManifest>(join(dir, MANIFEST));
  if (!manifest) throw new Error("Not a collection folder");
  await client.putCollection(manifest.id, manifest.name);
  const state: SyncState = { version: 1, collectionId: manifest.id, rev: 0, tree: {} };
  writeSyncState(dir, state);
  return state;
}

/** Stop syncing a folder. The folder and the cloud copy both stay as they are. */
export function disableCloud(dir: string): void {
  clearSyncState(dir);
}

const CLUTTER = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** Bring a cloud collection down into an empty folder, which then syncs like any other. */
export async function downloadCollection(dir: string, client: CloudClient, collectionId: string, opts: Omit<CloudSyncOptions, "dir" | "client"> = {}): Promise<SyncReport> {
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).some((name) => !CLUTTER.has(name))) throw new Error("Choose an empty folder for the download");
  writeSyncState(dir, { version: 1, collectionId, rev: 0, tree: {} });
  const sync = new CloudSync({ dir, client, ...opts });
  try {
    return await sync.requestSync();
  } finally {
    sync.dispose();
  }
}
