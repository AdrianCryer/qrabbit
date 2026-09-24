import { create } from "zustand";
import type {
  AgentEvent,
  AgentStatus,
  Anchor,
  CollectionInfo,
  CollectionSnapshot,
  ConfigOption,
  PermissionRequest,
  ReaderPosition,
  SourceInfo,
  Thread,
} from "@qrabbit/shared";
import { api } from "../lib/api";

export type Toast = { id: number; text: string };
let toastSeq = 0;

export type Activity = { id: string; title: string; kind?: string; status?: string; paths?: string[] };
export type TurnState = {
  running: boolean;
  text: string;
  activity: Activity[];
  permission: PermissionRequest | null;
  error: string | null;
};
const emptyTurn = (): TurnState => ({ running: true, text: "", activity: [], permission: null, error: null });

const lastSourceKey = (collectionId: string) => `qrabbit:last-source:${collectionId}`;

function titleFromQuote(quote: string, max = 60): string {
  const one = quote.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > 30 ? cut.slice(0, at) : cut) + "…";
}

type State = {
  platform: string;
  screen: "home" | "reader";
  recent: CollectionInfo[];
  collection: CollectionSnapshot | null;
  sourceId: string | null;
  thread: Thread | null;
  panelOpen: boolean;
  focus: boolean;
  composerQuote: Anchor | null;
  focusTarget: { page: number; key: number } | null;
  toasts: Toast[];
  agent: AgentStatus | null;
  turns: Record<string, TurnState>;
  configOptions: Record<string, ConfigOption[]>;
};

type Actions = {
  init(): Promise<void>;
  openCollectionDialog(): Promise<void>;
  openCollection(path: string): Promise<void>;
  goHome(): void;
  selectSource(id: string | null): void;
  importSources(): Promise<void>;
  updateSource(info: SourceInfo): void;
  refreshThreads(): Promise<void>;
  openThread(id: string | null): Promise<void>;
  closePanel(): void;
  setFocus(v: boolean): void;
  explore(anchor: Anchor): Promise<void>;
  /** Explore a span inside one of the open thread's messages: creates a branch and opens it. */
  branch(messageId: string, anchor: Anchor): Promise<void>;
  askHere(anchor: Anchor): void;
  clearComposerQuote(): void;
  sendMessage(body: string): Promise<void>;
  cancelTurn(): void;
  setConfig(configId: string, value: string | boolean): Promise<void>;
  replyPermission(requestId: string, optionId: string | null): void;
  connectAgent(): Promise<void>;
  loginAgent(methodId: string): Promise<void>;
  savePosition(sourceId: string, pos: ReaderPosition): void;
  toast(text: string): void;
};

let subscribed = false;

export const useStore = create<State & Actions>((set, get) => ({
  platform: "win32",
  screen: "home",
  recent: [],
  collection: null,
  sourceId: null,
  thread: null,
  panelOpen: false,
  focus: false,
  composerQuote: null,
  focusTarget: null,
  toasts: [],
  agent: null,
  turns: {},
  configOptions: {},

  async init() {
    const [platform, recent] = await Promise.all([api.app.platform(), api.collections.recent()]);
    set({ platform, recent });
    if (subscribed) return;
    subscribed = true;
    api.agent.onStatus((collectionPath, status) => {
      if (get().collection?.info.path === collectionPath) set({ agent: status });
    });
    api.agent.onPermission((request) => {
      set((s) => ({ turns: { ...s.turns, [request.threadId]: { ...(s.turns[request.threadId] ?? emptyTurn()), permission: request } } }));
    });
    api.agent.onEvent((threadId, event) => {
      if (event.type === "handoff") {
        set((s) => (s.thread?.id === threadId ? { thread: { ...s.thread, handoff: event.text } } : {}));
        void get().refreshThreads();
        return;
      }
      set((s) => {
        const t = { ...(s.turns[threadId] ?? emptyTurn()) };
        applyEvent(t, event);
        const patch: Partial<State> = { turns: { ...s.turns, [threadId]: t } };
        if (event.type === "config_options") patch.configOptions = { ...s.configOptions, [threadId]: event.options };
        return patch;
      });
    });
  },

  async openCollectionDialog() {
    const snap = await api.collections.openDialog();
    if (snap) await get().openCollection(snap.info.path);
  },

  async openCollection(path) {
    const snap = await api.collections.open(path);
    const recent = await api.collections.recent();
    let sourceId: string | null = null;
    try {
      sourceId = localStorage.getItem(lastSourceKey(snap.manifest.id));
    } catch {
      /* storage may be unavailable */
    }
    if (!sourceId || !snap.sources.some((s) => s.id === sourceId)) sourceId = snap.sources[0]?.id ?? null;
    set({ collection: snap, recent, screen: "reader", sourceId, thread: null, panelOpen: false, focus: false, composerQuote: null, agent: null, turns: {}, configOptions: {} });
    void get().connectAgent();
  },

  goHome() {
    set({ screen: "home", thread: null, panelOpen: false });
    void api.collections.recent().then((recent) => set({ recent }));
  },

  selectSource(id) {
    const c = get().collection;
    set({ sourceId: id });
    if (c && id) {
      try {
        localStorage.setItem(lastSourceKey(c.manifest.id), id);
      } catch {
        /* ignore */
      }
    }
  },

  async importSources() {
    const c = get().collection;
    if (!c) return;
    const before = c.sources.length;
    const sources = await api.sources.importDialog(c.info.path);
    set({ collection: { ...c, sources } });
    if (sources.length > before) {
      const newest = sources[0]!;
      get().selectSource(newest.id);
      get().toast(sources.length - before === 1 ? `Added ${newest.title}` : `Added ${sources.length - before} sources`);
    }
  },

  updateSource(info) {
    const c = get().collection;
    if (!c) return;
    set({ collection: { ...c, sources: c.sources.map((s) => (s.id === info.id ? info : s)) } });
  },

  async refreshThreads() {
    const c = get().collection;
    if (!c) return;
    const threads = await api.threads.list(c.info.path);
    set({ collection: { ...c, threads } });
  },

  async openThread(id) {
    const c = get().collection;
    if (!c || !id) {
      set({ thread: null, panelOpen: false });
      return;
    }
    const thread = await api.threads.read(c.info.path, id);
    if (!thread) {
      get().toast("That thread file is gone");
      await get().refreshThreads();
      return;
    }
    const a = thread.anchor;
    const patch: Partial<State> = { thread, panelOpen: true, composerQuote: null };
    if (a?.target === "source" && a.page && a.source) {
      if (a.source !== get().sourceId) get().selectSource(a.source);
      patch.focusTarget = { page: a.page, key: Date.now() };
    }
    set(patch);
    // Warm the agent session so the pickers show real options.
    if (!get().configOptions[id]) {
      api.agent
        .session(c.info.path, id)
        .then(({ configOptions }) => set((s) => ({ configOptions: { ...s.configOptions, [id]: configOptions } })))
        .catch(() => { /* status pill shows the problem */ });
    }
  },

  closePanel() {
    set({ panelOpen: false, focus: false });
  },

  setFocus(v) {
    set({ focus: v });
  },

  async explore(anchor) {
    const c = get().collection;
    if (!c) return;
    const thread = await api.threads.create(c.info.path, { title: titleFromQuote(anchor.quote), anchor });
    await get().refreshThreads();
    window.getSelection()?.removeAllRanges();
    await get().openThread(thread.id);
  },

  async branch(messageId, anchor) {
    const { collection: c, thread } = get();
    if (!c || !thread) return;
    const child = await api.agent.branch(c.info.path, thread.id, messageId, anchor);
    await get().refreshThreads();
    window.getSelection()?.removeAllRanges();
    await get().openThread(child.id);
  },

  askHere(anchor) {
    if (!get().thread) {
      get().toast("Open a thread first, or choose Explore to start one here");
      return;
    }
    set({ composerQuote: anchor });
    window.getSelection()?.removeAllRanges();
  },

  clearComposerQuote() {
    set({ composerQuote: null });
  },

  async sendMessage(body) {
    const { collection: c, thread, composerQuote } = get();
    if (!c || !thread) return;
    const text = body.trim();
    if (!text && !composerQuote) return;
    const threadId = thread.id;
    set((s) => ({ composerQuote: null, turns: { ...s.turns, [threadId]: emptyTurn() } }));
    try {
      const updated = await api.agent.prompt(c.info.path, threadId, text, composerQuote ?? undefined);
      set((s) => {
        const turns = { ...s.turns };
        delete turns[threadId];
        return { turns, thread: s.thread?.id === threadId ? updated : s.thread };
      });
    } catch (err) {
      // The agent could not run at all; keep the message in the file so nothing is lost.
      const message = String((err as Error)?.message ?? err);
      const saved = await api.threads.appendMessage(c.info.path, threadId, { role: "user", body: text, ...(composerQuote ? { quote: composerQuote } : {}) }).catch(() => null);
      set((s) => {
        const turns = { ...s.turns };
        delete turns[threadId];
        return { turns, thread: saved && s.thread?.id === threadId ? saved : s.thread };
      });
      get().toast(`Saved, but the agent could not answer: ${message}`);
    }
    await get().refreshThreads();
  },

  cancelTurn() {
    const { collection: c, thread } = get();
    if (c && thread) void api.agent.cancel(c.info.path, thread.id);
  },

  async setConfig(configId, value) {
    const { collection: c, thread } = get();
    if (!c || !thread) return;
    try {
      const options = await api.agent.setConfig(c.info.path, thread.id, configId, value);
      set((s) => ({ configOptions: { ...s.configOptions, [thread.id]: options } }));
    } catch (err) {
      get().toast(`Could not change ${configId}: ${String((err as Error)?.message ?? err)}`);
    }
  },

  replyPermission(requestId, optionId) {
    void api.agent.replyPermission(requestId, optionId);
    set((s) => {
      const turns = { ...s.turns };
      for (const [id, t] of Object.entries(turns)) if (t.permission?.id === requestId) turns[id] = { ...t, permission: null };
      return { turns };
    });
  },

  async connectAgent() {
    const c = get().collection;
    if (!c) return;
    try {
      const status = await api.agent.connect(c.info.path);
      if (get().collection?.info.path === c.info.path) set({ agent: status });
    } catch (err) {
      set({ agent: { connected: false, auth: null, authMethods: [], error: String((err as Error)?.message ?? err) } });
    }
  },

  async loginAgent(methodId) {
    const c = get().collection;
    if (!c) return;
    await api.agent.login(c.info.path, methodId);
    get().toast("A terminal window opened for sign-in. Finish there, then send a message here.");
  },

  savePosition(sourceId, pos) {
    const c = get().collection;
    if (!c) return;
    void api.reader.setPosition(c.info.path, sourceId, pos);
  },

  toast(text) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
  },
}));

function applyEvent(t: TurnState, ev: AgentEvent): void {
  switch (ev.type) {
    case "text":
      t.text += ev.text;
      break;
    case "tool_call":
      t.activity = [...t.activity, { id: ev.id, title: ev.title, kind: ev.kind, status: ev.status, paths: ev.paths }];
      break;
    case "tool_call_update":
      t.activity = t.activity.map((a) => (a.id === ev.id ? { ...a, ...(ev.title ? { title: ev.title } : {}), ...(ev.status ? { status: ev.status } : {}) } : a));
      break;
    case "stop":
      t.running = false;
      break;
    case "error":
      t.error = ev.message;
      t.running = false;
      break;
    default:
      break;
  }
}
