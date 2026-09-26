# QRabbit — Plan v2

Status: draft, 2026-09-25. Items marked **[open]** still need a decision.

---

## 1. Concept

A desktop client for reading difficult material with AI. The central loop:

> **Read → highlight → explore in a branch → understand → return to where you were.**

Questions, explorations, source passages and understanding are persistent first-class objects, not lines in a chat transcript.

The first thing to validate:

> Does branching exploration anchored to source material make difficult reading meaningfully better than a normal AI chat?

---

## 2. Key decisions at a glance

- **A thread is a chat.** Root threads are the familiar chat list. Documents are quoted *into* threads through anchored highlights; the document is never the root.
- **Explore inside answers is the core feature.** Any span in any message can be explored as a branch.
- **Users bring their own agent subscription.** The app is an **Agent Client Protocol (ACP) client**. Users sign into Claude Code, Codex, Copilot or another agent with the plan they already pay for, and pick a model per thread. No API key required.
- **The workspace is a plain folder.** Markdown, JSON and the PDFs are the truth; SQLite is a rebuildable index. Git-trackable, Obsidian-compatible, readable by the agent with its own file tools.
- **Sources are PDF, Markdown/text and web pages.** A web page is fetched once, reduced to its article text and saved as Markdown with the link kept, so it reads like a paper and is there offline. The app never renders live sites.
- **Desktop stack is Electron + TypeScript + React + PDF.js, in a pnpm monorepo.**
- **Branches start with a handoff; parents learn about them lazily.** The parent session writes a compact handoff when a branch is created. Nothing happens when the reader leaves a branch. When they next send a message in an ancestor thread, digests of branches active since that thread's last turn ride along with the prompt, shown as a passive chip. No Back, Close or return note.
- **No understanding state, not even a soft one.** Whether someone understood is an estimate, even to themselves, and asking for it adds friction that turns reading into a chore. Threads are never closed, flagged or graded. If an estimate is ever wanted, the event log can produce one from behaviour without asking (§13.6).
- **No persistent sidebar.** A home screen lists collections (reading lists); the header switches collection and source; threads are reached from a popover and from markers in the page margin. The reader and the thread panel get the whole width.
- **An append-only event log exists from day one**, so later analytics need no migration.

---

## 3. Core model

### 3.1 Objects

- **Collection** — a reading list: a folder on disk holding sources, threads, notes, and an index. The home screen lists recently opened collections. (Called a workspace in the persistence section; same thing.)
- **Source** — a PDF, a Markdown/text file, or a saved web page, with extracted text and page markers (a text source is one page).
- **Anchor** — a pointer to a span of text. The target is either a *source* or a *message*. Stored as a text quote with prefix/suffix, a character range in the extracted text, and (for PDFs) a page number. Rectangles for drawing are derived at render time and cached, not stored as truth.
- **Thread** — a linear conversation. Has an optional anchor (the span it was started from), an optional parent (thread id + message id), a status, and an agent/model choice.
  - A **root thread** has no parent. It is what users see as "a chat".
  - A **branch** is a thread whose parent is a message in another thread. Its anchor points at a span in that message.
- **Message** — a user or assistant turn inside a thread. A user message may carry one or more anchors (quoted spans from sources). An assistant message may carry citations (page references).
- **Branch summary** — a cached, model-written summary of a branch: 2–3 sentences, concept tags, and the id of the last message it covers. Generated in the background when the branch has new activity and an ancestor's composer gains focus, or on demand. Feeds lazy context (§5.5), hover cards on branch markers, and thread lists. Never shown as a ceremony and never asked of the reader.
- **Note** — free-form Markdown the user or agent writes.
- **Annotation** — the reader's own mark on a source, never part of a prompt: a *comment* (a span plus text) or a *bookmark* (a span or a whole page, with a label). Stored per source in `sources/<id>/annotations.json`; drawn as markers in the page margin; listed in the header's Marks popover.
- **Event** — append-only log entry: thread opened, question asked, branch created, returned, abandoned, depth reached, time on page.

### 3.2 How documents relate to threads

The document is **not** the root; it is a lens over the threads.

- Highlighting a source span and choosing **Explore** creates a new root thread anchored to that span. The reader stays visible beside it.
- Highlighting a source span while a thread is focused and choosing **Ask here** inserts the quote into that thread's composer as a removable quote card. The sent message carries the anchor, and the span becomes a highlight in that thread's colour. This keeps the linear-chat feel people already know. The selection toolbar is contextual: with a thread focused it offers *Ask here* first and *New thread* second; with none focused, *Explore* is first.
- Highlighting a span inside any **message** and choosing **Explore** creates a **branch** hanging off that message. This is the rabbit hole.
- The reader's margin shows a marker for every thread that touches a passage, colour-coded by thread. From the document you can jump into any conversation that started there.

So a thread can quote from several sources, a source can feed many threads, and the tree is *threads → branches*, never *document → threads*.

### 3.3 No understanding state

There is deliberately no way to mark a thread understood, resolved, done or closed.

- Understanding is an estimate, even for the reader. People come back and discover they did not understand after all, and anyone who reads "I understand" as "I must understand completely" turns every branch into a chore.
- Every thread is simply there. Lists order by recency and group by source. Nothing is archived.
- Nothing happens when the reader leaves a branch. Leaving is inferred from navigation, and the branch's transcript is already the record. A branch summary is cached lazily (§5.5) for the parent's next turn, for hover cards and for lists.
- Abandonment, revisits and depth live in the event log, not in the UI. If an estimate of understanding is ever useful, it comes from there (§13.6), never from a prompt.

---

## 4. Core UX

### 4.1 Layout

No persistent sidebar. It cost a quarter of the width and earned little, and it is fatal on tablets and small laptops.

- **Home** — a list of collections (reading lists) with a *Continue reading* card for the last position. Opening a collection opens its reader.
- **Header** — one 44px bar: brand, collection switcher, source switcher with the current page, a *Threads* popover with the collection's threads grouped by source and ordered by recency, search, agent status. Switching collection or source is a dropdown, not a panel.
- **Reader** — PDF.js viewer for PDFs, and a paper-styled article view for Markdown and web sources with the same selection, marks and keys; full width when no thread is focused. Selection toolbar: *Explore*, *Ask here*, *Comment*, *Bookmark*. Margin markers for anchored threads (colour-coded), comments and bookmarks; markers that share a line step sideways; clicking one opens the thread or an inline editor for the comment or label. A page can be bookmarked without a selection (Ctrl+D or the bookmark button by the zoom control).
- **Thread panel** — the focused thread, beside the reader. A branch opens *in place* (push), with a breadcrumb of ancestors at the top and a clickable outline of the branch tree under it. There are no Back, Close or Done actions. The breadcrumb, the outline, the margin markers, the Threads popover and Escape are the only ways to move, and moving is all that ever happens. The panel collapses with a header control (Escape from a root thread does the same); the current thread stays current and reopens where it was. A *Focus* toggle hides the paper when the reader wants the full width for the conversation. The paper never moves unless the reader clicks an anchor or a citation, and positions persist per source and per thread across sessions.

While the agent works, the panel shows a compact activity list above the streamed text (files read, searches run, what it is waiting on), permission requests inline with *Allow once*, *Always for this collection* and *Deny* (§5.6), and the send button becomes *Stop*. A message that carried branch digests shows a small "included 1 branch" chip (§5.5).

### 4.2 The central loop, concretely

1. Open a PDF. Reading position is saved per source.
2. Highlight "low-dimensional manifold" → *Explore*. A root thread opens, anchored to the span, composer pre-filled with the quote.
3. Ask. The answer streams in. Page citations link back into the reader.
4. Highlight "intrinsic dimensionality" inside the answer → *Explore*. A branch opens in the panel; the breadcrumb shows `manifold › intrinsic dimensionality`. While you type, the parent session writes a handoff so the branch starts informed (§5.5).
5. Go as deep as needed.
6. Click the parent in the breadcrumb, or press Escape. Nothing happens except that you are back in the parent, where you left it. In the background the branch is summarised, because it has new activity and you are now looking at its parent. Hovering the branch marker in the answer shows that summary.
7. Ask your next question in the parent. A small chip on the composer says the branch is included; the agent gets its digest with your message and not before. Collapse the panel when you want the whole width. The paper has not moved.
8. A week later: open the thread list or click the highlight in the reader. Everything is there.

### 4.3 Model and agent choice

- The thread header shows the agent (e.g. *Claude Code*) and a model picker populated from what the agent reports. The choice is saved on the thread; the default comes from workspace settings.
- Switching agent mid-thread is not supported in the MVP. A branch inherits its parent's agent and model.

### 4.4 Visual direction

References (copies in `planning/design-refs/`):

| Ref | Link | What to take from it |
|---|---|---|
| Invoices dashboard (`ref1-cards-tabs.jpg`) | https://pin.it/332B6ktF0 | Sunken segmented tabs: the active tab sits raised inside an inset track. Rounded 16–20px cards, count badges on tabs, and a white sheet nested inside dark chrome. |
| AI chat dashboard (`ref2-chat-agent.jpg`) | https://pin.it/10q4jqQSu | The composer as a large rounded card with chips for model and tools; a sidebar with quiet section labels. Skip its welcome hero and feature tiles; that is the generic part. |
| Glass cards (`ref3-macos-cards.jpg`) | https://pin.it/7dlRCuQAh | Very clean translucent cards, a model-picker pill inside the composer, suggestion chips. Use glass only for overlays such as the selection toolbar. |
| Dark component kit (`ref4-menu-items.jpg`) | https://pin.it/5HFZhgMmf | Menu items with icon, label and shortcut chip; segmented toggles; one accent; consistent radius and padding. |

Principles derived from them:

- **The paper is the bright surface; everything else is quiet.** Dark chrome, dark thread panel, and the PDF page as the white sheet, mirroring the dark-to-white nesting in the first reference. A light theme follows once tokens exist.
- **Three surface levels:** base, raised card, sunken track. Sunken segmented controls for reader/thread toggles and for prototype-style switches.
- **One accent colour, plus a small hue palette for per-thread highlights** chosen so highlights never compete with the accent.
- **The composer is a card:** quoted span at the top, text area, a chips row (agent, model, effort where the agent offers it), send.
- **Menus and toolbars** show icon, label and shortcut chip. Selection toolbar: *Explore* `E`, *Ask here* `A`, *Note* `N`. *Back* is `Esc`.
- **Not a dashboard.** No welcome hero, no feature tiles, no glows. The reader is the hero; the thread panel is a tool.
- **No persistent sidebar.** Navigation is dropdowns and popovers in the header, and markers in the page margin. Width goes to the paper and the conversation.
- **Nothing ends.** There are no Back, Close or Done controls. The reader goes somewhere else, and that is the whole event. What the agent is told later is shown as a passive, expandable chip, never as a step.
- **Frameless window** with native controls overlaid (`titleBarStyle: 'hidden'` plus `titleBarOverlay`) so the chrome reads as an app on Windows and macOS.
- **Motion:** the branch push/pop slides; nothing else moves.

Typography: Inter for UI, JetBrains Mono for code, KaTeX's own fonts for maths. Answers get a slightly larger measure than UI text because they are read, not scanned.

Clickable prototype of the central loop: `planning/prototype/central-loop.html`, published at https://claude.ai/artifact/82B5A5h1bbE5JkgBFYx24s. It shows seven states (home, reading, thread, branch, ask again, ask here, working) with accent, panel and theme variants for the open questions in §11. The prototype is considered done at this point; pane resizing, zoom, first-run and the light-theme pass are decided in the app with real components.

Managing the sources of a collection (reading order, read marks, removal with undo, adding selected files from a folder) is planned in `planning/plan-sources.md`, with its own prototype at `planning/prototype/sources.html`.

---

## 5. AI integration

### 5.1 Decision: the app is an ACP client

The app speaks the **Agent Client Protocol** (https://agentclientprotocol.com, JSON-RPC over stdio, spec v1, TypeScript SDK `@agentclientprotocol/sdk`). It spawns an agent process per workspace with `cwd` set to the workspace folder, and creates one ACP session per thread.

This is the same integration model Zed and JetBrains use. It gives us, generically across agents:

- streaming assistant text and thoughts (`agent_message_chunk`, `agent_thought_chunk`)
- tool-call display (`tool_call`, `tool_call_update`)
- permission requests (`session/request_permission`)
- session load/resume/list
- **model selection** via session config options (`category: "model"`), rendered generically
- prompt content blocks: text, `resource_link`, `embedded_resource`, images
- MCP servers passed from client to agent (our own workspace tools, later)
- authentication through the agent's **own** login flow (`authMethods` with `type: "terminal"` or `"agent"`)

### 5.2 Agents (verified 2026-09-25)

| Agent | Launch | Subscription login | Model picker | Notes |
|---|---|---|---|---|
| **Claude Code** | `npx @agentclientprotocol/claude-agent-acp` (wraps the Claude Agent SDK, which runs the unmodified `claude` binary) | Yes, via terminal auth: the adapter runs `claude auth login --claudeai`; tokens live in Claude Code's own store. Also offers Console (API billing) login. | Yes (`category: "model"`) | **First target.** See the policy note below. |
| **OpenAI Codex** | `npx @agentclientprotocol/codex-acp` (drives the Codex App Server; co-authored by OpenAI, JetBrains and Zed) | ChatGPT login through Codex's own flow. Works and is tolerated; OpenAI declined to formalise "bring your own plan" for third-party apps (issue closed 2026-03-20). | Yes | Second target. |
| **GitHub Copilot** | `npx @github/copilot --acp` or `@github/copilot-sdk` | **Explicitly allowed**, including Copilot Free (SDK GA 2026-06-02). | Not over ACP (copilot-cli #4880); yes via the SDK | Third target; may need the SDK path for a model picker. |
| **Google Antigravity** | `agy-acp-server` binary from the ACP registry (Google-published) | Google account; Google staff confirmed that spawning the official binary on cached credentials is supported (2026-09-15). | Undocumented over ACP | Gemini CLI lost consumer subscription login on 2026-06-18; do not target it. |
| Others in the registry | Cursor, OpenCode, Qwen Code, Kiro, … | Varies | Varies | Free with a generic client. |

Install and launch metadata comes from the ACP registry JSON (`https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`) rather than being hardcoded.

Verified by the spike (2026-09-25): the Claude adapter reuses an existing Claude Code sign-in, pushes the account it will bill on `_auth/status_update`, and exposes three session config options: `mode`, `model` (`default`, `opus[1m]`, `claude-fable-5-1[1m]`, `sonnet`, `haiku`) and `effort` (category `thought_level`, default `xhigh`). The model and effort pickers in §4.3 render those directly.

### 5.3 Anthropic policy — read before building

From Claude Code's *Legal and compliance* page and the *Use the Claude Agent SDK with your Claude plan* support article (both checked 2026-09-25):

- Anthropic **does not permit** third-party developers to offer Claude.ai login inside their own apps, to route requests through Free/Pro/Max credentials on behalf of users, or to **collect, store, or intermediate** Claude.ai credentials or session tokens.
- It **does not prevent** an end user from signing in to the **unmodified Claude Code binary** with their own subscription, including where a platform hosts Claude Code, provided all auth methods are left intact and each user authenticates with their own credentials.
- As of June 2026: "Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits". A planned Agent SDK credit scheme was announced in May 2026 and **paused** in June 2026. This could change again.
- The same page says developers building products "should use API key authentication" and to contact Anthropic for other arrangements.

Design consequences:

1. Sign-in always happens in the vendor's own flow inside the vendor's binary (ACP terminal auth). The app opens a terminal running the adapter's login command; it never sees a token.
2. The app never reads `~/.claude`, `~/.codex/auth.json`, or any keychain entry belonging to an agent.
3. Show a settings notice: usage draws on the agent's plan and its vendor may change the rules.
4. For personal use and a few testers this is fine. **Before distributing widely, ask Anthropic** (the page says to), or ship with Console/API-key login as the documented default and subscription login as the user's own choice inside the Claude Code binary.

### 5.4 What we give up versus calling the API directly, and how we compensate

| Lost | Compensation |
|---|---|
| Server-side PDF citations with page locations | Extracted text carries page markers (`<!-- page 4 -->`). `AGENTS.md` instructs the agent to cite as `[p.4]`. The app links those back into the reader. |
| Control of prompt caching | The agent harness caches its own prefix. Keep sessions alive per thread; don't restart the agent per turn. |
| Predictable latency and cost per turn | Put the quoted span and its surrounding section text *in the prompt* so simple questions need no tool call. The agent reads more from `text.md` only when needed. |
| Custom system prompt | `AGENTS.md` / `CLAUDE.md` at the workspace root is read automatically by Claude Code and Codex. Plus a per-session preamble in the first prompt. |

An escape hatch stays open: a direct-API provider (Anthropic SDK) behind the same internal `Provider` interface is a nice-to-have, not MVP. The Claude adapter's Console login already covers API-key users through the ACP path.

### 5.5 Context assembly

**Root thread, first turn:**

```
[preamble: you are helping the reader understand a source; cite pages as [p.N]; do not edit files under threads/]
[embedded_resource: the quoted span]
[text: surrounding paragraph or section from sources/<id>/text.md, with page markers]
[resource_link: sources/<id>/text.md]
[text: the user's question]
```

**Branch creation: a handoff written by the parent session.** When the user chooses *Explore* on a span inside a message, the app sends a hidden prompt to the *parent* thread's session, which already holds the whole conversation in its context:

> The reader is about to explore "<selection>" in a separate thread. Write a handoff for a fresh assistant that has no access to this conversation: (1) what this thread is about and which source passage it started from; (2) what has been established so far, in 3–6 sentences; (3) what "<selection>" means in the context of your answer, in 1–3 sentences; (4) what the reader already seems to understand and what they seem to be missing. Reply with the handoff only.

The reply is not shown as a message in the parent thread. The app stores it in the branch file's frontmatter (`handoff:`), where it is inspectable and editable. It runs while the user types their first question, so the extra turn rarely adds visible latency. If it fails or takes more than a few seconds, the app falls back to a mechanical digest built from stored messages: each ancestor's anchor quote, question, and the opening of its answer.

**Branch, first turn:**

```
[preamble: as above]
[text: handoff from the parent session]
[embedded_resource: the explored span, verbatim, with the sentence around it]
[resource_link: the parent thread file and the source text.md]
[text: the user's question]
```

Nesting composes. A branch of a branch gets its handoff from the child session, which already holds the handoff chain above it, so handoffs stay compact at any depth. ACP `session/fork` is still unstable; handoffs are the portable approach and work across agents.

**Lazy branch context.** Leaving a branch triggers nothing. Instead:

- A branch with messages newer than its cached summary is *dirty*.
- When the reader focuses the composer of a thread that has dirty descendants, the app asks each dirty branch session, in the background, for a summary: 2–3 sentences on what the branch established plus 1–5 concept tags. Deep trees resolve bottom-up, so a grandchild's summary is available to the child's summary. Results are cached on the branch with the id of the last message they cover.
- When the reader sends the message, digests of descendants active since this thread's last turn are attached ahead of the question ("Since your last turn the reader explored '<selection>' in a branch. Summary: …"). If a summary is not ready, a mechanical digest of the branch's last few messages goes instead.
- The sent message shows a small expandable chip, "Includes 1 branch", so the reader can see what the agent was told. Nobody has to act on it.
- If the reader never sends another message in the parent, nothing runs and nothing is sent.

The same cached summaries appear on hover over a branch marker and in thread lists, which is how a reader recovers what a branch established without anyone having declared it.

Subsequent turns in any thread send only the new user message plus any newly quoted spans.

### 5.6 Permissions policy for the agent

Handled in our `session/request_permission` handler:

- Read anywhere inside the workspace: allow.
- Write under `notes/` and `scratch/`: allow.
- Write anywhere else in the workspace (including `threads/` and `sources/`): deny with an explanation. The app owns those files.
- Anything outside the workspace, and shell commands: ask (MVP), with a workspace setting to deny outright.

Observed in the spike: asked to append a note, Claude Code first reached for a shell command (`kind: "execute"`), was refused, and then used its Write tool (`kind: "edit"`, with file locations), which the policy allowed. Tool calls arrive as `tool_call` followed by `tool_call_update` with the same id, and paths come from `locations` or `rawInput`.

### 5.7 `AGENTS.md` (also copied as `CLAUDE.md`)

Generated into every workspace. Contents:

- what the folder layout is and what each file means
- the role: tutor and research assistant, not a coding agent; prefer explaining over doing
- how to cite (`[p.N]`) and where the page markers are
- do not modify `threads/` or `sources/`; write notes only under `notes/`
- keep answers scoped to the question; the reader will branch if they want more
- write maths as LaTeX: `$…$` inline, `$$…$$` for display
- the extracted text of equations is unreliable; when a quoted passage or `text.md` looks garbled, read the relevant page of `source.pdf` directly

### 5.8 Sign-in flow

How the Claude Code VS Code extension does it (official docs, checked 2026-09-25): it bundles a private copy of the CLI, runs it as a background process behind a webview (no terminal emulator), and shows a sign-in screen whose button starts the CLI's own login. The browser opens for OAuth and completes through a localhost callback. If the callback cannot be reached, the browser shows a code and the CLI prompts for it to be pasted. Credentials are stored by the CLI: the macOS keychain, or a mode-0600 file under `~/.claude` on Linux and Windows.

Our equivalent through ACP:

1. On `initialize`, advertise the `auth.terminal` capability. The Claude adapter then lists *Claude Subscription* and *Anthropic Console* as auth methods.
2. The user picks one in a sign-in dialog. The app spawns the adapter's login command in a pseudo-terminal (`node-pty`) and renders it with xterm.js inside the dialog. These are the same two libraries VS Code's integrated terminal is built on.
3. Normal path: the browser opens, the localhost callback completes, the process exits, the dialog closes. No typing needed.
4. Fallback path: the CLI prompts "Paste code here"; the user pastes into the dialog's terminal view. This is why a real pty matters: the login UI is interactive and expects a TTY.
5. The app never reads the credential files or the keychain. It only observes the process exit code, then calls `initialize` again.

Spike shortcut: open the OS terminal with the login command instead of embedding one; swap in the pty dialog before testers arrive.

---

## 6. Persistence

### 6.1 Principle

The **folder is the truth**. Everything a user would grieve losing is a plain file. SQLite is a cache that can be deleted and rebuilt. This makes the workspace git-trackable, Obsidian-openable, and directly usable by the agent's file tools.

### 6.2 Layout

```
my-research/
  qrabbit.json                  # workspace manifest: id, name, settings, default agent/model
  AGENTS.md                     # agent instructions (generated; user-editable)
  CLAUDE.md                     # copy of AGENTS.md for Claude Code
  sources/
    attention-is-all-you-need/
      source.pdf
      source.json               # title, authors, sha256, page count, added date
      text.md                   # extracted text with <!-- page N --> markers
      annotations.json          # the reader's bookmarks and comments on this source
    manifold-hypothesis/        # a saved web page
      source.md                 # reader-mode Markdown; the first lines carry the title and the URL
      source.json               # kind "web", url, site name, byline, fetched date
      text.md                   # the same Markdown behind a single <!-- page 1 --> marker
  threads/
    2026-09-25-low-dimensional-manifold.md
    2026-09-25-low-dimensional-manifold/
      intrinsic-dimensionality.md          # branch
      intrinsic-dimensionality/
        why-not-pca.md                     # branch of a branch
  notes/
    ...
  .qrabbit/
    index.sqlite                # FTS5 over text and threads, anchor rect cache, thread graph
    events.jsonl                # append-only event log
    reader-state.json           # last page / scroll per source
```

Branch files nest under a folder named after the parent thread. Ids live in frontmatter, not filenames, so renames are safe. **[open]** A flat `threads/` folder with parent ids only in frontmatter is the alternative; nesting reads better in Obsidian and git.

### 6.3 Thread file format

```markdown
---
id: thr_01J9…
title: low-dimensional manifold
created: 2026-09-25T10:14:00Z
agent: claude-code
model: claude-opus-5
parent:                 # omitted for root threads
  thread: thr_01J8…
  message: msg_…
anchor:
  target: source        # source | message
  source: attention-is-all-you-need
  page: 4
  quote: "the representation lies on a low-dimensional manifold"
  prefix: "We hypothesise that "
  suffix: " and that the"
  start: 18342          # char offsets into text.md
  end: 18396
handoff: |              # branches only; written by the parent session at creation (§5.5)
  This thread began from p.4 of "Attention is all you need" …
summary:                # cached lazily (§5.5); absent until first needed
  at: 2026-09-25T10:41:00Z
  through: msg_…        # last message this summary covers; older than the thread → dirty
  text: "…"
  concepts: [manifold, intrinsic dimension]
---

## user  <!-- msg_… 2026-09-25T10:14:05Z -->

> the representation lies on a low-dimensional manifold  [p.4]

What does this mean concretely?

## assistant  <!-- msg_… 2026-09-25T10:14:20Z -->

…answer with [p.4] citations…
```

Human-readable, diffable, and trivially parsed. A user message that carried branch digests names them in its comment (`<!-- msg_… 2026-… context: thr_… -->`), so the transcript is honest about what the agent saw. A `## system` heading remains available for app-generated notes. Assistant tool-call activity is not stored in the transcript; it is shown live and summarised in events.

### 6.4 Index and watching

- On open, the app scans the folder, validates frontmatter, and rebuilds `index.sqlite` if missing or stale (by mtime/hash).
- `chokidar` watches the folder so edits made in Obsidian, by git, or by the agent under `notes/` appear live.
- Concurrency rule: the app is the only writer of `threads/` and `sources/`. Writes are atomic (temp file + rename).

---

## 7. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron** (electron-vite, electron-builder) | All TypeScript; the ACP SDK, PDF tooling and file watching are all Node-native; you are already expert. Pinned: electron-vite 5 with Vite 7 and `@vitejs/plugin-react` 5 (plugin-react 6 needs Vite 8, which electron-vite 5 rejects). |
| UI | React + TypeScript, Zustand for state, Tailwind or CSS modules | Standard; the UI would be identical under Tauri, so this is not a lock-in. |
| PDF | PDF.js 6 (`pdfjs-dist`) with text layer | The only realistic open-source renderer with selectable text. Its text layer sets `--font-height` and `--scale-x` per span and needs the matching stylesheet plus `--total-scale-factor` on the layer; the reader does both. |
| Text extraction | PDF.js `getTextContent` per page → `text.md` with page markers | Same engine for rendering and extraction keeps offsets consistent. |
| Anchoring | W3C Web Annotation selectors: TextQuote + TextPosition + page | Survives re-extraction and rendering changes; this is what Hypothesis uses. |
| Agent link | `@agentclientprotocol/sdk` (v1 API) in the main process; registry JSON for install/launch | See §5. |
| Storage | Files (§6) + `better-sqlite3` with FTS5 | Rebuildable index. |
| Watching | `chokidar` | |
| Rich messages | `react-markdown` + `remark-gfm` + `remark-math` + `rehype-katex` (KaTeX); `rehype-highlight` (highlight.js) for fenced code blocks that name a language, coloured through a small token set in the stylesheet with a second palette on paper | KaTeX is synchronous and fast enough to re-render on every streamed chunk. `throwOnError: false` lets unfinished maths during streaming fall back to plain text. Normalise `\(…\)` and `\[…\]` to `$` delimiters before parsing, since agents use both. |
| UI kit | Tailwind v4 with design tokens as CSS variables; Radix primitives for menus, dialogs, popovers and tabs; `lucide-react` icons | Behaviour from primitives, look from our tokens (§4.4). Avoids the stock component-library look. |
| Window chrome | Frameless, `titleBarStyle: 'hidden'` + `titleBarOverlay` | App-like chrome with native window controls on Windows and macOS. |
| IPC | Typed preload bridge (contextIsolation on); the renderer never touches disk or agent processes directly | Security and testability. |
| Repository | pnpm workspaces monorepo (§7.1) | The spike, the workspace format and the ACP client are libraries the app consumes, testable without Electron. |
| Sign-in terminal | `node-pty` + xterm.js inside a sign-in dialog (§5.8); OS terminal as the spike shortcut | ACP terminal auth needs a real TTY for the paste-a-code fallback; the normal browser path needs no typing. `node-pty` is a native module, so budget for `@electron/rebuild`. |
| Testing | Vitest for logic; Playwright for Electron E2E later | |

On Rust: the UI is the same either way; only the shell changes. Rust adds learning time on the critical path of a UX validation. If you want the learning project, do it as a **sidecar later** (e.g. a Rust PDF extraction/indexing tool) or as a shell swap once the product is proven. The ACP SDK also exists in Rust, so a Tauri port is not blocked.

### 7.1 Repository layout

```
qrabbit/
  apps/
    desktop/            # electron-vite: main, preload, renderer
  packages/
    workspace/          # file formats, parse/write, index, watcher (Node only, no Electron)
    acp-client/         # ACP connection, registry, sessions, sign-in flow (Node only)
    pdf/                # extraction, anchoring, text.md generation (Node and browser)
    shared/             # ids, zod schemas, types used everywhere
  tools/
    spike-acp/          # build-order step 0; later a manual test harness for acp-client
  planning/
```

Why a monorepo:

- The step-0 spike becomes `acp-client` instead of throwaway code.
- `workspace` and `acp-client` are tested with Vitest and no Electron in the loop.
- The nice-to-haves (MCP server, CLI exporter) are new packages over the same libraries, not forks of app code.
- The rule that the renderer never touches disk or processes becomes a dependency rule: the renderer may not import `workspace` or `acp-client`.

Rules: pnpm workspaces; TypeScript project references; one Vitest config per package; plain `pnpm -r` scripts, adding Turborepo only if builds get slow; native modules (`better-sqlite3`, `node-pty`) externalised in electron-vite and rebuilt with `@electron/rebuild`. Keep to these five packages until something forces a sixth.

---

## 8. MVP scope

### Must have

1. Electron app; home screen of collections; open/create a collection folder; header switchers for collection and source; threads popover.
2. Add PDF, Markdown and web-page sources; extract text with page markers.
3. PDF reader with selection, highlights, margin markers, saved reading position.
4. Selection actions: *Explore*, *Ask here*, *Note*.
5. Threads: root chat list, linear messages, quoted anchored spans.
6. Rich messages: Markdown with LaTeX (KaTeX, inline and display), code blocks with highlighting, tables; rendering stays stable while text streams in.
7. Branches from any message span; push/pop thread panel with breadcrumb; collapsible outline.
8. ACP client: Claude Code adapter working end to end with subscription login via terminal auth and a model picker. Streaming, tool-call display, permission handling per §5.6.
9. `AGENTS.md` generation; context assembly per §5.5; `[p.N]` citations linked into the reader.
10. Files-as-truth persistence (§6) with a rebuildable SQLite index and folder watching.
11. Lazy branch context: cached branch summaries with concept tags, digests attached to the next message in an ancestor thread with a passive chip, hover summaries on branch markers; panel collapse; positions persisted per source and per thread.
12. Event log.
13. Production-grade basics: crash-safe writes, error surfaces, updates via electron-builder, signed builds when testers arrive.

### Nice to have

- Codex and Copilot adapters (should be nearly free once the generic client exists).
- Full-text search across sources and threads.
- Direct-API provider (Anthropic SDK) behind the `Provider` interface, with server-side citations and caching.
- Workspace MCP server exposing thread/concept search to the agent.
- Export a thread or workspace to a single Markdown document.
- *Explore region*: crop the selected area of a PDF page (a figure or an equation) and send it as an image block to agents that accept images. Fixes the garbled-equation problem properly.
- Dimmed or inverted PDF pages for night reading.

### Explicitly deferred

- Flashcards and spaced repetition (concept tags from resolution are the seed).
- Concept graph, prerequisite recommendations, research memory.
- Related-paper discovery, citation following.
- Aggregate analytics across users (events are the seed; privacy and consent first).
- Multi-agent orchestration, agent switching mid-thread.
- Collaboration and publishing.

---

## 9. Build order

0. **Spike — done 2026-09-25.** `tools/spike-acp` spawns `claude-agent-acp`, reuses the existing Claude Code sign-in (Max plan, reported by the adapter's auth push), lists the model and effort options, changes one, streams a reply to a prompt with an embedded passage and a resource link, and handles two permission requests under the §5.6 policy (a shell command refused, a write under `notes/` allowed). About 20 s per turn at low effort. Findings in `tools/spike-acp/README.md`; the reusable parts live in `packages/acp-client`. Repeat for `codex-acp` when the second agent is chosen.
1. **Collections + reader — done 2026-09-25.** `apps/desktop` with the home screen, folder open through the OS dialog, header switchers for collection, source and threads, PDF import, PDF.js 6 rendering with lazy pages and fit-to-width, text extraction to `text.md` with page markers, selection → anchor (quote, prefix, suffix, offsets, page) → highlight rendering with margin markers, remembered page per source. Threads came in early so anchors have a home: *Explore* creates a thread file with the anchor, *Ask here* puts a quoted span into the focused thread's composer and saves the message. Verified by a scripted Playwright run with screenshots (`tools/dev/drive-desktop.mjs`, `.claude/skills/run-desktop`). Zoom (Ctrl with plus, minus, 0, or Ctrl+wheel, remembered per source) and a draggable, remembered divider between paper and panel were added after the first dogfooding notes, along with PDF.js's end-of-content selection guard, which had been missing and made drag-selection flicker to the whole page. Not yet: Markdown sources in the reader, first-run polish.
2. **Threads — done 2026-09-25** (root threads with step 1, branches after step 3). Selecting inside an answer offers *Explore*; the branch file is created at once under the parent's folder with a message anchor, and the parent session writes the handoff in the background (§5.5), shown in the branch and used by its first turn, with the parent transcript as the fallback. Branch spans are lit inside answers with the Custom Highlight API and carry a marker that opens the branch. Breadcrumb and outline navigate the tree; the Threads popover lists roots only. After a branch turn its session writes a cached summary with concept tags; when an ancestor is next asked, digests of branches active since its last turn ride along and the message records them in `context`, shown as an "included N branches" chip. Verified by the scripted drive: branch, handoff, branch answer, marker in the parent, and a parent follow-up that carried the branch over. Not yet: the background summary prefetch when an ancestor's composer gains focus (summaries are written right after each branch turn instead), Markdown sources in the reader.
3. **Agent wiring — done 2026-09-25.** One agent process per open collection in the main process, spawned on Electron's bundled Node with the collection as its working directory; one ACP session per thread; the §5.5 first-turn context (preamble, thread history when a session restarts, the anchored passage with surrounding text from `text.md`, a resource link) and per-message quoted passages; streaming into the panel with the activity list, permission cards for anything outside the §5.6 auto-allow policy, a Stop button, and model and effort pickers fed by the agent's config options and remembered per thread; replies saved to the thread file; sign-in from the header through the agent's own terminal flow; Markdown with KaTeX for answers. Verified end to end by the scripted drive: a real turn on the Max plan answered with page citations in about 20 s. Not yet exercised in the UI: a permission card (the run's only tool call was an auto-allowed read). Not yet built: the handoff, because branches from message spans are still to come (step 2's remainder), lazy branch context, and the embedded sign-in terminal.
4. **Branch summaries + events + polish:** lazy branch context and cached summaries are done (step 2). Keyboard shortcuts and a Settings dialog (agent connection and sign-in, per-collection defaults for model and effort stored in the manifest, reopen-last-collection, the shortcut reference) were added 2026-09-25. Web-page sources and the article reader arrived 2026-09-26: a URL is fetched in the main process, reduced to its article with Readability, turned into Markdown with turndown (links and images made absolute, editing chrome stripped, and formulas recovered as LaTeX from image alt text, MathML annotations, MathJax spans and scripts, so `$…$` and `$$…$$` render with KaTeX in the reader and reach the agent as maths rather than image links, with the macros a page declares for MathJax (`Macros: {…}`, `\newcommand`) saved on the source and a small default table in the renderer for sites that render to images and keep their preamble server side, such as Spinning Up's `\underE`; code blocks published as `<pre>` full of highlighter spans become fenced blocks tagged with the language the wrapper recorded, and admonitions such as Sphinx's "You Should Know" become blockquotes opening with a bold title, which the article view draws as a callout) and saved under `sources/<slug>/` as `source.md` plus `text.md` with the link on its first lines; Markdown and web sources open in a paper-styled article view where selection, threads, comments and bookmarks work as for PDFs, links open in the system browser, and anchors are located by quote search rather than offsets, both in the reader and when the passage is assembled for the agent. The app icon (the header's lime "Q" tile, rendered to `apps/desktop/resources/` by `tools/dev/make-icon.mjs`) is set on the window and the Windows taskbar, with an app user model id of its own, ready for packaging to pick up. Still to do: event log, error handling for agent failures and oversized sources, packaging. The reading list (`planning/plan-sources.md`) arrived 2026-09-26: the collection shows itself as a list in the reader pane with manual order kept in `qrabbit.json`, read marks as dates in `source.json`, removal to `.qrabbit/trash/` with undo, and adding selected files from a folder with duplicates recognised by content hash; verified by `tools/dev/drive-sources.mjs`.
5. **Dogfood milestone:** read three hard papers with QRabbit and three with plain Claude. Record events. Decide what to build next from that, not from this document.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Anthropic changes subscription rules for third-party use again | ACP keeps agents swappable; Console login is already offered by the same adapter; notice in settings. Ask Anthropic before wide distribution. |
| Agent turns are slow (tool reads) for simple questions | Section text inline in the prompt; keep sessions warm; show streamed thoughts so waiting feels purposeful. |
| Highlight anchoring breaks on re-extraction or odd PDFs | Quote + prefix/suffix re-anchoring with fuzzy fallback; page scoping; mark unanchorable highlights rather than dropping them. |
| Branch handoff loses nuance or arrives late | Handoff is written by the parent session, which has the full context (§5.5); the explored span is always included verbatim; mechanical digest as fallback; measure in dogfooding. |
| Background summaries run too often or too late | Only dirty branches, only when an ancestor's composer gains focus, at most once per new activity; mechanical digest if the summary is not ready when the message is sent. |
| Files-as-truth concurrency bugs | Single-writer rule, atomic writes, watcher-driven reload, index rebuild on mismatch. |
| Copilot has no model picker over ACP | Use the Copilot SDK path for that agent, or accept no picker at first. |
| Math-heavy PDFs extract poorly, garbling equations in `text.md` and in selections | `AGENTS.md` tells the agent to read the PDF page directly when text looks garbled; page-scoped anchoring still works; *Explore region* as an image is the proper fix (nice-to-have). |
| Scope creep before validation | The dogfood milestone gates every new feature. |

---

## 11. Open questions

1. **[open] Source-span *Explore* while a thread is focused:** always a new root thread (current proposal), or also offer "branch from here" so the new thread hangs off the focused one and receives its handoff?
2. **[open] Nested vs flat thread files** (§6.2).
3. **[open] Panel behaviour:** reader and thread panel resizable side by side, or can the thread panel go full-width with the reader collapsed? This affects how "return" feels.
4. **[open] Sign-in dialog:** confirm the embedded-pty dialog in §5.8 as the MVP design, with the OS-terminal shortcut only for the spike.
5. **[open] Which second agent** to wire after Claude Code: Codex (biggest user base) or Copilot (cleanest policy)?
6. **[open] Name.** Still QRabbit for now.
7. **[open] Accent colour and theme order:** dark-first with the paper as the bright surface (§4.4). Which accent, and is a light theme needed before testers?

---

## 12. Success criteria

The MVP succeeds if, on a hard paper, you can highlight, ask, branch several levels deep, go back up and keep asking with the branch carried along, find the paper exactly where you left it, and a week later recover what you learned, and that feels substantially better than a separate chat window. Measure with the dogfood milestone in §9 rather than by impression alone.

---

## 13. Long-term direction

None of this is for the MVP. It is listed so the data model leaves room for it. The event log and concept tags in this plan exist so these can be built later without a migration.

### 13.1 Question-driven learning

Flashcards should come from the reader's actual confusion, not from bulk extraction of facts from a paper. If the same concept is explored across several sources, the system suggests a card:

```
Concept: low-dimensional manifold
  Paper A → asked what it means
  Paper B → asked again
  Paper C → asked for an example
→ suggest a flashcard
```

Concept tags in branch summaries are the seed. Later: spaced repetition, review of previously difficult concepts, "teach this back to me", prerequisite checks.

### 13.2 Research memory and concept graph

Remember what the reader has already established, and avoid re-explaining concepts their branch summaries already cover unless asked. Recurring concepts across sources form a graph:

```
Paper A ──┐
          ├── self-attention ── transformer
Paper B ──┘                 └── positional encoding
```

Prerequisite recommendations follow from it: "you may want to understand X before continuing."

### 13.3 Related research

From inside an exploration: find relevant papers, supporting or contradicting evidence, follow citations, connect concepts across sources.

### 13.4 Resource-level intelligence

Across many readers, the event log can reveal which passages generate questions, which concepts are repeatedly misunderstood, common prerequisite gaps, which explanations resolve confusion, and where readers abandon a thread. That becomes a difficulty map of a resource and a set of prerequisite chains, which is valuable to authors, educators and publishers.

The system should learn **what readers struggle with**, never who they are. Aggregate data must be anonymised, consent-based, and designed for privacy from the start.

### 13.5 Multiple agents over one research graph

Because the workspace is a folder with a documented layout, other agents and clients can operate over the same research state. A workspace MCP server exposing thread and concept search is the first step; specialised agents (related-work search, prerequisite tutoring) can follow without changing the store.

### 13.6 Inferred understanding

The product never asks the reader whether they understood, because the answer is an estimate and the question is friction. If an estimate is ever useful (for review suggestions, for the resource-level maps in §13.4), it can be inferred from behaviour already in the event log: whether a concept is explored again in a later source, how deep the branch went, whether the reader returned or abandoned it, how long they stayed. This is noted so the log keeps capturing those signals. It is not a feature to build, and it must never surface as a grade the reader is shown.

---

## 14. Product philosophy

The product encourages curiosity rather than preventing distraction. A rabbit hole is not the problem; losing the way back is. So it must be cheap to:

1. follow curiosity,
2. go arbitrarily deep,
3. preserve exactly what was learned,
4. return to the original context,
5. continue reading.

Every UX decision is judged against that loop.

---

## 15. Naming

Working name: **QRabbit**. The Q carries question, query, curiosity and quest:

> question → rabbit hole → understanding

Alternatives considered: Rabbithole, Burrow, Warren, Tangent, Digress, Delve, Fathom. The final name is undecided.
