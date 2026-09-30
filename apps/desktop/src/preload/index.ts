import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";
import type { AgentEvent, AgentStatus, CloudAccount, CloudChanged, CloudSyncState, PermissionRequest, QrabbitApi } from "@qrabbit/shared";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<Args extends unknown[]>(channel: string, cb: (...args: Args) => void): () => void {
  const handler = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as Args));
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

/** The on-disk path of a File the OS handed to the page. A File the page made itself has none. */
function pathOf(file: File): string {
  try {
    return webUtils.getPathForFile(file);
  } catch {
    return "";
  }
}

const api: QrabbitApi = {
  collections: {
    recent: () => invoke("collections:recent"),
    openDialog: () => invoke("collections:openDialog"),
    open: (path) => invoke("collections:open", path),
    forget: (path) => invoke("collections:forget", path),
    updateSettings: (path, patch) => invoke("collections:updateSettings", path, patch),
    setOrder: (path, ids) => invoke("collections:setOrder", path, ids),
  },
  sources: {
    list: (collection) => invoke("sources:list", collection),
    importDialog: (collection) => invoke("sources:importDialog", collection),
    importUrl: (collection, url) => invoke("sources:importUrl", collection, url),
    importFiles: (collection, files) => invoke("sources:importFiles", collection, files),
    folderDialog: (collection) => invoke("sources:folderDialog", collection),
    scanFolder: (collection, dir, opts) => invoke("sources:scanFolder", collection, dir, opts),
    dropped: (collection, files) => invoke("sources:dropped", collection, files.map(pathOf).filter(Boolean)),
    setRead: (collection, id, read) => invoke("sources:setRead", collection, id, read),
    rename: (collection, id, title) => invoke("sources:rename", collection, id, title),
    autoTitle: (collection, id) => invoke("sources:autoTitle", collection, id),
    remove: (collection, id) => invoke("sources:remove", collection, id),
    restore: (collection, removed) => invoke("sources:restore", collection, removed),
    reveal: (collection, id) => invoke("sources:reveal", collection, id),
    readBytes: (collection, id) => invoke("sources:readBytes", collection, id),
    readText: (collection, id) => invoke("sources:readText", collection, id),
    saveText: (collection, id, text, pages, titles) => invoke("sources:saveText", collection, id, text, pages, titles),
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
    options: (collection) => invoke("agent:options", collection),
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
  cloud: {
    account: () => invoke("cloud:account"),
    requestCode: (email) => invoke("cloud:requestCode", email),
    verifyCode: (email, code) => invoke("cloud:verifyCode", email, code),
    signOut: (scope) => invoke("cloud:signOut", scope),
    devices: () => invoke("cloud:devices"),
    collections: () => invoke("cloud:collections"),
    enable: (collection) => invoke("cloud:enable", collection),
    disable: (collection) => invoke("cloud:disable", collection),
    remove: (collectionId) => invoke("cloud:remove", collectionId),
    syncNow: (collection) => invoke("cloud:syncNow", collection),
    syncState: (collection) => invoke("cloud:syncState", collection),
    download: (collectionId) => invoke("cloud:download", collectionId),
    onAccount: (cb) => subscribe<[CloudAccount]>("cloud:account", cb),
    onSyncState: (cb) => subscribe<[string, CloudSyncState]>("cloud:syncState", cb),
    onChanged: (cb) => subscribe<[string, CloudChanged]>("cloud:changed", cb),
  },
  app: {
    version: () => invoke("app:version"),
    platform: () => invoke("app:platform"),
    home: () => invoke("app:home"),
  },
};

contextBridge.exposeInMainWorld("qrabbit", api);
