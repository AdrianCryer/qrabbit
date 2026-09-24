import type * as acp from "@agentclientprotocol/sdk";

/** How to start an agent process. Mirrors the shape used by the ACP registry. */
export type AgentLaunch = {
  /** Absolute path of the executable (usually `process.execPath` for Node-based adapters). */
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Working directory for the agent process. Sessions set their own `cwd` separately. */
  cwd?: string;
};

/** What the client tells the agent about itself. */
export type ClientIdentity = {
  name: string;
  title?: string;
  version?: string;
};

/**
 * Auth identity pushed by the Claude adapter on `_auth/status_update`.
 * Interim `_meta` extension; the payload is opaque beyond `kind` and `label`.
 */
export type AuthStatus = {
  kind: string;
  label: string;
  [key: string]: unknown;
};

/** Decision for a `session/request_permission` call. */
export type PermissionDecision =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

export type PermissionHandler = (
  request: acp.RequestPermissionRequest,
) => Promise<PermissionDecision> | PermissionDecision;

/** File-system requests the agent may route through the client when `fs` capabilities are advertised. */
export type FsHandlers = {
  readTextFile: (params: acp.ReadTextFileRequest) => Promise<acp.ReadTextFileResponse>;
  writeTextFile: (params: acp.WriteTextFileRequest) => Promise<acp.WriteTextFileResponse>;
};

export type ClientHandlers = {
  permission: PermissionHandler;
  fs?: FsHandlers;
  /** Called whenever the agent reports which account it is using. */
  authStatus?: (status: AuthStatus) => void;
};

/** One event from a prompt turn, flattened for consumers that do not want the raw union. */
export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "thought"; text: string }
  | { type: "tool_call"; id: string; title: string; kind?: string; status?: string }
  | { type: "tool_call_update"; id: string; title?: string; status?: string }
  | { type: "config_options"; options: acp.SessionConfigOption[] }
  | { type: "usage"; usage: unknown }
  | { type: "other"; update: acp.SessionUpdate }
  | { type: "stop"; stopReason: acp.StopReason; response: acp.PromptResponse };

/** A model choice as reported by an agent through session config options. */
export type ModelChoice = {
  configId: string;
  current: string;
  options: Array<{ value: string; name: string; description?: string | null | undefined; group?: string }>;
};
