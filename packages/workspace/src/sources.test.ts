import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCollection, purgeTrash, readOrder, setOrder, TRASH, trashStamp } from "./collection.js";
import { autoTitleSource, findDuplicate, importFiles, listSources, removeSource, renameSource, restoreSource, saveSourceText, scanFolder, setSourceRead } from "./sources.js";
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

describe("renaming", () => {
  it("changes the title, keeps the id, and survives a later text extraction", () => {
    const dir = collection();
    addSource(dir, "2301-12345", "2026-09-01T00:00:00Z");
    // Extraction normally supplies the document's title in place of the file name, in sentence case.
    expect(saveSourceText(dir, "2301-12345", "<!-- page 1 -->\nbody", 1, { metadata: "Title From The PDF" }).title).toBe("Title from the PDF");
    const renamed = renameSource(dir, "2301-12345", "  Intrinsic   dimension paper ");
    expect(renamed.id).toBe("2301-12345");
    expect(renamed.title).toBe("Intrinsic dimension paper");
    expect(renamed.renamed).toMatch(/^\d{4}-/);
    expect(listSources(dir)[0]?.title).toBe("Intrinsic dimension paper");
    // A re-extraction (or the first one, when renamed from the list before opening) leaves the reader's title alone.
    expect(saveSourceText(dir, "2301-12345", "<!-- page 1 -->\nbody", 1, { metadata: "Title From The PDF" }).title).toBe("Intrinsic dimension paper");
    expect(() => renameSource(dir, "2301-12345", "   ")).toThrow(/empty/);
  });

  it("titles a PDF from the first page when the file name says nothing and the metadata is junk", () => {
    const dir = collection();
    mkdirSync(join(dir, "sources", "2301-12345"), { recursive: true });
    writeFileSync(join(dir, "sources", "2301-12345", "source.pdf"), "%PDF");
    writeFileSync(join(dir, "sources", "2301-12345", "source.json"), JSON.stringify({ id: "2301-12345", kind: "pdf", title: "2301.12345", file: "source.pdf", added: "2026-09-01T00:00:00Z", hasText: false }));
    const text = "<!-- page 1 -->\narXiv:2301.12345v2 [cs.LG] 30 Jan 2023\nIntrinsic Dimension of Learned\nRepresentations in Deep Networks\nAda Okonkwo, Bo Lindqvist\n";
    const saved = saveSourceText(dir, "2301-12345", text, 1, { metadata: "Microsoft Word - final.docx" });
    expect(saved.title).toBe("Intrinsic dimension of learned representations in Deep networks".replace("Deep networks", "deep networks"));
    expect(saved.docTitle).toBe("Intrinsic Dimension of Learned Representations in Deep Networks");
    // A file with a real name keeps it unless the metadata offers a title; the guess is only remembered.
    addSource(dir, "good-name", "2026-09-02T00:00:00Z");
    writeFileSync(join(dir, "sources", "good-name", "source.json"), JSON.stringify({ id: "good-name", kind: "pdf", title: "Attention is all you need", file: "source.md", added: "2026-09-02T00:00:00Z", hasText: false }));
    const kept = saveSourceText(dir, "good-name", "<!-- page 1 -->\nSome Other Heading Here\n", 1, { guess: "Some Other Heading Here" });
    expect(kept.title).toBe("Attention is all you need");
    expect(kept.docTitle).toBe("Some Other Heading Here");
  });

  it("auto-titles from the document on request, in sentence case, and says when it cannot", () => {
    const dir = collection();
    addSource(dir, "pca-note", "2026-09-01T00:00:00Z", "# A Note on PCA and Curved Data\n\nBody.\n");
    writeFileSync(join(dir, "sources", "pca-note", "text.md"), "<!-- page 1 -->\n# A Note on PCA and Curved Data\n\nBody.\n");
    const titled = autoTitleSource(dir, "pca-note");
    expect(titled?.title).toBe("A note on PCA and curved data");
    expect(titled?.renamed).toBeTruthy();
    // A source whose text is not extracted yet, and has no document title, has nothing to offer.
    addSource(dir, "unopened", "2026-09-02T00:00:00Z");
    expect(autoTitleSource(dir, "unopened")).toBeNull();
    // Already right: nothing changes and nothing is stamped.
    const same = autoTitleSource(dir, "pca-note");
    expect(same?.renamed).toBe(titled?.renamed);
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
