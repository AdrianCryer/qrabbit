import { useEffect, useRef, useState } from "react";
import type { Anchor, Message } from "@qrabbit/shared";
import { useStore } from "../state/store";
import { Icon } from "./Icons";

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

function MessageView({ m, hue }: { m: Message; hue: number }) {
  return (
    <div className={`msg ${m.role}`}>
      <div className="who">
        <b>{m.role === "user" ? "You" : m.role === "assistant" ? "Agent" : "Note"}</b>
        <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div className="body">
        {m.quote && <QuoteCard anchor={m.quote} hue={hue} />}
        {m.body.split(/\n{2,}/).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </div>
  );
}

export function ThreadPanel() {
  const thread = useStore((s) => s.thread);
  const focus = useStore((s) => s.focus);
  const composerQuote = useStore((s) => s.composerQuote);
  const { closePanel, setFocus, clearComposerQuote, sendMessage } = useStore.getState();
  const [draft, setDraft] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft("");
  }, [thread?.id]);

  useEffect(() => {
    if (composerQuote) taRef.current?.focus();
  }, [composerQuote]);

  useEffect(() => {
    const el = msgsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length]);

  if (!thread) return null;
  const hue = thread.hue;

  const send = () => {
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
          <MessageView key={m.id} m={m} hue={hue} />
        ))}
        <div className="pnote">
          Messages are saved to <code>{thread.file}</code>. The agent connection is the next build step, so nothing answers yet.
        </div>
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
          placeholder={composerQuote ? `Ask about this passage in ${thread.title}` : "Ask a follow-up, or highlight the paper and choose Ask here"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="crow">
          <span className="pick"><Icon name="terminal" />No agent</span>
          <span className="pick"><span className="lbl">model</span>—</span>
          <button className="send" title="Send (Ctrl+Enter)" onClick={send} disabled={!draft.trim() && !composerQuote}>
            <Icon name="up" />
          </button>
        </div>
      </div>
    </section>
  );
}
