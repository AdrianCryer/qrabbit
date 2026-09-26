/**
 * One rule for page text, used both when writing text.md and when mapping the PDF.js text
 * layer back to offsets: each text item contributes its string, plus a newline if it ends a line.
 * The text layer renders items as spans in the same order and a <br> for each end of line.
 */
export type TextItemLike = { str: string; hasEOL?: boolean };

export function pageTextFromItems(items: TextItemLike[]): string {
  let out = "";
  for (const it of items) {
    out += it.str;
    if (it.hasEOL) out += "\n";
  }
  return out;
}

export const pageMarker = (n: number): string => `<!-- page ${n} -->\n`;

export type TitleItemLike = TextItemLike & { height?: number; transform?: number[] };

/**
 * The largest upright text on a page, when it reads like a title. This is how most tools guess a PDF's
 * title when its metadata has none: the arXiv stamp down the margin is rotated and skipped, and a lone
 * journal banner fails the word count, so the next size down is tried.
 */
export function guessTitle(items: TitleItemLike[]): string | undefined {
  const groups = new Map<number, string[]>();
  for (const it of items) {
    const t = it.transform;
    if (t && Math.abs(t[1] ?? 0) > 0.01) continue;
    const h = Math.round((it.height ?? 0) * 2) / 2;
    if (!h || !it.str.trim()) continue;
    const g = groups.get(h) ?? [];
    g.push(it.str + (it.hasEOL ? " " : ""));
    groups.set(h, g);
  }
  const sizes = [...groups.keys()].sort((a, b) => b - a).slice(0, 3);
  for (const h of sizes) {
    const text = groups.get(h)!.join("").replace(/\s+/g, " ").trim();
    const words = text.split(" ").length;
    if (words >= 3 && words <= 30 && text.length >= 12 && text.length <= 220 && !/^arxiv:/i.test(text)) return text;
  }
  return undefined;
}

/** Join page texts into text.md and return where each page's text starts in it. */
export function buildTextMd(pageTexts: string[]): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  pageTexts.forEach((t, i) => {
    text += pageMarker(i + 1);
    starts.push(text.length);
    text += t;
    if (!t.endsWith("\n")) text += "\n";
    text += "\n";
  });
  return { text, starts };
}
