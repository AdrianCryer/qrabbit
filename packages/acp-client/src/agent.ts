import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type {
  AgentLaunch,
  AuthStatus,
  ClientHandlers,
  ClientIdentity,
  ModelChoice,
  TurnEvent,
} from "./types.js";

export const AUTH_STATUS_UPDATE_METHOD = "_auth/status_update";

/** Capabilities QRabbit advertises. `auth.terminal` is what makes the Claude adapter offer subscription login. */
export function defaultClientCapabilities(): acp.ClientCapabilities {
  return {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: false,
    auth: { terminal: true },
  };
}

export type SpawnedAgent = {
  child: ChildProcess;
  stream: acp.Stream;
  /** Resolves when the process exits. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill: () => void;
};

/** Start the agent process and wrap its stdio as an ACP stream. stderr is left to the caller. */
export function spawnAgent(launch: AgentLaunch, stderr: "inherit" | "pipe" = "pipe"): SpawnedAgent {
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: { ...process.env, ...(launch.env ?? {}) },
    stdio: ["pipe", "pipe", stderr],
    windowsHide: true,
  });
  const input = Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
  return { child, stream, exited, kill: () => { if (!child.killed) child.kill(); } };
}

/** Build the ACP client app with our handlers wired in. */
export function buildClientApp(identity: ClientIdentity, handlers: ClientHandlers): acp.ClientApp {
  let app = acp
    .client({ name: identity.name })
    .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
      const decision = await handlers.permission(ctx.params);
      return { outcome: decision } satisfies acp.RequestPermissionResponse;
    });

  if (handlers.fs) {
    const fs = handlers.fs;
    app = app
      .onRequest(acp.methods.client.fs.readTextFile, (ctx) => fs.readTextFile(ctx.params))
      .onRequest(acp.methods.client.fs.writeTextFile, (ctx) => fs.writeTextFile(ctx.params));
  }

  if (handlers.authStatus) {
    const onStatus = handlers.authStatus;
    app = app.onNotification(
      AUTH_STATUS_UPDATE_METHOD,
      (raw: unknown) => raw as { authStatus?: AuthStatus },
      (ctx) => {
        if (ctx.params?.authStatus) onStatus(ctx.params.authStatus);
      },
    );
  }
  return app;
}

/**
 * Spawn an agent, connect, run `op` with the connected context, then shut the agent down.
 * Suited to scripts and tests. The desktop app will hold a long-lived `connect()` instead.
 */
export async function withAgent<T>(
  launch: AgentLaunch,
  identity: ClientIdentity,
  handlers: ClientHandlers,
  op: (ctx: acp.ClientContext, agent: SpawnedAgent) => Promise<T>,
  stderr: "inherit" | "pipe" = "pipe",
): Promise<T> {
  const agent = spawnAgent(launch, stderr);
  try {
    return await buildClientApp(identity, handlers).connectWith(agent.stream, (ctx) => op(ctx, agent));
  } finally {
    agent.kill();
  }
}

export async function initialize(ctx: acp.ClientContext, identity: ClientIdentity): Promise<acp.InitializeResponse> {
  return ctx.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: defaultClientCapabilities(),
    clientInfo: { name: identity.name, title: identity.title ?? identity.name, version: identity.version ?? "0.0.0" },
  });
}

/** The invocation to run in a terminal for a `type: "terminal"` auth method. Exit 0 means signed in. */
export function terminalLoginCommand(launch: AgentLaunch, method: acp.AuthMethod): AgentLaunch | null {
  if (!("type" in method) || method.type !== "terminal") return null;
  return {
    command: launch.command,
    args: [...launch.args, ...(method.args ?? [])],
    env: { ...(launch.env ?? {}), ...(method.env ?? {}) },
    cwd: launch.cwd,
  };
}

/** Extract the model picker, if the agent exposes one, from a session's config options. */
export function modelChoice(options: acp.SessionConfigOption[] | null | undefined): ModelChoice | null {
  const opt = options?.find((o) => o.category === "model" && o.type === "select");
  if (!opt || opt.type !== "select") return null;
  const flat: ModelChoice["options"] = [];
  for (const entry of opt.options) {
    if ("group" in entry) {
      for (const v of entry.options) flat.push({ value: v.value, name: v.name, description: v.description, group: entry.name });
    } else {
      flat.push({ value: entry.value, name: entry.name, description: entry.description });
    }
  }
  return { configId: opt.id, current: opt.currentValue, options: flat };
}

export async function setConfigOption(
  ctx: acp.ClientContext,
  sessionId: string,
  configId: string,
  value: string | boolean,
): Promise<acp.SessionConfigOption[]> {
  // The request is a discriminated union: boolean values carry `type: "boolean"`, strings do not.
  const params: acp.SetSessionConfigOptionRequest =
    typeof value === "boolean" ? { sessionId, configId, type: "boolean", value } : { sessionId, configId, value };
  const res = (await ctx.request(acp.methods.agent.session.setConfigOption, params)) as acp.SetSessionConfigOptionResponse;
  return res.configOptions ?? [];
}

/** Label for an auth method: terminal methods are run by the client, agent methods via `authenticate`. */
export function authMethodKind(method: acp.AuthMethod): "terminal" | "agent" {
  return "type" in method && method.type === "terminal" ? "terminal" : "agent";
}

/** Text block helper. */
export function text(t: string): acp.ContentBlock {
  return { type: "text", text: t };
}

/** Embedded text resource block: the passage itself travels with the prompt. */
export function embeddedText(uri: string, contents: string, mimeType = "text/markdown"): acp.ContentBlock {
  return { type: "resource", resource: { uri, text: contents, mimeType } };
}

/** Resource link block: points the agent at a file it may read on its own. */
export function resourceLink(uri: string, name: string, mimeType = "text/markdown"): acp.ContentBlock {
  return { type: "resource_link", uri, name, mimeType };
}

/** Send a prompt and yield flattened events until the turn stops. */
export async function* promptTurn(
  session: acp.ActiveSession,
  blocks: acp.ContentBlock[],
): AsyncGenerator<TurnEvent, acp.PromptResponse, void> {
  let promptError: unknown = null;
  const pending = session.prompt(blocks).catch((err) => { promptError = err; return null; });
  for (;;) {
    let message: acp.ActiveSessionMessage;
    try {
      message = await session.nextUpdate();
    } catch (err) {
      if (promptError) throw promptError;
      throw err;
    }
    if (message.kind === "stop") {
      yield { type: "stop", stopReason: message.response.stopReason, response: message.response };
      return message.response;
    }
    const u = message.update;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content.type === "text") yield { type: "text", text: u.content.text };
        else yield { type: "other", update: u };
        break;
      case "agent_thought_chunk":
        if (u.content.type === "text") yield { type: "thought", text: u.content.text };
        break;
      case "tool_call":
        yield { type: "tool_call", id: u.toolCallId, title: u.title, kind: u.kind ?? undefined, status: u.status ?? undefined };
        break;
      case "tool_call_update":
        yield { type: "tool_call_update", id: u.toolCallId, title: u.title ?? undefined, status: u.status ?? undefined };
        break;
      case "config_option_update":
        yield { type: "config_options", options: u.configOptions };
        break;
      case "usage_update":
        yield { type: "usage", usage: u };
        break;
      default:
        yield { type: "other", update: u };
    }
    if (promptError) {
      await pending;
      throw promptError;
    }
  }
}
