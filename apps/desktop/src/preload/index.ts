import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AgentEvent, AgentStatus, PermissionRequest, QrabbitApi } from "@qrabbit/shared";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<Args extends unknown[]>(channel: string, cb: (...args: Args) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as Args));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api: QrabbitApi = {
  collections: {
    recent: () => invoke("collections:recent"),
    openDialog: () => invoke("collections:openDialog"),
    open: (path) => invoke("collections:open", path),
    forget: (path) => invoke("collections:forget", path),
    updateSettings: (path, patch) => invoke("collections:updateSettings", path, patch),
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
    delete: (collection, id) => invoke("threads:delete", collection, id),
  },
  reader: {
    setPosition: (collection, sourceId, position) => invoke("reader:setPosition", collection, sourceId, position),
  },
  annotations: {
    list: (collection) => invoke("annotations:list", collection),
    create: (collection, input) => invoke("annotations:create", collection, input),
    update: (collection, id, patch) => invoke("annotations:update", collection, id, patch),
    delete: (collection, id) => invoke("annotations:delete", collection, id),
  },
  agent: {
    status: (collection) => invoke("agent:status", collection),
    connect: (collection) => invoke("agent:connect", collection),
    session: (collection, threadId) => invoke("agent:session", collection, threadId),
    prompt: (collection, threadId, body, quote) => invoke("agent:prompt", collection, threadId, body, quote),
    cancel: (collection, threadId) => invoke("agent:cancel", collection, threadId),
    branch: (collection, parentId, messageId, anchor) => invoke("agent:branch", collection, parentId, messageId, anchor),
    setConfig: (collection, threadId, configId, value) => invoke("agent:setConfig", collection, threadId, configId, value),
    replyPermission: (requestId, optionId) => invoke("agent:replyPermission", requestId, optionId),
    login: (collection, methodId) => invoke("agent:login", collection, methodId),
    onEvent: (cb) => subscribe<[string, AgentEvent]>("agent:event", cb),
    onPermission: (cb) => subscribe<[PermissionRequest]>("agent:permission", cb),
    onStatus: (cb) => subscribe<[string, AgentStatus]>("agent:status", cb),
  },
  app: {
    version: () => invoke("app:version"),
    platform: () => invoke("app:platform"),
  },
};

contextBridge.exposeInMainWorld("qrabbit", api);
