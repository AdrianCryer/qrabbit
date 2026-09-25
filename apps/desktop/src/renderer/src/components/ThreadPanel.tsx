import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Anchor, ConfigOption, Message, ThreadMeta } from "@qrabbit/shared";
import { useStore, type TurnState } from "../state/store";
import { anchorToRangeIn, offsetsForRange, rectsForRange, selectorFor, textOfElement } from "../pdf/anchoring";
import { isTyping, matches } from "../lib/shortcuts";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";

// ---------- thread tree helpers ----------
function ancestorsOf(all: ThreadMeta[], t: ThreadMeta): ThreadMeta[] {
  const out: ThreadMeta[] = [];
  let cur: ThreadMeta | undefined = t;
  const seen = new Set<string>();
  while (cur?.parent && !seen.has(cur.parent.thread)) {
    seen.add(cur.parent.thread);
    const p = all.find((x) => x.id === cur!.parent!.thread);
    if (!p) break;
    out.unshift(p);
    cur = p;
  }
  return out;
}

function treeRows(all: ThreadMeta[], rootId: string): Array<{ t: ThreadMeta; depth: number }> {
  const rows: Array<{ t: ThreadMeta; depth: number }> = [];
  const visit = (id: string, depth: number) => {
    const t = all.find((x) => x.id === id);
    if (!t) return;
    rows.push({ t, depth });
    for (const c of all.filter((x) => x.parent?.thread === id).sort((a, b) => (a.created < b.created ? -1 : 1))) visit(c.id, depth + 1);
  };
  visit(rootId, 0);
  return rows;
}

// ---------- highlight registry (Custom Highlight API) ----------
type HL = { add(r: Range): void; delete(r: Range): boolean };
function highlightFor(name: string): HL | null {
  const g = globalThis as unknown as { CSS?: { highlights?: Map<string, HL> }; Highlight?: new () => HL };
  const reg = g.CSS?.highlights;
  if (!reg || !g.Highlight) return null;
  let hl = reg.get(name);
  if (!hl) {
    hl = new g.Highlight();
    reg.set(name, hl);
  }
  return hl;
}

// ---------- pieces ----------
function QuoteCard({ anchor, hue, from }: { anchor: Anchor; hue: number; from?: string }) {
  return (
    <div className={`quote h${hue}`}>
      <span className="from">
        <Icon name={anchor.target === "message" ? "branch" : "file"} />
        {anchor.target === "message" ? `from ${from ?? "the parent thread"}` : anchor.source}
        {anchor.page ? <span className="cite">p.{anchor.page}</span> : null}
      </span>
      {anchor.quote}
    </div>
  );
}

/** An assistant message with any branches that start inside it lit up and marked. */
function AssistantBody({ m, branches, onOpen }: { m: Message; branches: ThreadMeta[]; onOpen(id: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<Array<{ id: string; hue: number; x: number; y: number }>>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const added: Array<[HL, Range]> = [];
    const next: typeof marks = [];
    for (const b of branches) {
      if (!b.anchor) continue;
      const range = anchorToRangeIn(el, b.anchor);
      if (!range) continue;
      const hl = highlightFor(`qr-h${b.hue}`);
      if (hl) {
        hl.add(range);
        added.push([hl, range]);
      }
      const rects = rectsForRange(range, el);
      const first = rects[0];
      if (first) next.push({ id: b.id, hue: b.hue, x: first.x + first.width, y: first.y });
    }
    setMarks(next);
    return () => {
      for (const [hl, range] of added) hl.delete(range);
    };
  }, [m.body, branches]);

  return (
    <div className="mdwrap">
      <div ref={ref}>
        <Markdown text={m.body} />
      </div>
      {marks.map((mk) => (
        <button key={mk.id} className={`bmark h${mk.hue}`} style={{ left: mk.x + 4, top: mk.y - 1 }} title="Open this branch" onClick={() => onOpen(mk.id)}>
          <Icon name="branch" size={10} />
        </button>
      ))}
    </div>
  );
}

function MessageView({ m, hue, agentName, branches, threads, onOpen }: { m: Message; hue: number; agentName: string; branches: ThreadMeta[]; threads: ThreadMeta[]; onOpen(id: string): void }) {
  const included = (m.context ?? []).map((id) => threads.find((t) => t.id === id)?.title ?? id);
  return (
    <div className={`msg ${m.role}`} data-msg-id={m.id}>
      <div className="who">
        <b>{m.role === "user" ? "You" : m.role === "assistant" ? agentName : "Note"}</b>
        <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="body">
        {m.quote && <QuoteCard anchor={m.quote} hue={hue} />}
        {m.role === "user" ? m.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <AssistantBody m={m} branches={branches} onOpen={onOpen} />}
        {included.length > 0 && (
          <span className="ctxchip" title={included.join("\n")}>
            <Icon name="branch" size={11} />
            included {included.length} {included.length === 1 ? "branch" : "branches"}
          </span>
        )}
      </div>
    </div>
  );
}

const statusIcon = (status?: string) => (status === "completed" ? "check" : status === "failed" ? "x" : "spin");

function TurnView({ turn, agentName, threadId }: { turn: TurnState; agentName: string; threadId: string }) {
  const replyPermission = useStore((s) => s.replyPermission);
  const perm = turn.permission;
  return (
    <div className="msg assistant">
      <div className="who">
        <b>{agentName}</b>
        <span>{turn.running ? "working" : turn.error ? "stopped" : "done"}</span>
        {turn.running && <span className="spin" aria-hidden="true"><Icon name="spin" /></span>}
      </div>
      <div className="body">
        {turn.activity.length > 0 && (
          <div className="act" aria-label="Agent activity">
            {turn.activity.map((a) => (
              <div key={a.id} className="row">
                <span className={a.status === "completed" ? "ok" : a.status === "failed" ? "bad" : "spin"}>
                  <Icon name={statusIcon(a.status)} />
                </span>
                <span className="t" title={a.paths?.join("\n")}>{a.title}</span>
                {a.kind && <span className="d">{a.kind}</span>}
              </div>
            ))}
          </div>
        )}
        {perm && perm.threadId === threadId && (
          <div className="perm" role="group" aria-label="Permission request">
            <div className="q">
              <Icon name="lock" />
              <span>
                {agentName} wants to {perm.kind ? `${perm.kind}: ` : ""}
                <code>{perm.title}</code>
                {perm.paths.length > 0 && <> on <code>{perm.paths.join(", ")}</code></>}
              </span>
            </div>
            <div className="btns">
              {perm.options.map((o) => (
                <button key={o.optionId} className={`btn ${o.kind === "allow_once" ? "primary" : ""}`} onClick={() => replyPermission(perm.id, o.optionId)}>
                  {o.name}
                </button>
              ))}
              <button className="btn" onClick={() => replyPermission(perm.id, null)}>Cancel</button>
            </div>
          </div>
        )}
        {turn.text ? <Markdown text={turn.text} /> : turn.running && turn.activity.length === 0 ? <p className="muted">Thinking…</p> : null}
        {turn.running && <span className="cursor" aria-hidden="true" />}
        {turn.error && <p className="err">{turn.error}</p>}
      </div>
    </div>
  );
}

function Picker({ option, onPick }: { option: ConfigOption; onPick: (value: string) => void }) {
  if (option.type !== "select" || !option.options) return null;
  const current = option.options.find((o) => o.value === option.currentValue);
  const groups = new Map<string, typeof option.options>();
  for (const o of option.options) {
    const g = o.group ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }
  return (
    <Dropdown up triggerClass="pick" title={option.name} label={<><span className="lbl">{option.name.toLowerCase()}</span>{current?.name ?? String(option.currentValue)}<Icon name="chevron" size={12} /></>}>
      {(close) => (
        <>
          {[...groups.entries()].map(([g, opts]) => (
            <div key={g}>
              {g && <div className="mh">{g}</div>}
              {opts.map((o) => (
                <button key={o.value} className={`mi ${o.value === option.currentValue ? "cur" : ""}`} role="menuitem" onClick={() => { close(); onPick(o.value); }}>
                  <span className="txt">
                    <span className="t">{o.name}</span>
                    {o.description && <span className="m">{o.description}</span>}
                  </span>
                  {o.value === option.currentValue && <Icon name="check" />}
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </Dropdown>
  );
}

// ---------- the panel ----------
export function ThreadPanel() {
  const thread = useStore((s) => s.thread);
  const allThreads = useStore((s) => s.collection?.threads ?? []);
  const focus = useStore((s) => s.focus);
  const composerQuote = useStore((s) => s.composerQuote);
  const agent = useStore((s) => s.agent);
  const turn = useStore((s) => (s.thread ? s.turns[s.thread.id] : undefined));
  const options = useStore((s) => (s.thread ? s.configOptions[s.thread.id] : undefined));
  const { closePanel, setFocus, clearComposerQuote, sendMessage, cancelTurn, setConfig, openThread, branch, deleteThread } = useStore.getState();
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msgSel, setMsgSel] = useState<{ anchor: Anchor; messageId: string; left: number; top: number } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  const ancestors = useMemo(() => (thread ? ancestorsOf(allThreads, thread) : []), [allThreads, thread]);
  const rootId = ancestors[0]?.id ?? thread?.id ?? "";
  const rows = useMemo(() => (rootId ? treeRows(allThreads, rootId) : []), [allThreads, rootId]);
  const parent = ancestors[ancestors.length - 1];

  useEffect(() => { setDraft(""); setMsgSel(null); setConfirmDelete(false); }, [thread?.id]);
  useEffect(() => { if (composerQuote) taRef.current?.focus(); }, [composerQuote]);
  // The composer grows with its text up to a cap, then scrolls inside itself.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(220, Math.max(44, ta.scrollHeight))}px`;
  }, [draft, thread?.id]);
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.id, thread?.messages.length, turn?.text.length, turn?.activity.length, turn?.permission?.id]);
  useEffect(() => {
    const onChange = () => { const s = window.getSelection(); if (!s || s.isCollapsed) setMsgSel(null); };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  // E explores a selection inside an answer while its toolbar is showing.
  const msgSelRef = useRef(msgSel);
  msgSelRef.current = msgSel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = msgSelRef.current;
      if (!cur || isTyping(e) || !matches(e, "E")) return;
      e.preventDefault();
      setMsgSel(null);
      void branch(cur.messageId, cur.anchor);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [branch]);

  if (!thread) return null;
  const hue = thread.hue;
  const agentName = agent?.agent?.name?.includes("claude") ? "Claude Code" : agent?.agent?.name ?? "Agent";
  const running = !!turn?.running;
  const modelOpt = options?.find((o) => o.category === "model" || o.id === "model");
  const effortOpt = options?.find((o) => o.category === "thought_level" || o.id === "effort");
  const branchesOf = (messageId: string) => allThreads.filter((t) => t.parent?.thread === thread.id && t.parent.message === messageId);
  const subtreeCount = rows.filter((r) => r.t.id !== thread.id && (r.t.parent?.thread === thread.id || ancestorsOf(allThreads, r.t).some((a) => a.id === thread.id))).length;
  const removalNeedsConfirm = thread.messages.length > 0 || subtreeCount > 0;

  const send = () => {
    if (running) { cancelTurn(); return; }
    if (!draft.trim() && !composerQuote) return;
    void sendMessage(draft);
    setDraft("");
  };

  // Selecting inside an answer offers Explore: a branch anchored to that span.
  const onMsgsMouseUp = () => {
    window.setTimeout(() => {
      const sel = window.getSelection();
      const container = msgsRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !container) { setMsgSel(null); return; }
      const range = sel.getRangeAt(0);
      const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as Element) : range.startContainer.parentElement;
      const md = startEl?.closest(".msg.assistant[data-msg-id] .md") as HTMLElement | null;
      const messageId = (startEl?.closest(".msg.assistant[data-msg-id]") as HTMLElement | null)?.dataset["msgId"];
      if (!md || !messageId) { setMsgSel(null); return; }
      const offs = offsetsForRange(md, range);
      if (!offs) return;
      const s = selectorFor(textOfElement(md), offs[0], offs[1]);
      if (!s) return;
      const rect = rectsForRange(range, container)[0];
      if (!rect) return;
      setMsgSel({ anchor: { target: "message", thread: thread.id, message: messageId, ...s }, messageId, left: rect.x, top: rect.y });
    }, 0);
  };

  return (
    <section className="panel" aria-label="Thread">
      <div className="phead">
        <div className="crumbs">
          <span>Threads</span>
          {ancestors.map((a, i) => (
            <span key={a.id} className="crumb">
              <span className="sep">›</span>
              {ancestors.length > 2 && i > 0 && i < ancestors.length - 1 ? (
                <button title={a.title} onClick={() => void openThread(a.id)}>…</button>
              ) : (
                <button title={a.title} onClick={() => void openThread(a.id)}>{a.title}</button>
              )}
            </span>
          ))}
          <span className="sep">›</span>
          <span className="cur">{thread.title}</span>
        </div>
        <div className="pactions">
          <button className="btn icon" aria-pressed={focus} title={focus ? "Show the paper" : "Hide the paper"} onClick={() => setFocus(!focus)}>
            <Icon name="file" />
          </button>
          <Dropdown align="right" triggerClass="btn icon" title="Thread actions" label={<Icon name="more" />}>
            {(close) =>
              !removalNeedsConfirm ? (
                <button className="mi danger" role="menuitem" onClick={() => { close(); void deleteThread(thread.id); }}>
                  <Icon name="trash" />
                  <span className="txt"><span className="t">Remove this thread</span><span className="m">It has no messages yet</span></span>
                </button>
              ) : !confirmDelete ? (
                <button className="mi danger" role="menuitem" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" />
                  <span className="txt">
                    <span className="t">Remove thread…</span>
                    <span className="m">
                      {thread.messages.length} {thread.messages.length === 1 ? "message" : "messages"}
                      {subtreeCount > 0 ? ` and ${subtreeCount} ${subtreeCount === 1 ? "branch" : "branches"}` : ""}
                    </span>
                  </span>
                </button>
              ) : (
                <div className="confirm">
                  <span>Delete the thread file{subtreeCount > 0 ? " and its branches" : ""} from the collection? This cannot be undone.</span>
                  <div className="btns">
                    <button className="btn" onClick={() => { close(); setConfirmDelete(false); void deleteThread(thread.id); }}>Delete</button>
                    <button className="btn" onClick={() => { setConfirmDelete(false); close(); }}>Keep</button>
                  </div>
                </div>
              )
            }
          </Dropdown>
          <button className="btn icon" title="Collapse panel (Esc)" onClick={closePanel}>
            <Icon name="collapse" />
          </button>
        </div>
      </div>

      <div className="outline">
        {rows.map(({ t, depth }) => (
          <button key={t.id} className={`node ${t.id === thread.id ? "cur" : ""}`} style={{ paddingLeft: 8 + depth * 16 }} onClick={() => void openThread(t.id)}>
            <span className={`dot h${t.hue}`} />
            <span className="t">{t.title}</span>
            <span className="st">{t.anchor?.page ? `p.${t.anchor.page}` : t.parent ? "branch" : ""}</span>
          </button>
        ))}
      </div>

      <div className="msgs" ref={msgsRef} onMouseUp={onMsgsMouseUp} onScroll={() => setMsgSel(null)}>
        {thread.parent && (
          <details className="handoff">
            <summary>
              <Icon name="branch" />
              Handoff from {parent?.title ?? "the parent thread"}
              <span className="chip">{thread.handoff ? "written by parent session" : "being written…"}</span>
            </summary>
            {thread.handoff ? (
              <Markdown text={thread.handoff} />
            ) : (
              <p>The parent session is writing a handoff for this branch. You can ask right away; it is included if it is ready in time.</p>
            )}
          </details>
        )}
        {thread.anchor && (
          <div className="msg user">
            <div className="who"><b>Started from</b></div>
            <div className="body">
              <QuoteCard anchor={thread.anchor} hue={hue} from={parent?.title} />
            </div>
          </div>
        )}
        {thread.messages.map((m) => (
          <MessageView key={m.id} m={m} hue={hue} agentName={agentName} branches={branchesOf(m.id)} threads={allThreads} onOpen={(id) => void openThread(id)} />
        ))}
        {turn && (turn.running || turn.text || turn.error || turn.activity.length > 0) && <TurnView turn={turn} agentName={agentName} threadId={thread.id} />}
        {!agent?.connected && (
          <div className="pnote">{agent?.error ? `The agent could not start: ${agent.error}` : "Connecting to the agent…"}</div>
        )}
        {msgSel && (
          <div className="seltool msg-tool" role="toolbar" style={{ left: msgSel.left, top: msgSel.top }} onMouseDown={(e) => e.preventDefault()}>
            <button className="primary" onClick={() => { const s = msgSel; setMsgSel(null); void branch(s.messageId, s.anchor); }}>
              <Icon name="branch" />
              Explore <kbd>E</kbd>
            </button>
          </div>
        )}
      </div>

      <div className="composer">
        {composerQuote && (
          <div className={`cq h${hue}`}>
            <div>
              <div className="from">
                <Icon name="file" />
                Quoting {composerQuote.page ? `p.${composerQuote.page}` : composerQuote.source} · anchored to this thread
              </div>
              {composerQuote.quote}
            </div>
            <button className="x" title="Remove the quote (Esc)" aria-label="Remove the quote" onClick={clearComposerQuote}>
              <Icon name="x" />
            </button>
          </div>
        )}
        <textarea
          ref={taRef}
          rows={2}
          value={draft}
          placeholder={running ? `${agentName} is answering. Type to queue a follow-up.` : composerQuote ? `Ask about this passage in ${thread.title}` : thread.parent ? "Ask about this branch" : "Ask a follow-up, or highlight the paper and choose Ask here"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter adds a line. Never send while an IME is composing.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!running) send();
            } else if (e.key === "Escape" && composerQuote) {
              e.preventDefault();
              e.stopPropagation();
              clearComposerQuote();
            }
          }}
        />
        <div className="crow">
          <span className="pick" title={agent?.auth?.label ?? "Not signed in"}>
            <Icon name="terminal" />
            {agent?.connected ? (agent.auth?.label ?? agentName) : "No agent"}
          </span>
          {modelOpt && <Picker option={modelOpt} onPick={(v) => void setConfig(modelOpt.id, v)} />}
          {effortOpt && <Picker option={effortOpt} onPick={(v) => void setConfig(effortOpt.id, v)} />}
          <button className={`send ${running ? "stop" : ""}`} title={running ? "Stop" : "Send (Enter · Shift+Enter for a new line)"} onClick={send} disabled={!running && !draft.trim() && !composerQuote}>
            {running ? <Icon name="stop" /> : <Icon name="up" />}
          </button>
        </div>
      </div>
    </section>
  );
}
