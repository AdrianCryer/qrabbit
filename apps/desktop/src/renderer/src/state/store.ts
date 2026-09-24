import { create } from "zustand";
import type { Anchor, CollectionInfo, CollectionSnapshot, ReaderPosition, SourceInfo, Thread } from "@qrabbit/shared";
import { api } from "../lib/api";

export type Toast = { id: number; text: string };
let toastSeq = 0;

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
  /** Bumps when the reader should scroll to the focused thread's anchor. */
  focusTarget: { page: number; key: number } | null;
  toasts: Toast[];
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
  askHere(anchor: Anchor): void;
  clearComposerQuote(): void;
  sendMessage(body: string): Promise<void>;
  savePosition(sourceId: string, pos: ReaderPosition): void;
  toast(text: string): void;
};

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

  async init() {
    const [platform, recent] = await Promise.all([api.app.platform(), api.collections.recent()]);
    set({ platform, recent });
  },

  async openCollectionDialog() {
    const snap = await api.collections.openDialog();
    if (snap) get().openCollection(snap.info.path);
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
    set({ collection: snap, recent, screen: "reader", sourceId, thread: null, panelOpen: false, focus: false, composerQuote: null });
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
    if (a?.target === "source" && a.page) {
      if (a.source !== get().sourceId) get().selectSource(a.source);
      patch.focusTarget = { page: a.page, key: Date.now() };
    }
    set(patch);
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
    set({ thread, panelOpen: true, composerQuote: null });
    window.getSelection()?.removeAllRanges();
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
    const updated = await api.threads.appendMessage(c.info.path, thread.id, {
      role: "user",
      body: text,
      ...(composerQuote ? { quote: composerQuote } : {}),
    });
    set({ thread: updated, composerQuote: null });
    await get().refreshThreads();
    get().toast("Saved to the thread file. The agent is wired up in the next step.");
  },

  savePosition(sourceId, pos) {
    const c = get().collection;
    if (!c) return;
    void api.reader.setPosition(c.info.path, sourceId, pos);
  },

  toast(text) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2800);
  },
}));
