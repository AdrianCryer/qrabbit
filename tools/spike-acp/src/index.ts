/**
 * Step-0 spike (plan §9): drive the Claude Code ACP adapter from a script.
 *
 * Checks, in order:
 *   1. spawn the adapter and initialize; report protocol version, agent info, auth methods
 *   2. receive the agent's auth-status push (which account it will bill)
 *   3. open a session in a sample collection folder; list model / effort options
 *   4. change one config option and read the result back
 *   5. prompt with an embedded text resource; stream the reply
 *   6. handle a permission request (the prompt asks the agent to write under notes/)
 *
 * Writes a redacted summary to tools/spike-acp/out/result.json.
 */
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import {
  authMethodKind,
  embeddedText,
  initialize,
  modelChoice,
  promptTurn,
  resourceLink,
  setConfigOption,
  terminalLoginCommand,
  text,
  withAgent,
  type AgentLaunch,
  type AuthStatus,
  type PermissionDecision,
} from "@qrabbit/acp-client";
import { createSampleWorkspace } from "./workspace.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "..", "out");
mkdirSync(outDir, { recursive: true });

// The adapter's main entry is dist/lib.js; the executable is dist/index.js beside it.
const adapterLib = fileURLToPath(import.meta.resolve("@agentclientprotocol/claude-agent-acp"));
const adapterBin = join(dirname(adapterLib), "index.js");

const ws = createSampleWorkspace(join(outDir, "workspace"));
const launch: AgentLaunch = { command: process.execPath, args: [adapterBin], cwd: ws.root };
const identity = { name: "qrabbit-spike", title: "Qrabbit spike", version: "0.0.0" };

const summary: Record<string, unknown> = { startedAt: new Date().toISOString() };
const toolCalls: Array<{ id: string; title: string; status?: string }> = [];
const permissions: Array<{ title: string; chosen: string }> = [];
let replyText = "";
let authStatus: AuthStatus | null = null;

const insideWorkspace = (p: string) => {
  const rel = relative(ws.root, resolve(p));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};
const underNotes = (p: string) => insideWorkspace(p) && relative(ws.root, resolve(p)).split(sep)[0] === "notes";

function decidePermission(req: acp.RequestPermissionRequest): PermissionDecision {
  const tc = req.toolCall;
  const paths: string[] = [];
  for (const loc of tc.locations ?? []) paths.push(loc.path);
  const raw = tc.rawInput as Record<string, unknown> | undefined;
  for (const k of ["file_path", "path", "notebook_path"]) if (typeof raw?.[k] === "string") paths.push(raw[k] as string);

  const isWrite = tc.kind === "edit" || tc.kind === "delete" || tc.kind === "move";
  let want: acp.PermissionOptionKind;
  if (isWrite && paths.length > 0 && paths.every(underNotes)) want = "allow_once";
  else if (tc.kind === "read" && paths.length > 0 && paths.every(insideWorkspace)) want = "allow_once";
  else want = "reject_once";

  const opt = req.options.find((o) => o.kind === want) ?? req.options.find((o) => o.kind.startsWith(want.split("_")[0]!)) ?? req.options[0];
  const chosen = opt ? `${opt.kind}:${opt.name}` : "cancelled";
  const title = tc.title ?? "(untitled tool call)";
  permissions.push({ title, chosen });
  console.log(`\n[permission] ${title} (kind=${tc.kind ?? "?"}, paths=${paths.join(", ") || "-"}) -> ${chosen}`);
  return opt ? { outcome: "selected", optionId: opt.optionId } : { outcome: "cancelled" };
}

const stderrLog = createWriteStream(join(outDir, "agent.stderr.log"));

async function main() {
  const t0 = Date.now();
  const result = await withAgent(
    launch,
    identity,
    {
      permission: decidePermission,
      authStatus: (s) => {
        authStatus = s;
        console.log(`[auth] ${s.label} (kind=${s.kind})`);
      },
      fs: {
        async readTextFile(p) {
          if (!insideWorkspace(p.path)) throw new Error(`read outside collection refused: ${p.path}`);
          return { content: readFileSync(p.path, "utf8") };
        },
        async writeTextFile(p) {
          if (!underNotes(p.path)) throw new Error(`write outside notes/ refused: ${p.path}`);
          mkdirSync(dirname(p.path), { recursive: true });
          writeFileSync(p.path, p.content);
          return {};
        },
      },
    },
    async (ctx, agent) => {
      agent.child.stderr?.pipe(stderrLog);

      // 1. initialize
      const init = await initialize(ctx, identity);
      console.log(`[init] protocol v${init.protocolVersion}; agent=${init.agentInfo?.name ?? "?"} ${init.agentInfo?.version ?? ""}`);
      console.log(`[init] promptCapabilities=${JSON.stringify(init.agentCapabilities?.promptCapabilities ?? {})}`);
      console.log(`[init] authMethods=${(init.authMethods ?? []).map((m) => `${m.id}(${authMethodKind(m)})`).join(", ") || "none"}`);
      summary.protocolVersion = init.protocolVersion;
      summary.agent = init.agentInfo;
      summary.promptCapabilities = init.agentCapabilities?.promptCapabilities ?? null;
      summary.authMethods = (init.authMethods ?? []).map((m) => ({ id: m.id, name: m.name, type: authMethodKind(m) }));
      const loginCmds = (init.authMethods ?? []).map((m) => terminalLoginCommand(launch, m)).filter(Boolean);
      summary.terminalLoginArgs = loginCmds.map((c) => c!.args.slice(1));

      // 3. session in the sample collection
      return ctx.buildSession(ws.root).withSession(async (session) => {
        console.log(`[session] ${session.sessionId}`);
        const opts = session.newSessionResponse.configOptions ?? [];
        for (const o of opts) {
          const cur = o.type === "select" ? o.currentValue : String(o.currentValue);
          const n = o.type === "select" ? o.options.length : 2;
          console.log(`[config] ${o.id} (${o.category ?? "-"}, ${o.type}) = ${cur} [${n} options]`);
        }
        const model = modelChoice(opts);
        summary.configOptions = opts.map((o) => ({ id: o.id, category: o.category ?? null, type: o.type, current: o.currentValue }));
        summary.models = model?.options.map((m) => m.value) ?? [];
        if (model) console.log(`[models] ${model.options.map((m) => m.value).join(" | ")}`);

        // 4. change one option: effort -> low if offered (cheap turn), else re-set the model to itself
        const effort = opts.find((o) => o.id === "effort" && o.type === "select");
        if (effort && effort.type === "select") {
          const low = effort.options.flatMap((e) => ("group" in e ? e.options : [e])).find((v) => /low/i.test(v.value));
          if (low) {
            const after = await setConfigOption(ctx, session.sessionId, effort.id, low.value);
            const now = after.find((o) => o.id === effort.id);
            console.log(`[config] set ${effort.id}=${low.value} -> now ${now?.type === "select" ? now.currentValue : "?"}`);
            summary.setConfigOption = { id: effort.id, value: low.value, ok: now?.type === "select" && now.currentValue === low.value };
          }
        } else if (model) {
          const after = await setConfigOption(ctx, session.sessionId, model.configId, model.current);
          summary.setConfigOption = { id: model.configId, value: model.current, ok: after.length > 0 };
        }

        // 5. prompt with an embedded resource + a resource link, then 6. a write that needs permission
        const passage = "We hypothesise that the representation lies on a low-dimensional manifold embedded in $\\mathbb{R}^d$, and that the intrinsic dimension $k \\ll d$ is stable across the later layers.";
        const textUri = pathToFileURL(ws.textPath).href;
        const blocks = [
          text("The reader highlighted the passage below on p.4 of the source and wants it explained. Answer in at most three sentences, citing pages as [p.N] from the page markers. Then append one line to notes/spike.md recording the date and that the spike ran; create the file if needed. Do nothing else."),
          embeddedText(`${textUri}#p4`, passage, "text/markdown"),
          resourceLink(textUri, "sources/intrinsic-dimension/text.md"),
          text("What does this passage claim, concretely?"),
        ];
        console.log(`\n[prompt] sending ${blocks.length} blocks\n`);
        let stopReason: string | null = null;
        for await (const ev of promptTurn(session, blocks)) {
          switch (ev.type) {
            case "text": replyText += ev.text; process.stdout.write(ev.text); break;
            case "thought": break;
            case "tool_call": toolCalls.push({ id: ev.id, title: ev.title, status: ev.status }); console.log(`\n[tool] ${ev.title} (${ev.kind ?? "?"}) ${ev.status ?? ""}`); break;
            case "tool_call_update": { const t = toolCalls.find((c) => c.id === ev.id); if (t && ev.status) t.status = ev.status; if (ev.status) console.log(`[tool] ${ev.title ?? ev.id}: ${ev.status}`); break; }
            case "usage": break;
            case "config_options": break;
            case "stop": stopReason = ev.stopReason; console.log(`\n\n[stop] ${ev.stopReason}`); break;
            default: break;
          }
        }
        return { stopReason };
      });
    },
    "pipe",
  );

  summary.stopReason = result.stopReason;
  // Keep only what the UI would show; the push also carries the account's email and organisation.
  summary.authStatus = authStatus ? { kind: authStatus.kind, label: authStatus.label } : null;
  summary.toolCalls = toolCalls;
  summary.permissions = permissions;
  summary.replyPreview = replyText.slice(0, 600);
  summary.notesWritten = (() => { try { return readFileSync(join(ws.notesDir, "spike.md"), "utf8"); } catch { return null; } })();
  summary.elapsedMs = Date.now() - t0;
  writeFileSync(join(outDir, "result.json"), JSON.stringify(summary, null, 2));
  console.log(`\n[done] ${summary.elapsedMs} ms; summary at ${join(outDir, "result.json")}`);
}

const timer = setTimeout(() => { console.error("\n[timeout] spike exceeded 5 minutes"); process.exit(2); }, 5 * 60_000);
main()
  .then(() => { clearTimeout(timer); process.exit(0); })
  .catch((err) => { clearTimeout(timer); console.error("\n[error]", err); summary.error = String(err?.message ?? err); writeFileSync(join(outDir, "result.json"), JSON.stringify(summary, null, 2)); process.exit(1); });
