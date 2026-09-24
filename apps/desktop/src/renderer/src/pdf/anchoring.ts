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

/** Walk an element once and record where each text node (or <br>) sits in its concatenated text. */
function segments(root: HTMLElement): Seg[] {
  const segs: Seg[] = [];
  let off = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
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

/** The element's text as its text nodes render it, with "\n" for each <br>. */
export function textOfElement(root: HTMLElement): string {
  return segments(root)
    .map((s) => (s.node ? s.node.data : "\n"))
    .join("");
}
/** @deprecated alias kept for the reader */
export const layerText = textOfElement;

function offsetOf(segs: Seg[], node: Node, nodeOffset: number): number | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const seg = segs.find((s) => s.node === node);
    return seg ? seg.start + nodeOffset : null;
  }
  const children = Array.from(node.childNodes);
  for (let i = nodeOffset; i < children.length; i++) {
    const c = children[i]!;
    const first = c.nodeType === Node.TEXT_NODE ? c : document.createTreeWalker(c, NodeFilter.SHOW_TEXT).nextNode();
    if (first) {
      const seg = segs.find((s) => s.node === first);
      if (seg) return seg.start;
    }
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i]!;
    if (s.node && node.contains(s.node)) return s.end;
  }
  return null;
}

/** Character offsets of a DOM range within an element's text, clamped to the element. */
export function offsetsForRange(root: HTMLElement, range: Range): [number, number] | null {
  const segs = segments(root);
  const start = root.contains(range.startContainer) ? offsetOf(segs, range.startContainer, range.startOffset) : 0;
  const total = segs.length ? segs[segs.length - 1]!.end : 0;
  const end = root.contains(range.endContainer) ? offsetOf(segs, range.endContainer, range.endOffset) : total;
  if (start === null || end === null) return null;
  return [Math.min(start, end), Math.max(start, end)];
}

/** A DOM range covering [s, e) of an element's text, skipping <br> newlines at the edges. */
export function rangeForOffsets(root: HTMLElement, s: number, e: number): Range | null {
  const segs = segments(root);
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

/** Rectangles of a DOM range relative to a container element, deduplicated. */
export function rectsForRange(range: Range, container: HTMLElement): DOMRect[] {
  const base = container.getBoundingClientRect();
  const out: DOMRect[] = [];
  const seen = new Set<string>();
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 0.5 || r.height < 0.5) continue;
    const rect = new DOMRect(r.left - base.left + container.scrollLeft, r.top - base.top + container.scrollTop, r.width, r.height);
    const key = `${Math.round(rect.x)}:${Math.round(rect.y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rect);
  }
  return out;
}

const CONTEXT = 32;

/** Trim whitespace off an offset pair and build the quote/prefix/suffix triple. */
export function selectorFor(text: string, start: number, end: number): { quote: string; prefix: string; suffix: string; start: number; end: number } | null {
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  if (end <= start) return null;
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    start,
    end,
  };
}

/** Turn the current selection into a source anchor on the page it starts in. */
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
  const offs = offsetsForRange(ctx.textLayer, range);
  if (!offs) return null;
  const sel2 = selectorFor(ctx.pageText, offs[0], offs[1]);
  if (!sel2) return null;
  const anchor: Anchor = {
    target: "source",
    source: sourceId,
    page: ctx.page,
    quote: sel2.quote,
    prefix: sel2.prefix,
    suffix: sel2.suffix,
    start: ctx.pageStart + sel2.start,
    end: ctx.pageStart + sel2.end,
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

/** Locate an anchor's quote in a text: exact first, whitespace/case-insensitive second. */
export function findQuote(text: string, anchor: Anchor, base: number): [number, number] | null {
  const expected = anchor.start - base;
  const pick = (cands: Array<[number, number]>): [number, number] | null => {
    if (cands.length === 0) return null;
    let best: [number, number] | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const pre = text.slice(Math.max(0, c[0] - CONTEXT), c[0]);
      const suf = text.slice(c[1], c[1] + CONTEXT);
      const score = commonSuffixLen(pre, anchor.prefix) + commonPrefixLen(suf, anchor.suffix) - Math.abs(c[0] - expected) / 200;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  };
  const exact = pick(allIndices(text, anchor.quote).map((i) => [i, i + anchor.quote.length] as [number, number]));
  if (exact) return exact;
  const hay = normalized(text);
  const needle = normalized(anchor.quote).text;
  const fuzzy = allIndices(hay.text, needle).map((i) => [hay.map[i]!, hay.map[i + needle.length - 1]! + 1] as [number, number]);
  return pick(fuzzy);
}

/** Build a DOM range for a source anchor on a rendered page, or null if the text is not there. */
export function anchorToRange(ctx: PageContext, anchor: Anchor): Range | null {
  const found = findQuote(ctx.pageText, anchor, ctx.pageStart);
  return found ? rangeForOffsets(ctx.textLayer, found[0], found[1]) : null;
}

/** Build a DOM range for an anchor inside any rendered element (a message body, for branches). */
export function anchorToRangeIn(root: HTMLElement, anchor: Anchor): Range | null {
  const found = findQuote(textOfElement(root), anchor, 0);
  return found ? rangeForOffsets(root, found[0], found[1]) : null;
}
