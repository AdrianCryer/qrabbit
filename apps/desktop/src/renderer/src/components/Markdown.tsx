import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { useMemo } from "react";
import type { Options as MarkdownOptions } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { useMacros } from "../lib/macros";
import "katex/dist/katex.min.css";

/** Agents write maths with either delimiter style; normalise to dollars outside code fences. */
function normalizeMath(src: string): string {
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return p; // code
      return p.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => `$$${inner}$$`).replace(/\\\((.+?)\\\)/g, (_m, inner: string) => `$${inner}$`);
    })
    .join("");
}

export function Markdown({ text }: { text: string }) {
  const macros = useMacros();
  // KaTeX writes into the macro table it is given when a formula uses \gdef, so each render
  // gets its own copy of the shared one.
  const rehypePlugins = useMemo<NonNullable<MarkdownOptions["rehypePlugins"]>>(
    () => [
      [rehypeKatex, { throwOnError: false, strict: false, macros: { ...macros } }],
      // Fenced blocks that name a language get highlight.js token classes; styles.css colours them.
      [rehypeHighlight, { detect: false }],
    ],
    [macros],
  );
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={{
          // Links open in the system browser; the window never navigates away from the app.
          a: ({ href, children }) => (
            <a href={href} title={href} onClick={(e) => { e.preventDefault(); if (href) window.open(href); }}>
              {children}
            </a>
          ),
          img: ({ src, alt }) => (typeof src === "string" ? <img src={src} alt={alt ?? ""} loading="lazy" /> : null),
        }}
      >
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  );
}
