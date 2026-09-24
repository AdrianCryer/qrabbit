import type { Thread, ThreadMeta } from "@qrabbit/shared";
import { readThread } from "@qrabbit/workspace";

export function childrenOf(all: ThreadMeta[], id: string): ThreadMeta[] {
  return all.filter((t) => t.parent?.thread === id).sort((a, b) => (a.created < b.created ? -1 : 1));
}

function subtreeLastActivity(collection: string, all: ThreadMeta[], id: string): string {
  let latest = "";
  const t = readThread(collection, id);
  for (const m of t?.messages ?? []) if (m.at > latest) latest = m.at;
  for (const c of childrenOf(all, id)) {
    const l = subtreeLastActivity(collection, all, c.id);
    if (l > latest) latest = l;
  }
  return latest;
}

const DIGEST_CHARS = 900;

/** What the parent is told about a branch: the cached summary when fresh, otherwise a mechanical digest. */
export function branchDigest(branch: Thread): string {
  const last = branch.messages[branch.messages.length - 1];
  if (branch.summary && last && branch.summary.through === last.id) {
    const tags = branch.summary.concepts.length ? ` (concepts: ${branch.summary.concepts.join(", ")})` : "";
    return `${branch.summary.text}${tags}`;
  }
  const firstUser = branch.messages.find((m) => m.role === "user");
  const lastAssistant = [...branch.messages].reverse().find((m) => m.role === "assistant");
  const parts: string[] = [];
  if (firstUser) parts.push(`They asked: ${firstUser.body.slice(0, 300)}`);
  if (lastAssistant) parts.push(`Latest answer: ${lastAssistant.body.slice(0, DIGEST_CHARS)}${lastAssistant.body.length > DIGEST_CHARS ? "…" : ""}`);
  return parts.join("\n") || "(no messages yet)";
}

/**
 * Direct children of `parent` with activity anywhere in their subtree since the parent last
 * received their digest (plan §5.5). "Last received" is the newest parent message whose
 * `context` names the child.
 */
export function dirtyBranches(collection: string, parent: Thread, all: ThreadMeta[]): Array<{ branch: Thread; digest: string }> {
  const out: Array<{ branch: Thread; digest: string }> = [];
  for (const child of childrenOf(all, parent.id)) {
    const lastActivity = subtreeLastActivity(collection, all, child.id);
    if (!lastActivity) continue;
    let lastTold = "";
    for (const m of parent.messages) if (m.context?.includes(child.id) && m.at > lastTold) lastTold = m.at;
    if (lastActivity <= lastTold) continue;
    const full = readThread(collection, child.id);
    if (!full) continue;
    out.push({ branch: full, digest: branchDigest(full) });
  }
  return out;
}
