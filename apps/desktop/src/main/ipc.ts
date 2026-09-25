import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { basename } from "node:path";
import type { Anchor, Annotation, CollectionManifest, CollectionSnapshot, Message, ReaderPosition } from "@qrabbit/shared";
import {
  addAnnotation,
  deleteAnnotation,
  listAnnotations,
  updateAnnotation,
  appendMessage,
  createThread,
  deleteThread,
  importFile,
  listSources,
  listThreads,
  openCollection,
  readReaderState,
  readSourceBytes,
  readSourceText,
  readThread,
  saveSourceText,
  setReaderPosition,
  updateSettings,
} from "@qrabbit/workspace";
import { forgetRecent, recentCollections, touchRecent } from "./recent";
import { AgentHost, type AgentEmitter } from "./agent";

/** Main only touches collections this process opened; the renderer cannot point it at arbitrary folders. */
const opened = new Set<string>();

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
  ipcMain.handle("sources:importDialog", async (e, collection: string) => {
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
    if (r.canceled) return listSources(collection);
    for (const f of r.filePaths) {
      try {
        importFile(collection, f);
      } catch (err) {
        console.error(`import failed for ${basename(f)}:`, err);
      }
    }
    return listSources(collection);
  });
  ipcMain.handle("sources:readBytes", (_e, collection: string, id: string) => readSourceBytes(guard(collection), id));
  ipcMain.handle("sources:readText", (_e, collection: string, id: string) => readSourceText(guard(collection), id));
  ipcMain.handle("sources:saveText", (_e, collection: string, id: string, text: string, pages: number, title?: string) =>
    saveSourceText(guard(collection), id, text, pages, title),
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
