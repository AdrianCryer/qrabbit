import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import { embeddedText, resourceLink, text } from "@qrabbit/acp-client";
import type { Anchor, Thread } from "@qrabbit/shared";
import { readSourceText } from "@qrabbit/workspace";

const PREAMBLE =
  "You are helping the reader understand a source in this collection (see AGENTS.md). " +
  "Cite pages as [p.N] using the <!-- page N --> markers in the source's text.md. " +
  "Write maths as LaTeX with $…$ and $$…$$. Keep answers scoped to the question; the reader will branch if they want more. " +
  "Do not modify anything under threads/ or sources/.";

const CONTEXT_CHARS = 700;
const HISTORY_CHARS = 6000;

function textUri(collection: string, sourceId: string): string {
  return pathToFileURL(join(collection, "sources", sourceId, "text.md")).href;
}

/** The quoted span plus the text around it, straight from text.md by the anchor's offsets. */
function passageBlocks(collection: string, anchor: Anchor, label: string): acp.ContentBlock[] {
  const uri = textUri(collection, anchor.source);
  const page = anchor.page ? ` (p.${anchor.page})` : "";
  const blocks: acp.ContentBlock[] = [embeddedText(`${uri}#quote`, `${label}${page}:\n${anchor.quote}`)];
  const full = readSourceText(collection, anchor.source);
  if (full && anchor.end > anchor.start && anchor.end <= full.length) {
    const before = full.slice(Math.max(0, anchor.start - CONTEXT_CHARS), anchor.start);
    const after = full.slice(anchor.end, anchor.end + CONTEXT_CHARS);
    blocks.push(text(`Surrounding text from text.md${page}:\n…${before}[[${anchor.quote}]]${after}…`));
  }
  blocks.push(resourceLink(uri, `sources/${anchor.source}/text.md`));
  return blocks;
}

/** Earlier messages, for a session that starts on a thread which already has history. */
function historyBlock(thread: Thread): acp.ContentBlock | null {
  if (thread.messages.length === 0) return null;
  const parts: string[] = [];
  for (const m of thread.messages) {
    const who = m.role === "user" ? "Reader" : m.role === "assistant" ? "You" : "Note";
    const quote = m.quote ? `[quoting p.${m.quote.page ?? "?"}: ${m.quote.quote}]\n` : "";
    parts.push(`${who}: ${quote}${m.body}`);
  }
  let joined = parts.join("\n\n");
  if (joined.length > HISTORY_CHARS) joined = "…" + joined.slice(-HISTORY_CHARS);
  return text(`Earlier in this thread (for context, do not repeat it):\n\n${joined}`);
}

/**
 * Prompt assembly (plan §5.5). `priorTurns` is the number of turns already sent on this session,
 * and `thread` is the thread as stored before the new user message was appended.
 */
export function buildPromptBlocks(
  collection: string,
  thread: Thread,
  body: string,
  quote: Anchor | undefined,
  priorTurns: number,
): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  if (priorTurns === 0) {
    blocks.push(text(PREAMBLE));
    const history = historyBlock(thread);
    if (history) blocks.push(history);
    if (thread.anchor?.target === "source") blocks.push(...passageBlocks(collection, thread.anchor, "The reader started this thread from this passage"));
  }
  if (quote && quote.target === "source") blocks.push(...passageBlocks(collection, quote, "The reader highlighted this passage"));
  const question = body.trim() || (quote ? "Explain this passage." : "");
  if (question) blocks.push(text(question));
  return blocks;
}
