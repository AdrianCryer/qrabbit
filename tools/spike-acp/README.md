# spike-acp

Step 0 of the build order in `planning/plan-v2.md`: prove that a third-party app can drive Claude Code through the Agent Client Protocol on the user's own subscription, with a model picker, streaming, embedded context and permission handling.

```sh
pnpm install
pnpm spike:acp          # or: cd tools/spike-acp && pnpm start
```

Output goes to `tools/spike-acp/out/` (git-ignored): a sample collection folder the agent works in, `agent.stderr.log`, and `result.json` with a redacted summary.

## What it does

1. Spawns `@agentclientprotocol/claude-agent-acp` (Node, `dist/index.js`) and calls `initialize` with `auth.terminal: true` and `fs` capabilities.
2. Listens for the adapter's `_auth/status_update` push, which names the account the turn will bill.
3. Opens a session with `cwd` set to a sample collection folder that has an `AGENTS.md`, a `sources/<id>/text.md` with page markers, and a `notes/` folder.
4. Lists the session config options and changes `effort` to `low`.
5. Prompts with four content blocks: an instruction, the highlighted passage as an embedded `resource`, a `resource_link` to `text.md`, and the question.
6. Streams the reply and answers permission requests with the plan's policy: reads inside the collection and writes under `notes/` are allowed, everything else is refused.

## Findings (2026-09-25, adapter 0.81.2, SDK 1.5.0)

- **Sign-in is reused.** The adapter runs the Claude Code binary bundled with the Agent SDK, and that binary reads the login the user already made in Claude Code. No login step was needed on a machine where Claude Code was signed in. The auth push reported `Claude Max (kind=account)`.
- **Auth methods offered:** `claude-ai-login` and `console-login`, both `type: "terminal"`. To sign in from the app, run the adapter with the method's `args` (`--cli auth login --claudeai`) in a pty and treat exit 0 as success. The `--cli` flag makes the adapter exec the bundled Claude Code CLI with the remaining arguments.
- **Config options on a new session:** `mode` (category `mode`, 5 values), `model` (category `model`: `default`, `opus[1m]`, `claude-fable-5-1[1m]`, `sonnet`, `haiku`), `effort` (category `thought_level`, 6 values, default `xhigh`). `session/set_config_option` returns the full option list; the request is a discriminated union, boolean values carry `type: "boolean"`.
- **Prompt capabilities:** `image: true`, `embeddedContext: true`. Embedded text resources work; the agent read the passage and cited `[p.3]` and `[p.4]` from the markers in `text.md`.
- **Permissions:** the agent first tried a shell command to append the note (`kind: "execute"`), which our policy refused; it then used the Write tool (`kind: "edit"`, with `locations` set), which was allowed, and it explained the fallback in its reply. Tool calls arrive as `tool_call` then `tool_call_update` with the same id; `title` is optional on updates.
- **Timing:** about 20 seconds for the whole turn at `effort: low`, including one refused and one allowed tool call.

## Gotchas found while writing it

- `acp.methods.agent.session.setConfigOption` is the method constant (it is nested under `session`).
- `AuthMethod` is a union; narrow with `"type" in m && m.type === "terminal"`.
- Give the spike package its own dependency on `@agentclientprotocol/sdk` for types; pnpm does not hoist it from `acp-client`.
- On Windows, spawn `process.execPath` with the adapter's `dist/index.js`; do not rely on the `.bin` shim.
