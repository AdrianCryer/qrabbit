/**
 * Where a quote sits in a text. The offsets are exact for PDFs, whose anchors index text.md
 * directly; for web and Markdown sources they index the rendered text, so the quote itself is
 * searched, first verbatim and then ignoring case and runs of whitespace.
 */
export function locateQuote(full: string, anchor: { quote: string; start: number; end: number }): [number, number] | null {
  if (anchor.end > anchor.start && anchor.end <= full.length && full.slice(anchor.start, anchor.end) === anchor.quote) return [anchor.start, anchor.end];
  const exact = full.indexOf(anchor.quote);
  if (exact !== -1) return [exact, exact + anchor.quote.length];
  const map: number[] = [];
  let hay = "";
  let inSpace = false;
  for (let i = 0; i < full.length; i++) {
    const ch = full[i]!;
    if (/\s/.test(ch)) {
      if (!inSpace && hay.length) {
        hay += " ";
        map.push(i);
      }
      inSpace = true;
    } else {
      hay += ch.toLowerCase();
      map.push(i);
      inSpace = false;
    }
  }
  const needle = anchor.quote.replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  const i = hay.indexOf(needle);
  if (i === -1) return null;
  return [map[i]!, map[i + needle.length - 1]! + 1];
}
