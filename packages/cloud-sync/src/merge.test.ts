import { describe, expect, it } from "vitest";
import type { Annotation, CollectionManifest, SourceInfo, Thread } from "@qrabbit/shared";
import { parseThreadFile, serializeThread } from "@qrabbit/workspace";
import { fileKind, mergeAnnotations, mergeFiles, mergeManifest, mergeOrder, mergeReaderState, mergeSource, mergeThreads, sibling } from "./merge.js";

const enc = new TextEncoder();
const dec = new TextDecoder();
const mark = (id: string, text: string, created: string, updated?: string): Annotation => ({ id, kind: "comment", source: "paper", page: 1, text, created, ...(updated ? { updated } : {}) });

describe("file kinds", () => {
  it("tells the collection's files apart", () => {
    expect(fileKind("qrabbit.json")).toBe("manifest");
    expect(fileKind("sources/paper/source.json")).toBe("source");
    expect(fileKind("sources/paper/annotations.json")).toBe("annotations");
    expect(fileKind("sources/paper/source.pdf")).toBe("sourceFile");
    expect(fileKind("threads/2026-09-26-gap.md")).toBe("thread");
    expect(fileKind("threads/2026-09-26-gap/why.md")).toBe("thread");
    expect(fileKind(".qrabbit/reader-state.json")).toBe("readerState");
    expect(fileKind("notes/plan.md")).toBe("other");
  });

  it("names the cloud's copy beside the local file", () => {
    expect(sibling("notes/plan.md")).toBe("notes/plan (from cloud).md");
    expect(sibling("AGENTS.md")).toBe("AGENTS (from cloud).md");
    expect(sibling("sources/p/.hidden")).toBe("sources/p/.hidden (from cloud)");
  });
});

describe("reading order", () => {
  it("keeps the local order and appends what the cloud added", () => {
    expect(mergeOrder(["a", "c", "b"], ["a", "b", "d"], ["a", "b"])).toEqual(["a", "c", "b", "d"]);
  });
  it("drops what the cloud removed and does not resurrect what was removed here", () => {
    expect(mergeOrder(["a", "b"], ["b", "c"], ["a", "b", "c"])).toEqual(["b"]);
  });
  it("without a base, keeps everything", () => {
    expect(mergeOrder(["b", "a"], ["a", "c"], null)).toEqual(["b", "a", "c"]);
  });
});

describe("manifest", () => {
  it("takes the cloud's settings where this machine changed nothing", () => {
    const base: CollectionManifest = { id: "col_1", name: "Papers", created: "2026-09-01", settings: { model: "sonnet" }, order: ["a"] };
    const local: CollectionManifest = { ...base, order: ["a", "b"] };
    const remote: CollectionManifest = { ...base, name: "Papers 2026", settings: { model: "opus", effort: "high" } };
    expect(mergeManifest(local, remote, base)).toEqual({ id: "col_1", name: "Papers 2026", created: "2026-09-01", settings: { model: "opus", effort: "high" }, order: ["a", "b"] });
  });
  it("keeps this machine's choice when both changed the same setting", () => {
    const base: CollectionManifest = { id: "col_1", name: "P", created: "x", settings: { model: "sonnet" } };
    const local = { ...base, settings: { model: "haiku" } };
    const remote = { ...base, settings: { model: "opus" } };
    expect(mergeManifest(local, remote, base).settings).toEqual({ model: "haiku" });
  });
  it("merges each agent's defaults on their own", () => {
    const base: CollectionManifest = { id: "col_1", name: "P", created: "x", settings: { agents: { "claude-code": { model: "sonnet" } } } };
    const local = { ...base, settings: { agents: { "claude-code": { model: "opus", effort: "high" } } } };
    const remote = { ...base, settings: { agents: { "claude-code": { model: "sonnet" }, codex: { model: "gpt-5.5" } } } };
    expect(mergeManifest(local, remote, base).settings).toEqual({ agents: { "claude-code": { model: "opus", effort: "high" }, codex: { model: "gpt-5.5" } } });
  });
  it("drops an agent's default that this machine cleared", () => {
    const base: CollectionManifest = { id: "col_1", name: "P", created: "x", settings: { agents: { codex: { model: "gpt-5.5" } } } };
    const local = { ...base, settings: { agents: { codex: {} } } };
    expect(mergeManifest(local, base, base).settings).toEqual({});
  });
});

describe("source.json", () => {
  const base: SourceInfo = { id: "paper", kind: "pdf", title: "paper", file: "source.pdf", added: "2026-09-01T00:00:00Z", hasText: true };
  it("merges a rename here with a read mark there", () => {
    const local = { ...base, title: "The paper", renamed: "2026-09-02T00:00:00Z" };
    const remote = { ...base, read: "2026-09-03T00:00:00Z" };
    expect(mergeSource(local, remote, base)).toEqual({ ...base, title: "The paper", renamed: "2026-09-02T00:00:00Z", read: "2026-09-03T00:00:00Z" });
  });
  it("without a base, the later rename wins and a read mark sticks", () => {
    const local = { ...base, title: "Old name", renamed: "2026-09-02T00:00:00Z" };
    const remote = { ...base, title: "New name", renamed: "2026-09-05T00:00:00Z", read: "2026-09-04T00:00:00Z" };
    const out = mergeSource(local, remote, null);
    expect(out.title).toBe("New name");
    expect(out.read).toBe("2026-09-04T00:00:00Z");
  });
  it("respects an unread mark made here after the cloud saw it read", () => {
    const wasRead = { ...base, read: "2026-09-03T00:00:00Z" };
    const local = { ...base };
    expect(mergeSource(local, wasRead, wasRead).read).toBeUndefined();
  });
});

describe("annotations", () => {
  it("unions marks added on both machines and takes the later edit of a shared one", () => {
    const base = [mark("cmt_1", "first", "2026-09-01T00:00:00Z")];
    const local = [mark("cmt_1", "first, edited here", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"), mark("cmt_2", "mine", "2026-09-02T00:00:00Z")];
    const remote = [mark("cmt_1", "first, edited there", "2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z"), mark("cmt_3", "theirs", "2026-09-03T00:00:00Z")];
    const out = mergeAnnotations(local, remote, base);
    expect(out.map((a) => a.id)).toEqual(["cmt_1", "cmt_2", "cmt_3"]);
    expect(out[0]?.text).toBe("first, edited there");
  });
  it("lets a deletion stand unless the other machine changed the mark", () => {
    const base = [mark("cmt_1", "a", "2026-09-01T00:00:00Z"), mark("cmt_2", "b", "2026-09-01T00:00:00Z")];
    const local = [mark("cmt_2", "b, edited", "2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z")];
    const remote = [mark("cmt_1", "a", "2026-09-01T00:00:00Z")];
    expect(mergeAnnotations(local, remote, base).map((a) => a.id)).toEqual(["cmt_2"]);
  });
  it("without a base, keeps everything", () => {
    expect(mergeAnnotations([mark("cmt_1", "a", "2026-09-01T00:00:00Z")], [mark("cmt_2", "b", "2026-09-01T00:00:00Z")], null).map((a) => a.id)).toEqual(["cmt_1", "cmt_2"]);
  });
});

describe("reading positions", () => {
  it("follows the other machine where this one has not moved", () => {
    const base = { paper: { page: 10, scrollTop: 0, zoom: 1 } };
    const local = { paper: { page: 10, scrollTop: 0, zoom: 1 }, other: { page: 3, scrollTop: 0, zoom: 1 } };
    const remote = { paper: { page: 30, scrollTop: 100, zoom: 1 } };
    expect(mergeReaderState(local, remote, base)).toEqual({ paper: { page: 30, scrollTop: 100, zoom: 1 }, other: { page: 3, scrollTop: 0, zoom: 1 } });
  });
});

describe("threads", () => {
  const thread = (messages: Thread["messages"], extra: Partial<Thread> = {}): string =>
    serializeThread({ id: "thr_1", title: "The gap", created: "2026-09-26T10:00:00Z", hue: 2, file: "threads/gap.md", messageCount: messages.length, messages, ...extra });
  const msg = (id: string, role: "user" | "assistant", at: string, body: string) => ({ id, role, at, body });

  it("interleaves messages from both machines and takes a summary the other wrote", () => {
    const first = msg("msg_1", "user", "2026-09-26T10:00:00Z", "Why does the gap widen?");
    const base = thread([first]);
    const local = thread([first, msg("msg_2", "assistant", "2026-09-26T10:01:00Z", "Because…")]);
    const remote = thread([first, msg("msg_3", "user", "2026-09-26T10:05:00Z", "And in table 2?")], { summary: { at: "2026-09-26T10:06:00Z", through: "msg_3", text: "The gap", concepts: ["gap"] } });
    const out = mergeThreads("threads/gap.md", local, remote, base);
    expect(out).not.toBeNull();
    const merged = parseThreadFile(out!, "threads/gap.md");
    expect(merged.messages.map((m) => m.id)).toEqual(["msg_1", "msg_2", "msg_3"]);
    expect(merged.summary?.text).toBe("The gap");
    expect(merged.messageCount).toBe(3);
  });

  it("keeps both when a side is not a thread file", () => {
    expect(mergeFiles({ path: "threads/gap.md", local: enc.encode("not a thread"), remote: enc.encode(thread([])), base: null })).toEqual({ kind: "both" });
  });
});

describe("dispatch", () => {
  it("passes identical bytes through and keeps both for unknown formats", () => {
    const a = enc.encode("same");
    expect(mergeFiles({ path: "notes/x.md", local: a, remote: enc.encode("same"), base: null })).toEqual({ kind: "merged", bytes: a });
    expect(mergeFiles({ path: "notes/x.md", local: a, remote: enc.encode("other"), base: null })).toEqual({ kind: "both" });
    expect(mergeFiles({ path: "sources/p/source.pdf", local: a, remote: enc.encode("other"), base: null })).toEqual({ kind: "both" });
  });
  it("merges JSON files and keeps both when one does not parse", () => {
    const local = enc.encode(JSON.stringify([mark("cmt_1", "a", "2026-09-01T00:00:00Z")]));
    const remote = enc.encode(JSON.stringify([mark("cmt_2", "b", "2026-09-01T00:00:00Z")]));
    const out = mergeFiles({ path: "sources/p/annotations.json", local, remote, base: null });
    expect(out.kind).toBe("merged");
    expect((JSON.parse(dec.decode((out as { bytes: Uint8Array }).bytes)) as Annotation[]).map((a) => a.id)).toEqual(["cmt_1", "cmt_2"]);
    expect(mergeFiles({ path: "sources/p/annotations.json", local, remote: enc.encode("{broken"), base: null })).toEqual({ kind: "both" });
  });
});
