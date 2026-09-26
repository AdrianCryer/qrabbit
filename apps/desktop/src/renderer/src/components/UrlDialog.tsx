import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import { Icon } from "./Icons";

export function UrlDialog() {
  const open = useStore((s) => s.urlDialogOpen);
  const { setUrlDialogOpen, importUrl } = useStore.getState();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setError(null);
    setBusy(false);
    window.setTimeout(() => ref.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setUrlDialogOpen(false); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, setUrlDialogOpen]);

  if (!open) return null;

  const submit = async () => {
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await importUrl(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      setUrlDialogOpen(false);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setUrlDialogOpen(false); }}>
      <div className="dialog small" role="dialog" aria-modal="true" aria-label="Add a web page">
        <div className="dhead">
          <h2>Add a web page</h2>
          <button className="btn icon" title="Close (Esc)" onClick={() => setUrlDialogOpen(false)} disabled={busy}><Icon name="x" /></button>
        </div>
        <div className="dbody">
          <p className="dsub">The page is fetched once and reduced to its article text, saved into the collection as Markdown with the link kept. Read it, highlight it and explore it like a paper.</p>
          <form className="urlform" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <input ref={ref} type="url" value={url} placeholder="https://…" disabled={busy} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn primary" type="submit" disabled={busy || !url.trim()}>
              {busy ? <><span className="spin"><Icon name="spin" /></span>Fetching…</> : <><Icon name="globe" />Add</>}
            </button>
          </form>
          {error && <p className="err">{error}</p>}
        </div>
      </div>
    </div>
  );
}
