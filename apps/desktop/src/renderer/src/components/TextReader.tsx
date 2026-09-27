import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Anchor, Annotation, ReaderPosition, SourceInfo, ThreadMeta } from "@qrabbit/shared";
import { api } from "../lib/api";
import { highlightFor, type HL } from "../lib/highlights";
import { isTyping, matches } from "../lib/shortcuts";
import { anchorToRangeIn, offsetsForRange, rectsForRange, selectorFor, textOfElement } from "../pdf/anchoring";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";
import { MarkEditor, marksFor, type EditorState, type Mark } from "./MarkEditor";

type Props = {
  collectionPath: string;
  source: SourceInfo;
  threads: ThreadMeta[];
  annotations: Annotation[];
  position?: ReaderPosition;
  focusedThreadId: string | null;
  focusTarget: { page: number; key: number; markId?: string } | null;
  canAskHere: boolean;
  onPosition(pos: ReaderPosition): void;
  onExplore(anchor: Anchor): void;
  onAskHere(anchor: Anchor): void;
  onOpenThread(id: string): void;
  onBookmark(page: number, anchor?: Anchor): void;
  onComment(anchor: Anchor, page: number | undefined, text: string): void;
  onUpdateAnnotation(id: string, text: string): void;
  onDeleteAnnotation(id: string): void;
};

type Placed = { mark: Mark; x: number; y: number; col: number };

/** Markdown and web sources: one rendered article, with the same selection, marks and keys as the PDF reader. */
export function TextReader(props: Props) {
  const { collectionPath, source, threads, annotations, focusedThreadId, focusTarget, canAskHere, onPosition, onExplore, onAskHere, onOpenThread, onBookmark, onComment, onUpdateAnnotation, onDeleteAnnotation } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(() => props.position?.zoom ?? 1);
  const [sel, setSel] = useState<{ anchor: Anchor; left: number; top: number } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [layoutKey, setLayoutKey] = useState(0);
  const restored = useRef(false);
  const selRef = useRef(sel);
  selRef.current = sel;

  const marks = useMemo<Mark[]>(() => marksFor(source.id, threads, annotations), [threads, annotations, source.id]);

  // ----- load -----
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    restored.current = false;
    api.sources
      .readText(collectionPath, source.id)
      .then((t) => {
        if (cancelled) return;
        setText((t ?? "").replace(/^<!--\s*page 1\s*-->\r?\n/, ""));
      })
      .catch((err) => { if (!cancelled) setError(String((err as Error)?.message ?? err)); });
    return () => { cancelled = true; };
  }, [collectionPath, source.id]);

  // ----- marks: highlights through the Custom Highlight API, markers in the sheet's margin -----
  useLayoutEffect(() => {
    const article = articleRef.current;
    const sheet = sheetRef.current;
    if (!article || !sheet || text === null) { setPlaced([]); return; }
    const added: Array<[HL, Range]> = [];
    const items: Array<{ mark: Mark; y: number }> = [];
    for (const mark of marks) {
      if (!mark.anchor) { items.push({ mark, y: 8 }); continue; }
      const range = anchorToRangeIn(article, mark.anchor);
      if (!range) continue;
      const name = mark.kind === "thread" ? `qr-h${mark.hue}` : `qr-${mark.kind}`;
      const hl = highlightFor(name);
      if (hl) { hl.add(range); added.push([hl, range]); }
      const first = rectsForRange(range, sheet)[0];
      items.push({ mark, y: first ? first.y : 8 });
    }
    items.sort((a, b) => a.y - b.y);
    let lastY = -100;
    let col = 0;
    setPlaced(items.map((it) => { col = Math.abs(it.y - lastY) < 14 ? col + 1 : 0; lastY = it.y; return { mark: it.mark, x: 0, y: it.y, col }; }));
    return () => { for (const [hl, range] of added) hl.delete(range); };
  }, [text, marks, zoom, layoutKey]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const ro = new ResizeObserver(() => setLayoutKey((k) => k + 1));
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [text]);

  // ----- position -----
  useEffect(() => {
    if (text === null || restored.current) return;
    restored.current = true;
    const root = scrollRef.current;
    if (root) root.scrollTop = props.position?.scrollTop ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  const saveTimer = useRef<number | null>(null);
  const onScroll = () => {
    setSel(null);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const root = scrollRef.current;
      if (root) onPosition({ page: 1, scrollTop: root.scrollTop, zoom });
    }, 300);
  };
  useEffect(() => {
    if (!focusTarget?.markId) return;
    const root = scrollRef.current;
    const id = focusTarget.markId;
    let tries = 0;
    const tick = () => {
      const m = root?.querySelector<HTMLElement>(`.marker[data-mark-id="${CSS.escape(id)}"]`);
      if (m && root) {
        root.scrollTo({ top: Math.max(0, m.offsetTop + (sheetRef.current?.offsetTop ?? 0) - root.clientHeight / 3), behavior: "smooth" });
        m.classList.add("flash");
        window.setTimeout(() => m.classList.remove("flash"), 1600);
        return;
      }
      if (++tries < 12) window.setTimeout(tick, 150);
    };
    window.setTimeout(tick, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.key]);

  // ----- selection → anchor -----
  const onMouseUp = (e: React.MouseEvent) => {
    // Clicks on the toolbar, a margin marker or the comment editor are not new selections.
    if ((e.target as Element).closest(".seltool, .marker, .ceditor")) return;
    window.setTimeout(() => {
      const s = window.getSelection();
      const article = articleRef.current;
      const root = scrollRef.current;
      if (!s || !article || !root || s.isCollapsed || s.rangeCount === 0) { setSel(null); return; }
      const range = s.getRangeAt(0);
      if (!article.contains(range.startContainer)) { setSel(null); return; }
      const offs = offsetsForRange(article, range);
      if (!offs) return;
      const selector = selectorFor(textOfElement(article), offs[0], offs[1]);
      if (!selector) return;
      const rect = rectsForRange(range, root)[0];
      if (!rect) return;
      setSel({ anchor: { target: "source", source: source.id, page: 1, ...selector }, left: rect.x, top: rect.y });
    }, 0);
  };
  useEffect(() => {
    const onChange = () => { const s = window.getSelection(); if (!s || s.isCollapsed) setSel(null); };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  // ----- keys -----
  const zoomBy = useCallback((f: number) => setZoom((z) => Math.min(2, Math.max(0.7, Math.round(z * f * 100) / 100))), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (matches(e, "Mod+=")) { e.preventDefault(); zoomBy(1.1); return; }
      if (matches(e, "Mod+-")) { e.preventDefault(); zoomBy(1 / 1.1); return; }
      if (matches(e, "Mod+0")) { e.preventDefault(); setZoom(1); return; }
      const cur = selRef.current;
      if (matches(e, "Mod+D")) { e.preventDefault(); if (cur) { setSel(null); onBookmark(1, cur.anchor); } else onBookmark(1); return; }
      if (!cur) return;
      if (matches(e, "E")) { e.preventDefault(); setSel(null); onExplore(cur.anchor); }
      else if (matches(e, "A")) { e.preventDefault(); setSel(null); onAskHere(cur.anchor); }
      else if (matches(e, "C")) { e.preventDefault(); setSel(null); setEditor({ mode: "new", anchor: cur.anchor, left: cur.left, top: cur.top }); }
      else if (matches(e, "B")) { e.preventDefault(); setSel(null); onBookmark(1, cur.anchor); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomBy, onExplore, onAskHere, onBookmark]);

  const openMark = (mark: Mark, y: number) => {
    if (mark.kind === "thread") { onOpenThread(mark.id); return; }
    const a = annotations.find((x) => x.id === mark.id);
    const sheet = sheetRef.current;
    if (!a || !sheet) return;
    setEditor({ mode: "edit", annotation: a, left: sheet.offsetLeft + 40, top: sheet.offsetTop + y + 20 });
  };

  let host = "";
  try {
    if (source.url) host = new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }

  if (error) return <div className="reader"><div className="empty"><div className="box"><h3>Could not open this source</h3><p>{error}</p></div></div></div>;

  return (
    <div className="reader">
      <div className="rscroll" ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp}>
        <article className="sheet article" ref={sheetRef} style={{ fontSize: `${16 * zoom}px` }}>
          {(source.url || source.byline || source.siteName) && (
            <div className="webhead">
              <Icon name={source.kind === "web" ? "globe" : "lines"} />
              {source.url ? (
                <a href={source.url} onClick={(e) => { e.preventDefault(); window.open(source.url); }} title={source.url}>{host || source.url}</a>
              ) : (
                <span>{source.file}</span>
              )}
              {source.byline && <span>· {source.byline}</span>}
              {source.fetched && <span>· saved {new Date(source.fetched).toLocaleDateString()}</span>}
            </div>
          )}
          <div ref={articleRef}>{text === null ? <p className="muted">Opening…</p> : <Markdown text={text} />}</div>
          {placed.map(({ mark, y, col }) => {
            const cls = mark.kind === "thread" ? `marker h${mark.hue}` : `marker ${mark.kind}`;
            const title = mark.kind === "thread" ? `Thread: ${mark.title}` : mark.kind === "comment" ? mark.title : `Bookmark: ${mark.title}`;
            return (
              <button key={mark.id} className={`${cls} ${mark.id === focusedThreadId ? "focused" : ""}`} data-mark-id={mark.id} style={{ top: y, right: -40 - col * 30 }} title={title} onClick={() => openMark(mark, y)}>
                {mark.kind === "thread" ? "1" : <Icon name={mark.kind} size={11} />}
              </button>
            );
          })}
        </article>
        {sel && (
          <div className="seltool" role="toolbar" style={{ left: sel.left, top: sel.top }} onMouseDown={(e) => e.preventDefault()}>
            {canAskHere ? (
              <>
                <button className="primary" onClick={() => { const s = sel; setSel(null); onAskHere(s.anchor); }}><Icon name="chat" />Ask here <kbd>A</kbd></button>
                <button onClick={() => { const s = sel; setSel(null); onExplore(s.anchor); }}><Icon name="branch" />New thread <kbd>E</kbd></button>
              </>
            ) : (
              <>
                <button className="primary" onClick={() => { const s = sel; setSel(null); onExplore(s.anchor); }}><Icon name="branch" />Explore <kbd>E</kbd></button>
                <button onClick={() => { const s = sel; setSel(null); onAskHere(s.anchor); }}><Icon name="chat" />Ask here <kbd>A</kbd></button>
              </>
            )}
            <button onClick={() => { const s = sel; setSel(null); setEditor({ mode: "new", anchor: s.anchor, left: s.left, top: s.top }); }}><Icon name="comment" />Comment <kbd>C</kbd></button>
            <button onClick={() => { const s = sel; setSel(null); onBookmark(1, s.anchor); }}><Icon name="bookmark" />Bookmark <kbd>B</kbd></button>
          </div>
        )}
        {editor && (
          <MarkEditor
            state={editor}
            onClose={() => setEditor(null)}
            onSave={(t) => {
              if (editor.mode === "new") onComment(editor.anchor, 1, t);
              else onUpdateAnnotation(editor.annotation.id, t);
              setEditor(null);
            }}
            onDelete={editor.mode === "edit" ? () => { onDeleteAnnotation(editor.annotation.id); setEditor(null); } : undefined}
          />
        )}
      </div>
      <div className="zoom" role="group" aria-label="Text size">
        <button onClick={() => onBookmark(1)} title="Bookmark this article (Ctrl+D)"><Icon name="bookmark" size={13} /></button>
        <span className="zsep" />
        <button onClick={() => zoomBy(1 / 1.1)} title="Smaller text (Ctrl −)">−</button>
        <button className="pct" onClick={() => setZoom(1)} title="Default size (Ctrl 0)">{Math.round(zoom * 100)}%</button>
        <button onClick={() => zoomBy(1.1)} title="Larger text (Ctrl +)">+</button>
      </div>
    </div>
  );
}
