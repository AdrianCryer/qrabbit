/**
 * A path as the reader should see it: under the home folder it reads `~\Documents\…` (or
 * `~/Documents/…`), the way editors show it, which is shorter and keeps the account name off screen.
 * Windows paths compare case-insensitively.
 */
export function displayPath(path: string, home: string): string {
  if (!home) return path;
  const windows = /^[a-zA-Z]:[\\/]/.test(home);
  const norm = (p: string) => (windows ? p.toLowerCase() : p);
  const h = home.replace(/[\\/]+$/, "");
  if (norm(path) === norm(h)) return "~";
  const next = path.charAt(h.length);
  if (norm(path).startsWith(norm(h)) && (next === "\\" || next === "/")) return `~${path.slice(h.length)}`;
  return path;
}
