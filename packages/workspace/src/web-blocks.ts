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

/**
 * Readability scores elements partly by class name, and its "negative" pattern matches any class
 * containing "hidden", "scroll", "media" and the like. On sites built from utility classes
 * (`overflow-hidden`, `style-scrollbars`) that throws away the wrapper around every code block.
 * Only a bare `hidden` class actually hides content; the rest are noise, so drop them from the
 * ancestors of code blocks before extraction.
 */
const READABILITY_NEGATIVE = /-ad-|hidden|^hid$|banner|combx|comment|com-|contact|footer|gdpr|masthead|media|meta|outbrain|promo|related|scroll|share|shoutbox|sidebar|skyscraper|sponsor|shopping|tags|widget|extra|supplemental|popup|pagination|pager/i;

export function protectCodeBlocks(document: Doc): void {
  for (const el of all(document, '[class*="overflow-"]')) {
    const kept = classes(el).filter((c) => !/^overflow(-[xy])?-hidden$/.test(c));
    if (kept.length !== classes(el).length) el.setAttribute("class", kept.join(" "));
  }
  for (const pre of all(document, "pre")) {
    let node: El | null = pre;
    for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
      const kept = classes(node).filter((c) => c === "hidden" || !READABILITY_NEGATIVE.test(c));
      if (kept.length !== classes(node).length) node.setAttribute("class", kept.join(" "));
    }
  }
}

const LANGUAGE_LABELS: Record<string, string> = {
  python: "python", py: "python", javascript: "javascript", js: "javascript", typescript: "typescript", ts: "typescript",
  bash: "bash", shell: "bash", sh: "bash", zsh: "bash", json: "json", yaml: "yaml", yml: "yaml", toml: "toml", rust: "rust",
  go: "go", golang: "go", java: "java", kotlin: "kotlin", swift: "swift", c: "c", "c++": "cpp", cpp: "cpp", "c#": "csharp",
  csharp: "csharp", html: "html", css: "css", sql: "sql", diff: "diff", patch: "diff", markdown: "markdown", md: "markdown",
  xml: "xml", ruby: "ruby", php: "php", r: "r", scala: "scala", haskell: "haskell", lua: "lua", makefile: "makefile",
  dockerfile: "dockerfile", "plain text": "", plaintext: "", text: "", txt: "",
};

/**
 * A language label such as "Python" in the code block's own header row, when a site has one: a
 * short sibling of the block, within three wrappers, that holds no code block of its own.
 */
function languageLabelNear(pre: El): string | null {
  let branch: El = pre;
  let node: El | null = pre.parentElement;
  for (let depth = 0; node && depth < 3; depth++, branch = node, node = node.parentElement) {
    for (const sibling of Array.from(node.childNodes) as El[]) {
      if (sibling === branch || sibling.nodeName === "#text" || !sibling.querySelectorAll) continue;
      if (sibling.querySelector("pre") || (sibling.textContent ?? "").trim().length > 60) continue;
      for (const el of [sibling, ...Array.from(sibling.querySelectorAll("span, div, p, small, label"))]) {
        const text = (el.textContent ?? "").trim().toLowerCase();
        if (text.length <= 12 && text in LANGUAGE_LABELS) return LANGUAGE_LABELS[text]!;
      }
    }
  }
  return null;
}

/**
 * The block's text. Sites that render each line as its own row (a div holding a line number and
 * the line) need the rows joined with newlines and the numbers dropped; `textContent` alone
 * would run the lines together with the numbers.
 */
function textOfPre(pre: El): string {
  const rows = Array.from(pre.childNodes).filter((n) => n.nodeName !== "#text" || (n.textContent ?? "").trim()) as El[];
  if (rows.length >= 1 && rows.every((r) => r.nodeName === "DIV")) {
    const firsts = rows.map((r) => (Array.from(r.childNodes).find((n) => n.nodeName !== "#text") as El | undefined));
    const numbered = firsts.every((f, i) => f && (f.textContent ?? "").trim() === String(i + 1));
    return rows
      .map((r, i) => {
        const parts = Array.from(r.childNodes) as El[];
        const keep = numbered ? parts.filter((p) => p !== firsts[i]) : parts;
        return keep.map((p) => p.textContent ?? "").join("").replace(/\n+$/, "");
      })
      .join("\n");
  }
  return pre.textContent ?? "";
}

/** Give every `<pre>` a single `<code>` child carrying its text and language. */
export function normalizeCodeBlocks(document: Doc): number {
  // Line-number gutters and copy buttons are not code.
  for (const el of all(document, "pre .copybtn, pre button, .linenos, .lineno, .line-numbers-rows, td.linenos, span.linenos, pre [class*=\"line-number\"], pre [class*=\"linenumber\"], pre [class*=\"gutter\"]")) el.remove();
  for (const table of all(document, "table.highlighttable, table.codehilitetable, table.rouge-table")) {
    const code = table.querySelector("td.code, td.rouge-code, td:last-child");
    if (code) table.replaceWith(...Array.from(code.childNodes));
  }
  // Some sites nest the block the other way round, `<code><pre>`; the pre is the block.
  for (const code of all(document, "code")) {
    const inner = Array.from(code.childNodes).filter((n) => n.nodeName !== "#text" || (n.textContent ?? "").trim());
    if (inner.length === 1 && inner[0]!.nodeName === "PRE") code.replaceWith(inner[0]!);
  }
  let count = 0;
  for (const pre of all(document, "pre")) {
    const lang = languageOf(pre) ?? (() => { const c = pre.querySelector("code"); return c ? languageOf(c) : null; })() ?? languageLabelNear(pre);
    for (const br of all(pre, "br")) br.replaceWith(document.createTextNode("\n"));
    const only = Array.from(pre.childNodes).filter((n) => !(n.nodeName === "#text" && !(n.textContent ?? "").trim()));
    let code = only.length === 1 && only[0]!.nodeName === "CODE" ? (only[0] as El) : null;
    if (!code) {
      code = document.createElement("code");
      code.textContent = textOfPre(pre).replace(/^\n+/, "").replace(/\s+$/, "");
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

/**
 * docutils wraps an indented formula or code block inside a list item in a <blockquote>, which
 * the reader would draw as a callout around a lone equation. Unwrap quotes that hold nothing else.
 */
export function unwrapBareQuotes(document: Doc): number {
  let count = 0;
  for (const quote of all(document, "blockquote")) {
    const bare = all(quote, "qr-math, pre");
    if (bare.length !== 1) continue;
    if ((quote.textContent ?? "").trim() !== (bare[0]!.textContent ?? "").trim()) continue;
    quote.replaceWith(...Array.from(quote.childNodes));
    count++;
  }
  return count;
}

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
