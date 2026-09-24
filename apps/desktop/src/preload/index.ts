import { contextBridge, ipcRenderer } from "electron";
import type { QrabbitApi } from "@qrabbit/shared";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: QrabbitApi = {
  collections: {
    recent: () => invoke("collections:recent"),
    openDialog: () => invoke("collections:openDialog"),
    open: (path) => invoke("collections:open", path),
    forget: (path) => invoke("collections:forget", path),
  },
  sources: {
    importDialog: (collection) => invoke("sources:importDialog", collection),
    readBytes: (collection, id) => invoke("sources:readBytes", collection, id),
    readText: (collection, id) => invoke("sources:readText", collection, id),
    saveText: (collection, id, text, pages, title) => invoke("sources:saveText", collection, id, text, pages, title),
  },
  threads: {
    list: (collection) => invoke("threads:list", collection),
    read: (collection, id) => invoke("threads:read", collection, id),
    create: (collection, input) => invoke("threads:create", collection, input),
    appendMessage: (collection, id, message) => invoke("threads:appendMessage", collection, id, message),
  },
  reader: {
    setPosition: (collection, sourceId, position) => invoke("reader:setPosition", collection, sourceId, position),
  },
  app: {
    version: () => invoke("app:version"),
    platform: () => invoke("app:platform"),
  },
};

contextBridge.exposeInMainWorld("qrabbit", api);
