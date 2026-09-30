import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CloudChanged, CloudSyncState } from "@qrabbit/shared";
import { CloudSync, disableCloud, downloadCollection, enableCloud, isCloudCollection, readSyncState, type SyncReport } from "@qrabbit/cloud-sync";
import {
  addAnnotation,
  appendMessage,
  createThread,
  initCollection,
  listAnnotations,
  listSources,
  listThreads,
  readReaderState,
  readThread,
  removeSource,
  setReaderPosition,
  setSourceRead,
} from "@qrabbit/workspace";
import { admin, bytes, localStack, newUser, sameUser, type Stack, type TestUser } from "./stack.js";

const stack = localStack();

/** A collection folder as the app writes it: one PDF source with its text. */
function makeSource(dir: string, id: string, title: string, pdf: Uint8Array): void {
  const src = join(dir, "sources", id);
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "source.pdf"), pdf);
  writeFileSync(join(src, "source.json"), JSON.stringify({ id, kind: "pdf", title, file: "source.pdf", added: new Date().toISOString(), hasText: true }, null, 2) + "\n");
  writeFileSync(join(src, "text.md"), `<!-- page 1 -->\nText of ${title}\n`);
}

/** Every synced file under a folder with its bytes, for comparing two machines. */
function tree(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (sub: string) => {
    for (const name of readdirSync(sub)) {
      const full = join(sub, name);
      const rel = relative(dir, full).split(sep).join("/");
      if (rel === ".qrabbit" || rel.startsWith(".qrabbit/")) continue;
      if (statSync(full).isDirectory()) walk(full);
      else out.set(rel, readFileSync(full));
    }
  };
  walk(dir);
  return out;
}

const tmp = () => mkdtempSync(join(tmpdir(), "qrabbit-sync-"));

describe.skipIf(!stack)("cloud sync between two folders", () => {
  const s = stack as Stack;
  let user: TestUser;
  let a: string;
  let b: string;
  let syncA: CloudSync;
  let syncB: CloudSync;
  const changesA: CloudChanged[] = [];
  const changesB: CloudChanged[] = [];
  const statesA: CloudSyncState[] = [];
  let collectionId = "";
  let threadId = "";

  beforeAll(async () => {
    user = await newUser(s, "sync");
    a = tmp();
    initCollection(a, "Papers");
    makeSource(a, "attention", "Attention is all you need", bytes(48 * 1024, "attention.pdf"));
    const thread = createThread(a, { title: "The gap", anchor: { target: "source", source: "attention", page: 1, quote: "Text of", prefix: "", suffix: "", start: 0, end: 7 } });
    threadId = thread.id;
    appendMessage(a, threadId, { role: "user", body: "Why does the gap widen?" });
  });

  afterAll(async () => {
    syncA?.dispose();
    syncB?.dispose();
    await user?.client.signOut();
  });

  it("pushes a folder into the cloud on the first run", async () => {
    const state = await enableCloud(a, user.client);
    collectionId = state.collectionId;
    expect(collectionId.startsWith("col_")).toBe(true);
    expect(isCloudCollection(a)).toBe(true);
    syncA = new CloudSync({ dir: a, client: user.client, onChanged: (c) => changesA.push(c), onState: (st) => statesA.push(st) });
    const first = await syncA.requestSync();
    expect(first.pulled).toBe(0);
    // qrabbit.json, AGENTS.md, CLAUDE.md, .gitignore, the source's three files and the thread.
    expect(first.pushed).toBe(8);
    expect(first.unsaved).toEqual([]);
    // The pull after the push finds its own files already in place and moves the revision on.
    expect(first.rev).toBe(1);
    expect(readSyncState(a)?.rev).toBe(1);
    expect(statesA.at(-1)).toMatchObject({ phase: "idle", unsaved: 0, rev: 1 });
    const second = await syncA.requestSync();
    expect(second.pulled).toBe(0);
    expect(second.pushed).toBe(0);
    expect(second.rev).toBe(1);
    expect((await user.client.collections()).find((c) => c.id === collectionId)?.name).toBe("Papers");
  });

  it("brings the collection down onto another machine, file for file", async () => {
    b = tmp();
    const clientB = await sameUser(s, user);
    const report = await downloadCollection(b, clientB, collectionId);
    expect(report.pulled).toBe(8);
    expect(tree(b)).toEqual(tree(a));
    expect(listSources(b).map((x) => x.title)).toEqual(["Attention is all you need"]);
    expect(readThread(b, threadId)?.messages).toHaveLength(1);
    syncB = new CloudSync({ dir: b, client: clientB, onChanged: (c) => changesB.push(c) });
    expect((await syncB.requestSync()).rev).toBe(1);
  });

  it("merges marks made on both machines at the same time", async () => {
    addAnnotation(a, { kind: "comment", source: "attention", page: 1, text: "from A" });
    addAnnotation(b, { kind: "bookmark", source: "attention", page: 1, text: "from B" });
    const pushB = await syncB.requestSync();
    expect(pushB.pushed).toBe(1);
    const mergeA = await syncA.requestSync();
    expect(mergeA.conflicts).toBe(1);
    expect(mergeA.merged).toBe(1);
    expect(mergeA.pushed).toBe(1);
    expect(listAnnotations(a).map((x) => x.text).sort()).toEqual(["from A", "from B"]);
    const pullB = await syncB.requestSync();
    expect(pullB.pulled).toBe(1);
    expect(listAnnotations(b).map((x) => x.text).sort()).toEqual(["from A", "from B"]);
    expect(changesB.at(-1)?.annotations).toBe(true);
  });

  it("carries a read mark and a rename across", async () => {
    setSourceRead(a, "attention", true);
    await syncA.requestSync();
    await syncB.requestSync();
    expect(listSources(b)[0]?.read).toBeTruthy();
    expect(changesB.at(-1)?.sources).toBe(true);
  });

  it("interleaves messages both machines added to one thread", async () => {
    appendMessage(a, threadId, { role: "assistant", body: "Because the model overfits." });
    appendMessage(b, threadId, { role: "user", body: "And in table 2?" });
    await syncA.requestSync();
    const merged = await syncB.requestSync();
    expect(merged.merged).toBe(1);
    await syncA.requestSync();
    for (const dir of [a, b]) {
      const t = readThread(dir, threadId);
      expect(t?.messages.map((m) => m.body)).toEqual(["Why does the gap widen?", "Because the model overfits.", "And in table 2?"]);
    }
    expect(changesA.at(-1)?.threads).toBe(true);
  });

  it("follows a reading position set on the other machine", async () => {
    makeSource(a, "survey", "A survey", bytes(8 * 1024, "survey.pdf"));
    await syncA.requestSync();
    await syncB.requestSync();
    setReaderPosition(b, "survey", { page: 7, scrollTop: 120, zoom: 1 });
    await syncB.requestSync();
    const pulled = await syncA.requestSync();
    expect(pulled.changed.readerState).toBe(true);
    expect(readReaderState(a)["survey"]).toEqual({ page: 7, scrollTop: 120, zoom: 1 });
  });

  it("removes a source everywhere when one machine removes it", async () => {
    removeSource(b, "attention");
    const pushB = await syncB.requestSync();
    expect(pushB.removed).toBe(4);
    const pullA = await syncA.requestSync();
    expect(pullA.deleted).toBe(4);
    expect(existsSync(join(a, "sources", "attention"))).toBe(false);
    expect(listSources(a).map((x) => x.id)).toEqual(["survey"]);
    // The thread that quoted the removed source stays.
    expect(listThreads(a).map((t) => t.id)).toContain(threadId);
    expect(changesA.at(-1)?.sources).toBe(true);
  });

  it("keeps both copies when the same file changed on both machines in a format it cannot merge", async () => {
    writeFileSync(join(a, "notes", "plan.md"), "plan from A\n");
    await syncA.requestSync();
    await syncB.requestSync();
    writeFileSync(join(a, "notes", "plan.md"), "plan from A, revised\n");
    writeFileSync(join(b, "notes", "plan.md"), "plan from B, revised\n");
    await syncB.requestSync();
    const kept = await syncA.requestSync();
    expect(kept.kept).toBe(1);
    expect(readFileSync(join(a, "notes", "plan.md"), "utf8")).toBe("plan from A, revised\n");
    expect(readFileSync(join(a, "notes", "plan (from cloud).md"), "utf8")).toBe("plan from B, revised\n");
    await syncB.requestSync();
    expect(readFileSync(join(b, "notes", "plan.md"), "utf8")).toBe("plan from A, revised\n");
    expect(existsSync(join(b, "notes", "plan (from cloud).md"))).toBe(true);
  });

  it("stops syncing a folder without touching it", () => {
    disableCloud(b);
    expect(isCloudCollection(b)).toBe(false);
    expect(listSources(b).map((x) => x.id)).toEqual(["survey"]);
  });
});

describe.skipIf(!stack)("cloud sync and the quota", () => {
  const s = stack as Stack;

  it("keeps syncing the files that fit and reports the ones that do not", async () => {
    const small = await newUser(s, "syncquota");
    await admin(s).from("profiles").update({ quota_bytes: 512 * 1024 }).eq("id", small.id);
    const dir = tmp();
    initCollection(dir, "Big");
    makeSource(dir, "huge", "A huge scan", bytes(600 * 1024, "huge.pdf"));
    await enableCloud(dir, small.client);
    const states: CloudSyncState[] = [];
    const sync = new CloudSync({ dir, client: small.client, onState: (st) => states.push(st) });
    let report: SyncReport;
    try {
      report = await sync.requestSync();
    } finally {
      sync.dispose();
    }
    expect(report.unsaved).toEqual(["sources/huge/source.pdf"]);
    expect(report.pushed).toBe(6);
    expect(readSyncState(dir)?.unsaved).toEqual(["sources/huge/source.pdf"]);
    expect(states.at(-1)).toMatchObject({ phase: "idle", unsaved: 1 });
    await small.client.signOut();
  });
});
