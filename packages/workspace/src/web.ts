/// <reference path="./turndown-plugin-gfm.d.ts" />
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { MATH_TAG, mathToTex } from "./web-math.js";

export type WebPage = {
  url: string;
  title: string;
  markdown: string;
  siteName?: string;
  byline?: string;
  excerpt?: string;
  fetched: string;
};

/** The little of the DOM this file touches; the workspace package compiles without DOM types. */
type Elementish = { getAttribute(name: string): string | null };

const MAX_BYTES = 8 * 1024 * 1024;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 QRabbit/0.1";

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last).replace(/[-_]+/g, " ") : u.hostname;
  } catch {
    return url;
  }
}

/** "Key Concepts in RL — Spinning Up documentation" → "Key Concepts in RL", the way Readability treats " | " and " - ". */
function cleanTitle(title: string): string {
  const parts = title.split(/\s+[—–|]\s+/);
  if (parts.length < 2) return title;
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  return words(parts[0]!) >= 3 ? parts[0]!.trim() : words(parts[parts.length - 1]!) >= 3 ? parts[parts.length - 1]!.trim() : title;
}

/** Reader-mode extraction: the article's main content as Markdown, links and images made absolute. */
export function htmlToArticle(html: string, baseUrl: string): Omit<WebPage, "url" | "fetched"> {
  const { document } = parseHTML(html);
  let base = baseUrl;
  const baseEl = document.querySelector("base[href]");
  if (baseEl) {
    try {
      base = new URL(baseEl.getAttribute("href")!, baseUrl).href;
    } catch {
      /* keep the page url */
    }
  }
  const docTitle = document.querySelector("title")?.textContent?.trim();
  // Editing chrome that survives reader-mode extraction because it sits inside headings.
  for (const el of Array.from(document.querySelectorAll(".mw-editsection, .mw-jump-link, .noprint, a.headerlink, [role=\"navigation\"]")) as Array<{ remove(): void }>) el.remove();
  // Formulas become <qr-math> elements holding LaTeX before extraction, so none of them is lost
  // as an image, a hidden MathML twin, or a script.
  mathToTex(document as unknown as Parameters<typeof mathToTex>[0]);

  let article: ReturnType<Readability["parse"]> = null;
  try {
    article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }
  const contentHtml = article?.content ?? document.body?.innerHTML ?? html;

  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  td.use(gfm);
  // Turndown escapes square brackets as \[ and \], which collides with the \[…\] display-maths
  // delimiters the reader recognises; a bare [1] renders as plain text anyway.
  const escape = td.escape.bind(td);
  td.escape = (s: string) => escape(s).replace(/\\([[\]])/g, "$1");
  td.remove((node) => /^(script|style|noscript|iframe|svg)$/i.test(node.nodeName));
  td.addRule("math", {
    filter: (node) => node.nodeName.toLowerCase() === MATH_TAG,
    replacement: (_content, node) => {
      const el = node as unknown as Elementish & { textContent: string | null };
      const tex = (el.getAttribute("data-tex") ?? el.textContent ?? "").trim();
      if (!tex) return "";
      return el.getAttribute("display") === "block" ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
    },
  });
  td.addRule("absoluteLinks", {
    filter: "a",
    replacement: (content, node) => {
      const href = (node as unknown as Elementish).getAttribute("href");
      if (!href || !content.trim()) return content;
      try {
        return `[${content}](${new URL(href, base).href})`;
      } catch {
        return content;
      }
    },
  });
  td.addRule("absoluteImages", {
    filter: "img",
    replacement: (_content, node) => {
      const el = node as unknown as Elementish;
      const src = el.getAttribute("src");
      if (!src || src.startsWith("data:")) return "";
      const alt = (el.getAttribute("alt") ?? "").replace(/[[\]]/g, "");
      try {
        return `![${alt}](${new URL(src, base).href})`;
      } catch {
        return "";
      }
    },
  });
  const markdown = td
    .turndown(contentHtml)
    .replace(/^(\s*)([-*+])\s{3}/gm, "$1$2 ") // turndown pads list markers to four columns
    .replace(/^(\s*)(\d+\.)\s{2}/gm, "$1$2 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const title = cleanTitle(article?.title?.trim() || docTitle || titleFromUrl(baseUrl));
  return {
    title,
    markdown,
    ...(article?.siteName ? { siteName: article.siteName } : {}),
    ...(article?.byline ? { byline: article.byline } : {}),
    ...(article?.excerpt ? { excerpt: article.excerpt } : {}),
  };
}

/** Fetch a page and reduce it to an article. Markdown and plain-text responses are kept as they are. */
export async function fetchWebPage(input: string): Promise<WebPage> {
  const url = new URL(input.trim());
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http and https pages can be added");
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,text/markdown;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      "accept-language": "en",
    },
  });
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error("The page is too large to add");
  const body = await res.text();
  if (body.length > MAX_BYTES) throw new Error("The page is too large to add");
  const finalUrl = res.url || url.href;
  const fetched = new Date().toISOString();
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("text/markdown") || type.includes("text/plain")) {
    return { url: finalUrl, title: titleFromUrl(finalUrl), markdown: body.trim(), fetched };
  }
  return { ...htmlToArticle(body, finalUrl), url: finalUrl, fetched };
}
