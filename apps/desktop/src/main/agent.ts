import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { app } from "electron";
import * as acp from "@agentclientprotocol/sdk";
import {
  authMethodKind,
  buildClientApp,
  initialize,
  promptTurn,
  setConfigOption,
  spawnAgent,
  terminalLoginCommand,
  type AgentLaunch,
  type PermissionDecision,
  type SpawnedAgent,
} from "@qrabbit/acp-client";
import type { AgentEvent, AgentStatus, Anchor, ConfigOption, PermissionRequest, Thread } from "@qrabbit/shared";
import { appendMessage, readThread, updateThread } from "@qrabbit/workspace";
import { buildPromptBlocks } from "./context";

export type AgentEmitter = {
  event(threadId: string, event: AgentEvent): void;
  permission(request: PermissionRequest): void;
  status(collection: string, status: AgentStatus): void;
};

const IDENTITY = { name: "qrabbit", title: "QRabbit", version: app.getVersion() };

function adapterEntry(): string {
  try {
    return require.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js");
  } catch {
    return join(app.getAppPath(), "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "index.js");
  }
}

/** The adapter is a Node program; run it on Electron's bundled Node so the app needs no system Node. */
export function claudeLaunch(collection: string): AgentLaunch {
  return {
    command: process.execPath,
    args: [adapterEntry()],
    env: { ELECTRON_RUN_AS_NODE: "1", ELECTRON_NO_ATTACH_CONSOLE: "1" },
    cwd: collection,
  };
}

function flattenOptions(options: acp.SessionConfigOption[] | null | undefined): ConfigOption[] {
  return (options ?? []).map((o) => {
    if (o.type === "select") {
      const flat: NonNullable<ConfigOption["options"]> = [];
      for (const entry of o.options) {
        if ("group" in entry) for (const v of entry.options) flat.push({ value: v.value, name: v.name, description: v.description, group: entry.name });
        else flat.push({ value: entry.value, name: entry.name, description: entry.description });
      }
      return { id: o.id, name: o.name, category: o.category ?? null, type: "select", currentValue: o.currentValue, options: flat };
    }
    return { id: o.id, name: o.name, category: o.category ?? null, type: "boolean", currentValue: o.currentValue };
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

type SessionEntry = { session: acp.ActiveSession; configOptions: ConfigOption[]; turns: number };

/** One agent process per open collection, one ACP session per thread. */
export class AgentHost {
  status: AgentStatus = { connected: false, auth: null, authMethods: [] };
  private agent: SpawnedAgent | null = null;
  private ctx: acp.ClientContext | null = null;
  private closed = deferred<void>();
  private connecting: Promise<AgentStatus> | null = null;
  private sessions = new Map<string, SessionEntry>();
  private threadBySession = new Map<string, string>();
  private pending = new Map<string, (d: PermissionDecision) => void>();
  private running = new Map<string, () => void>();
  private permSeq = 0;

  constructor(readonly collection: string, private readonly emit: AgentEmitter) {}

  // ---------- paths ----------
  private inside(p: string): boolean {
    const rel = relative(this.collection, resolve(this.collection, p));
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  }
  private underNotes(p: string): boolean {
    return this.inside(p) && relative(this.collection, resolve(this.collection, p)).split(sep)[0] === "notes";
  }

  // ---------- lifecycle ----------
  connect(): Promise<AgentStatus> {
    if (this.status.connected) return Promise.resolve(this.status);
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async doConnect(): Promise<AgentStatus> {
    const launch = claudeLaunch(this.collection);
    this.closed = deferred<void>();
    const agent = spawnAgent(launch, "pipe");
    this.agent = agent;
    agent.child.stderr?.on("data", (d: Buffer) => { const s = d.toString().trim(); if (s) console.log(`[agent] ${s}`); });
    void agent.exited.then(() => {
      this.status = { ...this.status, connected: false };
      this.sessions.clear();
      this.emit.status(this.collection, this.status);
    });

    const client = buildClientApp(IDENTITY, {
      permission: (req) => this.onPermission(req),
      authStatus: (s) => {
        this.status = { ...this.status, auth: { kind: s.kind, label: s.label } };
        this.emit.status(this.collection, this.status);
      },
      fs: {
        readTextFile: async (p) => {
          if (!this.inside(p.path)) throw new Error("Reading outside the collection is not allowed");
          return { content: readFileSync(p.path, "utf8") };
        },
        writeTextFile: async (p) => {
          if (!this.underNotes(p.path)) throw new Error("Only notes/ is writable");
          mkdirSync(dirname(p.path), { recursive: true });
          writeFileSync(p.path, p.content);
          return {};
        },
      },
    });

    const ready = deferred<AgentStatus>();
    client
      .connectWith(agent.stream, async (ctx) => {
        this.ctx = ctx;
        const init = await initialize(ctx, IDENTITY);
        this.status = {
          connected: true,
          agent: { name: init.agentInfo?.name ?? "agent", version: init.agentInfo?.version ?? undefined },
          auth: this.status.auth,
          authMethods: (init.authMethods ?? []).filter((m) => authMethodKind(m) === "terminal").map((m) => ({ id: m.id, name: m.name, description: m.description })),
        };
        this.emit.status(this.collection, this.status);
        ready.resolve(this.status);
        await this.closed.promise; // hold the connection open until dispose()
      })
      .catch((err: unknown) => {
        this.status = { connected: false, auth: null, authMethods: [], error: String((err as Error)?.message ?? err) };
        this.emit.status(this.collection, this.status);
        ready.reject(err);
      });
    return ready.promise;
  }

  async dispose(): Promise<void> {
    this.closed.resolve();
    for (const cancel of this.running.values()) cancel();
    for (const reply of this.pending.values()) reply({ outcome: "cancelled" });
    this.pending.clear();
    this.agent?.kill();
    this.agent = null;
    this.ctx = null;
    this.sessions.clear();
    this.status = { connected: false, auth: null, authMethods: [] };
  }

  // ---------- sessions ----------
  async ensureSession(threadId: string): Promise<SessionEntry> {
    const existing = this.sessions.get(threadId);
    if (existing) return existing;
    await this.connect();
    if (!this.ctx) throw new Error("Agent is not connected");
    const session = await this.ctx.buildSession(this.collection).start();
    const entry: SessionEntry = { session, configOptions: flattenOptions(session.newSessionResponse.configOptions), turns: 0 };
    this.sessions.set(threadId, entry);
    this.threadBySession.set(session.sessionId, threadId);
    // Apply the thread's remembered model and effort.
    const thread = readThread(this.collection, threadId);
    for (const [id, value] of [["model", thread?.model], ["effort", thread?.effort]] as const) {
      const opt = entry.configOptions.find((o) => o.id === id);
      if (value && opt && opt.currentValue !== value) {
        try {
          entry.configOptions = flattenOptions(await setConfigOption(this.ctx, session.sessionId, id, value));
        } catch (err) {
          console.warn(`[agent] could not restore ${id}=${value}:`, err);
        }
      }
    }
    return entry;
  }

  async setConfig(threadId: string, configId: string, value: string | boolean): Promise<ConfigOption[]> {
    const entry = await this.ensureSession(threadId);
    if (!this.ctx) throw new Error("Agent is not connected");
    entry.configOptions = flattenOptions(await setConfigOption(this.ctx, entry.session.sessionId, configId, value));
    if (typeof value === "string" && (configId === "model" || configId === "effort")) updateThread(this.collection, threadId, { [configId]: value });
    return entry.configOptions;
  }

  // ---------- turns ----------
  async prompt(threadId: string, body: string, quote?: Anchor): Promise<Thread> {
    const before = readThread(this.collection, threadId);
    if (!before) throw new Error(`Unknown thread: ${threadId}`);
    const entry = await this.ensureSession(threadId);
    if (!this.ctx) throw new Error("Agent is not connected");
    appendMessage(this.collection, threadId, { role: "user", body: body.trim(), ...(quote ? { quote } : {}) });
    const blocks = buildPromptBlocks(this.collection, before, body, quote, entry.turns);
    entry.turns += 1;

    const sessionId = entry.session.sessionId;
    this.running.set(threadId, () => { void this.ctx?.notify(acp.methods.agent.session.cancel, { sessionId }); });
    let reply = "";
    try {
      for await (const ev of promptTurn(entry.session, blocks)) {
        switch (ev.type) {
          case "text": reply += ev.text; this.emit.event(threadId, { type: "text", text: ev.text }); break;
          case "thought": this.emit.event(threadId, { type: "thought", text: ev.text }); break;
          case "tool_call": {
            // Text written before a tool call and text written after it are separate paragraphs.
            if (reply && !/\n\s*$/.test(reply)) { reply += "\n\n"; this.emit.event(threadId, { type: "text", text: "\n\n" }); }
            const paths = [...(ev.locations ?? [])];
            const raw = ev.rawInput as Record<string, unknown> | undefined;
            for (const k of ["file_path", "path", "notebook_path"]) if (typeof raw?.[k] === "string") paths.push(raw[k] as string);
            this.emit.event(threadId, { type: "tool_call", id: ev.id, title: ev.title, kind: ev.kind, status: ev.status, paths });
            break;
          }
          case "tool_call_update": this.emit.event(threadId, { type: "tool_call_update", id: ev.id, title: ev.title, status: ev.status }); break;
          case "config_options": entry.configOptions = flattenOptions(ev.options); this.emit.event(threadId, { type: "config_options", options: entry.configOptions }); break;
          case "stop": this.emit.event(threadId, { type: "stop", stopReason: ev.stopReason }); break;
          default: break;
        }
      }
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      this.emit.event(threadId, { type: "error", message });
      if (!reply.trim()) reply = `*The agent could not answer: ${message}*`;
    } finally {
      this.running.delete(threadId);
    }
    if (reply.trim()) appendMessage(this.collection, threadId, { role: "assistant", body: reply.trimEnd() });
    const model = entry.configOptions.find((o) => o.id === "model");
    updateThread(this.collection, threadId, {
      agent: agentShortName(this.status.agent?.name),
      ...(model && typeof model.currentValue === "string" ? { model: model.currentValue } : {}),
    });
    return readThread(this.collection, threadId)!;
  }

  cancel(threadId: string): void {
    this.running.get(threadId)?.();
  }

  // ---------- permissions (plan §5.6) ----------
  private onPermission(req: acp.RequestPermissionRequest): Promise<PermissionDecision> | PermissionDecision {
    const tc = req.toolCall;
    const paths: string[] = [];
    for (const loc of tc.locations ?? []) paths.push(loc.path);
    const raw = tc.rawInput as Record<string, unknown> | undefined;
    for (const k of ["file_path", "path", "notebook_path"]) if (typeof raw?.[k] === "string") paths.push(raw[k] as string);
    const pick = (kind: acp.PermissionOptionKind) => req.options.find((o) => o.kind === kind) ?? req.options.find((o) => o.kind.startsWith(kind.split("_")[0]!));

    const isWrite = tc.kind === "edit" || tc.kind === "delete" || tc.kind === "move";
    if (tc.kind === "read" && paths.length > 0 && paths.every((p) => this.inside(p))) {
      const o = pick("allow_once");
      if (o) return { outcome: "selected", optionId: o.optionId };
    }
    if (isWrite && paths.length > 0 && paths.every((p) => this.underNotes(p))) {
      const o = pick("allow_once");
      if (o) return { outcome: "selected", optionId: o.optionId };
    }
    // Everything else asks the reader.
    const threadId = this.threadBySession.get(req.sessionId) ?? "";
    const id = `perm_${++this.permSeq}`;
    return new Promise<PermissionDecision>((resolve) => {
      this.pending.set(id, resolve);
      this.emit.permission({
        id,
        threadId,
        title: tc.title ?? "(untitled tool call)",
        kind: tc.kind ?? undefined,
        paths,
        options: req.options.map((o) => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      });
    });
  }

  replyPermission(requestId: string, optionId: string | null): void {
    const resolve = this.pending.get(requestId);
    if (!resolve) return;
    this.pending.delete(requestId);
    resolve(optionId ? { outcome: "selected", optionId } : { outcome: "cancelled" });
  }

  // ---------- sign-in ----------
  /** Open the agent's own login in a terminal window. The app never sees a credential. */
  login(methodId: string): void {
    const method = this.status.authMethods.find((m) => m.id === methodId);
    const launch = claudeLaunch(this.collection);
    const cmd = terminalLoginCommand(launch, { id: methodId, name: method?.name ?? methodId, type: "terminal", args: loginArgs(methodId) });
    if (!cmd) return;
    const dir = join(app.getPath("userData"), "login");
    mkdirSync(dir, { recursive: true });
    const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    if (process.platform === "win32") {
      const script = join(dir, "sign-in.cmd");
      const envLines = Object.entries(cmd.env ?? {}).map(([k, v]) => `set ${k}=${v}`).join("\r\n");
      writeFileSync(script, `@echo off\r\ntitle QRabbit sign-in\r\n${envLines}\r\n${quote(cmd.command)} ${cmd.args.map(quote).join(" ")}\r\necho.\r\necho Done. You can close this window and return to QRabbit.\r\npause\r\n`);
      spawn("cmd.exe", ["/c", "start", "QRabbit sign-in", script], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    } else {
      const script = join(dir, "sign-in.command");
      const envLines = Object.entries(cmd.env ?? {}).map(([k, v]) => `export ${k}=${quote(v)}`).join("\n");
      writeFileSync(script, `#!/bin/bash\n${envLines}\n${quote(cmd.command)} ${cmd.args.map(quote).join(" ")}\necho\necho "Done. You can close this window and return to QRabbit."\nread -r\n`, { mode: 0o755 });
      const opener = process.platform === "darwin" ? ["open", ["-a", "Terminal", script]] : ["x-terminal-emulator", ["-e", `bash ${quote(script)}`]];
      spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: "ignore" }).unref();
    }
  }
}

/** A stable, human name for the thread file: the adapter's package name is an implementation detail. */
function agentShortName(reported?: string): string {
  if (!reported) return "claude-code";
  if (/claude/i.test(reported)) return "claude-code";
  if (/codex/i.test(reported)) return "codex";
  if (/copilot/i.test(reported)) return "copilot";
  return reported.replace(/^@[^/]+\//, "").replace(/-acp$/, "");
}

/** The Claude adapter's terminal auth args, mirrored so login works even before initialize reported them. */
function loginArgs(methodId: string): string[] {
  if (methodId === "console-login") return ["--cli", "auth", "login", "--console"];
  return ["--cli", "auth", "login", "--claudeai"];
}

export function adapterExists(): boolean {
  return existsSync(adapterEntry());
}
