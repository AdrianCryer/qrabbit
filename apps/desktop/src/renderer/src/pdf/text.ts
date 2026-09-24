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
