import { join } from "node:path";
import { app } from "electron";
import { DEFAULT_AGENT, isAgentId, type AgentId } from "@qrabbit/shared";
import { readJson, writeJson } from "@qrabbit/workspace";

/**
 * Preferences that belong to this computer rather than to a collection. The agent is one: its sign-in
 * lives on the machine, while a collection's manifest travels to other computers through the cloud.
 */
type Prefs = { agent?: AgentId };

const file = () => join(app.getPath("userData"), "preferences.json");

function read(): Prefs {
  return readJson<Prefs>(file()) ?? {};
}

export function chosenAgent(): AgentId {
  const id = read().agent;
  return isAgentId(id) ? id : DEFAULT_AGENT;
}

/** Whether a reader has chosen an agent on this computer yet; until then the app asks. */
export function agentChosen(): boolean {
  return isAgentId(read().agent);
}

export function chooseAgent(id: AgentId): void {
  writeJson(file(), { ...read(), agent: id });
}
