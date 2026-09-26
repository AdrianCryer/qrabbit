/**
 * Formulas on the web arrive in several encodings: an image whose alt text is the LaTeX
 * (Sphinx imgmath, Wikipedia, WordPress), MathML with a TeX annotation (Wikipedia, KaTeX),
 * a span holding \(…\) for MathJax to render (Sphinx), or a MathJax 2 script. Before the
 * article is extracted, each becomes a <qr-math> element holding the LaTeX, which the Markdown
 * conversion writes as $…$ or $$…$$ so the reader renders it and the agent reads it.
 *
 * The package compiles without DOM types, so the little of the DOM this touches is typed here.
 */
type El = {
  nodeName: string;
  textContent: string | null;
  parentElement: El | null;
  childNodes: ArrayLike<El>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  replaceWith(...nodes: El[]): void;
  remove(): void;
};
type Doc = { createElement(tag: string): El; querySelectorAll(selector: string): ArrayLike<El> };

export const MATH_TAG = "qr-math";

const BLOCKS = new Set(["P", "DIV", "DD", "LI", "TD", "TH", "FIGURE", "SECTION", "ARTICLE", "MAIN", "BODY", "BLOCKQUOTE", "CENTER"]);

/** Strip the wrappers sites put around LaTeX, and give bare alignment rows an environment. */
export function normalizeTex(raw: string): string {
  let tex = raw.replace(/\r\n?/g, "\n").trim();
  const wrapped = /^\{\\(?:displaystyle|textstyle)\s*([\s\S]*)\}$/.exec(tex);
  if (wrapped) tex = wrapped[1]!.trim();
  if (!/\\begin\{/.test(tex) && /(^|[^\\])(\\\\|&)/.test(tex)) tex = `\\begin{aligned}\n${tex}\n\\end{aligned}`;
  return tex;
}

const blockOf = (el: El): El | null => {
  let b = el.parentElement;
  while (b && !BLOCKS.has(b.nodeName)) b = b.parentElement;
  return b;
};

/** True when the formula is all its paragraph holds, which is what display maths looks like. */
const standsAlone = (el: El): boolean => {
  const block = blockOf(el);
  return !!block && (block.textContent ?? "").trim() === (el.textContent ?? "").trim();
};

const all = (root: { querySelectorAll(selector: string): ArrayLike<El> }, selector: string): El[] => Array.from(root.querySelectorAll(selector));

const classes = (el: El): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

/** An image whose alt text is LaTeX, by the class, the URL or the alt text itself. */
function isMathImage(img: El): boolean {
  const alt = img.getAttribute("alt") ?? "";
  if (!alt.trim()) return false;
  if (classes(img).some((c) => /^(math|latex|tex|mwe-math-fallback-image.*)$/.test(c))) return true;
  const src = img.getAttribute("src") ?? "";
  if (/\/math\/|math\/render|latex\.php|\/tex\?|codecogs\.com|\/svg\/tex/i.test(src)) return true;
  return /^\{\\(displaystyle|textstyle)/.test(alt.trim());
}

const texOfMathML = (math: El): string | null => {
  const ann = math.querySelector('annotation[encoding="application/x-tex"], annotation[encoding="TeX"]');
  return ann?.textContent?.trim() || math.getAttribute("alttext")?.trim() || null;
};

/** Replace every formula in the document with a <qr-math> element. Returns how many were found. */
export function mathToTex(document: Doc): number {
  let count = 0;
  const replace = (target: El, raw: string | null, display?: boolean) => {
    const tex = raw ? normalizeTex(raw) : "";
    if (!tex) return;
    const el = document.createElement(MATH_TAG);
    // The text keeps the extractor's length heuristics honest; the attribute keeps the LaTeX
    // exact, since the Markdown conversion collapses whitespace in text, newlines included.
    el.textContent = tex;
    el.setAttribute("data-tex", tex);
    target.replaceWith(el);
    const isBlock = display ?? standsAlone(el);
    el.setAttribute("display", isBlock ? "block" : "inline");
    // A wrapper div around a lone display formula would be dropped by the article extractor as
    // too short to matter; unwrap it so the formula stands as a paragraph of its own.
    if (isBlock) {
      let block = blockOf(el);
      while (block && block.nodeName === "DIV" && (block.textContent ?? "").trim() === tex) {
        const parent = block.parentElement;
        block.replaceWith(...Array.from(block.childNodes));
        block = parent && BLOCKS.has(parent.nodeName) ? parent : null;
      }
    }
    count++;
  };

  // KaTeX output: the LaTeX is in the MathML annotation; the HTML twin repeats it visually.
  for (const el of all(document, ".katex-display")) replace(el, el.querySelector("annotation")?.textContent ?? null, true);
  for (const el of all(document, ".katex")) replace(el, el.querySelector("annotation")?.textContent ?? null);
  // MathJax 2 keeps the source in a script; its preview span would duplicate it.
  for (const el of all(document, ".MathJax_Preview")) el.remove();
  for (const el of all(document, 'script[type^="math/tex"]')) replace(el, el.textContent, /mode\s*=\s*display/.test(el.getAttribute("type") ?? ""));
  // Sphinx with MathJax: a span or div holding \(…\) or \[…\].
  for (const el of all(document, "span.math, div.math")) {
    const text = (el.textContent ?? "").trim();
    const m = /^\\\(([\s\S]*)\\\)$/.exec(text) ?? /^\\\[([\s\S]*)\\\]$/.exec(text);
    if (m) replace(el, m[1]!, text.startsWith("\\["));
  }
  // Wikipedia: hidden MathML with an annotation next to a fallback image whose alt is the LaTeX.
  for (const el of all(document, ".mwe-math-element")) {
    const img = el.querySelector("img[alt]");
    const math = el.querySelector("math");
    const display = img ? classes(img).some((c) => c.includes("display")) : undefined;
    replace(el, img?.getAttribute("alt") ?? (math ? texOfMathML(math) : null), display || undefined);
  }
  // Any other MathML that carries its source.
  for (const el of all(document, "math")) replace(el, texOfMathML(el), el.getAttribute("display") === "block" ? true : undefined);
  // Formula images: Sphinx imgmath, WordPress, CodeCogs and the like.
  for (const el of all(document, "img")) if (isMathImage(el)) replace(el, el.getAttribute("alt"));
  return count;
}
