import { useEffect, useRef, useState } from "react";
import type { FolderFile } from "@qrabbit/shared";
import { useStore } from "../state/store";
import { fmtSize } from "../lib/time";
import { Icon } from "./Icons";

const kindIcon = (kind: string) => (kind === "web" ? "globe" : kind === "markdown" ? "lines" : "file");
const dirOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "");

/** Pick which files from a scanned folder come into the collection. Everything new starts ticked. */
export function FolderDialog() {
  const scan = useStore((s) => s.folderScan);
  const busy = useStore((s) => s.folderBusy);
  const { closeFolder, rescanFolder, importFromFolder } = useStore.getState();
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [recursive, setRecursive] = useState(true);
  const known = useRef<{ root: string; paths: Set<string> } | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // A fresh scan ticks every new file. A rescan of the same folder keeps the reader's choices, including
  // for files that are hidden while subfolders are off, and ticks only files never shown before.
  useEffect(() => {
    if (!scan) {
      known.current = null;
      return;
    }
    const sameRoot = known.current?.root === scan.root;
    const seen = sameRoot ? known.current!.paths : new Set<string>();
    setTicked((prev) => {
      const next = sameRoot ? new Set(prev) : new Set<string>();
      for (const f of scan.files) if (!f.existing && (!sameRoot || !seen.has(f.path))) next.add(f.path);
      return next;
    });
    for (const f of scan.files) seen.add(f.path);
    known.current = { root: scan.root, paths: seen };
    if (!sameRoot) {
      setFilter("");
      setRecursive(true);
      window.setTimeout(() => filterRef.current?.focus(), 0);
    }
  }, [scan]);

  useEffect(() => {
    if (!scan) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); if (!busy) closeFolder(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [scan, busy, closeFolder]);

  if (!scan) return null;

  const q = filter.trim().toLowerCase();
  const visible = scan.files.filter((f) => !q || f.rel.toLowerCase().includes(q));
  const fresh = scan.files.filter((f) => !f.existing);
  const chosen = fresh.filter((f) => ticked.has(f.path));
  const bytes = chosen.reduce((n, f) => n + f.size, 0);
  const toggle = (f: FolderFile, on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(f.path);
      else next.delete(f.path);
      return next;
    });
  const setVisible = (on: boolean) =>
    setTicked((prev) => {
      const next = new Set(prev);
      for (const f of visible) if (!f.existing) { if (on) next.add(f.path); else next.delete(f.path); }
      return next;
    });
  const onRecursive = (on: boolean) => {
    setRecursive(on);
    void rescanFolder(on);
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) closeFolder(); }}>
      <div className="dialog folder" role="dialog" aria-modal="true" aria-label="Add from a folder">
        <div className="dhead">
          <h2>Add from a folder</h2>
          <span className="path" title={scan.root}>{scan.root}</span>
          <button className="btn icon" title="Close (Esc)" onClick={closeFolder} disabled={busy}><Icon name="x" /></button>
        </div>
        <div className="dtools">
          <label className="filter">
            <Icon name="search" />
            <input ref={filterRef} id="folder-filter" type="search" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <label className="switch">
            <input id="folder-recursive" type="checkbox" checked={recursive} disabled={busy} onChange={(e) => onRecursive(e.target.checked)} />
            Include subfolders
          </label>
        </div>
        <div className="dlist">
          {visible.length === 0 && <div className="dnote">{scan.files.length === 0 ? "No PDF, Markdown or text files here." : "Nothing matches the filter."}</div>}
          {visible.map((f) => (
            <label key={f.path} className={`frow ${f.existing ? "off" : ""}`}>
              <input type="checkbox" checked={!f.existing && ticked.has(f.path)} disabled={!!f.existing || busy} onChange={(e) => toggle(f, e.target.checked)} />
              <span className="kind"><Icon name={kindIcon(f.kind)} /></span>
              <span className="txt">
                <span className="t"><span className="dir">{dirOf(f.rel)}</span>{f.name}</span>
                {f.existing && <span className="m">Already in the collection as "{f.existing.title}"</span>}
              </span>
              <span className="meta">{fmtSize(f.size)}{f.existing && <span className="chip">in collection</span>}</span>
            </label>
          ))}
          {(scan.skipped > 0 || scan.truncated) && (
            <div className="dnote">
              {scan.truncated ? `Showing the first ${scan.files.length} files; the folder has more. ` : ""}
              {scan.skipped > 0 ? `${scan.skipped} other ${scan.skipped === 1 ? "file" : "files"} skipped (not PDF, Markdown or text). ` : ""}
              Files are copied; the folder is left as it is.
            </div>
          )}
        </div>
        <div className="dfoot">
          <span className="cnt">{chosen.length} of {fresh.length} new {fresh.length === 1 ? "file" : "files"} selected{chosen.length ? ` · ${fmtSize(bytes)}` : ""}</span>
          <button className="link" onClick={() => setVisible(true)} disabled={busy}>Select all</button>
          <button className="link" onClick={() => setVisible(false)} disabled={busy}>None</button>
          <button className="btn primary" disabled={busy || chosen.length === 0} onClick={() => void importFromFolder(chosen.map((f) => f.path))}>
            {busy ? <><span className="spin"><Icon name="spin" /></span>Working…</> : chosen.length ? `Add ${chosen.length} ${chosen.length === 1 ? "file" : "files"}` : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
