import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type * as acp from "@agentclientprotocol/sdk";
import { embeddedText, resourceLink, text } from "@qrabbit/acp-client";
import type { Anchor, Thread } from "@qrabbit/shared";
import { readSourceText } from "@qrabbit/workspace";

export const PREAMBLE =
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
  if (!anchor.source) return [text(`${label}:\n${anchor.quote}`)];
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
export function historyBlock(thread: Thread, intro = "Earlier in this thread (for context, do not repeat it)"): acp.ContentBlock | null {
  if (thread.messages.length === 0) return null;
  const parts: string[] = [];
  for (const m of thread.messages) {
    const who = m.role === "user" ? "Reader" : m.role === "assistant" ? "You" : "Note";
    const quote = m.quote ? `[quoting ${m.quote.page ? `p.${m.quote.page}` : "a passage"}: ${m.quote.quote}]\n` : "";
    parts.push(`${who}: ${quote}${m.body}`);
  }
  let joined = parts.join("\n\n");
  if (joined.length > HISTORY_CHARS) joined = "…" + joined.slice(-HISTORY_CHARS);
  return text(`${intro}:\n\n${joined}`);
}

/** The paragraph of a message body that contains the explored span. */
function paragraphAround(body: string, quote: string): string {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const target = norm(quote);
  for (const para of body.split(/\n{2,}/)) if (norm(para).includes(target)) return para.trim();
  return "";
}

/** What a branch's first turn carries when the parent's handoff exists, or a mechanical stand-in. */
export function branchIntroBlocks(parent: Thread, branch: Thread, handoff: string | undefined): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  const parentMsg = parent.messages.find((m) => m.id === branch.parent?.message);
  blocks.push(text(`This thread branches from a passage inside an earlier answer in the thread "${parent.title}". The reader wants to explore that passage on its own.`));
  if (handoff) blocks.push(text(`Handoff from the assistant in the parent thread:\n\n${handoff}`));
  else {
    const h = historyBlock(parent, "The parent thread so far (for context)");
    if (h) blocks.push(h);
  }
  if (branch.anchor) {
    const para = parentMsg ? paragraphAround(parentMsg.body, branch.anchor.quote) : "";
    blocks.push(text(`The passage being explored, from the parent's answer:\n${branch.anchor.quote}${para && para !== branch.anchor.quote ? `\n\nIts surrounding paragraph:\n${para}` : ""}`));
  }
  return blocks;
}

/** The hidden prompt that asks the parent session for a branch handoff (plan §5.5). */
export function handoffPrompt(selection: string): string {
  return (
    `The reader is about to explore "${selection}" in a separate thread. ` +
    "Write a handoff for a fresh assistant that has no access to this conversation: " +
    "(1) what this thread is about and which source passage it started from; " +
    "(2) what has been established so far, in 3–6 sentences; " +
    `(3) what "${selection}" means in the context of your answer, in 1–3 sentences; ` +
    "(4) what the reader already seems to understand and what they seem to be missing. " +
    "Reply with the handoff only."
  );
}

/** The hidden prompt that asks a branch session to summarise itself for its parent. */
export const SUMMARY_PROMPT =
  "Summarise what this thread has established, for someone who has not read it, in 2–3 sentences. " +
  "Then on a new line write `Tags:` followed by 1–5 short concept tags separated by commas. Reply with nothing else.";

export function parseSummary(reply: string): { text: string; concepts: string[] } {
  const m = /\n\s*tags?\s*:\s*(.+)$/i.exec(reply.trim());
  if (!m) return { text: reply.trim(), concepts: [] };
  const concepts = m[1]!.split(/[,;]/).map((s) => s.trim().replace(/^[-*]\s*/, "")).filter(Boolean).slice(0, 5);
  return { text: reply.slice(0, m.index).trim(), concepts };
}

/** Digests of branches active since the parent's last turn, attached ahead of the question. */
export function branchContextBlock(items: Array<{ title: string; digest: string }>): acp.ContentBlock | null {
  if (items.length === 0) return null;
  const lines = items.map((b) => `• The reader explored "${b.title}" in a branch. ${b.digest}`);
  return text(`Since your last turn, in branches of this thread:\n${lines.join("\n\n")}`);
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
  extras: { intro?: acp.ContentBlock[]; branchContext?: acp.ContentBlock | null } = {},
): acp.ContentBlock[] {
  const blocks: acp.ContentBlock[] = [];
  if (priorTurns === 0) {
    blocks.push(text(PREAMBLE));
    if (extras.intro) blocks.push(...extras.intro);
    const history = historyBlock(thread);
    if (history) blocks.push(history);
    if (thread.anchor?.target === "source") blocks.push(...passageBlocks(collection, thread.anchor, "The reader started this thread from this passage"));
  }
  if (extras.branchContext) blocks.push(extras.branchContext);
  if (quote && quote.target === "source") blocks.push(...passageBlocks(collection, quote, "The reader highlighted this passage"));
  const question = body.trim() || (quote ? "Explain this passage." : "");
  if (question) blocks.push(text(question));
  return blocks;
}
