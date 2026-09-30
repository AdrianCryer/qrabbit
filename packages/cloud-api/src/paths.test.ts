import { describe, expect, it } from "vitest";
import { isSyncedPath, PATH_FIXTURES, syncPathProblem } from "./paths.js";

describe("sync paths", () => {
  it("accepts every path a collection folder produces", () => {
    for (const p of PATH_FIXTURES.ok) expect(syncPathProblem(p), p).toBeNull();
  });

  it("rejects what other file systems cannot write and what stays local", () => {
    for (const p of PATH_FIXTURES.bad) expect(syncPathProblem(p), JSON.stringify(p)).not.toBeNull();
  });

  it("keeps app state local apart from the reading positions", () => {
    expect(isSyncedPath(".qrabbit/reader-state.json")).toBe(true);
    expect(isSyncedPath(".qrabbit/index.sqlite")).toBe(false);
    expect(isSyncedPath(".qrabbit/trash/x/source.pdf")).toBe(false);
    expect(isSyncedPath("sources/paper/source.pdf")).toBe(true);
    expect(isSyncedPath("sources/paper/source.json.4242.tmp")).toBe(false);
  });

  it("rejects things that are not strings", () => {
    expect(syncPathProblem(null)).toBe("empty path");
    expect(syncPathProblem(42)).toBe("empty path");
  });
});
