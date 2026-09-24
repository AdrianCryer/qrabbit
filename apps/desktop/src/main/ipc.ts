import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { basename } from "node:path";
import type { Anchor, CollectionSnapshot, Message, ReaderPosition } from "@qrabbit/shared";
import {
  appendMessage,
  createThread,
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
} from "@qrabbit/workspace";
import { forgetRecent, recentCollections, touchRecent } from "./recent";

/** Main only touches collections this process opened; the renderer cannot point it at arbitrary folders. */
const opened = new Set<string>();

function guard(path: string): string {
  if (!opened.has(path)) throw new Error("Collection is not open");
  return path;
}

function snapshot(path: string): CollectionSnapshot {
  const { info, manifest } = openCollection(path);
  opened.add(path);
  touchRecent(info);
  return { info, manifest, sources: listSources(path), threads: listThreads(path), readerState: readReaderState(path) };
}

const windowOf = (e: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined;

export function registerIpc(): void {
  // ----- collections -----
  ipcMain.handle("collections:recent", () => recentCollections());
  ipcMain.handle("collections:open", (_e, path: string) => snapshot(path));
  ipcMain.handle("collections:forget", (_e, path: string) => forgetRecent(path));
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

  // ----- reader -----
  ipcMain.handle("reader:setPosition", (_e, collection: string, sourceId: string, position: ReaderPosition) => {
    setReaderPosition(guard(collection), sourceId, position);
  });

  // ----- app -----
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:platform", () => process.platform);
}
