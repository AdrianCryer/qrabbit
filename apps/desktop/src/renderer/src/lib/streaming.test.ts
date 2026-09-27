import { describe, expect, it } from "vitest";
import { completeForDisplay, nextRevealEnd, revealBudget, splitBlocks, wrapWords } from "./streaming";

/** Reveal `text` unit by unit and collect what each step shows. */
function steps(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const next = nextRevealEnd(text, i);
    if (next === i) break;
    i = next;
    out.push(text.slice(0, i));
  }
  return out;
}

describe("nextRevealEnd", () => {
  it("reveals a word at a time, whitespace included with the next word", () => {
    expect(steps("It is the sum")).toEqual(["It", "It is", "It is the", "It is the sum"]);
  });

  it("reveals a formula whole, and waits while it is unfinished", () => {
    const done = "Take $r_0 + \\gamma r_1$ and";
    expect(steps(done)).toContain("Take $r_0 + \\gamma r_1$");
    expect(steps(done).some((s) => s.endsWith("$r_0"))).toBe(false);
    const open = "so\n\n$$\nV(s) = r";
    expect(nextRevealEnd(open, 2)).toBe(2);
    expect(nextRevealEnd("so\n\n$$\nV(s) = r\n$$\n\nNext", 2)).toBe("so\n\n$$\nV(s) = r\n$$".length);
  });

  it("treats a lone dollar before a line break as text", () => {
    expect(nextRevealEnd("costs $5\nmore", 5)).toBe(7);
  });

  it("reveals a code fence line whole", () => {
    expect(nextRevealEnd("```python\nx = 1", 0)).toBe("```python\n".length);
    expect(nextRevealEnd("```pyth", 0)).toBe(0);
  });
});

describe("completeForDisplay", () => {
  it("closes an open code fence, bold and inline code", () => {
    expect(completeForDisplay("```python\nx = 1")).toBe("```python\nx = 1\n```");
    expect(completeForDisplay("the **manifold")).toBe("the **manifold**");
    expect(completeForDisplay("use `torch")).toBe("use `torch`");
    expect(completeForDisplay("the **manifold** hypothesis")).toBe("the **manifold** hypothesis");
  });

  it("holds back a half-written link", () => {
    expect(completeForDisplay("see [dimensionality red")).toBe("see ");
    expect(completeForDisplay("see [it](https://exa")).toBe("see ");
    expect(completeForDisplay("see [it](https://example.org) now")).toBe("see [it](https://example.org) now");
  });
});

describe("splitBlocks", () => {
  it("splits at blank lines but not inside fences or display maths", () => {
    const md = "First para.\n\n$$\na\n\nb\n$$\n\n```\nx\n\ny\n```\n\nLast.";
    expect(splitBlocks(md)).toEqual(["First para.", "$$\na\n\nb\n$$", "```\nx\n\ny\n```", "Last."]);
  });

  it("keeps an indented continuation with its list item", () => {
    expect(splitBlocks("- item\n\n    more of the item\n\nNext")).toEqual(["- item\n\n    more of the item", "Next"]);
  });
});

describe("wrapWords", () => {
  const tree = () => ({
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        children: [
          { type: "text", value: "It is " },
          { type: "element", tagName: "strong", children: [{ type: "text", value: "the sum" }] },
          { type: "text", value: " of " },
          { type: "element", tagName: "code", properties: { className: ["language-math", "math-inline"] }, children: [{ type: "text", value: "r_0 + r_1" }] },
          { type: "text", value: " rewards" },
        ],
      },
    ],
  });
  const words = (node: { tagName?: string; properties?: Record<string, unknown>; children?: unknown[] }, out: string[] = []): string[] => {
    for (const c of (node.children ?? []) as Array<{ tagName?: string; properties?: Record<string, unknown>; children?: unknown[]; value?: string }>) {
      if (c.tagName === "span") out.push(`${(c.properties?.["className"] as string[]).join(".")}:${(c.children as Array<{ value: string }>)[0]!.value}`);
      else words(c, out);
    }
    return out;
  };

  it("wraps words in reading order, marks those from fadeFrom as fresh, and leaves maths whole", () => {
    const t = tree();
    expect(wrapWords(t, 3)).toBe(6);
    expect(words(t)).toEqual(["w:It", "w:is", "w:the", "w.fresh:sum", "w.fresh:of", "w.fresh:rewards"]);
    const math = (t.children[0]!.children as Array<{ tagName?: string; children?: Array<{ value?: string }> }>).find((c) => c.tagName === "code")!;
    expect(math.children![0]!.value).toBe("r_0 + r_1");
  });
});

describe("revealBudget", () => {
  it("never drops below reading pace and speeds up with a backlog", () => {
    expect(revealBudget(0, 1)).toBe(60);
    expect(revealBudget(400, 1)).toBe(500);
  });
});
