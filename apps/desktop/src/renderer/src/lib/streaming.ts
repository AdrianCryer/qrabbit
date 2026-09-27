/**
 * Streaming an answer so it reads smoothly, the way the chat apps do it: text arrives from the
 * agent in uneven lumps, and the view reveals it at a steady pace, a word at a time, never showing
 * half-written syntax. These are the pure parts; StreamingMarkdown drives them per animation frame.
 */

const isSpace = (ch: string | undefined) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r";

/**
 * Where the next revealable unit starting at `i` ends: the next word with the whitespace before it,
 * or a whole formula or code-fence line. Returns `i` when that unit has not fully arrived yet (an
 * opening `$$` without its closing one), so the reveal waits rather than show raw TeX.
 */
export function nextRevealEnd(text: string, i: number): number {
  let j = i;
  while (j < text.length && isSpace(text[j])) j++;
  if (j >= text.length) return text.length;
  const closeAfter = (open: string, close: string): number => {
    const k = text.indexOf(close, j + open.length);
    return k === -1 ? i : k + close.length;
  };
  if (text.startsWith("$$", j)) return closeAfter("$$", "$$");
  if (text.startsWith("\\[", j)) return closeAfter("\\[", "\\]");
  if (text.startsWith("\\(", j)) return closeAfter("\\(", "\\)");
  if (text[j] === "$") {
    // Inline maths closes on the same line; a lone dollar before a line break is just a dollar.
    for (let k = j + 1; k < text.length; k++) {
      if (text[k] === "\n") return j + 1;
      if (text[k] === "$" && text[k - 1] !== "\\") return k + 1;
    }
    return i;
  }
  if (text.startsWith("```", j)) {
    // A fence line appears whole, so the language tag never shows as prose.
    const nl = text.indexOf("\n", j);
    return nl === -1 ? i : nl + 1;
  }
  let k = j;
  while (k < text.length && !isSpace(text[k]) && !(k > j && (text[k] === "$" || text.startsWith("\\(", k) || text.startsWith("\\[", k)))) k++;
  return Math.max(k, j + 1);
}

/**
 * The revealed prefix made safe to render: close an unfinished code fence, bold or inline code so
 * they render as what they will become, and hide a half-written link until it completes.
 */
export function completeForDisplay(prefix: string): string {
  let text = prefix;
  const fences = (text.match(/^```/gm) ?? []).length;
  if (fences % 2 === 1) return `${text}\n\`\`\``;
  // Only the last block can be unfinished.
  const lastBreak = text.lastIndexOf("\n\n");
  const head = text.slice(0, lastBreak + 1);
  let tail = text.slice(lastBreak + 1);
  const link = tail.lastIndexOf("[");
  if (link !== -1 && !/\]\([^)]*\)/.test(tail.slice(link))) {
    // "[text" or "[text](url" without its closing parenthesis: hold it back.
    if (/^\[[^\]]*(\]\([^)]*)?$/.test(tail.slice(link))) tail = tail.slice(0, link);
  }
  const outsideCode = tail.replace(/`[^`\n]*`/g, "");
  if ((outsideCode.match(/\*\*/g) ?? []).length % 2 === 1) tail = `${tail.replace(/\s+$/, "")}**`;
  if ((tail.match(/`/g) ?? []).length % 2 === 1) tail = `${tail.replace(/\s+$/, "")}\``;
  text = head + tail;
  return text;
}

/**
 * Split Markdown into top-level blocks at blank lines, so finished blocks can be rendered once and
 * left alone while the last one grows. Never splits inside a code fence or a `$$` block, and keeps
 * indented continuations (list item paragraphs, nested lists) with the block before them.
 */
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let inMath = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) inFence = !inFence;
    else if (!inFence && trimmed === "$$") inMath = !inMath;
    if (!inFence && !inMath && trimmed === "" && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
      continue;
    }
    if (current.length === 0 && blocks.length > 0 && /^[ \t]+\S/.test(line)) {
      // An indented line right after a blank one belongs to the block above (e.g. a list item's
      // second paragraph); on its own it would render as a code block.
      current = [blocks.pop()!, "", line];
      continue;
    }
    if (current.length === 0 && trimmed === "") continue;
    current.push(line);
  }
  if (current.length > 0) blocks.push(current.join("\n"));
  return blocks;
}

/**
 * Characters to reveal this frame: never slower than a comfortable reading pace, and faster when a
 * backlog builds up so the view stays within about a second of what has arrived.
 */
export function revealBudget(backlog: number, dtSeconds: number): number {
  const MIN_RATE = 60; // characters a second
  const CATCH_UP = 0.8; // seconds to clear a backlog
  return Math.max(MIN_RATE, backlog / CATCH_UP) * dtSeconds;
}

/**
 * Where a just-finished stream had got to, by thread, so the saved message can carry on revealing
 * from there instead of popping the rest in at once. Only honoured for a few seconds: an answer
 * that finished while the reader was elsewhere should not replay when they come back to it.
 */
const handoffs = new Map<string, { shown: number; at: number }>();
export const revealHandoff = {
  set(threadId: string, shown: number): void {
    handoffs.set(threadId, { shown, at: Date.now() });
  },
  get(threadId: string): number | undefined {
    const h = handoffs.get(threadId);
    return h && Date.now() - h.at < 3000 ? h.shown : undefined;
  },
  delete(threadId: string): void {
    handoffs.delete(threadId);
  },
};
