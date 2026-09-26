import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCollection, purgeTrash, readOrder, setOrder, TRASH, trashStamp } from "./collection.js";
import { findDuplicate, importFiles, listSources, removeSource, restoreSource, scanFolder, setSourceRead } from "./sources.js";
import { readJson } from "./fs.js";

function collection(): string {
  const dir = mkdtempSync(join(tmpdir(), "qrabbit-"));
  initCollection(dir, "Test");
  return dir;
}

function addSource(dir: string, id: string, added: string, content = `# ${id}\n`): void {
  mkdirSync(join(dir, "sources", id), { recursive: true });
  writeFileSync(join(dir, "sources", id, "source.md"), content);
  writeFileSync(join(dir, "sources", id, "source.json"), JSON.stringify({ id, kind: "markdown", title: id, file: "source.md", added, hasText: false }));
}

describe("reading order", () => {
  it("lists unlisted sources oldest first, and listed ones in the manifest's order before them", () => {
    const dir = collection();
    addSource(dir, "b", "2026-09-02T00:00:00Z");
    addSource(dir, "a", "2026-09-01T00:00:00Z");
    addSource(dir, "c", "2026-09-03T00:00:00Z");
    expect(listSources(dir).map((s) => s.id)).toEqual(["a", "b", "c"]);

    setOrder(dir, ["c", "gone", "a", "c"]);
    expect(readOrder(dir)).toEqual(["c", "gone", "a"]);
    expect(listSources(dir).map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});

describe("importing files", () => {
  it("copies files, skips content already in the collection, and appends to the order", () => {
    const dir = collection();
    addSource(dir, "old", "2026-09-01T00:00:00Z");
    const src = mkdtempSync(join(tmpdir(), "qrabbit-src-"));
    writeFileSync(join(src, "paper.md"), "# Paper\n\nA paragraph.\n");
    writeFileSync(join(src, "copy of paper.md"), "# Paper\n\nA paragraph.\n");
    writeFileSync(join(src, "notes.txt"), "plain notes\n");
    writeFileSync(join(src, "figure.png"), "not a source");

    const first = importFiles(dir, [join(src, "paper.md"), join(src, "figure.png")]);
    expect(first.added.map((s) => s.title)).toEqual(["paper"]);
    expect(first.failed).toEqual([join(src, "figure.png")]);
    expect(first.added[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const second = importFiles(dir, [join(src, "copy of paper.md"), join(src, "notes.txt")]);
    expect(second.added.map((s) => s.title)).toEqual(["notes"]);
    expect(second.existing.map((s) => s.id)).toEqual(["paper"]);
    expect(findDuplicate(dir, join(src, "notes.txt"))?.id).toBe("notes");
    expect(findDuplicate(dir, join(src, "figure.png"))).toBeNull();

    // The order now names every source: the one that predates ordering first, then the imports in sequence.
    expect(readOrder(dir)).toEqual(["old", "paper", "notes"]);
    expect(listSources(dir).map((s) => s.id)).toEqual(["old", "paper", "notes"]);
    // A hand-made source's hash is filled in when a comparison needs it.
    expect(readJson<{ sha256?: string }>(join(dir, "sources", "old", "source.json"))?.sha256).toBeUndefined();
  });
});

describe("read marks", () => {
  it("records a date when marked read and drops it when marked unread", () => {
    const dir = collection();
    addSource(dir, "a", "2026-09-01T00:00:00Z");
    const marked = setSourceRead(dir, "a", true);
    expect(marked.read).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(readJson<{ read?: string }>(join(dir, "sources", "a", "source.json"))?.read).toBe(marked.read);
    const cleared = setSourceRead(dir, "a", false);
    expect(cleared.read).toBeUndefined();
    expect("read" in (readJson<object>(join(dir, "sources", "a", "source.json")) ?? {})).toBe(false);
  });
});

describe("removing", () => {
  it("moves the folder to the trash, keeps the order tidy, and restores at the old position", () => {
    const dir = collection();
    addSource(dir, "a", "2026-09-01T00:00:00Z");
    addSource(dir, "b", "2026-09-02T00:00:00Z");
    addSource(dir, "c", "2026-09-03T00:00:00Z");
    writeFileSync(join(dir, "sources", "b", "annotations.json"), "[]");

    const removed = removeSource(dir, "b");
    expect(removed.index).toBe(1);
    expect(existsSync(join(dir, "sources", "b"))).toBe(false);
    expect(existsSync(join(removed.trashPath, "annotations.json"))).toBe(true);
    expect(listSources(dir).map((s) => s.id)).toEqual(["a", "c"]);
    expect(readOrder(dir)).toEqual(["a", "c"]);

    const back = restoreSource(dir, removed);
    expect(back.id).toBe("b");
    expect(listSources(dir).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(existsSync(join(dir, "sources", "b", "annotations.json"))).toBe(true);
    expect(readdirSync(join(dir, TRASH))).toEqual([]);

    expect(() => restoreSource(dir, { id: "x", trashPath: join(dir, "sources", "a"), index: 0 })).toThrow(/Not a removed source/);
  });

  it("purges trash older than a week and keeps newer entries", () => {
    const dir = collection();
    const old = join(dir, TRASH, trashStamp(new Date(Date.now() - 8 * 86_400_000)), "old-one");
    const fresh = join(dir, TRASH, trashStamp(new Date(Date.now() - 86_400_000)), "fresh-one");
    mkdirSync(old, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    writeFileSync(join(dir, TRASH, "not-a-stamp"), "");
    const gone = purgeTrash(dir);
    expect(gone).toHaveLength(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(join(dir, TRASH, "not-a-stamp"))).toBe(true);
  });

  it("adds the trash to a collection's existing .gitignore once", () => {
    const dir = collection();
    const text = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(text.split("\n")).toContain(`${TRASH}/`);
    initCollection(dir);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(text);
  });
});

describe("scanning a folder", () => {
  it("lists eligible files root first, flags duplicates by content, and can leave subfolders out", () => {
    const dir = collection();
    const src = mkdtempSync(join(tmpdir(), "qrabbit-scan-"));
    writeFileSync(join(src, "z-root.pdf"), "%PDF-1.4 fake");
    writeFileSync(join(src, "a-root.md"), "# A\n");
    writeFileSync(join(src, "image.png"), "png");
    mkdirSync(join(src, "notes"));
    writeFileSync(join(src, "notes", "n.txt"), "notes");
    mkdirSync(join(src, ".hidden"));
    writeFileSync(join(src, ".hidden", "secret.md"), "# hidden\n");
    mkdirSync(join(src, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(src, "node_modules", "pkg", "README.md"), "# pkg\n");
    // the collection already holds the content of a-root.md, under a different name
    importFiles(dir, [join(src, "a-root.md")]);

    const full = scanFolder(dir, src, { recursive: true });
    expect(full.files.map((f) => f.rel)).toEqual(["a-root.md", "z-root.pdf", "notes/n.txt"]);
    expect(full.files[0]!.existing).toEqual({ id: "a-root", title: "a-root" });
    expect(full.files[1]!.existing).toBeUndefined();
    expect(full.files.map((f) => f.kind)).toEqual(["markdown", "pdf", "markdown"]);
    expect(full.skipped).toBe(1);
    expect(full.truncated).toBe(false);

    const flat = scanFolder(dir, src, { recursive: false });
    expect(flat.files.map((f) => f.rel)).toEqual(["a-root.md", "z-root.pdf"]);

    const capped = scanFolder(dir, src, { recursive: true, limit: 2 });
    expect(capped.files).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });
});
