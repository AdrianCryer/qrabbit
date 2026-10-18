import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Anchor, Annotation, ReaderPosition, SourceInfo, ThreadMeta } from "@qrabbit/shared";
import { api } from "../lib/api";
import { ensureWorker, pdfjs, type PDFDocumentProxy, type TextItem } from "../pdf/pdfjs";
import { buildTextMd, guessTitle, pageTextFromItems } from "../pdf/text";
import { anchorToRange, layerText, rectsForRange, selectionToAnchor, type PageContext } from "../pdf/anchoring";
import { lowerEndOfContent, raiseEndOfContent } from "../pdf/selection-guard";
import { isTyping, matches } from "../lib/shortcuts";
import { Icon } from "./Icons";

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
  onTextExtracted(text: string, pages: number, titles?: { metadata?: string; guess?: string }): void;
};

const SIDE_PADDING = 40;
const MAX_PAGE_WIDTH = 900;
const MARGIN_GUTTER = 48;

export function Reader(props: Props) {
  const { collectionPath, source, threads, annotations, focusedThreadId, focusTarget, canAskHere, onPosition, onExplore, onAskHere, onOpenThread, onBookmark, onComment, onUpdateAnnotation, onDeleteAnnotation, onTextExtracted } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const contexts = useRef(new Map<number, PageContext>());
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Array<{ w: number; h: number }>>([]);
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]));
  const [texts, setTexts] = useState<{ pages: string[]; starts: number[] } | null>(null);
  const [status, setStatus] = useState<string | null>("Opening…");
  const [sel, setSel] = useState<{ anchor: Anchor; left: number; top: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(() => props.position?.zoom ?? 1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const restored = useRef(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const currentPage = useRef(props.position?.page ?? 1);

  const marks = useMemo<Mark[]>(() => marksFor(source.id, threads, annotations), [threads, annotations, source.id]);

  // ----- load the document -----
  useEffect(() => {
    let cancelled = false;
    let loading: { destroy(): Promise<void> } | null = null;
    contexts.current.clear();
    restored.current = false;
    setDoc(null);
    setSizes([]);
    setTexts(null);
    setError(null);
    setStatus("Opening…");
    (async () => {
      try {
        ensureWorker();
        const bytes = await api.sources.readBytes(collectionPath, source.id);
        const task = pdfjs.getDocument({ data: bytes });
        loading = task;
        const d = await task.promise;
        if (cancelled) return;
        const s: Array<{ w: number; h: number }> = [];
        for (let i = 1; i <= d.numPages; i++) {
          const p = await d.getPage(i);
          const v = p.getViewport({ scale: 1 });
          s.push({ w: v.width, h: v.height });
        }
        if (cancelled) return;
        setSizes(s);
        setDoc(d);
        setStatus(source.hasText ? null : "Extracting text…");
      } catch (err) {
        if (!cancelled) setError(String((err as Error)?.message ?? err));
      }
    })();
    return () => {
      cancelled = true;
      void loading?.destroy();
    };
  }, [collectionPath, source.id]);

  // ----- extract page text once; it defines every offset the app stores -----
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const pages: string[] = [];
      let firstItems: TextItem[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        const items = tc.items as TextItem[];
        if (i === 1) firstItems = items;
        pages.push(pageTextFromItems(items));
        if (cancelled) return;
      }
      const built = buildTextMd(pages);
      setTexts({ pages, starts: built.starts });
      setStatus(null);
      if (!source.hasText) {
        // The PDF's own title field, plus the largest text on the first page for files whose field is empty or junk.
        let metadata: string | undefined;
        try {
          const md = await doc.getMetadata();
          const info = md.info as { Title?: unknown };
          if (typeof info?.Title === "string") metadata = info.Title;
        } catch {
          /* metadata is optional */
        }
        const guess = guessTitle(firstItems);
        onTextExtracted(built.text, doc.numPages, { ...(metadata ? { metadata } : {}), ...(guess ? { guess } : {}) });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // ----- fit to width -----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - SIDE_PADDING));
    setWidth(el.clientWidth - SIDE_PADDING);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    const first = sizes[0];
    if (!first || width <= 0) return 1;
    // Leave room on both sides so margin markers sit beside the page instead of overflowing it.
    return Math.min(2.5, Math.max(0.4, Math.min(width - 2 * MARGIN_GUTTER, MAX_PAGE_WIDTH) / first.w));
  }, [sizes, width]);
  const scale = fitScale * zoom;

  // ----- zoom: keep the same document point under the top of the viewport -----
  const prevScale = useRef(scale);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (root && prevScale.current > 0 && prevScale.current !== scale) root.scrollTop = root.scrollTop * (scale / prevScale.current);
    prevScale.current = scale;
  }, [scale]);
  const zoomBy = useCallback((factor: number) => setZoom((z) => Math.min(3, Math.max(0.5, Math.round(z * factor * 100) / 100))), []);
  const selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (matches(e, "Mod+=")) { e.preventDefault(); zoomBy(1.1); return; }
      if (matches(e, "Mod+-")) { e.preventDefault(); zoomBy(1 / 1.1); return; }
      if (matches(e, "Mod+0")) { e.preventDefault(); setZoom(1); return; }
      const current = selRef.current;
      // Bookmark the selection if there is one, else the page in view.
      if (matches(e, "Mod+D")) {
        e.preventDefault();
        if (current) { setSel(null); onBookmark(current.anchor.page ?? currentPage.current, current.anchor); }
        else onBookmark(currentPage.current);
        return;
      }
      // Selection actions, only while the toolbar is showing.
      if (!current) return;
      if (matches(e, "E")) { e.preventDefault(); setSel(null); onExplore(current.anchor); }
      else if (matches(e, "A")) { e.preventDefault(); setSel(null); onAskHere(current.anchor); }
      else if (matches(e, "C")) { e.preventDefault(); setSel(null); setEditor({ mode: "new", anchor: current.anchor, left: current.left, top: current.top }); }
      else if (matches(e, "B")) { e.preventDefault(); setSel(null); onBookmark(current.anchor.page ?? currentPage.current, current.anchor); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoomBy, onExplore, onAskHere, onBookmark]);

  const openMark = useCallback(
    (mark: Mark, pageEl: HTMLElement, rect: DOMRect | null) => {
      if (mark.kind === "thread") { onOpenThread(mark.id); return; }
      const a = annotations.find((x) => x.id === mark.id);
      if (!a) return;
      const top = pageEl.offsetTop + (rect ? rect.y + rect.height : 8);
      const left = pageEl.offsetLeft + (rect ? rect.x : 40);
      setEditor({ mode: "edit", annotation: a, left, top });
    },
    [annotations, onOpenThread],
  );
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    // React registers wheel listeners as passive, so a native one is needed to swallow Ctrl+wheel.
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // ----- selection guard, see pdf/selection-guard.ts -----
  // Each layer raises its end-of-content block on mousedown (PageView). It stays up while the pointer is
  // down, through the collapsed selection that follows the press, and comes down when the pointer does.
  useEffect(() => {
    const layers = () => Array.from(scrollRef.current?.querySelectorAll<HTMLElement>(".textLayer") ?? []);
    const lowerAll = () => { for (const l of layers()) lowerEndOfContent(l); };
    let pointerDown = false;
    const onPointerDown = () => { pointerDown = true; };
    const onPointerUp = () => { pointerDown = false; lowerAll(); };
    const onChange = () => {
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) { lowerAll(); setSel(null); return; }
      if (s.isCollapsed) setSel(null);
      // A drag that crosses onto another page raises that page's block too.
      const all = layers();
      const active = new Set<HTMLElement>();
      for (let i = 0; i < s.rangeCount; i++) {
        const r = s.getRangeAt(i);
        for (const l of all) if (!active.has(l) && r.intersectsNode(l)) active.add(l);
      }
      for (const l of all) {
        if (!active.has(l)) lowerEndOfContent(l);
        else if (pointerDown) l.classList.add("selecting");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    window.addEventListener("blur", onPointerUp);
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("blur", onPointerUp);
      document.removeEventListener("selectionchange", onChange);
    };
  }, []);

  // ----- lazy rendering -----
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || sizes.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset["page"]);
            if (e.isIntersecting) next.add(n);
          }
          return next.size === prev.size ? prev : next;
        });
      },
      { root, rootMargin: "1200px 0px" },
    );
    pageRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [sizes.length]);

  // ----- remembered position -----
  useEffect(() => {
    if (restored.current || sizes.length === 0 || width <= 0) return;
    restored.current = true;
    const page = props.position?.page ?? 1;
    const el = pageRefs.current[page - 1];
    if (el && scrollRef.current) scrollRef.current.scrollTop = Math.max(0, el.offsetTop - 22);
  }, [sizes.length, width, props.position?.page]);

  useEffect(() => {
    if (!focusTarget) return;
    const root = scrollRef.current;
    const el = pageRefs.current[focusTarget.page - 1];
    if (!el || !root) return;
    root.scrollTo({ top: Math.max(0, el.offsetTop - 22), behavior: "smooth" });
    // Once the page has rendered its marks, settle on the mark itself.
    const id = focusTarget.markId;
    if (!id) return;
    let tries = 0;
    const tick = () => {
      const m = root.querySelector<HTMLElement>(`.marker[data-mark-id="${CSS.escape(id)}"]`);
      if (m) {
        const y = el.offsetTop + m.offsetTop;
        root.scrollTo({ top: Math.max(0, y - root.clientHeight / 3), behavior: "smooth" });
        m.classList.add("flash");
        window.setTimeout(() => m.classList.remove("flash"), 1600);
        return;
      }
      if (++tries < 12) window.setTimeout(tick, 150);
    };
    window.setTimeout(tick, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTarget?.key]);

  const saveTimer = useRef<number | null>(null);
  const onScroll = () => {
    setSel(null);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const root = scrollRef.current;
      if (!root) return;
      let page = 1;
      for (let i = 0; i < pageRefs.current.length; i++) {
        const el = pageRefs.current[i];
        if (el && el.offsetTop + el.offsetHeight > root.scrollTop + 40) { page = i + 1; break; }
      }
      currentPage.current = page;
      onPosition({ page, scrollTop: root.scrollTop, zoom: zoomRef.current });
    }, 300);
  };
  useEffect(() => {
    // Remember the zoom level with the position.
    const root = scrollRef.current;
    if (!root || !restored.current) return;
    onPosition({ page: props.position?.page ?? 1, scrollTop: root.scrollTop, zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // ----- selection → anchor -----
  const onMouseUp = (e: React.MouseEvent) => {
    // Clicks on the toolbar, a margin marker or the comment editor are not new selections.
    if ((e.target as Element).closest(".seltool, .marker, .ceditor")) return;
    window.setTimeout(() => {
      const s = window.getSelection();
      const root = scrollRef.current;
      if (!s || !root) return;
      const res = selectionToAnchor(s, contexts.current.values(), source.id);
      if (!res || res.rects.length === 0) { setSel(null); return; }
      const first = res.rects[0]!;
      const pageEl = res.ctx.pageEl;
      setSel({ anchor: res.anchor, left: pageEl.offsetLeft + first.x, top: pageEl.offsetTop + first.y });
    }, 0);
  };
  const registerContext = useCallback((ctx: PageContext) => { contexts.current.set(ctx.page, ctx); }, []);

  if (error) {
    return (
      <div className="reader"><div className="empty"><div className="box"><h3>Could not open this PDF</h3><p>{error}</p></div></div></div>
    );
  }

  return (
    <div className="reader">
      <div className="rscroll" ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp}>
        {sizes.map((size, i) => {
          const n = i + 1;
          return (
            <PageView
              key={n}
              ref={(el) => { pageRefs.current[i] = el; }}
              doc={doc}
              n={n}
              scale={scale}
              size={size}
              visible={visible.has(n)}
              pageText={texts?.pages[i] ?? null}
              pageStart={texts?.starts[i] ?? 0}
              marks={marks.filter((m) => m.page === n)}
              focusedThreadId={focusedThreadId}
              onContext={registerContext}
              onMark={openMark}
            />
          );
        })}
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
            <button title="Comment on this passage" onClick={() => { const s = sel; setSel(null); setEditor({ mode: "new", anchor: s.anchor, left: s.left, top: s.top }); }}><Icon name="comment" />Comment <kbd>C</kbd></button>
            <button title="Bookmark this passage" onClick={() => { const s = sel; setSel(null); onBookmark(s.anchor.page ?? currentPage.current, s.anchor); }}><Icon name="bookmark" />Bookmark <kbd>B</kbd></button>
          </div>
        )}
        {editor && (
          <MarkEditor
            state={editor}
            onClose={() => setEditor(null)}
            onSave={(text) => {
              if (editor.mode === "new") onComment(editor.anchor, editor.anchor.page, text);
              else onUpdateAnnotation(editor.annotation.id, text);
              setEditor(null);
            }}
            onDelete={editor.mode === "edit" ? () => { onDeleteAnnotation(editor.annotation.id); setEditor(null); } : undefined}
          />
        )}
      </div>
      {status && <div className="rstatus">{status}</div>}
      {sizes.length > 0 && (
        <div className="zoom" role="group" aria-label="Zoom">
          <button onClick={() => onBookmark(currentPage.current)} title="Bookmark this page (Ctrl+D)"><Icon name="bookmark" size={13} /></button>
          <span className="zsep" />
          <button onClick={() => zoomBy(1 / 1.1)} title="Zoom out (Ctrl −)">−</button>
          <button className="pct" onClick={() => setZoom(1)} title="Fit to width (Ctrl 0)">{Math.round(zoom * 100)}%</button>
          <button onClick={() => zoomBy(1.1)} title="Zoom in (Ctrl +)">+</button>
        </div>
      )}
    </div>
  );
}

// ---------- one page ----------
import { forwardRef } from "react";

type PageProps = {
  doc: PDFDocumentProxy | null;
  n: number;
  scale: number;
  size: { w: number; h: number };
  visible: boolean;
  pageText: string | null;
  pageStart: number;
  marks: Mark[];
  focusedThreadId: string | null;
  onContext(ctx: PageContext): void;
  onMark(mark: Mark, pageEl: HTMLElement, rect: DOMRect | null): void;
};

type Box = { mark: Mark; rects: DOMRect[] };

const PageView = forwardRef<HTMLDivElement, PageProps>(function PageView(
  { doc, n, scale, size, visible, pageText, pageStart, marks, focusedThreadId, onContext, onMark },
  ref,
) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [renderedAt, setRenderedAt] = useState(0);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const w = size.w * scale;
  const h = size.h * scale;

  const setRefs = (el: HTMLDivElement | null) => {
    pageRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };

  useEffect(() => {
    if (!visible || !doc || pageText === null) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    (async () => {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const tl = textRef.current;
      if (!canvas || !tl || cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const rt = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      task = rt;
      try { await rt.promise; } catch { return; }
      if (cancelled) return;
      tl.replaceChildren();
      // PDF.js 6 sizes text runs from --total-scale-factor; older builds read --scale-factor. Set both.
      tl.style.setProperty("--scale-factor", String(viewport.scale));
      tl.style.setProperty("--total-scale-factor", String(viewport.scale));
      const tc = await page.getTextContent();
      const layer = new pdfjs.TextLayer({ textContentSource: tc, container: tl, viewport });
      await layer.render();
      if (cancelled) return;
      // Selection guard, see the selectionchange handler in Reader.
      const end = document.createElement("div");
      end.className = "endOfContent";
      tl.append(end);
      if (import.meta.env.DEV && layerText(tl) !== pageText) console.warn(`[reader] text layer differs from extracted text on page ${n}`);
      onContext({ page: n, pageEl: pageRef.current!, textLayer: tl, pageText, pageStart });
      setRenderedAt(scale);
    })();
    return () => { cancelled = true; task?.cancel(); };
  }, [visible, doc, n, scale, pageText, pageStart, onContext]);

  useEffect(() => {
    const tl = textRef.current;
    const pageEl = pageRef.current;
    if (!tl || !pageEl || renderedAt === 0 || pageText === null) { setBoxes([]); return; }
    const ctx: PageContext = { page: n, pageEl, textLayer: tl, pageText, pageStart };
    const out: Box[] = [];
    for (const mark of marks) {
      if (!mark.anchor) { out.push({ mark, rects: [] }); continue; }
      const range = anchorToRange(ctx, mark.anchor);
      out.push({ mark, rects: range ? rectsForRange(range, pageEl) : [] });
    }
    setBoxes(out);
  }, [renderedAt, marks, n, pageText, pageStart]);

  // Markers sit in the right margin at their span's first line; ones that share a line step right.
  const markers = useMemo(() => {
    const items = boxes
      .map((b) => ({ b, y: b.rects[0]?.y ?? 8 }))
      .sort((p, q) => p.y - q.y);
    let lastY = -100;
    let col = 0;
    return items.map((it) => {
      col = Math.abs(it.y - lastY) < 14 ? col + 1 : 0;
      lastY = it.y;
      return { ...it, col };
    });
  }, [boxes]);

  return (
    <div className="page" ref={setRefs} data-page={n} style={{ width: w, height: h }}>
      {renderedAt === 0 && <div className="placeholder">{n}</div>}
      <canvas ref={canvasRef} />
      <div className="hlLayer" aria-hidden="true">
        {boxes.map((b) =>
          b.rects.map((r, i) => (
            <div
              key={`${b.mark.id}:${i}`}
              className={`hl ${b.mark.kind === "thread" ? `h${b.mark.hue}` : b.mark.kind} ${b.mark.id === focusedThreadId ? "focused" : ""}`}
              style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
            />
          )),
        )}
      </div>
      {markers.map(({ b, y, col }) => {
        const m = b.mark;
        const cls = m.kind === "thread" ? `marker h${m.hue}` : `marker ${m.kind}`;
        const title = m.kind === "thread" ? `Thread: ${m.title}` : m.kind === "comment" ? m.title : `Bookmark: ${m.title}`;
        return (
          <button key={m.id} className={cls} data-mark-id={m.id} style={{ top: y, right: -40 - col * 30 }} title={title} onClick={() => onMark(m, pageRef.current!, b.rects[0] ?? null)}>
            {m.kind === "thread" ? "1" : <Icon name={m.kind} size={11} />}
          </button>
        );
      })}
      <div className="textLayer" ref={textRef} onMouseDown={(e) => raiseEndOfContent(e.currentTarget, e.target, e.clientX, e.clientY)} />
    </div>
  );
});
