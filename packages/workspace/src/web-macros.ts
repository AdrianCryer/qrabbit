/**
 * LaTeX macros a page defines for its own formulas. Sites that render maths in the browser ship
 * them in a MathJax configuration (`Macros: {E: "{\\mathrm E}", underE: ["…", 2]}` or, for
 * MathJax 3, `macros: {…}`), or as `\newcommand` lines inside a hidden formula. Sites that
 * render to images keep them server side, so nothing can be recovered there; the reader falls
 * back to its own defaults for those.
 *
 * The result is a KaTeX macro table: names carry their backslash, bodies use #1…#9.
 */
export type MacroTable = Record<string, string>;

/** `\newcommand{\E}{{\mathrm E}}`, `\newcommand{\underE}[2]{…}`, `\renewcommand`, `\def\E{…}`. */
function fromNewcommands(text: string, out: MacroTable): void {
  const re = /\\(?:re)?newcommand\s*\{?\\([a-zA-Z]+)\}?\s*(?:\[(\d)\])?\s*\{|\\def\s*\\([a-zA-Z]+)\s*\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const name = m[1] ?? m[3]!;
    const body = balanced(text, re.lastIndex - 1);
    if (body === null) continue;
    out[`\\${name}`] = body.trim();
    re.lastIndex += body.length + 1;
  }
}

/** The contents of the brace group that opens at `open`, or null if it never closes. */
function balanced(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return text.slice(open + 1, i); }
  }
  return null;
}

/** MathJax 2 `Macros: {…}` and MathJax 3 `macros: {…}` object literals, JSON or nearly so. */
function fromMathJaxConfig(text: string, out: MacroTable): void {
  const re = /["']?[Mm]acros["']?\s*:\s*\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const body = balanced(text, re.lastIndex - 1);
    if (body === null) continue;
    const entry = /["']?([a-zA-Z]+)["']?\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|\[\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')\s*(?:,\s*(\d+))?\s*(?:,[^\]]*)?\])/g;
    for (let e = entry.exec(body); e; e = entry.exec(body)) {
      const raw = e[2] ?? e[3] ?? e[4] ?? e[5];
      if (raw === undefined) continue;
      // JS string escapes: \\ is a backslash, \" a quote; nothing else appears in macro bodies.
      const value = raw.replace(/\\(["'\\])/g, "$1").replace(/\\\\/g, "\\");
      out[`\\${e[1]}`] = value;
    }
  }
}

/** Every macro the page declares, from configuration scripts and `\newcommand` lines alike. */
export function macrosInHtml(html: string): MacroTable {
  const out: MacroTable = {};
  fromMathJaxConfig(html, out);
  fromNewcommands(html.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"), out);
  return out;
}
