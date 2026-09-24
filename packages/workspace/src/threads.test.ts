import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initCollection } from "./collection.js";
import { appendMessage, createThread, listThreads, parseThreadFile, readThread, serializeThread } from "./threads.js";

describe("thread files", () => {
  it("round-trips frontmatter, anchors and messages", () => {
    const dir = mkdtempSync(join(tmpdir(), "qrabbit-"));
    initCollection(dir, "Test");
    const t = createThread(dir, {
      title: "low-dimensional manifold",
      anchor: { target: "source", source: "paper", page: 4, quote: "lies on a low-dimensional manifold", prefix: "representation ", suffix: " embedded", start: 120, end: 154 },
    });
    appendMessage(dir, t.id, {
      role: "user",
      body: "What does this mean concretely?",
      quote: { target: "source", source: "paper", page: 4, quote: "lies on a low-dimensional manifold", prefix: "representation ", suffix: " embedded", start: 120, end: 154 },
    });
    appendMessage(dir, t.id, { role: "assistant", body: "It is a claim about the activations.\n\n$$k \\ll d$$", context: ["thr_child"] });

    const back = readThread(dir, t.id)!;
    expect(back.title).toBe("low-dimensional manifold");
    expect(back.anchor?.page).toBe(4);
    expect(back.messages).toHaveLength(2);
    expect(back.messages[0]!.quote?.quote).toBe("lies on a low-dimensional manifold");
    expect(back.messages[1]!.body).toContain("$$k \\ll d$$");
    expect(back.messages[1]!.context).toEqual(["thr_child"]);
    expect(listThreads(dir)[0]!.messageCount).toBe(2);

    // serialise → parse is stable
    const text = serializeThread(back);
    const again = parseThreadFile(text, back.file);
    expect(serializeThread(again)).toBe(text);
  });

  it("nests branch files under the parent's folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "qrabbit-"));
    initCollection(dir, "Test");
    const root = createThread(dir, { title: "root" });
    const child = createThread(dir, { title: "child", parent: { thread: root.id, message: "msg_x" } });
    expect(child.file.startsWith(root.file.replace(/\.md$/, "") + "/")).toBe(true);
    expect(child.hue).not.toBe(root.hue);
  });
});
