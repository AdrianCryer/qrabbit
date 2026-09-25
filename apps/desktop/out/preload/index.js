"use strict";
const electron = require("electron");
const invoke = (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args);
function subscribe(channel, cb) {
  const handler = (_e, ...args) => cb(...args);
  electron.ipcRenderer.on(channel, handler);
  return () => electron.ipcRenderer.removeListener(channel, handler);
}
const api = {
  collections: {
    recent: () => invoke("collections:recent"),
    openDialog: () => invoke("collections:openDialog"),
    open: (path) => invoke("collections:open", path),
    forget: (path) => invoke("collections:forget", path)
  },
  sources: {
    importDialog: (collection) => invoke("sources:importDialog", collection),
    readBytes: (collection, id) => invoke("sources:readBytes", collection, id),
    readText: (collection, id) => invoke("sources:readText", collection, id),
    saveText: (collection, id, text, pages, title) => invoke("sources:saveText", collection, id, text, pages, title)
  },
  threads: {
    list: (collection) => invoke("threads:list", collection),
    read: (collection, id) => invoke("threads:read", collection, id),
    create: (collection, input) => invoke("threads:create", collection, input),
    appendMessage: (collection, id, message) => invoke("threads:appendMessage", collection, id, message),
    delete: (collection, id) => invoke("threads:delete", collection, id)
  },
  reader: {
    setPosition: (collection, sourceId, position) => invoke("reader:setPosition", collection, sourceId, position)
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
    onEvent: (cb) => subscribe("agent:event", cb),
    onPermission: (cb) => subscribe("agent:permission", cb),
    onStatus: (cb) => subscribe("agent:status", cb)
  },
  app: {
    version: () => invoke("app:version"),
    platform: () => invoke("app:platform")
  }
};
electron.contextBridge.exposeInMainWorld("qrabbit", api);
