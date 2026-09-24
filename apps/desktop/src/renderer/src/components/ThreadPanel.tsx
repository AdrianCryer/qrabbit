import { useEffect, useRef, useState } from "react";
import type { Anchor, ConfigOption, Message } from "@qrabbit/shared";
import { useStore, type TurnState } from "../state/store";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";

function QuoteCard({ anchor, hue }: { anchor: Anchor; hue: number }) {
  return (
    <div className={`quote h${hue}`}>
      <span className="from">
        <Icon name="file" />
        {anchor.source}
        {anchor.page ? <span className="cite">p.{anchor.page}</span> : null}
      </span>
      {anchor.quote}
    </div>
  );
}

function MessageView({ m, hue, agentName }: { m: Message; hue: number; agentName: string }) {
  return (
    <div className={`msg ${m.role}`}>
      <div className="who">
        <b>{m.role === "user" ? "You" : m.role === "assistant" ? agentName : "Note"}</b>
        <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="body">
        {m.quote && <QuoteCard anchor={m.quote} hue={hue} />}
        {m.role === "user" ? m.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : <Markdown text={m.body} />}
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
                {perm.paths.length > 0 && (
                  <>
                    {" "}
                    on <code>{perm.paths.join(", ")}</code>
                  </>
                )}
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

export function ThreadPanel() {
  const thread = useStore((s) => s.thread);
  const focus = useStore((s) => s.focus);
  const composerQuote = useStore((s) => s.composerQuote);
  const agent = useStore((s) => s.agent);
  const turn = useStore((s) => (s.thread ? s.turns[s.thread.id] : undefined));
  const options = useStore((s) => (s.thread ? s.configOptions[s.thread.id] : undefined));
  const { closePanel, setFocus, clearComposerQuote, sendMessage, cancelTurn, setConfig } = useStore.getState();
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(""); }, [thread?.id]);
  useEffect(() => { if (composerQuote) taRef.current?.focus(); }, [composerQuote]);
  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length, turn?.text.length, turn?.activity.length, turn?.permission?.id]);

  if (!thread) return null;
  const hue = thread.hue;
  const agentName = agent?.agent?.name?.includes("claude") ? "Claude Code" : agent?.agent?.name ?? "Agent";
  const running = !!turn?.running;
  const modelOpt = options?.find((o) => o.category === "model" || o.id === "model");
  const effortOpt = options?.find((o) => o.category === "thought_level" || o.id === "effort");

  const send = () => {
    if (running) { cancelTurn(); return; }
    if (!draft.trim() && !composerQuote) return;
    void sendMessage(draft);
    setDraft("");
  };

  return (
    <section className="panel" aria-label="Thread">
      <div className="phead">
        <div className="crumbs">
          <span>Threads</span>
          <span className="sep">›</span>
          <span className="cur">{thread.title}</span>
        </div>
        <div className="pactions">
          <button className="btn icon" aria-pressed={focus} title={focus ? "Show the paper" : "Hide the paper"} onClick={() => setFocus(!focus)}>
            <Icon name="file" />
          </button>
          <button className="btn icon" title="Collapse panel (Esc)" onClick={closePanel}>
            <Icon name="collapse" />
          </button>
        </div>
      </div>

      <div className="outline">
        <span className={`dot h${hue}`} />
        <span>{thread.title}</span>
        <span className="st">{thread.anchor?.page ? `p.${thread.anchor.page}` : thread.anchor ? "anchored" : "no anchor"}</span>
      </div>

      <div className="msgs" ref={msgsRef}>
        {thread.anchor && (
          <div className="msg user">
            <div className="who"><b>Started from</b></div>
            <div className="body">
              <QuoteCard anchor={thread.anchor} hue={hue} />
            </div>
          </div>
        )}
        {thread.messages.map((m) => (
          <MessageView key={m.id} m={m} hue={hue} agentName={agentName} />
        ))}
        {turn && (turn.running || turn.text || turn.error || turn.activity.length > 0) && <TurnView turn={turn} agentName={agentName} threadId={thread.id} />}
        {!agent?.connected && (
          <div className="pnote">
            {agent?.error ? `The agent could not start: ${agent.error}` : "Connecting to the agent…"}
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
            <button className="x" title="Remove quote" onClick={clearComposerQuote}>
              <Icon name="x" />
            </button>
          </div>
        )}
        <textarea
          ref={taRef}
          rows={2}
          value={draft}
          placeholder={running ? `${agentName} is answering. Type to queue a follow-up.` : composerQuote ? `Ask about this passage in ${thread.title}` : "Ask a follow-up, or highlight the paper and choose Ask here"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              if (!running) send();
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
          <button className={`send ${running ? "stop" : ""}`} title={running ? "Stop" : "Send (Ctrl+Enter)"} onClick={send} disabled={!running && !draft.trim() && !composerQuote}>
            {running ? <Icon name="stop" /> : <Icon name="up" />}
          </button>
        </div>
      </div>
    </section>
  );
}
