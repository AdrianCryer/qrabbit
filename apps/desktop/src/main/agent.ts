import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { app } from "electron";
import * as acp from "@agentclientprotocol/sdk";
import {
  buildClientApp,
  initialize,
  promptTurn,
  setConfigOption,
  spawnAgent,
  terminalLoginCommand,
  text,
  type AgentLaunch,
  type PermissionDecision,
  type SpawnedAgent,
} from "@qrabbit/acp-client";
import { agentDefaults, agentInfo, type AgentEvent, type AgentId, type AgentSignIn, type AgentStatus, type Anchor, type ConfigOption, type PermissionRequest, type Thread } from "@qrabbit/shared";
import { appendMessage, createThread, listThreads, openCollection, readThread, updateThread } from "@qrabbit/workspace";
import { branchContextBlock, branchIntroBlocks, buildPromptBlocks, handoffPrompt, historyBlock, parseSummary, PREAMBLE, SUMMARY_PROMPT } from "./context";
import { adapterEntry, ensureInstalled } from "./agent-install";
import { adapterRuntime } from "./runtime";
import { dirtyBranches } from "./tree";

export type AgentEmitter = {
  event(threadId: string, event: AgentEvent): void;
  permission(request: PermissionRequest): void;
  status(collection: string, status: AgentStatus): void;
};

const IDENTITY = { name: "qrabbit", title: "Qrabbit", version: app.getVersion() };
const HANDOFF_WAIT_MS = 20_000;
const SUMMARY_DELAY_MS = 1500;
/** A session started only to learn the agent's options for Settings; it never prompts. */
const PROBE_ID = "__settings__";
/** The ACP config categories behind the thread's `model` and `effort` fields. */
const CATEGORY = { model: "model", effort: "thought_level" } as const;

/** What each adapter is started with, beyond the runtime's own environment. */
const ADAPTER_ENV: Partial<Record<AgentId, Record<string, string>>> = {
  // Read-only makes Codex ask before every file change, so the §5.6 policy decides: notes/ is allowed, the rest is
  // the reader's call. Its own default lets it write anywhere in the collection unasked.
  codex: { INITIAL_AGENT_MODE: "read-only" },
};

/** Claude Code's terminal sign-in arguments, mirrored so login works even before initialize reported them. */
const TERMINAL_ARGS: Record<string, string[]> = {
  "claude-ai-login": ["--cli", "auth", "login", "--claudeai"],
  "console-login": ["--cli", "auth", "login", "--console"],
};

/**
 * The adapters are Node programs: run on a console Node on Windows, else on Electron's own (see runtime.ts). Each
 * is an npm package downloaded on first use (agent-install.ts), so an agent's first launch can wait minutes.
 */
export async function agentLaunch(agent: AgentId, collection: string): Promise<AgentLaunch> {
  await ensureInstalled(agent);
  const runtime = await adapterRuntime();
  return {
    command: runtime.command,
    args: [adapterEntry(agent)],
    env: { ...runtime.env, ...ADAPTER_ENV[agent] },
    cwd: collection,
  };
}

/** The registry's sign-in methods, narrowed to those the adapter advertised (Codex hides ChatGPT without a browser). */
function offeredSignIn(agent: AgentId, advertised?: acp.AuthMethod[]): AgentSignIn[] {
  const all = agentInfo(agent).signIn;
  if (!advertised?.length) return all;
  const ids = new Set(advertised.map((m) => m.id));
  return all.filter((m) => ids.has(m.id));
}

/** JSON-RPC's "Authentication required", which an adapter returns for a new session before anyone signed in. */
function isAuthRequired(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === -32000;
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

type SessionEntry = {
  session: acp.ActiveSession;
  configOptions: ConfigOption[];
  /** The options as the agent first reported them, before the thread's or collection's choice was applied. */
  native: ConfigOption[];
  /** Turns sent so far, hidden ones included; 0 means the session still needs its opening context. */
  turns: number;
  /** ACP sessions take one prompt at a time; hidden work queues behind the reader's. */
  lock: Promise<void>;
};

/** One agent process per open collection, one ACP session per thread. */
export class AgentHost {
  status: AgentStatus;
  private agent: SpawnedAgent | null = null;
  private ctx: acp.ClientContext | null = null;
  private closed = deferred<void>();
  private connecting: Promise<AgentStatus> | null = null;
  private sessions = new Map<string, SessionEntry>();
  private threadBySession = new Map<string, string>();
  private pending = new Map<string, (d: PermissionDecision) => void>();
  private running = new Map<string, () => void>();
  private handoffs = new Map<string, Promise<void>>();
  private summaryTimers = new Map<string, NodeJS.Timeout>();
  private permSeq = 0;
  private disposed = false;

  constructor(readonly collection: string, readonly agentId: AgentId, private readonly emit: AgentEmitter) {
    this.status = this.idle();
  }

  private idle(error?: string): AgentStatus {
    return { id: this.agentId, connected: false, auth: null, authMethods: offeredSignIn(this.agentId), ...(error ? { error } : {}) };
  }

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
    const launch = await agentLaunch(this.agentId, this.collection);
    // Disposed while the runtime was being found (an agent switch as the collection opened): start nothing.
    if (this.disposed) throw new Error("The agent was stopped");
    this.closed = deferred<void>();
    const agent = spawnAgent(launch, "pipe");
    this.agent = agent;
    agent.child.stderr?.on("data", (d: Buffer) => { const s = d.toString().trim(); if (s) console.log(`[agent] ${s}`); });
    void agent.exited.then(() => {
      // After dispose() the host is gone; a late exit must not report over whatever replaced it.
      if (this.agent !== agent) return;
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
          id: this.agentId,
          connected: true,
          agent: { name: init.agentInfo?.name ?? "agent", version: init.agentInfo?.version ?? undefined },
          auth: this.status.auth,
          authMethods: offeredSignIn(this.agentId, init.authMethods ?? undefined),
        };
        this.emit.status(this.collection, this.status);
        ready.resolve(this.status);
        await this.closed.promise; // hold the connection open until dispose()
      })
      .catch((err: unknown) => {
        if (this.agent === agent) {
          this.status = this.idle(String((err as Error)?.message ?? err));
          this.emit.status(this.collection, this.status);
        }
        ready.reject(err);
      });
    return ready.promise;
  }

  /** For good: the host is dropped afterwards, and a connect still in flight starts nothing. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.closed.resolve();
    for (const cancel of this.running.values()) cancel();
    for (const reply of this.pending.values()) reply({ outcome: "cancelled" });
    for (const t of this.summaryTimers.values()) clearTimeout(t);
    this.pending.clear();
    this.summaryTimers.clear();
    this.agent?.kill();
    this.agent = null;
    this.ctx = null;
    this.sessions.clear();
    this.status = this.idle();
  }

  // ---------- sessions ----------
  async ensureSession(threadId: string): Promise<SessionEntry> {
    const existing = this.sessions.get(threadId);
    if (existing) return existing;
    await this.connect();
    if (!this.ctx) throw new Error("Agent is not connected");
    let session: acp.ActiveSession;
    try {
      session = await this.ctx.buildSession(this.collection).start();
    } catch (err) {
      if (!isAuthRequired(err)) throw err;
      const first = this.status.authMethods[0];
      throw new Error(`Not signed in to ${agentInfo(this.agentId).title}. Choose "Sign in · ${first?.name ?? "…"}" from the agent menu in the header.`);
    }
    const native = flattenOptions(session.newSessionResponse.configOptions);
    const entry: SessionEntry = { session, configOptions: native, native, turns: 0, lock: Promise.resolve() };
    this.sessions.set(threadId, entry);
    this.threadBySession.set(session.sessionId, threadId);
    // A thread's own choice wins; otherwise the collection's defaults from Settings apply. Either is skipped when
    // this agent does not offer it: a thread that was with another agent keeps its record for when it goes back.
    const thread = readThread(this.collection, threadId);
    const defaults = agentDefaults(openCollection(this.collection).manifest.settings, this.agentId);
    for (const key of ["model", "effort"] as const) {
      // Found afresh each time: a new model can change which efforts are on offer.
      const opt = entry.configOptions.find((o) => o.category === CATEGORY[key]);
      const value = [thread?.[key], defaults[key]].find((v) => v && opt?.options?.some((o) => o.value === v));
      if (opt && value && opt.currentValue !== value) {
        try {
          entry.configOptions = flattenOptions(await setConfigOption(this.ctx, session.sessionId, opt.id, value));
        } catch (err) {
          console.warn(`[agent] could not restore ${key}=${value}:`, err);
        }
      }
    }
    return entry;
  }

  /**
   * The agent's options for Settings, with `currentValue` showing what the agent starts on by itself
   * (Claude Code's /model choice, Codex's config.toml). Comes from any live session, else from a probe session.
   */
  async options(): Promise<ConfigOption[]> {
    for (const [id, entry] of this.sessions) if (id !== PROBE_ID) return entry.native;
    const probe = this.sessions.get(PROBE_ID) ?? (await this.ensureSession(PROBE_ID));
    return probe.native;
  }

  /** Run `fn` when the session is free; the reader's turns and hidden work never overlap. */
  private withSession<T>(entry: SessionEntry, fn: () => Promise<T>): Promise<T> {
    const run = entry.lock.then(fn, fn);
    entry.lock = run.then(() => undefined, () => undefined);
    return run;
  }

  async setConfig(threadId: string, configId: string, value: string | boolean): Promise<ConfigOption[]> {
    const entry = await this.ensureSession(threadId);
    if (!this.ctx) throw new Error("Agent is not connected");
    // Ids differ between agents (Claude's `effort` is Codex's `reasoning_effort`); the category says what it is.
    const category = entry.configOptions.find((o) => o.id === configId)?.category;
    const key = (Object.keys(CATEGORY) as Array<keyof typeof CATEGORY>).find((k) => CATEGORY[k] === category);
    entry.configOptions = flattenOptions(await setConfigOption(this.ctx, entry.session.sessionId, configId, value));
    if (typeof value === "string" && key) updateThread(this.collection, threadId, { [key]: value });
    return entry.configOptions;
  }

  /** A turn whose output goes nowhere but the return value: handoffs and summaries. */
  private async runHidden(entry: SessionEntry, blocks: acp.ContentBlock[]): Promise<string> {
    return this.withSession(entry, async () => {
      entry.turns += 1;
      let out = "";
      for await (const ev of promptTurn(entry.session, blocks)) if (ev.type === "text") out += ev.text;
      return out.trim();
    });
  }

  // ---------- branches (plan §5.5) ----------
  /** Create the branch file at once and let the parent session write the handoff behind it. */
  branch(parentId: string, messageId: string, anchor: Anchor): Thread {
    const parent = readThread(this.collection, parentId);
    if (!parent) throw new Error(`Unknown thread: ${parentId}`);
    const title = titleFromQuote(anchor.quote);
    const branch = createThread(this.collection, {
      title,
      anchor: { ...anchor, target: "message", thread: parentId, message: messageId },
      parent: { thread: parentId, message: messageId },
      ...(parent.model ? { model: parent.model } : {}),
      ...(parent.effort ? { effort: parent.effort } : {}),
    });
    const job = this.writeHandoff(parent, branch).catch((err) => console.warn("[agent] handoff failed:", err));
    this.handoffs.set(branch.id, job);
    void job.finally(() => this.handoffs.delete(branch.id));
    return branch;
  }

  private async writeHandoff(parent: Thread, branch: Thread): Promise<void> {
    const entry = await this.ensureSession(parent.id);
    const blocks: acp.ContentBlock[] = [];
    if (entry.turns === 0) {
      // A fresh parent session (after a restart) needs the conversation before it can hand it off.
      blocks.push(text(PREAMBLE));
      const h = historyBlock(parent, "This thread so far");
      if (h) blocks.push(h);
    }
    blocks.push(text(handoffPrompt(branch.anchor?.quote ?? branch.title)));
    const handoff = await this.runHidden(entry, blocks);
    if (!handoff) return;
    updateThread(this.collection, branch.id, { handoff });
    this.emit.event(branch.id, { type: "handoff", text: handoff });
  }

  /** After a branch turn, summarise the branch for its ancestors while its session is warm. */
  private scheduleSummary(threadId: string): void {
    const prev = this.summaryTimers.get(threadId);
    if (prev) clearTimeout(prev);
    this.summaryTimers.set(
      threadId,
      setTimeout(() => {
        this.summaryTimers.delete(threadId);
        void this.writeSummary(threadId).catch((err) => console.warn("[agent] summary failed:", err));
      }, SUMMARY_DELAY_MS),
    );
  }

  private async writeSummary(threadId: string): Promise<void> {
    const entry = this.sessions.get(threadId);
    const thread = readThread(this.collection, threadId);
    if (!entry || !thread || thread.messages.length === 0) return;
    const last = thread.messages[thread.messages.length - 1]!;
    if (thread.summary?.through === last.id) return;
    const reply = await this.runHidden(entry, [text(SUMMARY_PROMPT)]);
    if (!reply) return;
    const { text: summary, concepts } = parseSummary(reply);
    updateThread(this.collection, threadId, { summary: { at: new Date().toISOString(), through: last.id, text: summary, concepts } });
  }

  // ---------- turns ----------
  async prompt(threadId: string, body: string, quote?: Anchor): Promise<Thread> {
    const before = readThread(this.collection, threadId);
    if (!before) throw new Error(`Unknown thread: ${threadId}`);
    const entry = await this.ensureSession(threadId);
    if (!this.ctx) throw new Error("Agent is not connected");

    // Branch opening: wait briefly for the handoff the parent session is writing.
    let intro: acp.ContentBlock[] | undefined;
    if (entry.turns === 0 && before.parent) {
      const pending = this.handoffs.get(threadId);
      if (pending) await Promise.race([pending, new Promise((r) => setTimeout(r, HANDOFF_WAIT_MS))]);
      const fresh = readThread(this.collection, threadId) ?? before;
      const parent = readThread(this.collection, before.parent.thread);
      if (parent) intro = branchIntroBlocks(parent, fresh, fresh.handoff);
    }

    // Lazy branch context: digests of descendants active since this thread's last turn.
    const dirty = dirtyBranches(this.collection, before, listThreads(this.collection));
    const branchContext = branchContextBlock(dirty.map((d) => ({ title: d.branch.title, digest: d.digest })));

    appendMessage(this.collection, threadId, {
      role: "user",
      body: body.trim(),
      ...(quote ? { quote } : {}),
      ...(dirty.length ? { context: dirty.map((d) => d.branch.id) } : {}),
    });
    const blocks = buildPromptBlocks(this.collection, before, body, quote, entry.turns, { intro, branchContext });

    const sessionId = entry.session.sessionId;
    this.running.set(threadId, () => { void this.ctx?.notify(acp.methods.agent.session.cancel, { sessionId }); });
    let reply = "";
    try {
      await this.withSession(entry, async () => {
        entry.turns += 1;
        for await (const ev of promptTurn(entry.session, blocks)) {
          switch (ev.type) {
            case "text": reply += ev.text; this.emit.event(threadId, { type: "text", text: ev.text }); break;
            case "thought": this.emit.event(threadId, { type: "thought", text: ev.text }); break;
            case "tool_call": {
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
      });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      this.emit.event(threadId, { type: "error", message });
      if (!reply.trim()) reply = `*The agent could not answer: ${message}*`;
    } finally {
      this.running.delete(threadId);
    }
    if (reply.trim()) appendMessage(this.collection, threadId, { role: "assistant", body: reply.trimEnd() });
    // The model is recorded only when the reader picks one (setConfig); otherwise the thread keeps
    // following the collection's default, and Settings can change it later.
    updateThread(this.collection, threadId, { agent: this.agentId });
    if (before.parent) this.scheduleSummary(threadId);
    return readThread(this.collection, threadId)!;
  }

  cancel(threadId: string): void {
    this.running.get(threadId)?.();
  }

  /** Forget the sessions of deleted threads: stop any turn, drop timers, unhook permission routing. */
  dropSessions(threadIds: string[]): void {
    for (const id of threadIds) {
      this.running.get(id)?.();
      const entry = this.sessions.get(id);
      if (entry) {
        this.threadBySession.delete(entry.session.sessionId);
        entry.session.dispose();
        this.sessions.delete(id);
      }
      const timer = this.summaryTimers.get(id);
      if (timer) clearTimeout(timer);
      this.summaryTimers.delete(id);
      this.handoffs.delete(id);
    }
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
  /**
   * Start the agent's own sign-in; the app never sees a credential. Claude Code's CLI runs in a terminal window.
   * Codex opens ChatGPT's page in the browser itself, keeps the tokens in its own store, and pushes the new
   * account on `_auth/status_update`.
   */
  async login(methodId: string): Promise<AgentSignIn["via"]> {
    const info = agentInfo(this.agentId);
    const method = info.signIn.find((m) => m.id === methodId);
    if (!method) throw new Error(`${info.title} has no sign-in method "${methodId}"`);
    if (method.via === "terminal") {
      await this.openTerminalLogin(method);
      return "terminal";
    }
    await this.connect();
    if (!this.ctx) throw new Error("Agent is not connected");
    // Settles when the browser flow does, possibly minutes from now, or never if the tab is abandoned (a
    // second click starts a fresh flow). The status push is what reports the outcome.
    this.ctx.request(acp.methods.agent.authenticate, { methodId }).catch((err: unknown) => console.warn(`[agent] ${method.name} sign-in did not finish:`, err));
    return "browser";
  }

  private async openTerminalLogin(method: AgentSignIn): Promise<void> {
    const args = TERMINAL_ARGS[method.id];
    if (!args) throw new Error(`No terminal command for "${method.name}"`);
    const cmd = terminalLoginCommand(await agentLaunch(this.agentId, this.collection), { id: method.id, name: method.name, type: "terminal", args });
    if (!cmd) return;
    const dir = join(app.getPath("userData"), "login");
    mkdirSync(dir, { recursive: true });
    const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
    if (process.platform === "win32") {
      const script = join(dir, "sign-in.cmd");
      const envLines = Object.entries(cmd.env ?? {}).map(([k, v]) => `set ${k}=${v}`).join("\r\n");
      writeFileSync(script, `@echo off\r\ntitle Qrabbit sign-in\r\n${envLines}\r\n${quote(cmd.command)} ${cmd.args.map(quote).join(" ")}\r\necho.\r\necho Done. You can close this window and return to Qrabbit.\r\npause\r\n`);
      spawn("cmd.exe", ["/c", "start", "Qrabbit sign-in", script], { detached: true, stdio: "ignore", windowsHide: false }).unref();
    } else {
      const script = join(dir, "sign-in.command");
      const envLines = Object.entries(cmd.env ?? {}).map(([k, v]) => `export ${k}=${quote(v)}`).join("\n");
      writeFileSync(script, `#!/bin/bash\n${envLines}\n${quote(cmd.command)} ${cmd.args.map(quote).join(" ")}\necho\necho "Done. You can close this window and return to Qrabbit."\nread -r\n`, { mode: 0o755 });
      const opener = process.platform === "darwin" ? ["open", ["-a", "Terminal", script]] : ["x-terminal-emulator", ["-e", `bash ${quote(script)}`]];
      spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: "ignore" }).unref();
    }
  }
}

function titleFromQuote(quote: string, max = 60): string {
  const one = quote.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > 30 ? cut.slice(0, at) : cut) + "…";
}
