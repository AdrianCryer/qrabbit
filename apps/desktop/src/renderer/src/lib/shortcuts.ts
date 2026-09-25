/**
 * One table drives the key handling and the Settings list. `keys` uses "Mod" for Ctrl on
 * Windows and Linux and ⌘ on macOS; other parts are KeyboardEvent.key values.
 */
export type Shortcut = { id: string; keys: string; label: string; group: string };

export const SHORTCUTS: Shortcut[] = [
  { id: "open", keys: "Mod+O", label: "Open a collection folder", group: "Collections" },
  { id: "home", keys: "Mod+Shift+H", label: "All collections", group: "Collections" },
  { id: "import", keys: "Mod+I", label: "Add sources to this collection", group: "Collections" },
  { id: "threads", keys: "Mod+Shift+T", label: "Threads in this collection", group: "Threads" },
  { id: "panel", keys: "Mod+B", label: "Show or hide the thread panel", group: "Threads" },
  { id: "focus", keys: "Mod+Shift+F", label: "Hide or show the paper", group: "Threads" },
  { id: "parent", keys: "Alt+ArrowUp", label: "Go to the parent thread", group: "Threads" },
  { id: "explore", keys: "E", label: "Explore the selection, in the paper or in an answer", group: "Selection" },
  { id: "ask", keys: "A", label: "Ask here with the selection", group: "Selection" },
  { id: "escape", keys: "Escape", label: "Clear the quote, then collapse the panel", group: "Selection" },
  { id: "send", keys: "Enter", label: "Send the message", group: "Composer" },
  { id: "newline", keys: "Shift+Enter", label: "New line in the message", group: "Composer" },
  { id: "zoomIn", keys: "Mod+=", label: "Zoom in", group: "Reader" },
  { id: "zoomOut", keys: "Mod+-", label: "Zoom out", group: "Reader" },
  { id: "zoomReset", keys: "Mod+0", label: "Fit the page to the width", group: "Reader" },
  { id: "zoomWheel", keys: "Mod+Wheel", label: "Zoom with the mouse wheel", group: "Reader" },
  { id: "settings", keys: "Mod+,", label: "Settings and shortcuts", group: "App" },
];

const KEY_LABELS: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", "=": "+", Wheel: "wheel", ",": "," };

export function formatKeys(keys: string, platform: string): string[] {
  const mac = platform === "darwin";
  return keys.split("+").map((k) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : k === "Alt" ? (mac ? "⌥" : "Alt") : k === "Shift" ? (mac ? "⇧" : "Shift") : (KEY_LABELS[k] ?? k)));
}

/** True when the event is exactly this chord (modifiers must match, so Mod+B does not fire on Mod+Shift+B). */
export function matches(e: KeyboardEvent | React.KeyboardEvent, keys: string): boolean {
  const parts = keys.split("+");
  const wantMod = parts.includes("Mod");
  const wantShift = parts.includes("Shift");
  const wantAlt = parts.includes("Alt");
  const key = parts[parts.length - 1]!;
  const mod = e.ctrlKey || e.metaKey;
  if (mod !== wantMod || e.shiftKey !== wantShift || e.altKey !== wantAlt) return false;
  if (key === "=") return e.key === "=" || e.key === "+";
  if (key.length === 1) return e.key.toLowerCase() === key.toLowerCase();
  return e.key === key;
}

export function shortcut(id: string): Shortcut {
  return SHORTCUTS.find((s) => s.id === id)!;
}

/** Whether a key event happened while typing, in which case single-letter shortcuts stay out of the way. */
export function isTyping(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
}
