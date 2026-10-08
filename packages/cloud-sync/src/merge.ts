/**
 * Merging a file changed on this machine and in the cloud at the same time. The cloud knows nothing about the
 * formats; this is where the collection's own files are understood. With the last synced version at hand (the
 * cloud keeps it for a week) the merge is three-way: what this machine changed wins, everything else follows the
 * cloud. Without it, local values win and the cloud fills in what is missing.
 */
import type { Annotation, CollectionManifest, Message, ReaderState, SourceInfo, Thread, ThreadMeta } from "@qrabbit/shared";
import { parseThreadFile, serializeThread } from "@qrabbit/workspace";

export type FileKind = "manifest" | "source" | "sourceFile" | "annotations" | "readerState" | "thread" | "other";

export type MergeInput = { path: string; local: Uint8Array; remote: Uint8Array; base: Uint8Array | null };
/** `merged`: write these bytes. `both`: the formats cannot be merged; keep the local file and the cloud's beside it. */
export type MergeResult = { kind: "merged"; bytes: Uint8Array } | { kind: "both" };

const dec = new TextDecoder();
const enc = new TextEncoder();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const bytesEqual = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
const toJson = (v: unknown) => enc.encode(JSON.stringify(v, null, 2) + "\n");

function parseJson<T>(bytes: Uint8Array): T | null {
  try {
    return JSON.parse(dec.decode(bytes)) as T;
  } catch {
    return null;
  }
}

/** What a synced path is to the app, for merging and for telling the renderer what to refresh. */
export function fileKind(path: string): FileKind {
  if (path === "qrabbit.json") return "manifest";
  if (path === ".qrabbit/reader-state.json") return "readerState";
  if (/^sources\/[^/]+\/source\.json$/.test(path)) return "source";
  if (/^sources\/[^/]+\/annotations\.json$/.test(path)) return "annotations";
  if (path.startsWith("sources/")) return "sourceFile";
  if (/^threads\/.+\.md$/.test(path)) return "thread";
  return "other";
}

/** Where the cloud's copy goes when two versions of a file cannot be merged. */
export function sibling(path: string, label = "from cloud"): string {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${dir}${stem} (${label})${ext}`;
}

// ---------- values ----------
/** One value: unchanged here means the cloud's; changed here means ours. Without a base, ours unless we have none. */
function pick<T>(local: T | undefined, remote: T | undefined, base: T | undefined, hasBase: boolean): T | undefined {
  if (same(local, remote)) return local;
  if (hasBase) return same(local, base) ? remote : local;
  return local === undefined ? remote : local;
}

function pickFields<T extends object>(local: T, remote: T, base: T | null): T {
  const out: Record<string, unknown> = {};
  const l = local as Record<string, unknown>;
  const r = remote as Record<string, unknown>;
  const b = base as Record<string, unknown> | null;
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const v = pick(l[k], r[k], b ? b[k] : undefined, b !== null);
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// ---------- the manifest ----------
/** Local order first, without what the cloud removed; then whatever the cloud added. */
export function mergeOrder(local: string[] = [], remote: string[] = [], base: string[] | null = null): string[] {
  const removedRemotely = new Set(base ? base.filter((id) => !remote.includes(id)) : []);
  const removedLocally = new Set(base ? base.filter((id) => !local.includes(id)) : []);
  const out = local.filter((id) => !removedRemotely.has(id));
  for (const id of remote) if (!out.includes(id) && !removedLocally.has(id)) out.push(id);
  return out;
}

type AgentDefaultsMap = NonNullable<CollectionManifest["settings"]["agents"]>;

/** Field by field within each agent, so one computer's Claude Code choice and another's Codex choice both stay. */
function mergeAgentDefaults(local: AgentDefaultsMap = {}, remote: AgentDefaultsMap = {}, base: AgentDefaultsMap | null): AgentDefaultsMap | undefined {
  const out: Record<string, object> = {};
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)]) as Set<keyof AgentDefaultsMap>) {
    const v = pickFields(local[id] ?? {}, remote[id] ?? {}, base ? (base[id] ?? {}) : null);
    if (Object.keys(v).length) out[id] = v;
  }
  return Object.keys(out).length ? (out as AgentDefaultsMap) : undefined;
}

export function mergeManifest(local: CollectionManifest, remote: CollectionManifest, base: CollectionManifest | null): CollectionManifest {
  const out = pickFields(local, remote, base);
  out.settings = pickFields(local.settings ?? {}, remote.settings ?? {}, base ? (base.settings ?? {}) : null);
  const agents = mergeAgentDefaults(local.settings?.agents, remote.settings?.agents, base ? (base.settings?.agents ?? {}) : null);
  if (agents) out.settings.agents = agents;
  else delete out.settings.agents;
  out.order = mergeOrder(local.order, remote.order, base ? (base.order ?? []) : null);
  out.id = local.id;
  return out;
}

// ---------- a source ----------
export function mergeSource(local: SourceInfo, remote: SourceInfo, base: SourceInfo | null): SourceInfo {
  const out = pickFields(local, remote, base);
  if (!base) {
    // Two-way: the later rename wins, and a read mark set on either machine sticks.
    if (local.renamed && remote.renamed && local.renamed !== remote.renamed) {
      const later = local.renamed > remote.renamed ? local : remote;
      out.title = later.title;
      out.renamed = later.renamed;
    } else if (remote.renamed && !local.renamed) {
      out.title = remote.title;
      out.renamed = remote.renamed;
    }
    if (!out.read && (local.read || remote.read)) out.read = local.read ?? remote.read;
  }
  out.id = local.id;
  // Whether text.md exists is a fact about this folder.
  out.hasText = local.hasText;
  return out;
}

// ---------- marks ----------
export function mergeAnnotations(local: Annotation[], remote: Annotation[], base: Annotation[] | null): Annotation[] {
  const L = new Map(local.map((a) => [a.id, a]));
  const R = new Map(remote.map((a) => [a.id, a]));
  const B = base ? new Map(base.map((a) => [a.id, a])) : null;
  const stamp = (a: Annotation) => a.updated ?? a.created;
  const ids = [...L.keys(), ...remote.filter((a) => !L.has(a.id)).map((a) => a.id)];
  const out: Annotation[] = [];
  for (const id of ids) {
    const a = L.get(id);
    const c = R.get(id);
    const was = B?.get(id);
    if (a && c) out.push(same(a, c) ? a : stamp(c) > stamp(a) ? c : a);
    // Only on one side: added there, or removed on the other. With a base the two can be told apart, and a removal
    // stands unless the other side changed the mark meanwhile. Without one, keeping is the safe choice.
    else if (a && (!B || !was || !same(a, was))) out.push(a);
    else if (c && (!B || !was || !same(c, was))) out.push(c);
  }
  return out;
}

// ---------- reading positions ----------
export function mergeReaderState(local: ReaderState, remote: ReaderState, base: ReaderState | null): ReaderState {
  return pickFields(local, remote, base);
}

// ---------- threads ----------
const metaOf = ({ messages: _m, file: _f, messageCount: _c, ...meta }: Thread): Omit<ThreadMeta, "file" | "messageCount"> => meta;

/** Messages by id in time order, frontmatter field by field; null when a side does not parse. */
export function mergeThreads(path: string, localText: string, remoteText: string, baseText: string | null): string | null {
  let local: Thread;
  let remote: Thread;
  let base: Thread | null = null;
  try {
    local = parseThreadFile(localText, path);
    remote = parseThreadFile(remoteText, path);
    if (baseText !== null) base = parseThreadFile(baseText, path);
  } catch {
    return null;
  }
  const meta = pickFields(metaOf(local), metaOf(remote), base ? metaOf(base) : null);
  const byId = new Map<string, Message>(local.messages.map((m) => [m.id, m]));
  const inBase = base ? new Map(base.messages.map((m) => [m.id, m])) : null;
  for (const m of remote.messages) {
    const mine = byId.get(m.id);
    if (!mine) byId.set(m.id, m);
    else if (!same(mine, m) && inBase && same(mine, inBase.get(m.id))) byId.set(m.id, m);
  }
  if (inBase) {
    const inLocal = new Set(local.messages.map((m) => m.id));
    const inRemote = new Map(remote.messages.map((m) => [m.id, m]));
    for (const [id, was] of inBase) {
      if (!inLocal.has(id) && inRemote.has(id) && same(inRemote.get(id), was)) byId.delete(id);
      if (!inRemote.has(id) && inLocal.has(id) && same(byId.get(id), was)) byId.delete(id);
    }
  }
  const messages = [...byId.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id)));
  const thread: Thread = { ...(meta as ThreadMeta), file: path, messageCount: messages.length, messages };
  return serializeThread(thread);
}

// ---------- dispatch ----------
export function mergeFiles({ path, local, remote, base }: MergeInput): MergeResult {
  if (bytesEqual(local, remote)) return { kind: "merged", bytes: local };
  const kind = fileKind(path);
  const both: MergeResult = { kind: "both" };
  try {
    if (kind === "thread") {
      const text = mergeThreads(path, dec.decode(local), dec.decode(remote), base ? dec.decode(base) : null);
      return text === null ? both : { kind: "merged", bytes: enc.encode(text) };
    }
    if (kind === "manifest" || kind === "source" || kind === "annotations" || kind === "readerState") {
      const l = parseJson<unknown>(local);
      const r = parseJson<unknown>(remote);
      if (l === null || r === null || typeof l !== "object" || typeof r !== "object") return both;
      const b = base ? parseJson<unknown>(base) : null;
      const b3 = b !== null && typeof b === "object" ? b : null;
      switch (kind) {
        case "manifest":
          return { kind: "merged", bytes: toJson(mergeManifest(l as CollectionManifest, r as CollectionManifest, b3 as CollectionManifest | null)) };
        case "source":
          return { kind: "merged", bytes: toJson(mergeSource(l as SourceInfo, r as SourceInfo, b3 as SourceInfo | null)) };
        case "annotations":
          if (!Array.isArray(l) || !Array.isArray(r)) return both;
          return { kind: "merged", bytes: toJson(mergeAnnotations(l as Annotation[], r as Annotation[], Array.isArray(b3) ? (b3 as Annotation[]) : null)) };
        case "readerState":
          return { kind: "merged", bytes: toJson(mergeReaderState(l as ReaderState, r as ReaderState, b3 as ReaderState | null)) };
      }
    }
  } catch {
    return both;
  }
  return both;
}
