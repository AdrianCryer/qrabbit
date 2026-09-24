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
