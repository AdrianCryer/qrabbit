/**
 * Which paths inside a collection folder sync, and what a path may look like.
 *
 * The cloud applies the same rules in SQL (`is_valid_sync_path` in the migration), so a client cannot fill the
 * quota with trash or plant a path another operating system cannot write. `PATH_FIXTURES` drives both test
 * suites, so the two implementations cannot drift apart unnoticed.
 */

/** App state stays local, except the reading positions: "pick up where you left off" needs those. */
export const STATE_DIR = ".qrabbit";
export const STATE_SYNCED = `${STATE_DIR}/reader-state.json`;
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
const IGNORED_DIRS = new Set([".git", "node_modules"]);
/** Names Windows refuses in any folder, with or without an extension. */
const WINDOWS_DEVICES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
/** Control characters, the backslash and the characters Windows forbids in file names. */
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f\\<>:"|?*]/;

export const MAX_PATH_BYTES = 1024;

/**
 * Whether a path inside a collection is one the app syncs at all. Files the app can rebuild or that belong to one
 * machine (the trash, the index, temp files, OS clutter) stay local.
 */
export function isSyncedPath(path: string): boolean {
  const segments = path.split("/");
  const base = segments[segments.length - 1] ?? "";
  if (segments.some((s) => IGNORED_DIRS.has(s))) return false;
  if (IGNORED_NAMES.has(base) || base.endsWith(".tmp")) return false;
  if (path === STATE_DIR || path.startsWith(`${STATE_DIR}/`)) return path === STATE_SYNCED;
  return true;
}

/** Why a path cannot be stored in the cloud, or null when it can. Relative, forward slashes, writable on every OS. */
export function syncPathProblem(path: unknown): string | null {
  if (typeof path !== "string" || path.length === 0) return "empty path";
  if (new TextEncoder().encode(path).length > MAX_PATH_BYTES) return `longer than ${MAX_PATH_BYTES} bytes`;
  if (FORBIDDEN_CHARS.test(path)) return "contains a character some file systems refuse";
  if (path.startsWith("/")) return "absolute path";
  if (path.endsWith("/")) return "ends with a slash";
  if (path.includes("//")) return "empty segment";
  for (const seg of path.split("/")) {
    if (seg === "." || seg === "..") return "relative segment";
    if (seg.endsWith(".") || seg.endsWith(" ")) return "segment ends with a dot or a space";
    if (WINDOWS_DEVICES.test(seg.split(".")[0]!)) return "reserved device name";
  }
  if (!isSyncedPath(path)) return "not a synced path";
  return null;
}

export const isSyncPath = (path: unknown): path is string => syncPathProblem(path) === null;

/** Paths both implementations must accept and reject. */
export const PATH_FIXTURES = {
  ok: [
    "qrabbit.json",
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    "sources/attention-is-all-you-need/source.pdf",
    "sources/attention-is-all-you-need/source.json",
    "sources/attention-is-all-you-need/text.md",
    "sources/attention-is-all-you-need/annotations.json",
    "threads/2026-09-26-the-gap-widens.md",
    "threads/2026-09-26-the-gap-widens/why-the-gap.md",
    "notes/reading-plan.md",
    ".qrabbit/reader-state.json",
    "sources/ünïcödé-tïtle/source.md",
    "sources/日本語/source.pdf",
    "sources/a b/source c.pdf",
    "console.md",
    "sources/.hidden/source.md",
  ],
  bad: [
    "",
    "/qrabbit.json",
    "sources/",
    "sources//x/source.pdf",
    "../qrabbit.json",
    "sources/./source.pdf",
    "sources\\paper\\source.pdf",
    "sources/paper:1/source.pdf",
    "sources/what?/source.pdf",
    "sources/a*b/source.pdf",
    'sources/"quoted"/source.pdf',
    "sources/x|y/source.pdf",
    "sources/<paper>/source.pdf",
    "sources/paper./source.pdf",
    "sources/paper /source.pdf",
    "sources/con/source.pdf",
    "sources/paper/nul.txt",
    "sources/paper/COM1.md",
    "sources/paper/lpt9",
    "sources/paper/source.pdf.tmp",
    "sources/paper/source.json.1234.tmp",
    ".DS_Store",
    "sources/paper/Thumbs.db",
    "sources/paper/desktop.ini",
    ".git/config",
    "notes/node_modules/x.js",
    ".qrabbit",
    ".qrabbit/index.sqlite",
    ".qrabbit/trash/2026-09-26T10-00-00-000Z/paper/source.pdf",
    ".qrabbit/reader-state.json.tmp",
    "sources/paper/\u0007bell.pdf",
    "sources/paper/tab\there.pdf",
    "x".repeat(1025),
  ],
} as const;
