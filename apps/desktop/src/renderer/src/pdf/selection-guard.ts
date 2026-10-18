/**
 * The text layer's selection guard, after PDF.js's viewer.
 *
 * Every span in a text layer is absolutely positioned, so the layer itself has no in-flow content and
 * Chromium resolves any point on blank paper to the end of the layer. Left alone, a press just past the
 * end of a paragraph anchors the selection at the bottom of the page, so dragging back onto the line
 * selects everything below it, and a drag over blank paper extends a selection the same way. PDF.js
 * answers with the layer's end-of-content block: while the pointer is down it covers the page beneath
 * the spans, and since it cannot be selected, Chromium leaves the selection alone over blank paper.
 *
 * The block must be up before the browser resolves the press, so it is raised on mousedown rather than
 * on the first selectionchange. PDF.js stops there, and a drag that starts on blank paper selects nothing.
 * Here such a press also places the block beside the nearest span and makes it selectable: the block is
 * then a caret position of its own, next to that span's edge in the document, and a drag that starts from
 * it reaches the text the way a press beside a line does in an ordinary document. Chromium only starts
 * the drag from the block when the drag's first move lands on it too, so the block sits above the spans
 * for that one move and drops beneath them after it.
 */

/** Raise a layer's end-of-content block for a press at (x, y) on `target`, in viewport coordinates. */
export function raiseEndOfContent(layer: HTMLElement, target: EventTarget | null, x: number, y: number): void {
  layer.classList.add("selecting");
  if (target !== layer) return;
  const end = layer.querySelector<HTMLElement>(".endOfContent");
  const near = end && nearestSpan(layer, x, y);
  if (!end || !near) return;
  end.style.userSelect = "text";
  end.style.zIndex = "2";
  document.addEventListener("mousemove", () => { end.style.zIndex = ""; }, { once: true });
  near.span.parentNode?.insertBefore(end, near.before ? near.span : near.span.nextSibling);
}

/** Lower the block again and put it back at the end of the layer. */
export function lowerEndOfContent(layer: HTMLElement): void {
  layer.classList.remove("selecting");
  const end = layer.querySelector<HTMLElement>(".endOfContent");
  if (!end) return;
  end.style.userSelect = "";
  end.style.zIndex = "";
  if (end !== layer.lastElementChild) layer.append(end);
}

/** The span nearest a point: the line under it first, then the closest span along that line. */
function nearestSpan(layer: HTMLElement, x: number, y: number): { span: HTMLElement; before: boolean } | null {
  let best: { span: HTMLElement; before: boolean; d: number } | null = null;
  for (const span of layer.querySelectorAll<HTMLElement>("span")) {
    if (!span.firstChild || span.classList.contains("markedContent") || span.getAttribute("role") === "img") continue;
    const r = span.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // The gap under a paragraph belongs to it, as in flowing text, so a span above the point counts as nearer.
    const dy = y < r.top ? (r.top - y) * 2 : y > r.bottom ? y - r.bottom : 0;
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const d = dy * 1000 + dx;
    if (!best || d < best.d) best = { span, before: x < r.left, d };
  }
  return best;
}
