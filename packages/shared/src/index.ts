import { customAlphabet } from "nanoid";

// ---------- ids ----------
const gen = customAlphabet("0123456789abcdefghjkmnpqrstvwxyz", 16);
/** Prefixed, sortable-enough ids: thr_…, msg_…, src_… */
export const newId = (prefix: string): string => `${prefix}_${gen()}`;

export function slugify(input: string, max = 60): string {
  const s = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "untitled";
}

// ---------- collections ----------
export type CollectionManifest = {
  id: string;
  name: string;
  created: string;
  settings: { agent?: string; model?: string; effort?: string };
  /** Source ids in reading order. Sources not listed come after, oldest first. */
  order?: string[];
};

export type CollectionCounts = { sources: number; read: number; threads: number };

export type CollectionInfo = {
  path: string;
  name: string;
  id: string;
  lastOpened?: string;
  /** Filled in for the home screen; absent inside a snapshot. */
  counts?: CollectionCounts;
};

// ---------- sources ----------
export type SourceKind = "pdf" | "markdown" | "web";

export type SourceInfo = {
  id: string;
  kind: SourceKind;
  title: string;
  /** File name inside sources/<id>/, e.g. source.pdf */
  file: string;
  pages?: number;
  added: string;
  /** true once text.md has been extracted */
  hasText: boolean;
  /** When the reader marked it read. Absent means unread. A record, never a prompt. */
  read?: string;
  /** When the reader gave it a title of their own; text extraction then leaves the title alone. */
  renamed?: string;
  /** The document's own title as found in it (PDF metadata, the largest text on page one, or the first heading). */
  docTitle?: string;
  /** Hash of the source file, for duplicate detection. Computed on import, back-filled when first needed. */
  sha256?: string;
  /** Web sources only. */
  url?: string;
  siteName?: string;
  byline?: string;
  fetched?: string;
  /** LaTeX macros the page defined for its own formulas, as KaTeX takes them: `{"\\E": "{\\mathrm E}"}`. */
  macros?: Record<string, string>;
};

/** A file found by scanning a folder to add from. */
export type FolderFile = {
  path: string;
  /** Relative to the scanned root, with forward slashes. */
  rel: string;
  name: string;
  size: number;
  kind: SourceKind;
  /** Set when a source in the collection already has this content. */
  existing?: { id: string; title: string };
};

export type FolderScan = {
  root: string;
  files: FolderFile[];
  /** Files with other extensions, not listed. */
  skipped: number;
  /** The scan stopped at its limit; the folder has more eligible files than shown. */
  truncated: boolean;
};

export type ImportResult = {
  added: SourceInfo[];
  /** Files that were already in the collection, by content; nothing was copied for these. */
  existing: SourceInfo[];
  /** Paths that could not be imported. */
  failed: string[];
};

/** What `remove` hands back so `restore` can undo it. */
export type RemovedSource = { id: string; trashPath: string; index: number };

export type DropResult = { kind: "scan"; scan: FolderScan } | { kind: "imported"; result: ImportResult };

// ---------- anchors ----------
/**
 * W3C Web Annotation style selector set. `quote`/`prefix`/`suffix` re-anchor after
 * re-extraction. `start`/`end` are offsets into text.md for PDF sources, into the rendered
 * text for Markdown and web sources, and into the message body for a message target; they are
 * hints, and the quote is what locates a span. `page` scopes the search for PDFs.
 */
export type Anchor = {
  target: "source" | "message";
  /** Source id for a source target; absent for a message target. */
  source?: string;
  page?: number;
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  /** message target only */
  thread?: string;
  message?: string;
};

// ---------- threads ----------
export type MessageRole = "user" | "assistant" | "system";

export type Message = {
  id: string;
  role: MessageRole;
  at: string;
  body: string;
  /** Quoted source span this message carries, if any (also stored in frontmatter `anchors`). */
  quote?: Anchor;
  /** Branch ids whose digests were attached to this message. */
  context?: string[];
};

export type ThreadSummary = {
  at: string;
  through: string;
  text: string;
  concepts: string[];
};

export type ThreadMeta = {
  id: string;
  title: string;
  created: string;
  agent?: string;
  model?: string;
  effort?: string;
  parent?: { thread: string; message: string };
  anchor?: Anchor;
  /** Written by the parent session when the branch is created (plan §5.5). */
  handoff?: string;
  summary?: ThreadSummary;
  /** 1–4, picks the highlight colour */
  hue: number;
  /** Path relative to the collection root */
  file: string;
  messageCount: number;
};

export type Thread = ThreadMeta & { messages: Message[] };

// ---------- annotations: the reader's own marks, never part of a prompt ----------
export type AnnotationKind = "bookmark" | "comment";

export type Annotation = {
  id: string;
  kind: AnnotationKind;
  source: string;
  /** Page for a PDF; a page bookmark has a page but no anchor. */
  page?: number;
  anchor?: Anchor;
  /** Comment text, or a bookmark label. */
  text: string;
  created: string;
  updated?: string;
};

// ---------- reader ----------
export type ReaderPosition = { page: number; scrollTop: number; zoom: number };
export type ReaderState = Record<string, ReaderPosition>;

// ---------- agent ----------
export type AgentAuth = { kind: string; label: string } | null;

export type AgentStatus = {
  connected: boolean;
  agent?: { name: string; version?: string };
  /** Pushed by the adapter: which account the next turn bills. */
  auth: AgentAuth;
  authMethods: Array<{ id: string; name: string; description?: string | null }>;
  error?: string;
};

export type ConfigOption = {
  id: string;
  name: string;
  category?: string | null;
  type: "select" | "boolean";
  currentValue: string | boolean;
  options?: Array<{ value: string; name: string; description?: string | null; group?: string }>;
};

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool_call"; id: string; title: string; kind?: string; status?: string; paths?: string[] }
  | { type: "tool_call_update"; id: string; title?: string; status?: string }
  | { type: "config_options"; options: ConfigOption[] }
  | { type: "stop"; stopReason: string }
  | { type: "error"; message: string }
  /** The parent session finished writing a branch's handoff. */
  | { type: "handoff"; text: string };

export type PermissionRequest = {
  id: string;
  threadId: string;
  title: string;
  kind?: string;
  paths: string[];
  options: Array<{ optionId: string; name: string; kind: string }>;
};

// ---------- renderer ↔ main contract ----------
export type CollectionSnapshot = {
  info: CollectionInfo;
  manifest: CollectionManifest;
  sources: SourceInfo[];
  threads: ThreadMeta[];
  annotations: Annotation[];
  readerState: ReaderState;
};

export type QrabbitApi = {
  collections: {
    recent(): Promise<CollectionInfo[]>;
    /** Pick a folder; initialise it as a collection if it is not one yet. */
    openDialog(): Promise<CollectionSnapshot | null>;
    open(path: string): Promise<CollectionSnapshot>;
    forget(path: string): Promise<CollectionInfo[]>;
    /** Merge settings into the collection manifest (defaults for new threads, etc.). */
    updateSettings(path: string, patch: CollectionManifest["settings"]): Promise<CollectionManifest>;
    /** Write the reading order: every source id, in the order to read them. */
    setOrder(path: string, ids: string[]): Promise<CollectionManifest>;
  };
  sources: {
    /** The collection's sources in reading order. */
    list(collectionPath: string): Promise<SourceInfo[]>;
    /** Pick files with the OS dialog and add them; null when the dialog was cancelled. */
    importDialog(collectionPath: string): Promise<ImportResult | null>;
    /** Fetch a web page, reduce it to an article, and add it as a source. */
    importUrl(collectionPath: string, url: string): Promise<SourceInfo>;
    /** Add files from a folder the user picked or dropped. Only paths from such a folder are accepted. */
    importFiles(collectionPath: string, files: string[]): Promise<ImportResult>;
    /** Pick a folder with the OS dialog and scan it; null when cancelled. */
    folderDialog(collectionPath: string): Promise<FolderScan | null>;
    /** Rescan a folder the user already picked, for example with subfolders turned off. */
    scanFolder(collectionPath: string, dir: string, opts: { recursive: boolean }): Promise<FolderScan>;
    /** Files or a folder dropped onto the window. A folder is scanned; files are added. */
    dropped(collectionPath: string, files: File[]): Promise<DropResult | null>;
    /** Record that the reader finished (or did not finish) a source. */
    setRead(collectionPath: string, sourceId: string, read: boolean): Promise<SourceInfo>;
    /** Give the source a new title. Its folder and id stay, so threads and marks stay attached. */
    rename(collectionPath: string, sourceId: string, title: string): Promise<SourceInfo>;
    /** Rename the source to its document's title in sentence case; null when no title is known yet. */
    autoTitle(collectionPath: string, sourceId: string): Promise<SourceInfo | null>;
    /** Move the source folder to the collection's trash; threads keep their quotes. */
    remove(collectionPath: string, sourceId: string): Promise<RemovedSource>;
    /** Put a removed source back where it was. */
    restore(collectionPath: string, removed: RemovedSource): Promise<SourceInfo>;
    /** Show the source's folder in the file manager. */
    reveal(collectionPath: string, sourceId: string): Promise<void>;
    readBytes(collectionPath: string, sourceId: string): Promise<Uint8Array>;
    /** Store extracted text. `titles.metadata` is the PDF's title field, `titles.guess` the largest text on page one. */
    saveText(collectionPath: string, sourceId: string, text: string, pages: number, titles?: { metadata?: string; guess?: string }): Promise<SourceInfo>;
    readText(collectionPath: string, sourceId: string): Promise<string | null>;
  };
  threads: {
    list(collectionPath: string): Promise<ThreadMeta[]>;
    read(collectionPath: string, threadId: string): Promise<Thread | null>;
    create(collectionPath: string, input: { title: string; anchor?: Anchor; parent?: { thread: string; message: string } }): Promise<Thread>;
    appendMessage(collectionPath: string, threadId: string, message: Omit<Message, "id" | "at"> & { id?: string; at?: string }): Promise<Thread>;
    /** Delete a thread and its branches; resolves with the ids removed. */
    delete(collectionPath: string, threadId: string): Promise<string[]>;
  };
  reader: {
    setPosition(collectionPath: string, sourceId: string, position: ReaderPosition): Promise<void>;
  };
  annotations: {
    list(collectionPath: string): Promise<Annotation[]>;
    create(collectionPath: string, input: Omit<Annotation, "id" | "created" | "updated">): Promise<Annotation>;
    update(collectionPath: string, id: string, patch: { text?: string }): Promise<Annotation>;
    delete(collectionPath: string, id: string): Promise<boolean>;
  };
  agent: {
    status(collectionPath: string): Promise<AgentStatus>;
    connect(collectionPath: string): Promise<AgentStatus>;
    /** Ensure a session exists for the thread and return its config options. */
    session(collectionPath: string, threadId: string): Promise<{ configOptions: ConfigOption[] }>;
    /** The agent's config options (models, effort) for Settings, from a live session or a probe session started for the purpose. */
    options(collectionPath: string): Promise<ConfigOption[]>;
    /** Append the user message, run one turn, append the reply; resolves with the updated thread. */
    prompt(collectionPath: string, threadId: string, body: string, quote?: Anchor): Promise<Thread>;
    /** Create a branch from a span inside a message and start its handoff in the background. */
    branch(collectionPath: string, parentId: string, messageId: string, anchor: Anchor): Promise<Thread>;
    cancel(collectionPath: string, threadId: string): Promise<void>;
    setConfig(collectionPath: string, threadId: string, configId: string, value: string | boolean): Promise<ConfigOption[]>;
    replyPermission(requestId: string, optionId: string | null): Promise<void>;
    /** Run the agent's own terminal sign-in flow in a terminal window. */
    login(collectionPath: string, methodId: string): Promise<void>;
    onEvent(cb: (threadId: string, event: AgentEvent) => void): () => void;
    onPermission(cb: (request: PermissionRequest) => void): () => void;
    onStatus(cb: (collectionPath: string, status: AgentStatus) => void): () => void;
  };
  app: {
    version(): Promise<string>;
    platform(): Promise<string>;
    /** The user's home folder, so paths under it can be shown as ~. */
    home(): Promise<string>;
  };
};
