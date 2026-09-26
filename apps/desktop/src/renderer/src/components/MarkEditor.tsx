import { useEffect, useRef, useState } from "react";
import type { Anchor, Annotation } from "@qrabbit/shared";
import { Icon } from "./Icons";

/** Anything drawn on a source: a thread's anchor, a comment, or a bookmark. */
export type Mark = { id: string; kind: "thread" | "comment" | "bookmark"; hue?: number; anchor?: Anchor; page: number; title: string };

export type EditorState =
  | { mode: "new"; anchor: Anchor; left: number; top: number }
  | { mode: "edit"; annotation: Annotation; left: number; top: number };

/** Inline editor for a comment's text or a bookmark's label, positioned inside a scroll container. */
export function MarkEditor({ state, onClose, onSave, onDelete }: { state: EditorState; onClose(): void; onSave(text: string): void; onDelete?: () => void }) {
  const isBookmark = state.mode === "edit" && state.annotation.kind === "bookmark";
  const [text, setText] = useState(state.mode === "edit" ? state.annotation.text : "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const quote = state.mode === "new" ? state.anchor.quote : state.annotation.anchor?.quote;
  return (
    <div className="ceditor" style={{ left: state.left, top: state.top }} onMouseDown={(e) => e.stopPropagation()}>
      <div className="chead">
        <Icon name={isBookmark ? "bookmark" : "comment"} />
        <span>{isBookmark ? "Bookmark" : state.mode === "new" ? "New comment" : "Comment"}</span>
        {quote && <span className="cq-quote" title={quote}>{quote}</span>}
      </div>
      <textarea
        ref={ref}
        rows={isBookmark ? 1 : 3}
        value={text}
        placeholder={isBookmark ? "Label" : "Your note on this passage. It stays yours; the agent never sees it."}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
          else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (text.trim() || isBookmark) onSave(text); }
        }}
      />
      <div className="cbtns">
        <button className="btn primary" disabled={!text.trim() && !isBookmark} onClick={() => onSave(text)}>Save <kbd>Enter</kbd></button>
        <button className="btn" onClick={onClose}>Cancel</button>
        {onDelete && <button className="btn danger" onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}

/** Build the marks for one source from its threads and annotations. */
export function marksFor(
  sourceId: string,
  threads: Array<{ id: string; title: string; hue: number; anchor?: Anchor }>,
  annotations: Annotation[],
): Mark[] {
  const out: Mark[] = [];
  for (const t of threads) {
    if (t.anchor?.target === "source" && t.anchor.source === sourceId) {
      out.push({ id: t.id, kind: "thread", hue: t.hue, anchor: t.anchor, page: t.anchor.page ?? 1, title: t.title });
    }
  }
  for (const a of annotations) {
    if (a.source !== sourceId) continue;
    out.push({ id: a.id, kind: a.kind, anchor: a.anchor, page: a.page ?? a.anchor?.page ?? 1, title: a.text });
  }
  return out;
}
