import type { Anchor } from "@qrabbit/shared";

/** What the reader knows about one rendered page. */
export type PageContext = {
  page: number;
  pageEl: HTMLElement;
  textLayer: HTMLElement;
  /** Text of this page by the rule in text.ts; equals the text layer's text nodes plus "\n" per <br>. */
  pageText: string;
  /** Offset of this page's text inside text.md. */
  pageStart: number;
};

type Seg = { node: Text | null; start: number; end: number };

/** Walk the text layer once and record where each text node (or <br>) sits in the page text. */
function segments(textLayer: HTMLElement): Seg[] {
  const segs: Seg[] = [];
  let off = 0;
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) {
      const len = (n as Text).data.length;
      if (len) {
        segs.push({ node: n as Text, start: off, end: off + len });
        off += len;
      }
    } else if ((n as Element).tagName === "BR") {
      segs.push({ node: null, start: off, end: off + 1 });
      off += 1;
    }
  }
  return segs;
}

/** Text as the layer actually renders it. Should equal PageContext.pageText; used to detect drift. */
export function layerText(textLayer: HTMLElement): string {
  return segments(textLayer)
    .map((s) => (s.node ? s.node.data : "\n"))
    .join("");
}

function offsetOf(segs: Seg[], node: Node, nodeOffset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const seg = segs.find((s) => s.node === node);
    return seg ? seg.start + nodeOffset : null;
  }
  // Element container: resolve to the first text node at or after the child index.
  const children = Array.from(node.childNodes);
  for (let i = nodeOffset; i < children.length; i++) {
    const c = children[i]!;
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const first = c.nodeType === Node.TEXT_NODE ? c : walker.nextNode();
    if (first) {
      const seg = segs.find((s) => s.node === first);
      if (seg) return seg.start;
    }
  }
  // Past the last child: the end of the last text segment inside this element.
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (s.node && node.contains(s.node)) return s.end;
  }
  return null;
}

/** Rectangles of a DOM range relative to the page element, deduplicated. */
export function rectsForRange(range: Range, pageEl: HTMLElement): DOMRect[] {
  const base = pageEl.getBoundingClientRect();
  const out: DOMRect[] = [];
  const seen = new Set<string>();
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 0.5 || r.height < 0.5) continue;
    const rect = new DOMRect(r.left - base.left, r.top - base.top, r.width, r.height);
    const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rect);
  }
  return out;
}

const CONTEXT = 32;

/** Turn the current selection into an anchor on the page it starts in. */
export function selectionToAnchor(
  sel: Selection,
  pages: Iterable<PageContext>,
  sourceId: string,
): { anchor: Anchor; rects: DOMRect[]; ctx: PageContext } | null {
  if (sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  let ctx: PageContext | undefined;
  for (const p of pages) if (p.textLayer.contains(range.startContainer)) { ctx = p; break; }
  if (!ctx) return null;

  const segs = segments(ctx.textLayer);
  let start = offsetOf(segs, range.startContainer, range.startOffset);
  if (start === null) return null;
  let end = ctx.textLayer.contains(range.endContainer) ? offsetOf(segs, range.endContainer, range.endOffset) : ctx.pageText.length;
  if (end === null) end = ctx.pageText.length;
  const text = ctx.pageText;
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  if (end <= start) return null;

  const anchor: Anchor = {
    target: "source",
    source: sourceId,
    page: ctx.page,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    start: ctx.pageStart + start,
    end: ctx.pageStart + end,
  };
  return { anchor, rects: rectsForRange(range, ctx.pageEl), ctx };
}

// ---------- re-anchoring ----------

function normalized(s: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      if (!inSpace && text.length) { text += " "; map.push(i); }
      inSpace = true;
    } else {
      text += ch.toLowerCase();
      map.push(i);
      inSpace = false;
    }
  }
  return { text, map };
}

function allIndices(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = hay.indexOf(needle);
  while (i !== -1) { out.push(i); i = hay.indexOf(needle, i + 1); }
  return out;
}

function commonSuffixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Locate an anchor's quote in a page's text: exact first, whitespace/case-insensitive second. */
export function findQuote(pageText: string, anchor: Anchor, pageStart: number): [number, number] | null {
  const expected = anchor.start - pageStart;
  const pick = (cands: Array<[number, number]>): [number, number] | null => {
    if (cands.length === 0) return null;
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const pre = pageText.slice(Math.max(0, c[0] - CONTEXT), c[0]);
      const suf = pageText.slice(c[1], c[1] + CONTEXT);
      const score = commonSuffixLen(pre, anchor.prefix) + commonPrefixLen(suf, anchor.suffix) - Math.abs(c[0] - expected) / 200;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  };

  const exact = pick(allIndices(pageText, anchor.quote).map((i) => [i, i + anchor.quote.length] as [number, number]));
  if (exact) return exact;

  const hay = normalized(pageText);
  const needle = normalized(anchor.quote).text;
  const fuzzy = allIndices(hay.text, needle).map((i) => {
    const s = hay.map[i]!;
    const e = hay.map[i + needle.length - 1]! + 1;
    return [s, e] as [number, number];
  });
  return pick(fuzzy);
}

/** Build a DOM range for an anchor on a rendered page, or null if the text is not there. */
export function anchorToRange(ctx: PageContext, anchor: Anchor): Range | null {
  const found = findQuote(ctx.pageText, anchor, ctx.pageStart);
  if (!found) return null;
  const [s, e] = found;
  const segs = segments(ctx.textLayer);
  let startSeg: Seg | undefined;
  for (const seg of segs) if (seg.node && s < seg.end && s >= seg.start) { startSeg = seg; break; }
  if (!startSeg) for (const seg of segs) if (seg.node && seg.start >= s) { startSeg = seg; break; }
  let endSeg: Seg | undefined;
  for (let i = segs.length - 1; i >= 0; i--) { const seg = segs[i]!; if (seg.node && e > seg.start && e <= seg.end) { endSeg = seg; break; } }
  if (!endSeg) for (let i = segs.length - 1; i >= 0; i--) { const seg = segs[i]!; if (seg.node && seg.end <= e) { endSeg = seg; break; } }
  if (!startSeg?.node || !endSeg?.node) return null;
  const range = document.createRange();
  range.setStart(startSeg.node, Math.max(0, Math.min(startSeg.node.data.length, s - startSeg.start)));
  range.setEnd(endSeg.node, Math.max(0, Math.min(endSeg.node.data.length, e - endSeg.start)));
  return range;
}
