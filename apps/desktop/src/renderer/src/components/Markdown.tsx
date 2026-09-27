import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Options as MarkdownOptions } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import { useMacros } from "../lib/macros";
import { completeForDisplay, nextRevealEnd, revealBudget, splitBlocks } from "../lib/streaming";
import "katex/dist/katex.min.css";

/**
 * Agents write maths with either delimiter style; normalise to dollars outside code fences.
 * remark-math only treats `$$` as display maths when the fences stand on lines of their own; a
 * one-line `$$ … $$`, which agents write all the time, would otherwise render as small inline maths.
 */
export function normalizeMath(src: string): string {
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return p; // code
      return p
        .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner: string) => `\n$$\n${inner.trim()}\n$$\n`)
        .replace(/\\\((.+?)\\\)/g, (_m, inner: string) => `$${inner}$`)
        .replace(/^([ \t>]*)\$\$((?:(?!\$\$).)+)\$\$[ \t]*$/gm, (_m, lead: string, inner: string) => `${lead}$$\n${lead}${inner.trim()}\n${lead}$$`);
    })
    .join("");
}

const remarkPlugins: NonNullable<MarkdownOptions["remarkPlugins"]> = [remarkGfm, remarkMath];
const components: MarkdownOptions["components"] = {
  // Links open in the system browser; the window never navigates away from the app.
  a: ({ href, children }) => (
    <a href={href} title={href} onClick={(e) => { e.preventDefault(); if (href) window.open(href); }}>
      {children}
    </a>
  ),
  img: ({ src, alt }) => (typeof src === "string" ? <img src={src} alt={alt ?? ""} loading="lazy" /> : null),
};

function useRehypePlugins() {
  const macros = useMacros();
  // KaTeX writes into the macro table it is given when a formula uses \gdef, so each render
  // gets its own copy of the shared one.
  return useMemo<NonNullable<MarkdownOptions["rehypePlugins"]>>(
    () => [
      [rehypeKatex, { throwOnError: false, strict: false, macros: { ...macros } }],
      // Fenced blocks that name a language get highlight.js token classes; styles.css colours them.
      [rehypeHighlight, { detect: false }],
    ],
    [macros],
  );
}

/** One run of Markdown rendered without a wrapper. Memoised, so an unchanged block is left alone. */
const MdBlock = memo(function MdBlock({ text, rehypePlugins }: { text: string; rehypePlugins: NonNullable<MarkdownOptions["rehypePlugins"]> }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
      {normalizeMath(text)}
    </ReactMarkdown>
  );
});

export function Markdown({ text }: { text: string }) {
  const rehypePlugins = useRehypePlugins();
  return (
    <div className="md">
      <MdBlock text={text} rehypePlugins={rehypePlugins} />
    </div>
  );
}

/**
 * An answer as it streams: whatever has arrived in `text` is revealed at a steady pace a word at a
 * time (whole formulas at once, never half-written syntax), finished blocks are rendered once and
 * left alone, and each new block fades in. With `live` false the rest is revealed and `onDone` fires.
 * `startAt` continues a reveal that an earlier view began, so a finished answer does not pop in.
 */
export function StreamingMarkdown({ text, live, startAt = 0, onReveal, onDone }: { text: string; live: boolean; startAt?: number; onReveal?(shown: number): void; onDone?(): void }) {
  const rehypePlugins = useRehypePlugins();
  const [shown, setShown] = useState(() => Math.min(startAt, text.length));
  const state = useRef({ shown, text, live, onReveal, onDone, done: false });
  state.current = { ...state.current, text, live, onReveal, onDone };
  // Blocks already on screen when this view mounted stay still; only blocks added later fade in.
  const settled = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let budget = 0;
    const tick = (now: number) => {
      const s = state.current;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (s.shown < s.text.length) {
        budget += revealBudget(s.text.length - s.shown, dt);
        let at = s.shown;
        while (at < s.text.length) {
          const next = nextRevealEnd(s.text, at);
          if (next === at) {
            // The next unit (a formula, a fence line) has not fully arrived; once the stream has
            // ended there is nothing more to wait for.
            if (!s.live) at = s.text.length;
            break;
          }
          // A formula appears as one unit and costs about as much as two words, not its length.
          const cost = Math.min(next - at, 14);
          if (cost > budget) break;
          budget -= cost;
          at = next;
        }
        if (at !== s.shown) {
          s.shown = at;
          setShown(at);
          s.onReveal?.(at);
        }
      } else {
        budget = 0;
        if (!s.live && !s.done) {
          s.done = true;
          s.onDone?.();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const blocks = splitBlocks(completeForDisplay(text.slice(0, shown)));
  if (settled.current === null) settled.current = blocks.length;
  return (
    <div className="md streaming">
      {blocks.map((b, i) => (
        <div key={i} className={i >= (settled.current ?? 0) ? "mdblock enter" : "mdblock"}>
          <MdBlock text={b} rehypePlugins={rehypePlugins} />
        </div>
      ))}
    </div>
  );
}
