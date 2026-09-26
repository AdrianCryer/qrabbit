/**
 * Code blocks and callouts as sites publish them, made recognisable to the Markdown conversion.
 *
 * Turndown only writes a fenced code block for `<pre><code>`; Sphinx, GitHub, Medium and most
 * highlighters emit `<pre>` full of spans, which would otherwise come out as escaped prose. And
 * an admonition ("You Should Know", "Note", "Warning") is just a div with a title paragraph,
 * which reads as two ordinary paragraphs once its classes are gone; it becomes a blockquote
 * with a bold title line instead.
 *
 * The package compiles without DOM types, so the little of the DOM this touches is typed here.
 */
type Node_ = { nodeName: string; textContent: string | null; parentElement: El | null };
type El = Node_ & {
  firstChild: Node_ | null;
  childNodes: ArrayLike<Node_>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): El | null;
  querySelectorAll(selector: string): ArrayLike<El>;
  appendChild(node: Node_): void;
  replaceWith(...nodes: Node_[]): void;
  remove(): void;
};
type Doc = { createElement(tag: string): El; createTextNode(text: string): Node_; querySelectorAll(selector: string): ArrayLike<El> };

const all = (root: { querySelectorAll(selector: string): ArrayLike<El> }, selector: string): El[] => Array.from(root.querySelectorAll(selector));
const classes = (el: El): string[] => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

const NOT_A_LANGUAGE = /^(default|text|plain|plaintext|none|notranslate|nohighlight)$/i;

/** The language a highlighter recorded on the block or one of its wrappers. */
export function languageOf(el: El): string | null {
  let node: El | null = el;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    for (const c of classes(node)) {
      const m = /^(?:language|lang|highlight-source|highlight|brush:)-?([a-z0-9+#.-]+)$/i.exec(c);
      if (m && !NOT_A_LANGUAGE.test(m[1]!)) return m[1]!.toLowerCase();
    }
    const data = node.getAttribute("data-lang") ?? node.getAttribute("data-language");
    if (data && !NOT_A_LANGUAGE.test(data)) return data.toLowerCase();
  }
  return null;
}

/** Give every `<pre>` a single `<code>` child carrying its text and language. */
export function normalizeCodeBlocks(document: Doc): number {
  // Line-number gutters and copy buttons are not code.
  for (const el of all(document, "pre .copybtn, pre button, .linenos, .lineno, .line-numbers-rows, td.linenos, span.linenos")) el.remove();
  for (const table of all(document, "table.highlighttable, table.codehilitetable, table.rouge-table")) {
    const code = table.querySelector("td.code, td.rouge-code, td:last-child");
    if (code) table.replaceWith(...Array.from(code.childNodes));
  }
  let count = 0;
  for (const pre of all(document, "pre")) {
    const lang = languageOf(pre) ?? (() => { const c = pre.querySelector("code"); return c ? languageOf(c) : null; })();
    for (const br of all(pre, "br")) br.replaceWith(document.createTextNode("\n"));
    const only = Array.from(pre.childNodes).filter((n) => !(n.nodeName === "#text" && !(n.textContent ?? "").trim()));
    let code = only.length === 1 && only[0]!.nodeName === "CODE" ? (only[0] as El) : null;
    if (!code) {
      code = document.createElement("code");
      code.textContent = (pre.textContent ?? "").replace(/^\n+/, "").replace(/\s+$/, "");
      // A code element must be the first child for the fenced-block rule to apply.
      for (const n of Array.from(pre.childNodes)) (n as El).remove?.();
      pre.textContent = "";
      pre.appendChild(code);
    } else if (pre.firstChild !== code) {
      for (const n of Array.from(pre.childNodes)) if (n !== code) (n as El).remove?.();
    }
    // The article extractor strips class attributes, so the language rides in a data attribute
    // that the Markdown conversion's fence rule reads.
    if (lang) code.setAttribute("data-lang", lang);
    count++;
  }
  return count;
}

const TITLE_BY_KIND: Record<string, string> = {
  note: "Note", warning: "Warning", tip: "Tip", hint: "Hint", important: "Important", caution: "Caution",
  attention: "Attention", danger: "Danger", error: "Error", seealso: "See also", info: "Info", todo: "To do",
};

/** Turn admonitions and callouts into blockquotes that open with a bold title. */
export function normalizeCallouts(document: Doc): number {
  const selector = [
    ".admonition", "[class*=\"admonition\"]", ".callout", "[class*=\"callout\"]", "details.admonition",
    ...Object.keys(TITLE_BY_KIND).map((k) => `div.${k}, section.${k}, aside.${k}`),
  ].join(", ");
  let count = 0;
  for (const el of all(document, selector)) {
    if (el.nodeName === "P" || el.nodeName === "SPAN" || el.nodeName === "A") continue; // titles and links that merely mention the class
    // Nested matches are handled when their ancestor is; skip anything already inside a converted one.
    const titleEl = el.querySelector(".admonition-title, .admonitionHeading, .callout-title, .title, summary");
    let title = titleEl?.textContent?.trim() ?? "";
    if (!title) {
      const first = Array.from(el.childNodes).find((n) => n.nodeName !== "#text") as El | undefined;
      if (first && /^H[1-6]$/.test(first.nodeName)) title = first.textContent?.trim() ?? "";
      if (!title) for (const c of classes(el)) if (TITLE_BY_KIND[c]) { title = TITLE_BY_KIND[c]!; break; }
    }
    const quote = document.createElement("blockquote");
    if (title) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = title;
      p.appendChild(strong);
      quote.appendChild(p);
      if (titleEl) titleEl.remove();
      else {
        const first = Array.from(el.childNodes).find((n) => n.nodeName !== "#text") as El | undefined;
        if (first && /^H[1-6]$/.test(first.nodeName)) first.remove();
      }
    }
    for (const n of Array.from(el.childNodes)) quote.appendChild(n);
    el.replaceWith(quote);
    count++;
  }
  return count;
}
