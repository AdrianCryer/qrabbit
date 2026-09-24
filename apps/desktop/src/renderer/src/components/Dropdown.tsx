import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  /** Contents of the trigger pill. */
  label: ReactNode;
  align?: "left" | "right";
  className?: string;
  title?: string;
  /** Menu body. Receives a closer so items can dismiss the menu. */
  children: (close: () => void) => ReactNode;
};

/** A header pill that opens a glass menu below it. Closes on outside click and Escape. */
export function Dropdown({ label, align = "left", className, title, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`pop ${className ?? ""}`} ref={ref}>
      <button className="hpill" aria-expanded={open} aria-haspopup="menu" title={title} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className={`menu ${align === "right" ? "right" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
