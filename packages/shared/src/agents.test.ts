import { describe, expect, it } from "vitest";
import { agentDefaults, agentDefaultsPatch, type CollectionManifest } from "./index.js";

/** What `updateSettings` does with a patch: a shallow merge, written as JSON. */
const apply = (settings: CollectionManifest["settings"], patch: CollectionManifest["settings"]) => JSON.parse(JSON.stringify({ ...settings, ...patch }));

describe("agent defaults", () => {
  it("reads Claude Code's defaults from before other agents", () => {
    const settings = { model: "opus", effort: "high" };
    expect(agentDefaults(settings, "claude-code")).toEqual({ model: "opus", effort: "high" });
    expect(agentDefaults(settings, "codex")).toEqual({});
  });

  it("moves Claude Code's old pair under agents when it changes", () => {
    const settings = { model: "opus", effort: "high" };
    const next = apply(settings, agentDefaultsPatch(settings, "claude-code", { effort: "low" }));
    expect(next).toEqual({ agents: { "claude-code": { model: "opus", effort: "low" } } });
  });

  it("leaves Claude Code's old pair alone when another agent changes", () => {
    const settings = { model: "opus" };
    const next = apply(settings, agentDefaultsPatch(settings, "codex", { model: "gpt-5.5" }));
    expect(next).toEqual({ model: "opus", agents: { codex: { model: "gpt-5.5" } } });
    expect(agentDefaults(next, "claude-code")).toEqual({ model: "opus", effort: undefined });
  });

  it("clears a default back to the agent's own", () => {
    const settings = { agents: { codex: { model: "gpt-5.5", effort: "high" } } };
    const next = apply(settings, agentDefaultsPatch(settings, "codex", { model: undefined }));
    expect(agentDefaults(next, "codex")).toEqual({ effort: "high" });
  });
});
