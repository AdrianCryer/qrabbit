const paths: Record<string, string> = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  lines: "M4 6h16M4 12h10M4 18h7",
  branch: "M6 3v12M18 9a9 9 0 0 1-9 9M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  chevron: "m6 9 6 6 6-6",
  collapse: "m6 17 5-5-5-5M13 17l5-5-5-5",
  search: "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM20 20l-3.5-3.5",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  up: "M12 19V5M5 12l7-7 7 7",
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  terminal: "m4 17 6-6-6-6M12 19h8",
  check: "m5 12 5 5L20 7",
  spin: "M21 12a9 9 0 1 1-6.2-8.6",
  stop: "M7 7h10v10H7z",
  lock: "M3 11h18v10H3zM7 11V7a5 5 0 0 1 10 0v4",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L19 3.4M15 7l2 2",
  refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  comment: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2zM8 8h8M8 12h5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
};

export function Icon({ name, size }: { name: keyof typeof paths | string; size?: number }) {
  const d = paths[name] ?? "";
  const style = size ? { width: size, height: size } : undefined;
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={style}>
      <path d={d} />
    </svg>
  );
}
