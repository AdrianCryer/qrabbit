/** "now", "5 min", "3 h", "2 d", or a date for anything older than a week. */
export function relTime(iso?: string): string {
  if (!iso) return "";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days} d`;
  return new Date(iso).toLocaleDateString();
}

/** "just now", "5 min ago", "on 12/09/2026". */
export function ago(iso?: string): string {
  const r = relTime(iso);
  if (!r) return "";
  if (r === "now") return "just now";
  return /^\d+ (min|h|d)$/.test(r) ? `${r} ago` : `on ${r}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "today", "yesterday", a weekday inside the week, otherwise a date. */
export function relDay(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso);
  const now = new Date();
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return WEEKDAYS[then.getDay()]!;
  return then.toLocaleDateString();
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
