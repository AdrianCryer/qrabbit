import { describe, expect, it } from "vitest";
import { locateQuote } from "./text.js";

const full = "<!-- page 1 -->\n# Manifold hypothesis\n\nThe **manifold hypothesis** posits that many [high-dimensional](https://x) data sets\nthat occur in the real world actually lie along low-dimensional manifolds.\n";

describe("locateQuote", () => {
  it("trusts offsets that match the quote", () => {
    const start = full.indexOf("posits");
    expect(locateQuote(full, { quote: "posits that many", start, end: start + 16 })).toEqual([start, start + 16]);
  });

  it("falls back to searching the quote when offsets index rendered text", () => {
    const at = locateQuote(full, { quote: "posits that many", start: 3, end: 19 });
    expect(at).not.toBeNull();
    expect(full.slice(at![0], at![1])).toBe("posits that many");
  });

  it("ignores case and whitespace, and the Markdown around a rendered span", () => {
    const at = locateQuote(full, { quote: "Data sets that occur in the real world", start: 0, end: 0 });
    expect(at).not.toBeNull();
    expect(full.slice(at![0], at![1])).toBe("data sets\nthat occur in the real world");
    expect(locateQuote(full, { quote: "not in the text", start: 0, end: 0 })).toBeNull();
  });
});
