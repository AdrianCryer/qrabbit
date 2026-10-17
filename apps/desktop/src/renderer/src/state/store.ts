import { create } from "zustand";
import { agentDefaultsPatch, agentInfo, DEFAULT_AGENT, type AgentDefaults, type AgentId, type AgentInstall } from "@qrabbit/shared";
import type {
  AgentEvent,
  AgentStatus,
  Anchor,
  Annotation,
  CloudAccount,
  CloudChanged,
  CloudCollectionInfo,
  CloudSyncState,
  CollectionInfo,
  CollectionSnapshot,
  ConfigOption,
  FolderScan,
  ImportResult,
  PermissionRequest,
  ReaderPosition,
  SourceInfo,
  Thread,
} from "@qrabbit/shared";
import { api } from "../lib/api";

export type Toast = { id: number; text: string; action?: { label: string; run(): void } };
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
/** An error's message without the "Error invoking remote method '…': Error:" wrapper IPC adds around main's errors. */
const errText = (err: unknown) => String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

function titleFromQuote(quote: string, max = 60): string {
  const one = quote.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > 30 ? cut.slice(0, at) : cut) + "…";
}

function describeImport(r: ImportResult): string {
  const parts: string[] = [];
  if (r.added.length) parts.push(r.added.length === 1 ? `Added ${r.added[0]!.title}` : `Added ${r.added.length} sources`);
  if (r.existing.length) parts.push(r.existing.length === 1 ? `${r.existing[0]!.title} was already here` : `${r.existing.length} were already here`);
  if (r.failed.length) parts.push(r.failed.length === 1 ? "1 file could not be added" : `${r.failed.length} files could not be added`);
  return parts.join(" · ") || "Nothing added";
}

type State = {
  platform: string;
  /** The user's home folder; paths under it are shown as ~. */
  home: string;
  screen: "home" | "reader";
  recent: CollectionInfo[];
  collection: CollectionSnapshot | null;
  /** The open source, or null for the reading list. */
  sourceId: string | null;
  /** The source the reading list was opened from, so Ctrl+L can go back to it. */
  lastSourceId: string | null;
  thread: Thread | null;
  panelOpen: boolean;
  focus: boolean;
  composerQuote: Anchor | null;
  /** Bumped when the composer should take keyboard focus: after Explore, Ask here and a new branch. */
  composerFocusKey: number;
  /** Where the reader should scroll: a page, and optionally a mark on it. */
  focusTarget: { page: number; key: number; markId?: string } | null;
  toasts: Toast[];
  /** The agent this computer uses; switching it restarts the agent process. */
  agentId: AgentId;
  agent: AgentStatus | null;
  /** Whether a reader has chosen an agent on this computer yet: false shows the chooser, null until known. */
  agentChosen: boolean | null;
  /** Where each agent's download stands on this computer. */
  installs: Partial<Record<AgentId, AgentInstall>>;
  turns: Record<string, TurnState>;
  configOptions: Record<string, ConfigOption[]>;
  /** The last config options any session reported; Settings uses them to offer model and effort choices. */
  knownOptions: ConfigOption[];
  /** Settings is asking the agent for its options. */
  optionsLoading: boolean;
  optionsError: string | null;
  settingsOpen: boolean;
  /** The page Settings opens on when a menu asks for one; null means the page last used. */
  settingsTab: SettingsTab | null;
  urlDialogOpen: boolean;
  /** The folder picker is open while a scan is held here. */
  folderScan: FolderScan | null;
  folderBusy: boolean;
  /** Which header menu a shortcut opened, if any. */
  menu: "collection" | "source" | "threads" | "marks" | "cloud" | null;
  /** The cloud account on this machine; null until the first look. */
  cloud: CloudAccount | null;
  /** Where the open collection stands with the cloud; null when it is not kept there from this folder. */
  cloudSync: CloudSyncState | null;
  /** The account's collections, for the home screen. */
  cloudCollections: CloudCollectionInfo[];
  /** The cloud collection on its way into a folder here, by id; null while none is. */
  cloudDownload: string | null;
};

export type MenuId = State["menu"];
/** The pages of the Settings dialog. */
export type SettingsTab = "agent" | "cloud" | "general" | "shortcuts";

type Actions = {
  init(): Promise<void>;
  openCollectionDialog(): Promise<void>;
  openCollection(path: string): Promise<void>;
  goHome(): void;
  selectSource(id: string | null): void;
  /** Show the reading list in the reader pane. The last source stays remembered. */
  showList(): void;
  /** Ctrl+L: the list, or back to the paper. */
  toggleList(): void;
  refreshSources(): Promise<void>;
  importSources(): Promise<void>;
  /** Fetch a web page into the collection and open it. Throws with a readable message on failure. */
  importUrl(url: string): Promise<void>;
  /** Show what an import did and open the first new source when a paper was open. */
  applyImport(result: ImportResult): Promise<void>;
  setUrlDialogOpen(open: boolean): void;
  updateSource(info: SourceInfo): void;
  setOrder(ids: string[]): Promise<void>;
  moveSource(id: string, to: "top" | "bottom" | -1 | 1): Promise<void>;
  toggleRead(id: string): Promise<void>;
  /** Give a source a title of the reader's own; a blank or unchanged title is a no-op. */
  renameSource(id: string, title: string): Promise<void>;
  /** Rename to the document's own title in sentence case, with Undo. */
  autoTitleSource(id: string): Promise<void>;
  /** Move the source to the collection's trash, with an Undo toast. */
  removeSource(id: string): Promise<void>;
  revealSource(id: string): void;
  addFromFolder(): Promise<void>;
  rescanFolder(recursive: boolean): Promise<void>;
  closeFolder(): void;
  importFromFolder(files: string[]): Promise<void>;
  /** Files or a folder dropped on the reading list. */
  dropFiles(files: File[]): Promise<void>;
  refreshThreads(): Promise<void>;
  openThread(id: string | null): Promise<void>;
  closePanel(): void;
  setFocus(v: boolean): void;
  explore(anchor: Anchor): Promise<void>;
  /** Explore a span inside one of the open thread's messages: creates a branch and opens it. */
  branch(messageId: string, anchor: Anchor): Promise<void>;
  askHere(anchor: Anchor): void;
  /** Put the caret in the composer; the next thing after choosing a passage is usually typing. */
  focusComposer(): void;
  clearComposerQuote(): void;
  sendMessage(body: string): Promise<void>;
  cancelTurn(): void;
  setConfig(configId: string, value: string | boolean): Promise<void>;
  replyPermission(requestId: string, optionId: string | null): void;
  connectAgent(): Promise<void>;
  /** Switch this computer's agent. Open threads continue: the new agent gets their history on its first turn. */
  chooseAgent(id: AgentId): Promise<void>;
  loginAgent(methodId: string): Promise<void>;
  /** Download an agent's adapter and CLI, or try again after a failure. */
  installAgent(id: AgentId): Promise<void>;
  /** Delete an agent's download; not the agent in use. */
  uninstallAgent(id: AgentId): Promise<void>;
  /** Put the first-run chooser away for now; it asks again next launch until an agent is chosen. */
  dismissChooser(): void;
  savePosition(sourceId: string, pos: ReaderPosition): void;
  toast(text: string, action?: Toast["action"]): void;
  dismissToast(id: number): void;
  /** Delete a thread and its branches. The panel moves to the parent, or closes. */
  deleteThread(id: string): Promise<void>;
  setSettingsOpen(open: boolean, tab?: SettingsTab): void;
  /** Ask the agent for its models and effort levels, so Settings can offer them before any thread exists. */
  refreshOptions(): Promise<void>;
  setMenu(menu: MenuId): void;
  /** Show the panel with the current thread, or hide it. */
  togglePanel(): void;
  openParent(): Promise<void>;
  /** Change the open collection's defaults for new threads under the current agent. */
  updateAgentDefaults(patch: AgentDefaults): Promise<void>;
  /** Bookmark a span, or a page when no anchor is given. */
  addBookmark(sourceId: string, page: number, anchor?: Anchor): Promise<void>;
  addComment(sourceId: string, page: number | undefined, anchor: Anchor, text: string): Promise<void>;
  updateAnnotation(id: string, text: string): Promise<void>;
  deleteAnnotation(id: string): Promise<void>;
  /** Show a bookmark or comment in the reader. */
  goToAnnotation(id: string): void;
  /** Read the cloud account and its collections again. */
  refreshCloud(): Promise<void>;
  cloudRequestCode(email: string): Promise<void>;
  cloudVerifyCode(email: string, code: string): Promise<void>;
  cloudSignOut(scope: "local" | "others"): Promise<void>;
  /** Keep the open collection in the cloud, from this folder. */
  enableCloud(): Promise<void>;
  /** Stop syncing this folder; the cloud copy stays. */
  disableCloud(): Promise<void>;
  /** Take a collection out of the cloud altogether. */
  removeCloudCollection(id: string): Promise<void>;
  syncNow(): Promise<void>;
  /** Bring a cloud collection down into a folder chosen in a dialog, then open it. */
  downloadCollection(id: string): Promise<void>;
  /** Refresh what a pull changed on disk. */
  applyCloudChanges(changed: CloudChanged): Promise<void>;
};

let subscribed = false;

export const useStore = create<State & Actions>((set, get) => ({
  platform: "win32",
  home: "",
  screen: "home",
  recent: [],
  collection: null,
  sourceId: null,
  lastSourceId: null,
  thread: null,
  panelOpen: false,
  focus: false,
  composerQuote: null,
  composerFocusKey: 0,
  focusTarget: null,
  toasts: [],
  agentId: DEFAULT_AGENT,
  agent: null,
  agentChosen: null,
  installs: {},
  turns: {},
  configOptions: {},
  knownOptions: [],
  optionsLoading: false,
  optionsError: null,
  settingsOpen: false,
  settingsTab: null,
  urlDialogOpen: false,
  folderScan: null,
  folderBusy: false,
  menu: null,
  cloud: null,
  cloudSync: null,
  cloudCollections: [],
  cloudDownload: null,

  async init() {
    const [platform, home, recent, agentId, setup] = await Promise.all([api.app.platform(), api.app.home(), api.collections.recent(), api.agent.current(), api.agent.setup()]);
    // A choice or an install event that arrived while this was in flight is newer than the answer; keep it.
    set((s) => ({ platform, home, recent, agentId, agentChosen: s.agentChosen ?? setup.chosen, installs: { ...Object.fromEntries(setup.installs.map((i) => [i.id, i])), ...s.installs } }));
    if (subscribed) return;
    subscribed = true;
    void get().refreshCloud();
    api.cloud.onAccount((cloud) => set({ cloud }));
    api.cloud.onSyncState((collectionPath, state) => {
      if (get().collection?.info.path === collectionPath) set({ cloudSync: state });
    });
    api.cloud.onChanged((collectionPath, changed) => {
      if (get().collection?.info.path === collectionPath) void get().applyCloudChanges(changed);
    });
    // Optional: go straight back into the last collection.
    try {
      if (localStorage.getItem("qrabbit:reopen-last") === "1" && recent[0]) void get().openCollection(recent[0].path);
    } catch {
      /* ignore */
    }
    api.agent.onInstall((install) => set((s) => ({ installs: { ...s.installs, [install.id]: install } })));
    api.agent.onStatus((collectionPath, status) => {
      // A process stopped by a switch may still report; only the chosen agent speaks for the collection.
      if (get().collection?.info.path !== collectionPath || status.id !== get().agentId) return;
      const before = get().agent?.auth;
      set({ agent: status });
      // Signing in finishes outside the app; once the account arrives, retry what failed for want of it.
      if (status.auth && status.auth.kind !== "none" && (before?.kind !== status.auth.kind || before?.label !== status.auth.label)) {
        const thread = get().thread;
        if (thread && !get().configOptions[thread.id]) warmSession(collectionPath, thread.id);
        if (get().settingsOpen && get().optionsError) void get().refreshOptions();
      }
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
        if (event.type === "config_options") {
          patch.configOptions = { ...s.configOptions, [threadId]: event.options };
          patch.knownOptions = event.options;
        }
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
    // The remembered source, else the first in reading order; the list itself when there is nothing to read.
    if (!sourceId || !snap.sources.some((s) => s.id === sourceId)) sourceId = snap.sources[0]?.id ?? null;
    set({ collection: snap, recent, screen: "reader", sourceId, lastSourceId: sourceId, thread: null, panelOpen: false, focus: false, composerQuote: null, agent: null, turns: {}, configOptions: {}, folderScan: null, folderBusy: false, cloudSync: null });
    void get().connectAgent();
    void api.cloud
      .syncState(path)
      .then((cloudSync) => {
        if (get().collection?.info.path === path) set({ cloudSync });
      })
      .catch(() => {});
  },

  goHome() {
    set({ screen: "home", thread: null, panelOpen: false, folderScan: null, cloudSync: null });
    void api.collections.recent().then((recent) => set({ recent }));
    void get().refreshCloud();
  },

  selectSource(id) {
    const c = get().collection;
    set({ sourceId: id, menu: null, ...(id ? { lastSourceId: id } : {}) });
    if (c && id) {
      try {
        localStorage.setItem(lastSourceKey(c.manifest.id), id);
      } catch {
        /* ignore */
      }
    }
  },

  showList() {
    set({ sourceId: null, menu: null });
  },

  toggleList() {
    const { sourceId, lastSourceId, collection: c } = get();
    if (!c) return;
    if (sourceId !== null) {
      get().showList();
      return;
    }
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(lastSourceKey(c.manifest.id));
    } catch {
      /* ignore */
    }
    const has = (id: string | null) => !!id && c.sources.some((s) => s.id === id);
    const back = has(lastSourceId) ? lastSourceId : has(remembered) ? remembered : (c.sources[0]?.id ?? null);
    if (back) get().selectSource(back);
  },

  async refreshSources() {
    const c = get().collection;
    if (!c) return;
    const sources = await api.sources.list(c.info.path);
    set((s) => (s.collection?.info.path === c.info.path ? { collection: { ...s.collection, sources } } : {}));
  },

  async importSources() {
    const c = get().collection;
    if (!c) return;
    set({ menu: null });
    const result = await api.sources.importDialog(c.info.path);
    if (result) await get().applyImport(result);
  },

  async importUrl(url) {
    const c = get().collection;
    if (!c) return;
    const info = await api.sources.importUrl(c.info.path, url);
    await get().refreshSources();
    get().selectSource(info.id);
    get().toast(`Added ${info.title}`);
  },

  async applyImport(result) {
    await get().refreshSources();
    const { added, existing, failed } = result;
    // From the list page the new rows are visible; while reading, the first new source opens.
    if (added.length && get().sourceId !== null) get().selectSource(added[0]!.id);
    if (!added.length && !failed.length && existing.length === 1) {
      const e = existing[0]!;
      get().toast(`${e.title} is already in this collection`, { label: "Open", run: () => get().selectSource(e.id) });
      return;
    }
    get().toast(describeImport(result));
  },

  setUrlDialogOpen(open) {
    set({ urlDialogOpen: open, menu: null });
  },

  updateSource(info) {
    const c = get().collection;
    if (!c) return;
    set({ collection: { ...c, sources: c.sources.map((s) => (s.id === info.id ? info : s)) } });
  },

  async setOrder(ids) {
    const c = get().collection;
    if (!c) return;
    const byId = new Map(c.sources.map((s) => [s.id, s]));
    const sources = ids.map((id) => byId.get(id)).filter((s): s is SourceInfo => !!s);
    for (const s of c.sources) if (!sources.includes(s)) sources.push(s);
    set((s) => (s.collection ? { collection: { ...s.collection, sources } } : {}));
    try {
      const manifest = await api.collections.setOrder(c.info.path, sources.map((s) => s.id));
      set((s) => (s.collection ? { collection: { ...s.collection, manifest } } : {}));
    } catch (err) {
      get().toast(`Could not save the order: ${errText(err)}`);
      await get().refreshSources();
    }
  },

  async moveSource(id, to) {
    const c = get().collection;
    if (!c) return;
    const ids = c.sources.map((s) => s.id);
    const i = ids.indexOf(id);
    if (i < 0) return;
    ids.splice(i, 1);
    const dest = to === "top" ? 0 : to === "bottom" ? ids.length : Math.max(0, Math.min(ids.length, i + to));
    ids.splice(dest, 0, id);
    await get().setOrder(ids);
  },

  async toggleRead(id) {
    const c = get().collection;
    const cur = c?.sources.find((s) => s.id === id);
    if (!c || !cur) return;
    try {
      const info = await api.sources.setRead(c.info.path, id, !cur.read);
      get().updateSource(info);
    } catch (err) {
      get().toast(`Could not save the read mark: ${errText(err)}`);
    }
  },

  async renameSource(id, title) {
    const c = get().collection;
    const cur = c?.sources.find((s) => s.id === id);
    const clean = title.replace(/\s+/g, " ").trim();
    if (!c || !cur || !clean || clean === cur.title) return;
    try {
      const info = await api.sources.rename(c.info.path, id, clean);
      get().updateSource(info);
    } catch (err) {
      get().toast(`Could not rename ${cur.title}: ${errText(err)}`);
    }
  },

  async autoTitleSource(id) {
    const c = get().collection;
    const cur = c?.sources.find((s) => s.id === id);
    if (!c || !cur) return;
    try {
      const info = await api.sources.autoTitle(c.info.path, id);
      if (!info) {
        get().toast(cur.hasText ? "No title was found in the document" : "Open the source once so its text is read, then try again");
        return;
      }
      if (info.title === cur.title) {
        get().toast("The title already matches the document");
        return;
      }
      get().updateSource(info);
      const before = cur.title;
      get().toast(`Renamed to “${info.title}”`, { label: "Undo", run: () => void get().renameSource(id, before) });
    } catch (err) {
      get().toast(`Could not title ${cur.title}: ${errText(err)}`);
    }
  },

  async removeSource(id) {
    const c = get().collection;
    const info = c?.sources.find((s) => s.id === id);
    if (!c || !info) return;
    set({ menu: null });
    let removed;
    try {
      removed = await api.sources.remove(c.info.path, id);
    } catch (err) {
      get().toast(`Could not remove ${info.title}: ${errText(err)}`);
      return;
    }
    set((s) =>
      s.collection
        ? {
            collection: { ...s.collection, sources: s.collection.sources.filter((x) => x.id !== id), annotations: s.collection.annotations.filter((a) => a.source !== id) },
            ...(s.sourceId === id ? { sourceId: null } : {}),
          }
        : {},
    );
    const token = removed;
    get().toast(`Removed ${info.title}`, {
      label: "Undo",
      run: () => {
        void (async () => {
          try {
            await api.sources.restore(c.info.path, token);
            await get().refreshSources();
            const annotations = await api.annotations.list(c.info.path);
            set((s) => (s.collection ? { collection: { ...s.collection, annotations } } : {}));
          } catch (err) {
            get().toast(`Could not restore ${info.title}: ${errText(err)}`);
          }
        })();
      },
    });
  },

  revealSource(id) {
    const c = get().collection;
    if (!c) return;
    set({ menu: null });
    void api.sources.reveal(c.info.path, id).catch((err) => get().toast(`Could not open the folder: ${errText(err)}`));
  },

  async addFromFolder() {
    const c = get().collection;
    if (!c) return;
    set({ menu: null });
    try {
      const scan = await api.sources.folderDialog(c.info.path);
      if (scan) set({ folderScan: scan, folderBusy: false });
    } catch (err) {
      get().toast(`Could not read that folder: ${errText(err)}`);
    }
  },

  async rescanFolder(recursive) {
    const { collection: c, folderScan } = get();
    if (!c || !folderScan) return;
    set({ folderBusy: true });
    try {
      const scan = await api.sources.scanFolder(c.info.path, folderScan.root, { recursive });
      set((s) => (s.folderScan?.root === folderScan.root ? { folderScan: scan } : {}));
    } catch (err) {
      get().toast(`Could not read that folder: ${errText(err)}`);
    } finally {
      set({ folderBusy: false });
    }
  },

  closeFolder() {
    set({ folderScan: null, folderBusy: false });
  },

  async importFromFolder(files) {
    const c = get().collection;
    if (!c || files.length === 0) return;
    set({ folderBusy: true });
    try {
      const result = await api.sources.importFiles(c.info.path, files);
      set({ folderScan: null, folderBusy: false });
      await get().applyImport(result);
    } catch (err) {
      set({ folderBusy: false });
      get().toast(`Could not add those files: ${errText(err)}`);
    }
  },

  async dropFiles(files) {
    const c = get().collection;
    if (!c || files.length === 0) return;
    try {
      const r = await api.sources.dropped(c.info.path, files);
      if (!r) {
        get().toast("Only files and folders from disk can be dropped here");
        return;
      }
      if (r.kind === "scan") set({ folderScan: r.scan, folderBusy: false });
      else await get().applyImport(r.result);
    } catch (err) {
      get().toast(`Could not add the dropped files: ${errText(err)}`);
    }
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
    if (a?.target === "source" && a.page && a.source && c.sources.some((s) => s.id === a.source)) {
      if (a.source !== get().sourceId) get().selectSource(a.source);
      patch.focusTarget = { page: a.page, key: Date.now(), markId: thread.id };
    }
    set(patch);
    if (!get().configOptions[id]) warmSession(c.info.path, id);
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
    get().focusComposer();
    get().toast("New thread from your highlight", { label: "Undo", run: () => void get().deleteThread(thread.id) });
  },

  async branch(messageId, anchor) {
    const { collection: c, thread } = get();
    if (!c || !thread) return;
    const child = await api.agent.branch(c.info.path, thread.id, messageId, anchor);
    await get().refreshThreads();
    window.getSelection()?.removeAllRanges();
    await get().openThread(child.id);
    get().focusComposer();
    get().toast("New branch from the answer", { label: "Undo", run: () => void get().deleteThread(child.id) });
  },

  async deleteThread(id) {
    const c = get().collection;
    if (!c) return;
    const meta = c.threads.find((t) => t.id === id);
    const deleted = await api.threads.delete(c.info.path, id);
    if (deleted.length === 0) return;
    await get().refreshThreads();
    const current = get().thread;
    if (current && deleted.includes(current.id)) {
      const parentId = meta?.parent?.thread;
      if (parentId && !deleted.includes(parentId)) await get().openThread(parentId);
      else set({ thread: null, panelOpen: false, focus: false, composerQuote: null });
    }
    set((s) => {
      const turns = { ...s.turns };
      const configOptions = { ...s.configOptions };
      for (const d of deleted) { delete turns[d]; delete configOptions[d]; }
      return { turns, configOptions };
    });
    get().toast(deleted.length === 1 ? "Thread removed" : `Thread and ${deleted.length - 1} ${deleted.length === 2 ? "branch" : "branches"} removed`);
  },

  askHere(anchor) {
    if (!get().thread) {
      get().toast("Open a thread first, or choose Explore to start one here");
      return;
    }
    set({ composerQuote: anchor });
    window.getSelection()?.removeAllRanges();
    get().focusComposer();
  },

  focusComposer() {
    set((s) => ({ composerFocusKey: s.composerFocusKey + 1 }));
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
      const message = errText(err);
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
      get().toast(`Could not change ${configId}: ${errText(err)}`);
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
      const id = get().agentId;
      set({ agent: { id, connected: false, auth: null, authMethods: agentInfo(id).signIn, error: errText(err) } });
    }
  },

  async chooseAgent(id) {
    const same = id === get().agentId;
    if (same && get().agentChosen) return;
    if (!same && Object.values(get().turns).some((t) => t.running)) {
      get().toast("An answer is still coming. Stop it or let it finish, then switch agents.");
      return;
    }
    await api.agent.choose(id);
    set({ agentChosen: true });
    const info = agentInfo(id);
    if (get().installs[id]?.state !== "ready") get().toast(`${info.title} is downloading (${info.download}). Read on meanwhile; the header shows when it is ready.`);
    if (same) return;
    set({ agentId: id, agent: null, configOptions: {}, knownOptions: [], optionsError: null });
    const c = get().collection;
    if (!c) return;
    await get().connectAgent();
    const thread = get().thread;
    if (thread) warmSession(c.info.path, thread.id);
    if (get().settingsOpen) void get().refreshOptions();
  },

  async loginAgent(methodId) {
    const c = get().collection;
    if (!c) return;
    const method = agentInfo(get().agentId).signIn.find((m) => m.id === methodId);
    try {
      const via = await api.agent.login(c.info.path, methodId);
      get().toast(
        via === "browser"
          ? `Your browser opened to sign in with your ${method?.name ?? "account"}. Finish there; Qrabbit picks it up by itself.`
          : "A terminal window opened for sign-in. Finish there, then send a message here.",
      );
    } catch (err) {
      get().toast(`Could not start sign-in: ${errText(err)}`);
    }
  },

  async installAgent(id) {
    try {
      await api.agent.install(id);
    } catch (err) {
      get().toast(`Could not download ${agentInfo(id).title}: ${errText(err)}`);
      return;
    }
    // The agent in use was waiting on this download.
    if (id === get().agentId && get().collection && !get().agent?.connected) void get().connectAgent();
  },

  async uninstallAgent(id) {
    try {
      await api.agent.uninstall(id);
    } catch (err) {
      get().toast(`Could not remove ${agentInfo(id).title}: ${errText(err)}`);
    }
  },

  dismissChooser() {
    set({ agentChosen: true });
  },

  savePosition(sourceId, pos) {
    const c = get().collection;
    if (!c) return;
    void api.reader.setPosition(c.info.path, sourceId, pos);
    // The list shows where each source was left; keep the snapshot in step with the file.
    set((s) => (s.collection ? { collection: { ...s.collection, readerState: { ...s.collection.readerState, [sourceId]: pos } } } : {}));
  },

  toast(text, action) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, ...(action ? { action } : {}) }] }));
    setTimeout(() => get().dismissToast(id), action ? 7000 : 3200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setSettingsOpen(open, tab) {
    set({ settingsOpen: open, settingsTab: open ? (tab ?? null) : null, menu: null });
    if (open && get().collection) void get().refreshOptions();
  },

  async refreshOptions() {
    const c = get().collection;
    if (!c) return;
    const agentId = get().agentId;
    const current = () => get().collection?.info.path === c.info.path && get().agentId === agentId;
    set({ optionsLoading: true, optionsError: null });
    try {
      const options = await api.agent.options(c.info.path);
      if (current()) set({ knownOptions: options, optionsLoading: false });
    } catch (err) {
      if (current()) set({ optionsLoading: false, optionsError: errText(err) });
    }
  },

  setMenu(menu) {
    set({ menu });
  },

  togglePanel() {
    const { panelOpen, thread, collection: c } = get();
    if (panelOpen) { get().closePanel(); return; }
    if (thread) { set({ panelOpen: true }); return; }
    const latest = c?.threads.find((t) => !t.parent) ?? c?.threads[0];
    if (latest) void get().openThread(latest.id);
    else get().toast("No thread yet. Highlight the paper and choose Explore.");
  },

  async openParent() {
    const t = get().thread;
    if (t?.parent) await get().openThread(t.parent.thread);
  },

  async updateAgentDefaults(patch) {
    const c = get().collection;
    if (!c) return;
    const manifest = await api.collections.updateSettings(c.info.path, agentDefaultsPatch(c.manifest.settings, get().agentId, patch));
    set((s) => (s.collection ? { collection: { ...s.collection, manifest } } : {}));
  },

  async addBookmark(sourceId, page, anchor) {
    const c = get().collection;
    if (!c) return;
    const isPdf = c.sources.find((s) => s.id === sourceId)?.kind === "pdf";
    const label = anchor ? titleFromQuote(anchor.quote, 50) : isPdf ? `Page ${page}` : "This article";
    const a = await api.annotations.create(c.info.path, { kind: "bookmark", source: sourceId, page, ...(anchor ? { anchor } : {}), text: label });
    set((s) => (s.collection ? { collection: { ...s.collection, annotations: [a, ...s.collection.annotations] } } : {}));
    window.getSelection()?.removeAllRanges();
    get().toast(anchor ? "Bookmarked the passage" : isPdf ? `Bookmarked page ${page}` : "Bookmarked the article", { label: "Undo", run: () => void get().deleteAnnotation(a.id) });
  },

  async addComment(sourceId, page, anchor, text) {
    const c = get().collection;
    if (!c || !text.trim()) return;
    const a = await api.annotations.create(c.info.path, { kind: "comment", source: sourceId, ...(page ? { page } : {}), anchor, text: text.trim() });
    set((s) => (s.collection ? { collection: { ...s.collection, annotations: [a, ...s.collection.annotations] } } : {}));
    window.getSelection()?.removeAllRanges();
  },

  async updateAnnotation(id, text) {
    const c = get().collection;
    if (!c) return;
    const next = await api.annotations.update(c.info.path, id, { text: text.trim() });
    set((s) => (s.collection ? { collection: { ...s.collection, annotations: s.collection.annotations.map((a) => (a.id === id ? next : a)) } } : {}));
  },

  async deleteAnnotation(id) {
    const c = get().collection;
    if (!c) return;
    await api.annotations.delete(c.info.path, id);
    set((s) => (s.collection ? { collection: { ...s.collection, annotations: s.collection.annotations.filter((a) => a.id !== id) } } : {}));
  },

  goToAnnotation(id) {
    const c = get().collection;
    const a = c?.annotations.find((x) => x.id === id);
    if (!a) return;
    if (a.source !== get().sourceId) get().selectSource(a.source);
    set({ focusTarget: { page: a.page ?? a.anchor?.page ?? 1, key: Date.now(), markId: id } });
  },

  // ---------- cloud ----------
  async refreshCloud() {
    try {
      const cloud = await api.cloud.account();
      set({ cloud });
      set({ cloudCollections: cloud.signedIn ? await api.cloud.collections() : [] });
    } catch (err) {
      set((s) => ({ cloud: { ...(s.cloud ?? { available: true, signedIn: false }), error: errText(err) } }));
    }
  },

  async cloudRequestCode(email) {
    await api.cloud.requestCode(email);
  },

  async cloudVerifyCode(email, code) {
    const cloud = await api.cloud.verifyCode(email, code);
    set({ cloud });
    void get().refreshCloud();
    const c = get().collection;
    if (c) void api.cloud.syncState(c.info.path).then((cloudSync) => set({ cloudSync })).catch(() => {});
  },

  async cloudSignOut(scope) {
    const cloud = await api.cloud.signOut(scope);
    set({ cloud, ...(scope === "local" ? { cloudSync: null, cloudCollections: [] } : {}) });
    if (scope === "others") get().toast("Every other computer was signed out");
  },

  async enableCloud() {
    const c = get().collection;
    if (!c) return;
    set({ menu: null });
    try {
      const cloudSync = await api.cloud.enable(c.info.path);
      set({ cloudSync });
      get().toast(`${c.info.name} is now kept in the cloud`);
      void get().refreshCloud();
    } catch (err) {
      get().toast(`Could not keep ${c.info.name} in the cloud: ${errText(err)}`);
    }
  },

  async disableCloud() {
    const c = get().collection;
    if (!c) return;
    set({ menu: null });
    try {
      await api.cloud.disable(c.info.path);
      set({ cloudSync: null });
      get().toast(`${c.info.name} now stays on this computer; the copy in the cloud is kept`);
      void get().refreshCloud();
    } catch (err) {
      get().toast(`Could not stop syncing: ${errText(err)}`);
    }
  },

  async removeCloudCollection(id) {
    set({ menu: null });
    const name = get().cloudCollections.find((c) => c.id === id)?.name ?? "The collection";
    try {
      await api.cloud.remove(id);
      if (get().cloudSync?.collectionId === id) set({ cloudSync: null });
      get().toast(`${name} was removed from the cloud; every computer keeps its folder`);
      void get().refreshCloud();
    } catch (err) {
      get().toast(`Could not remove ${name} from the cloud: ${errText(err)}`);
    }
  },

  async syncNow() {
    const c = get().collection;
    if (!c) return;
    set({ menu: null });
    try {
      set({ cloudSync: await api.cloud.syncNow(c.info.path) });
    } catch (err) {
      get().toast(`Sync did not finish: ${errText(err)}`);
    }
  },

  async downloadCollection(id) {
    if (get().cloudDownload) return;
    const dir = await api.cloud.downloadDialog();
    if (!dir) return;
    const name = get().cloudCollections.find((c) => c.id === id)?.name ?? "The collection";
    set({ cloudDownload: id });
    let snap: CollectionSnapshot | null = null;
    try {
      snap = await api.cloud.download(id, dir);
      await get().openCollection(snap.info.path);
      get().toast(`${snap.info.name} is on this computer now and stays in step with the cloud`);
    } catch (err) {
      get().toast(snap ? `${snap.info.name} is on this computer now but did not open: ${errText(err)}` : `Could not download ${name}: ${errText(err)}`);
      // Main may have the folder in its recent list even so; the home screen shows what is there.
      void api.collections.recent().then((recent) => set({ recent }));
    } finally {
      set({ cloudDownload: null });
      void get().refreshCloud();
    }
  },

  async applyCloudChanges(changed) {
    const c = get().collection;
    if (!c) return;
    const path = c.info.path;
    const still = () => get().collection?.info.path === path;
    if (changed.manifest || changed.readerState) {
      // The manifest carries the order and the settings; a fresh snapshot is the simplest way to read both.
      const snap = await api.collections.open(path);
      if (!still()) return;
      set((s) => (s.collection ? { collection: { ...s.collection, manifest: snap.manifest, sources: snap.sources, annotations: snap.annotations, threads: snap.threads, readerState: snap.readerState } } : {}));
    } else {
      if (changed.sources || changed.annotations) {
        const [sources, annotations] = await Promise.all([api.sources.list(path), api.annotations.list(path)]);
        if (!still()) return;
        set((s) => (s.collection ? { collection: { ...s.collection, sources, annotations } } : {}));
      }
      if (changed.threads) await get().refreshThreads();
    }
    const open = get().thread;
    if (changed.threads && open) {
      const thread = await api.threads.read(path, open.id);
      if (still()) set((s) => (s.thread?.id === open.id ? { thread } : {}));
    }
    // The source being read may have been removed on another computer.
    const cur = get();
    if (cur.sourceId && cur.collection && !cur.collection.sources.some((s) => s.id === cur.sourceId)) set({ sourceId: null });
  },
}));

/** Start the thread's session so the composer's pickers show the agent's real options. */
function warmSession(collectionPath: string, threadId: string): void {
  const agentId = useStore.getState().agentId;
  api.agent
    .session(collectionPath, threadId)
    .then(({ configOptions }) => {
      // After a switch these would be the old agent's options.
      if (useStore.getState().agentId !== agentId) return;
      useStore.setState((s) => ({ configOptions: { ...s.configOptions, [threadId]: configOptions }, knownOptions: configOptions }));
    })
    .catch(() => { /* the status pill shows the problem */ });
}

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
