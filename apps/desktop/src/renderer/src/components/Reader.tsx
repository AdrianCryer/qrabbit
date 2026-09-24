import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Anchor, ReaderPosition, SourceInfo, ThreadMeta } from "@qrabbit/shared";
import { api } from "../lib/api";
import { ensureWorker, pdfjs, type PDFDocumentProxy, type TextItem } from "../pdf/pdfjs";
import { buildTextMd, pageTextFromItems } from "../pdf/text";
import { anchorToRange, layerText, rectsForRange, selectionToAnchor, type PageContext } from "../pdf/anchoring";
import { Icon } from "./Icons";

type Highlight = { threadId: string; hue: number; anchor: Anchor };

type Props = {
  collectionPath: string;
  source: SourceInfo;
  threads: ThreadMeta[];
  position?: ReaderPosition;
  focusedThreadId: string | null;
  focusTarget: { page: number; key: number } | null;
  canAskHere: boolean;
  onPosition(pos: ReaderPosition): void;
  onExplore(anchor: Anchor): void;
  onAskHere(anchor: Anchor): void;
  onOpenThread(id: string): void;
  onTextExtracted(text: string, pages: number, title?: string): void;
};

const SIDE_PADDING = 40;
const MAX_PAGE_WIDTH = 900;
const MARGIN_GUTTER = 48;

export function Reader(props: Props) {
  const { collectionPath, source, threads, focusedThreadId, focusTarget, canAskHere, onPosition, onExplore, onAskHere, onOpenThread, onTextExtracted } = props;
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
  const restored = useRef(false);

  const highlights = useMemo<Highlight[]>(
    () =>
      threads
        .filter((t) => t.anchor?.target === "source" && t.anchor.source === source.id)
        .map((t) => ({ threadId: t.id, hue: t.hue, anchor: t.anchor! })),
    [threads, source.id],
  );

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
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        pages.push(pageTextFromItems(tc.items as TextItem[]));
        if (cancelled) return;
      }
      const built = buildTextMd(pages);
      setTexts({ pages, starts: built.starts });
      setStatus(null);
      if (!source.hasText) {
        let title: string | undefined;
        try {
          const md = await doc.getMetadata();
          const info = md.info as { Title?: unknown };
          if (typeof info?.Title === "string") title = info.Title;
        } catch {
          /* metadata is optional */
        }
        onTextExtracted(built.text, doc.numPages, title);
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

  const scale = useMemo(() => {
    const first = sizes[0];
    if (!first || width <= 0) return 1;
    // Leave room on both sides so margin markers sit beside the page instead of overflowing it.
    return Math.min(2.5, Math.max(0.4, Math.min(width - 2 * MARGIN_GUTTER, MAX_PAGE_WIDTH) / first.w));
  }, [sizes, width]);

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
    const el = pageRefs.current[focusTarget.page - 1];
    if (el && scrollRef.current) scrollRef.current.scrollTo({ top: Math.max(0, el.offsetTop - 22), behavior: "smooth" });
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
      onPosition({ page, scrollTop: root.scrollTop, zoom: 1 });
    }, 300);
  };

  // ----- selection → anchor -----
  const onMouseUp = () => {
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
  useEffect(() => {
    const onChange = () => { const s = window.getSelection(); if (!s || s.isCollapsed) setSel(null); };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

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
              highlights={highlights.filter((h) => h.anchor.page === n)}
              focusedThreadId={focusedThreadId}
              onContext={registerContext}
              onMarker={onOpenThread}
            />
          );
        })}
        {sel && (
          <div className="seltool" role="toolbar" style={{ left: sel.left, top: sel.top }} onMouseDown={(e) => e.preventDefault()}>
            {canAskHere ? (
              <>
                <button className="primary" onClick={() => onAskHere(sel.anchor)}><Icon name="chat" />Ask here</button>
                <button onClick={() => onExplore(sel.anchor)}><Icon name="branch" />New thread</button>
              </>
            ) : (
              <>
                <button className="primary" onClick={() => onExplore(sel.anchor)}><Icon name="branch" />Explore</button>
                <button onClick={() => onAskHere(sel.anchor)}><Icon name="chat" />Ask here</button>
              </>
            )}
          </div>
        )}
      </div>
      {status && <div className="rstatus">{status}</div>}
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
  highlights: Highlight[];
  focusedThreadId: string | null;
  onContext(ctx: PageContext): void;
  onMarker(threadId: string): void;
};

const PageView = forwardRef<HTMLDivElement, PageProps>(function PageView(
  { doc, n, scale, size, visible, pageText, pageStart, highlights, focusedThreadId, onContext, onMarker },
  ref,
) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [renderedAt, setRenderedAt] = useState(0);
  const [boxes, setBoxes] = useState<Array<{ threadId: string; hue: number; rects: DOMRect[] }>>([]);
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
    const out: Array<{ threadId: string; hue: number; rects: DOMRect[] }> = [];
    for (const hl of highlights) {
      const range = anchorToRange(ctx, hl.anchor);
      if (!range) continue;
      out.push({ threadId: hl.threadId, hue: hl.hue, rects: rectsForRange(range, pageEl) });
    }
    setBoxes(out);
  }, [renderedAt, highlights, n, pageText, pageStart]);

  return (
    <div className="page" ref={setRefs} data-page={n} style={{ width: w, height: h }}>
      {renderedAt === 0 && <div className="placeholder">{n}</div>}
      <canvas ref={canvasRef} />
      <div className="hlLayer" aria-hidden="true">
        {boxes.map((b) =>
          b.rects.map((r, i) => (
            <div key={`${b.threadId}:${i}`} className={`hl h${b.hue} ${b.threadId === focusedThreadId ? "focused" : ""}`} style={{ left: r.x, top: r.y, width: r.width, height: r.height }} />
          )),
        )}
      </div>
      {boxes.map((b) => {
        const first = b.rects[0];
        if (!first) return null;
        return (
          <button key={b.threadId} className={`marker h${b.hue}`} style={{ top: first.y }} title="Open this thread" onClick={() => onMarker(b.threadId)}>
            1
          </button>
        );
      })}
      <div className="textLayer" ref={textRef} />
    </div>
  );
});
