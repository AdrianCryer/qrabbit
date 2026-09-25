import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCollection } from "./collection.js";
import { addAnnotation, deleteAnnotation, listAnnotations, updateAnnotation } from "./annotations.js";

describe("annotations", () => {
  it("stores comments and bookmarks per source and lists them across the collection", () => {
    const dir = mkdtempSync(join(tmpdir(), "qrabbit-"));
    initCollection(dir, "Test");
    for (const id of ["paper-a", "paper-b"]) {
      mkdirSync(join(dir, "sources", id), { recursive: true });
      writeFileSync(join(dir, "sources", id, "source.json"), JSON.stringify({ id, kind: "pdf", title: id, file: "source.pdf", added: "2026-09-26T00:00:00Z", hasText: false }));
    }
    const c = addAnnotation(dir, { kind: "comment", source: "paper-a", page: 3, text: "Check this against Table 2", anchor: { target: "source", source: "paper-a", page: 3, quote: "the gap widens", prefix: "", suffix: "", start: 10, end: 24 } });
    const b = addAnnotation(dir, { kind: "bookmark", source: "paper-b", page: 7, text: "Page 7" });
    expect(c.id.startsWith("cmt_")).toBe(true);
    expect(b.id.startsWith("bmk_")).toBe(true);

    const all = listAnnotations(dir);
    expect(all.map((a) => a.id).sort()).toEqual([b.id, c.id].sort());
    expect(all.find((a) => a.id === c.id)?.source).toBe("paper-a");

    const edited = updateAnnotation(dir, c.id, { text: "Compare with Table 2" });
    expect(edited.text).toBe("Compare with Table 2");
    expect(edited.updated).toBeTruthy();

    expect(deleteAnnotation(dir, b.id)).toBe(true);
    expect(deleteAnnotation(dir, b.id)).toBe(false);
    expect(listAnnotations(dir).map((a) => a.id)).toEqual([c.id]);
  });
});
