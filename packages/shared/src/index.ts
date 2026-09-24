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
};

export type CollectionInfo = {
  path: string;
  name: string;
  id: string;
  lastOpened?: string;
};

// ---------- sources ----------
export type SourceKind = "pdf" | "markdown";

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
};

// ---------- anchors ----------
/**
 * W3C Web Annotation style selector set. `quote`/`prefix`/`suffix` re-anchor after
 * re-extraction; `start`/`end` are offsets into text.md for the source target, or into the
 * message body for a message target; `page` scopes the search for PDFs.
 */
export type Anchor = {
  target: "source" | "message";
  source: string;
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
  parent?: { thread: string; message: string };
  anchor?: Anchor;
  summary?: ThreadSummary;
  /** 1–4, picks the highlight colour */
  hue: number;
  /** Path relative to the collection root */
  file: string;
  messageCount: number;
};

export type Thread = ThreadMeta & { messages: Message[] };

// ---------- reader ----------
export type ReaderPosition = { page: number; scrollTop: number; zoom: number };
export type ReaderState = Record<string, ReaderPosition>;

// ---------- renderer ↔ main contract ----------
export type CollectionSnapshot = {
  info: CollectionInfo;
  manifest: CollectionManifest;
  sources: SourceInfo[];
  threads: ThreadMeta[];
  readerState: ReaderState;
};

export type QrabbitApi = {
  collections: {
    recent(): Promise<CollectionInfo[]>;
    /** Pick a folder; initialise it as a collection if it is not one yet. */
    openDialog(): Promise<CollectionSnapshot | null>;
    open(path: string): Promise<CollectionSnapshot>;
    forget(path: string): Promise<CollectionInfo[]>;
  };
  sources: {
    importDialog(collectionPath: string): Promise<SourceInfo[]>;
    readBytes(collectionPath: string, sourceId: string): Promise<Uint8Array>;
    saveText(collectionPath: string, sourceId: string, text: string, pages: number, title?: string): Promise<SourceInfo>;
    readText(collectionPath: string, sourceId: string): Promise<string | null>;
  };
  threads: {
    list(collectionPath: string): Promise<ThreadMeta[]>;
    read(collectionPath: string, threadId: string): Promise<Thread | null>;
    create(collectionPath: string, input: { title: string; anchor?: Anchor; parent?: { thread: string; message: string } }): Promise<Thread>;
    appendMessage(collectionPath: string, threadId: string, message: Omit<Message, "id" | "at"> & { id?: string; at?: string }): Promise<Thread>;
  };
  reader: {
    setPosition(collectionPath: string, sourceId: string, position: ReaderPosition): Promise<void>;
  };
  app: {
    version(): Promise<string>;
    platform(): Promise<string>;
  };
};
