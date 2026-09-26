import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { statSync } from "node:fs";
import { basename, delimiter, resolve, sep } from "node:path";
import type { Anchor, Annotation, CollectionManifest, CollectionSnapshot, DropResult, FolderScan, ImportResult, Message, ReaderPosition, RemovedSource } from "@qrabbit/shared";
import {
  addAnnotation,
  autoTitleSource,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
  appendMessage,
  createThread,
  deleteThread,
  importFiles,
  importWebPage,
  listSources,
  listThreads,
  openCollection,
  readReaderState,
  readSourceBytes,
  readSourceText,
  readThread,
  removeSource,
  renameSource,
  restoreSource,
  saveSourceText,
  scanFolder,
  setOrder,
  setReaderPosition,
  setSourceRead,
  sourceDir,
  updateSettings,
} from "@qrabbit/workspace";
import { forgetRecent, recentCollections, touchRecent } from "./recent";
import { AgentHost, type AgentEmitter } from "./agent";

/** Main only touches collections this process opened; the renderer cannot point it at arbitrary folders. */
const opened = new Set<string>();

/**
 * Files and folders the user pointed the app at through a dialog or a drop, per collection. They are the only
 * places `importFiles` and `scanFolder` will read from, so the renderer cannot copy arbitrary files into a
 * collection and read them back.
 */
const chosen = new Map<string, Set<string>>();
function allow(collection: string, path: string): string {
  const full = resolve(path);
  let set = chosen.get(collection);
  if (!set) chosen.set(collection, (set = new Set()));
  set.add(full);
  return full;
}
function assertChosen(collection: string, path: string): string {
  const full = resolve(path);
  for (const root of chosen.get(collection) ?? []) if (full === root || full.startsWith(root + sep)) return full;
  throw new Error(`Not a file the user chose: ${basename(path)}`);
}
/** Folders a scripted run may scan without the dialog: `QRABBIT_TRUST_FOLDERS`, separated like PATH. Development builds only. */
const trustedFolders = app.isPackaged
  ? []
  : (process.env["QRABBIT_TRUST_FOLDERS"] ?? "")
      .split(delimiter)
      .map((s) => s.trim())
      .filter(Boolean);

// ----- agents: one host per open collection -----
const hosts = new Map<string, AgentHost>();
const broadcast = (channel: string, ...args: unknown[]) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, ...args);
};
const emitter: AgentEmitter = {
  event: (threadId, event) => broadcast("agent:event", threadId, event),
  permission: (request) => broadcast("agent:permission", request),
  status: (collection, status) => broadcast("agent:status", collection, status),
};
function host(collection: string): AgentHost {
  guard(collection);
  let h = hosts.get(collection);
  if (!h) {
    h = new AgentHost(collection, emitter);
    hosts.set(collection, h);
  }
  return h;
}
export async function disposeAgents(): Promise<void> {
  await Promise.all([...hosts.values()].map((h) => h.dispose()));
  hosts.clear();
}

function guard(path: string): string {
  if (!opened.has(path)) throw new Error("Collection is not open");
  return path;
}

function snapshot(path: string): CollectionSnapshot {
  const { info, manifest } = openCollection(path);
  opened.add(path);
  for (const d of trustedFolders) allow(path, d);
  touchRecent(info);
  return { info, manifest, sources: listSources(path), threads: listThreads(path), annotations: listAnnotations(path), readerState: readReaderState(path) };
}

const windowOf = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined;

export function registerIpc(): void {
  // ----- collections -----
  ipcMain.handle("collections:recent", () => recentCollections());
  ipcMain.handle("collections:open", (_e, path: string) => snapshot(path));
  ipcMain.handle("collections:forget", (_e, path: string) => forgetRecent(path));
  ipcMain.handle("collections:updateSettings", (_e, path: string, patch: CollectionManifest["settings"]) => updateSettings(guard(path), patch));
  ipcMain.handle("collections:setOrder", (_e, path: string, ids: string[]) => setOrder(guard(path), ids));
  ipcMain.handle("collections:openDialog", async (e) => {
    const win = windowOf(e);
    const r = await dialog.showOpenDialog(win!, {
      title: "Open a collection folder (or pick an empty folder to start one)",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Open collection",
    });
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return null;
    return snapshot(dir);
  });

  // ----- sources -----
  ipcMain.handle("sources:list", (_e, collection: string) => listSources(guard(collection)));
  ipcMain.handle("sources:importDialog", async (e, collection: string): Promise<ImportResult | null> => {
    guard(collection);
    const win = windowOf(e);
    const r = await dialog.showOpenDialog(win!, {
      title: "Add sources",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "PDF and Markdown", extensions: ["pdf", "md", "markdown", "txt"] },
        { name: "PDF", extensions: ["pdf"] },
        { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      ],
      buttonLabel: "Add",
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    return importFiles(collection, r.filePaths.map((f) => allow(collection, f)));
  });
  ipcMain.handle("sources:importFiles", (_e, collection: string, files: string[]) =>
    importFiles(guard(collection), files.map((f) => assertChosen(collection, f))),
  );
  ipcMain.handle("sources:folderDialog", async (e, collection: string): Promise<FolderScan | null> => {
    guard(collection);
    const win = windowOf(e);
    const r = await dialog.showOpenDialog(win!, {
      title: "Add sources from a folder",
      properties: ["openDirectory"],
      buttonLabel: "Choose folder",
    });
    const dir = r.filePaths[0];
    if (r.canceled || !dir) return null;
    return scanFolder(collection, allow(collection, dir), { recursive: true });
  });
  ipcMain.handle("sources:scanFolder", (_e, collection: string, dir: string, opts: { recursive: boolean }) =>
    scanFolder(guard(collection), assertChosen(collection, dir), { recursive: !!opts?.recursive }),
  );
  // Paths come from the preload, which resolves them from the dropped File objects; the renderer never sees them.
  ipcMain.handle("sources:dropped", (_e, collection: string, paths: string[]): DropResult | null => {
    guard(collection);
    const real = paths.filter((p) => typeof p === "string" && p.length > 0);
    if (real.length === 0) return null;
    const folder = real.find((p) => {
      try {
        return statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
    if (folder) return { kind: "scan", scan: scanFolder(collection, allow(collection, folder), { recursive: true }) };
    return { kind: "imported", result: importFiles(collection, real.map((p) => allow(collection, p))) };
  });
  ipcMain.handle("sources:importUrl", (_e, collection: string, url: string) => importWebPage(guard(collection), url));
  ipcMain.handle("sources:setRead", (_e, collection: string, id: string, read: boolean) => setSourceRead(guard(collection), id, !!read));
  ipcMain.handle("sources:rename", (_e, collection: string, id: string, title: string) => renameSource(guard(collection), id, String(title ?? "")));
  ipcMain.handle("sources:autoTitle", (_e, collection: string, id: string) => autoTitleSource(guard(collection), id));
  ipcMain.handle("sources:remove", (_e, collection: string, id: string) => removeSource(guard(collection), id));
  ipcMain.handle("sources:restore", (_e, collection: string, removed: RemovedSource) => restoreSource(guard(collection), removed));
  ipcMain.handle("sources:reveal", (_e, collection: string, id: string) => {
    shell.showItemInFolder(sourceDir(guard(collection), id));
  });
  ipcMain.handle("sources:readBytes", (_e, collection: string, id: string) => readSourceBytes(guard(collection), id));
  ipcMain.handle("sources:readText", (_e, collection: string, id: string) => readSourceText(guard(collection), id));
  ipcMain.handle("sources:saveText", (_e, collection: string, id: string, text: string, pages: number, titles?: { metadata?: string; guess?: string }) =>
    saveSourceText(guard(collection), id, text, pages, titles),
  );

  // ----- threads -----
  ipcMain.handle("threads:list", (_e, collection: string) => listThreads(guard(collection)));
  ipcMain.handle("threads:read", (_e, collection: string, id: string) => readThread(guard(collection), id));
  ipcMain.handle(
    "threads:create",
    (_e, collection: string, input: { title: string; anchor?: Anchor; parent?: { thread: string; message: string } }) =>
      createThread(guard(collection), input),
  );
  ipcMain.handle(
    "threads:appendMessage",
    (_e, collection: string, id: string, message: Omit<Message, "id" | "at"> & { id?: string; at?: string }) =>
      appendMessage(guard(collection), id, message),
  );

  ipcMain.handle("threads:delete", (_e, collection: string, id: string) => {
    const deleted = deleteThread(guard(collection), id);
    hosts.get(collection)?.dropSessions(deleted);
    return deleted;
  });

  // ----- annotations -----
  ipcMain.handle("annotations:list", (_e, collection: string) => listAnnotations(guard(collection)));
  ipcMain.handle("annotations:create", (_e, collection: string, input: Omit<Annotation, "id" | "created" | "updated">) => addAnnotation(guard(collection), input));
  ipcMain.handle("annotations:update", (_e, collection: string, id: string, patch: { text?: string }) => updateAnnotation(guard(collection), id, patch));
  ipcMain.handle("annotations:delete", (_e, collection: string, id: string) => deleteAnnotation(guard(collection), id));

  // ----- reader -----
  ipcMain.handle("reader:setPosition", (_e, collection: string, sourceId: string, position: ReaderPosition) => {
    setReaderPosition(guard(collection), sourceId, position);
  });

  // ----- agent -----
  ipcMain.handle("agent:status", (_e, collection: string) => host(collection).status);
  ipcMain.handle("agent:connect", (_e, collection: string) => host(collection).connect());
  ipcMain.handle("agent:session", async (_e, collection: string, threadId: string) => {
    const entry = await host(collection).ensureSession(threadId);
    return { configOptions: entry.configOptions };
  });
  ipcMain.handle("agent:options", (_e, collection: string) => host(collection).options());
  ipcMain.handle("agent:prompt", (_e, collection: string, threadId: string, body: string, quote?: Anchor) =>
    host(collection).prompt(threadId, body, quote),
  );
  ipcMain.handle("agent:cancel", (_e, collection: string, threadId: string) => host(collection).cancel(threadId));
  ipcMain.handle("agent:branch", (_e, collection: string, parentId: string, messageId: string, anchor: Anchor) =>
    host(collection).branch(parentId, messageId, anchor),
  );
  ipcMain.handle("agent:setConfig", (_e, collection: string, threadId: string, configId: string, value: string | boolean) =>
    host(collection).setConfig(threadId, configId, value),
  );
  ipcMain.handle("agent:replyPermission", (_e, requestId: string, optionId: string | null) => {
    for (const h of hosts.values()) h.replyPermission(requestId, optionId);
  });
  ipcMain.handle("agent:login", (_e, collection: string, methodId: string) => host(collection).login(methodId));

  // ----- app -----
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);
}
