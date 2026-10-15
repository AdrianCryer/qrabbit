import { existsSync, mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join, sep } from "node:path";
import { app, safeStorage } from "electron";
import { CloudClient, CloudError, isSyncedPath, type DevicePlatform, type SessionStore } from "@qrabbit/cloud-api";
import { CloudSync, disableCloud, downloadCollection, enableCloud, isCloudCollection, readSyncState } from "@qrabbit/cloud-sync";
import type { CloudAccount, CloudChanged, CloudCollectionInfo, CloudDevice, CloudSyncState, CollectionInfo } from "@qrabbit/shared";
import { readJson, writeJson } from "@qrabbit/workspace";

type CloudEndpoint = { url: string; publishableKey: string };

const DEBOUNCE_MS = 2000;
const PERIODIC_MS = 5 * 60_000;

const endpoint = (url: string | undefined, publishableKey: string | undefined): CloudEndpoint | null => (url && publishableKey ? { url, publishableKey } : null);

/**
 * Where QRabbit Cloud is: `QRABBIT_CLOUD_URL` with `QRABBIT_CLOUD_PUBLISHABLE_KEY` from the environment the app runs
 * in, else as the build's environment had them (see `apps/desktop/.env.example`). Null without both: no cloud.
 */
export function cloudEndpoint(): CloudEndpoint | null {
  return (
    endpoint(process.env["QRABBIT_CLOUD_URL"], process.env["QRABBIT_CLOUD_PUBLISHABLE_KEY"]) ??
    endpoint(import.meta.env.QRABBIT_CLOUD_URL, import.meta.env.QRABBIT_CLOUD_PUBLISHABLE_KEY)
  );
}

/** The session, a refresh token, kept encrypted with the OS keychain in the app's data folder. */
class SessionFile implements SessionStore {
  private readonly file = join(app.getPath("userData"), "cloud-session.bin");
  private cache: Record<string, string> | null = null;

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    this.cache = {};
    try {
      if (existsSync(this.file)) {
        const raw = readFileSync(this.file);
        const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
        this.cache = JSON.parse(text) as Record<string, string>;
      }
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private save(): void {
    const text = JSON.stringify(this.load());
    if (!safeStorage.isEncryptionAvailable()) console.warn("[cloud] no OS keychain available; the session is stored unencrypted");
    const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, "utf8");
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, data, { mode: 0o600 });
  }

  getItem(key: string): string | null {
    return this.load()[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.load()[key] = value;
    this.save();
  }
  removeItem(key: string): void {
    delete this.load()[key];
    this.save();
  }
}

export type CloudEmitter = {
  account(account: CloudAccount): void;
  syncState(collectionPath: string, state: CloudSyncState): void;
  changed(collectionPath: string, changed: CloudChanged): void;
};

type Runner = { sync: CloudSync; watcher: FSWatcher | null; unwatch: () => void; timer: NodeJS.Timeout; debounce: NodeJS.Timeout | null };

const platform = (): DevicePlatform => (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux" ? process.platform : "other");

/** The account on this machine and one sync runner per open cloud collection. */
export class CloudHost {
  readonly client: CloudClient | null;
  private readonly runners = new Map<string, Runner>();
  private readonly openPaths = new Set<string>();
  private deviceId: string | null = null;
  private last: CloudAccount = { available: false, signedIn: false };

  constructor(
    private readonly emit: CloudEmitter,
    /** Folders this machine knows, to match cloud collections to them. */
    private readonly recent: () => CollectionInfo[],
  ) {
    const endpoint = cloudEndpoint();
    this.client = endpoint ? new CloudClient({ ...endpoint, sessionStore: new SessionFile() }) : null;
    this.client?.onAuthChange((session) => {
      if (!session) {
        this.stopAll();
        this.deviceId = null;
      }
      void this.account().catch(() => {});
    });
  }

  // ---------- the account ----------
  async account(): Promise<CloudAccount> {
    if (!this.client) return this.set({ available: false, signedIn: false });
    const session = await this.client.session().catch(() => null);
    if (!session) return this.set({ available: true, signedIn: false });
    try {
      const me = await this.client.me();
      const deviceId = await this.ensureDevice(me.id);
      return this.set({ available: true, signedIn: true, email: me.email ?? session.user.email, usedBytes: me.usedBytes, quotaBytes: me.quotaBytes, deviceId });
    } catch (err) {
      if (err instanceof CloudError && err.code === "unauthenticated") return this.set({ available: true, signedIn: false });
      return this.set({ ...this.last, available: true, signedIn: true, email: session.user.email, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private set(account: CloudAccount): CloudAccount {
    this.last = account;
    this.emit.account(account);
    return account;
  }

  private get devicesFile(): string {
    return join(app.getPath("userData"), "cloud-devices.json");
  }

  /** This machine's device in the account, registered on first sight and remembered per account. */
  private async ensureDevice(userId: string): Promise<string> {
    if (this.deviceId) return this.deviceId;
    const client = this.client!;
    const known = readJson<Record<string, string>>(this.devicesFile) ?? {};
    const devices = await client.devices();
    let id = known[userId];
    if (!id || !devices.some((d) => d.id === id)) {
      id = (await client.registerDevice(hostname() || "This computer", platform())).id;
      writeJson(this.devicesFile, { ...known, [userId]: id });
    } else {
      void client.touchDevice(id).catch(() => {});
    }
    this.deviceId = id;
    return id;
  }

  async requestCode(email: string): Promise<void> {
    if (!this.client) throw new Error("QRabbit Cloud is not available in this build");
    await this.client.requestCode(email);
  }

  async verifyCode(email: string, code: string): Promise<CloudAccount> {
    if (!this.client) throw new Error("QRabbit Cloud is not available in this build");
    await this.client.verifyCode(email, code);
    const account = await this.account();
    for (const path of this.openPaths) void this.startRunner(path);
    return account;
  }

  async signOut(scope: "local" | "others"): Promise<CloudAccount> {
    if (!this.client) return this.account();
    if (scope === "local") this.stopAll();
    await this.client.signOut(scope);
    return this.account();
  }

  async devices(): Promise<CloudDevice[]> {
    if (!this.client) return [];
    const list = await this.client.devices();
    return list.map((d) => ({ id: d.id, name: d.name, platform: d.platform, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, current: d.id === this.deviceId }));
  }

  async collections(): Promise<CloudCollectionInfo[]> {
    if (!this.client) return [];
    const local = new Map<string, string>();
    for (const c of this.recent()) {
      const id = readSyncState(c.path)?.collectionId;
      if (id && !local.has(id)) local.set(id, c.path);
    }
    const list = await this.client.collections();
    return list.map((c) => ({ id: c.id, name: c.name, rev: c.rev, updatedAt: c.updatedAt, ...(local.has(c.id) ? { localPath: local.get(c.id)! } : {}) }));
  }

  // ---------- collections ----------
  /** A collection was opened in the app: sync it from here on if it is a cloud collection. */
  opened(path: string): void {
    this.openPaths.add(path);
    if (isCloudCollection(path)) void this.startRunner(path).catch((err) => console.warn(`[cloud] ${basename(path)}: ${String((err as Error)?.message ?? err)}`));
  }

  async enable(path: string): Promise<CloudSyncState> {
    if (!this.client) throw new Error("QRabbit Cloud is not available in this build");
    await enableCloud(path, this.client);
    const runner = await this.startRunner(path);
    if (!runner) throw new Error("Sign in to QRabbit Cloud first");
    return runner.sync.state;
  }

  disable(path: string): void {
    this.stopRunner(path);
    disableCloud(path);
  }

  async remove(collectionId: string): Promise<void> {
    if (!this.client) return;
    for (const [path, runner] of this.runners) {
      if (runner.sync.state.collectionId === collectionId) this.disable(path);
    }
    for (const c of this.recent()) if (readSyncState(c.path)?.collectionId === collectionId) disableCloud(c.path);
    await this.client.deleteCollection(collectionId);
  }

  async syncNow(path: string): Promise<CloudSyncState> {
    const runner = this.runners.get(path) ?? (await this.startRunner(path));
    if (!runner) throw new Error("Sign in to QRabbit Cloud first");
    await runner.sync.requestSync();
    return runner.sync.state;
  }

  syncState(path: string): CloudSyncState | null {
    const runner = this.runners.get(path);
    if (runner) return runner.sync.state;
    const s = readSyncState(path);
    return s ? { collectionId: s.collectionId, phase: "idle", live: false, rev: s.rev, unsaved: s.unsaved?.length ?? 0, skipped: 0, tooLarge: 0, ...(s.lastSync ? { lastSync: s.lastSync } : {}) } : null;
  }

  async download(collectionId: string, dir: string): Promise<void> {
    if (!this.client) throw new Error("QRabbit Cloud is not available in this build");
    const account = await this.account();
    if (!account.signedIn) throw new Error("Sign in to QRabbit Cloud first");
    await downloadCollection(dir, this.client, collectionId, { ...(account.deviceId ? { deviceId: account.deviceId } : {}), log: console });
  }

  dispose(): void {
    this.stopAll();
  }

  // ---------- runners ----------
  private async startRunner(path: string): Promise<Runner | null> {
    const existing = this.runners.get(path);
    if (existing) return existing;
    if (!this.client || !isCloudCollection(path)) return null;
    const account = this.last.signedIn ? this.last : await this.account();
    if (!account.signedIn) return null;
    const client = this.client;
    const sync = new CloudSync({
      dir: path,
      client,
      ...(account.deviceId ? { deviceId: account.deviceId } : {}),
      log: { info: (m) => console.log(`[cloud] ${basename(path)}: ${m}`), warn: (m) => console.warn(`[cloud] ${basename(path)}: ${m}`) },
      onState: (s) => this.emit.syncState(path, s),
      onChanged: (c) => this.emit.changed(path, c),
    });
    const runner: Runner = { sync, watcher: null, unwatch: () => {}, timer: setInterval(() => this.kick(path), PERIODIC_MS), debounce: null };
    this.runners.set(path, runner);
    // The folder itself, debounced: the app's own writes and edits made in Obsidian both count.
    try {
      runner.watcher = watch(path, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename).split(sep).join("/");
        if (!isSyncedPath(rel)) return;
        if (runner.debounce) clearTimeout(runner.debounce);
        runner.debounce = setTimeout(() => {
          runner.debounce = null;
          this.kick(path);
        }, DEBOUNCE_MS);
      });
      runner.watcher.on("error", () => {
        runner.watcher?.close();
        runner.watcher = null;
      });
    } catch {
      runner.watcher = null;
    }
    // Other machines' commits, over the live channel. When the channel comes up, a run catches whatever it missed.
    runner.unwatch = client.watch(
      sync.state.collectionId,
      (rev) => {
        if (rev > sync.state.rev) this.kick(path);
      },
      (status) => {
        const wasLive = sync.state.live;
        sync.setLive(status === "live");
        if (status === "live" && !wasLive) this.kick(path);
      },
    );
    this.emit.syncState(path, sync.state);
    this.kick(path);
    return runner;
  }

  private kick(path: string): void {
    const runner = this.runners.get(path);
    if (!runner) return;
    runner.sync
      .requestSync()
      .then((report) => {
        if (report.pulled || report.pushed || report.deleted || report.removed) void this.account().catch(() => {});
      })
      .catch((err) => console.warn(`[cloud] ${basename(path)}: ${String((err as Error)?.message ?? err)}`));
  }

  private stopRunner(path: string): void {
    const runner = this.runners.get(path);
    if (!runner) return;
    this.runners.delete(path);
    clearInterval(runner.timer);
    if (runner.debounce) clearTimeout(runner.debounce);
    runner.watcher?.close();
    runner.unwatch();
    runner.sync.dispose();
  }

  private stopAll(): void {
    for (const path of [...this.runners.keys()]) this.stopRunner(path);
  }
}
