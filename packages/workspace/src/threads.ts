import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import YAML from "yaml";
import { newId, slugify, type Anchor, type Message, type Thread, type ThreadMeta } from "@qrabbit/shared";
import { DIRS } from "./collection.js";
import { writeAtomic } from "./fs.js";

type Frontmatter = {
  id: string;
  title: string;
  created: string;
  agent?: string;
  model?: string;
  effort?: string;
  parent?: { thread: string; message: string };
  anchor?: Anchor;
  anchors?: Record<string, Anchor>;
  context?: Record<string, string[]>;
  summary?: ThreadMeta["summary"];
  hue: number;
};

const HEADING = /^## (user|assistant|system)\s+<!--\s*(\S+)\s+(\S+)\s*-->\s*$/;

// ---------- parse ----------
export function parseThreadFile(text: string, file: string): Thread {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`Thread file has no frontmatter: ${file}`);
  const fm = YAML.parse(m[1]!) as Frontmatter;
  const body = m[2] ?? "";
  const messages: Message[] = [];
  let cur: Message | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (cur) {
      let text = lines.join("\n").replace(/^\n+|\n+$/g, "");
      // The quote is rendered into the body for readability; the anchor in frontmatter is the record.
      if (cur.quote) text = text.replace(/^(?:>.*(?:\n|$))+\n*/, "");
      cur.body = text;
      messages.push(cur);
    }
    lines.length = 0;
  };
  for (const line of body.split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const id = h[2]!;
      cur = { id, role: h[1] as Message["role"], at: h[3]!, body: "" };
      const quote = fm.anchors?.[id];
      if (quote) cur.quote = quote;
      const ctx = fm.context?.[id];
      if (ctx) cur.context = ctx;
    } else if (cur) {
      lines.push(line);
    }
  }
  flush();
  const meta: ThreadMeta = {
    id: fm.id,
    title: fm.title,
    created: fm.created,
    hue: fm.hue ?? 1,
    file,
    messageCount: messages.length,
  };
  if (fm.agent) meta.agent = fm.agent;
  if (fm.model) meta.model = fm.model;
  if (fm.effort) meta.effort = fm.effort;
  if (fm.parent) meta.parent = fm.parent;
  if (fm.anchor) meta.anchor = fm.anchor;
  if (fm.summary) meta.summary = fm.summary;
  return { ...meta, messages };
}

// ---------- serialise ----------
function renderQuote(a: Anchor): string {
  const page = a.page ? `  [p.${a.page}]` : "";
  return a.quote
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n") + page;
}

export function serializeThread(t: Thread): string {
  const fm: Frontmatter = { id: t.id, title: t.title, created: t.created, hue: t.hue };
  if (t.agent) fm.agent = t.agent;
  if (t.model) fm.model = t.model;
  if (t.effort) fm.effort = t.effort;
  if (t.parent) fm.parent = t.parent;
  if (t.anchor) fm.anchor = t.anchor;
  if (t.summary) fm.summary = t.summary;
  const anchors: Record<string, Anchor> = {};
  const context: Record<string, string[]> = {};
  for (const m of t.messages) {
    if (m.quote) anchors[m.id] = m.quote;
    if (m.context?.length) context[m.id] = m.context;
  }
  if (Object.keys(anchors).length) fm.anchors = anchors;
  if (Object.keys(context).length) fm.context = context;

  const parts = [`---\n${YAML.stringify(fm).trimEnd()}\n---\n`];
  for (const m of t.messages) {
    parts.push(`\n## ${m.role}  <!-- ${m.id} ${m.at} -->\n\n`);
    if (m.quote) parts.push(renderQuote(m.quote) + "\n\n");
    parts.push(m.body.trimEnd() + "\n");
  }
  return parts.join("");
}

// ---------- files ----------
function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
}

export function listThreads(collection: string): ThreadMeta[] {
  const files: string[] = [];
  walk(join(collection, DIRS.threads), files);
  const out: ThreadMeta[] = [];
  for (const f of files) {
    try {
      const rel = relative(collection, f).split(sep).join("/");
      const { messages: _m, ...meta } = parseThreadFile(readFileSync(f, "utf8"), rel);
      out.push(meta);
    } catch {
      // A file the app cannot parse is left alone; the reader may be editing it by hand.
    }
  }
  return out.sort((a, b) => (a.created < b.created ? 1 : -1));
}

export function readThread(collection: string, id: string): Thread | null {
  const meta = listThreads(collection).find((t) => t.id === id);
  if (!meta) return null;
  return parseThreadFile(readFileSync(join(collection, meta.file), "utf8"), meta.file);
}

function writeThread(collection: string, t: Thread): void {
  writeAtomic(join(collection, t.file), serializeThread(t));
}

function uniqueFile(collection: string, dir: string, base: string): string {
  let rel = `${dir}/${base}.md`;
  let n = 2;
  while (existsSync(join(collection, rel))) rel = `${dir}/${base}-${n++}.md`;
  return rel;
}

export function createThread(
  collection: string,
  input: { title: string; anchor?: Anchor; parent?: { thread: string; message: string }; agent?: string; model?: string },
): Thread {
  const existing = listThreads(collection);
  const created = new Date().toISOString();
  const day = created.slice(0, 10);
  let dir: string = DIRS.threads;
  if (input.parent) {
    const parent = existing.find((t) => t.id === input.parent!.thread);
    if (parent) dir = parent.file.replace(/\.md$/, "");
  }
  const file = uniqueFile(collection, dir, input.parent ? slugify(input.title) : `${day}-${slugify(input.title)}`);
  const hue = ((existing.length % 4) + 1) as number;
  const thread: Thread = {
    id: newId("thr"),
    title: input.title,
    created,
    hue,
    file,
    messageCount: 0,
    messages: [],
  };
  if (input.anchor) thread.anchor = input.anchor;
  if (input.parent) thread.parent = input.parent;
  if (input.agent) thread.agent = input.agent;
  if (input.model) thread.model = input.model;
  writeThread(collection, thread);
  return thread;
}

export function appendMessage(
  collection: string,
  id: string,
  message: Omit<Message, "id" | "at"> & { id?: string; at?: string },
): Thread {
  const t = readThread(collection, id);
  if (!t) throw new Error(`Unknown thread: ${id}`);
  const msg: Message = { ...message, id: message.id ?? newId("msg"), at: message.at ?? new Date().toISOString() };
  t.messages.push(msg);
  t.messageCount = t.messages.length;
  writeThread(collection, t);
  return t;
}

export function updateThread(collection: string, id: string, patch: Partial<Pick<Thread, "title" | "agent" | "model" | "effort" | "summary">>): Thread {
  const t = readThread(collection, id);
  if (!t) throw new Error(`Unknown thread: ${id}`);
  Object.assign(t, patch);
  writeThread(collection, t);
  return t;
}
