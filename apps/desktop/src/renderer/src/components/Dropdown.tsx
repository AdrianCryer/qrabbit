import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  /** Contents of the trigger. */
  label: ReactNode;
  align?: "left" | "right";
  /** Open above the trigger instead of below (for menus near the bottom edge). */
  up?: boolean;
  className?: string;
  /** Class for the trigger button; defaults to the header pill. */
  triggerClass?: string;
  title?: string;
  disabled?: boolean;
  /** Controlled mode, so a shortcut can open the menu. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** Menu body. Receives a closer so items can dismiss the menu. */
  children: (close: () => void) => ReactNode;
};

/** A trigger that opens a glass menu. Closes on outside click and Escape. */
export function Dropdown({ label, align = "left", up = false, className, triggerClass = "hpill", title, disabled, open: openProp, onOpenChange, children }: Props) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => {
    if (!controlled) setOpenState(v);
    onOpenChange?.(v);
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className={`pop ${className ?? ""}`} ref={ref}>
      <button className={triggerClass} aria-expanded={open} aria-haspopup="menu" title={title} disabled={disabled} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className={`menu ${align === "right" ? "right" : ""} ${up ? "up" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
