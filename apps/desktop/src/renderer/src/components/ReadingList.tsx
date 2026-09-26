import { useEffect, useRef, useState } from "react";
import type { ReaderPosition, SourceInfo } from "@qrabbit/shared";
import { useStore } from "../state/store";
import { ago, relDay } from "../lib/time";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icons";

const kindIcon = (kind: string) => (kind === "web" ? "globe" : kind === "markdown" ? "lines" : "file");
const kindLabel = (s: SourceInfo) => (s.kind === "pdf" ? `PDF${s.pages ? ` · ${s.pages} pages` : ""}` : s.kind === "web" ? (s.siteName ?? s.url ?? "Web page") : "Markdown");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Where the reader left a source: last position, not pages seen. */
function progress(s: SourceInfo, pos: ReaderPosition | undefined): { text: string; muted: boolean } {
  if (s.read) return { text: `Read · ${relDay(s.read)}`, muted: false };
  if (!pos) return { text: "Not started", muted: true };
  if (s.kind === "pdf" && s.pages) return { text: `p. ${pos.page} of ${s.pages}`, muted: false };
  return { text: "Opened", muted: false };
}

type Drag = { id: string; over: string | null; before: boolean };

/** The collection as a list, in the reader pane: reading order, read marks, removal and the ways to add. */
export function ReadingList() {
  const collection = useStore((s) => s.collection);
  const { selectSource, toggleRead, removeSource, moveSource, setOrder, revealSource, importSources, addFromFolder, setUrlDialogOpen, dropFiles } = useStore.getState();
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const overDepth = useRef(0);
  const focusNext = useRef<string | null>(null);

  const sources = collection?.sources ?? [];

  // After a move the row keeps keyboard focus.
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    (document.querySelector(`.row[data-id="${CSS.escape(id)}"]`) as HTMLElement | null)?.focus();
  }, [sources]);

  if (!collection) return null;
  const readerState = collection.readerState;
  const roots = collection.threads.filter((t) => !t.parent);
  const readCount = sources.filter((s) => s.read).length;
  const threadCount = roots.length;

  // ----- drag to reorder: the row number is the handle -----
  const onGripDown = (e: React.PointerEvent<HTMLSpanElement>, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { id, over: null, before: true };
    setDrag(dragRef.current);
    document.body.classList.add("dragging");
  };
  const onGripMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".row") as HTMLElement | null;
    const overId = row?.dataset["id"] ?? null;
    if (!row || !overId || overId === d.id) d.over = null;
    else {
      const b = row.getBoundingClientRect();
      d.before = e.clientY < b.top + b.height / 2;
      d.over = overId;
    }
    setDrag({ ...d });
  };
  const onGripUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDrag(null);
    document.body.classList.remove("dragging");
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!d.over) return;
    const ids = sources.map((s) => s.id).filter((x) => x !== d.id);
    ids.splice(ids.indexOf(d.over) + (d.before ? 0 : 1), 0, d.id);
    focusNext.current = d.id;
    void setOrder(ids);
  };

  const onRowKey = (e: React.KeyboardEvent<HTMLLIElement>, s: SourceInfo) => {
    if (e.target !== e.currentTarget) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Enter") { e.preventDefault(); selectSource(s.id); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); void removeSource(s.id); }
    else if (mod && e.key === "ArrowUp") { e.preventDefault(); focusNext.current = s.id; void moveSource(s.id, -1); }
    else if (mod && e.key === "ArrowDown") { e.preventDefault(); focusNext.current = s.id; void moveSource(s.id, 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus(); }
    else if (e.key.toLowerCase() === "r" && !mod && !e.altKey) { e.preventDefault(); void toggleRead(s.id); }
  };

  // ----- files dropped from the OS -----
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  const onDragEnter = (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); overDepth.current++; setFileOver(true); };
  const onDragOver = (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; };
  const onDragLeave = (e: React.DragEvent) => { if (!hasFiles(e)) return; overDepth.current = Math.max(0, overDepth.current - 1); if (overDepth.current === 0) setFileOver(false); };
  const onDrop = (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); overDepth.current = 0; setFileOver(false); void dropFiles(Array.from(e.dataTransfer.files)); };

  const sortBy = (key: "title" | "added" | "unread") => {
    const next = [...sources];
    if (key === "title") next.sort((a, b) => a.title.localeCompare(b.title));
    else if (key === "added") next.sort((a, b) => (a.added < b.added ? -1 : a.added > b.added ? 1 : 0));
    else next.sort((a, b) => (a.read ? 1 : 0) - (b.read ? 1 : 0));
    void setOrder(next.map((s) => s.id));
  };

  const addItems = (close: () => void) => (
    <>
      <button className="mi" role="menuitem" onClick={() => { close(); void importSources(); }}>
        <Icon name="file" />
        <span className="txt"><span className="t">Files…</span><span className="m">PDF, Markdown or text</span></span>
        <span className="meta"><kbd>Ctrl</kbd><kbd>I</kbd></span>
      </button>
      <button className="mi" role="menuitem" onClick={() => { close(); void addFromFolder(); }}>
        <Icon name="folder" />
        <span className="txt"><span className="t">From a folder…</span><span className="m">Pick which files to bring in</span></span>
      </button>
      <button className="mi" role="menuitem" onClick={() => { close(); setUrlDialogOpen(true); }}>
        <Icon name="globe" />
        <span className="txt"><span className="t">Web page…</span><span className="m">Saved as reader-mode Markdown</span></span>
      </button>
    </>
  );

  return (
    <div className="reader">
      <section className="list" aria-label="Reading list" onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div className="col">
          <div className="lhead">
            <div>
              <h1>{collection.info.name}</h1>
              <p className="sub">{sources.length ? `${plural(sources.length, "source")} · ${readCount} read · ${plural(threadCount, "thread")}` : "No sources yet"}</p>
            </div>
            {sources.length > 0 && (
              <div className="lactions">
                <Dropdown align="right" triggerClass="btn quiet" title="Reorder once" label={<><Icon name="sort" />Order<Icon name="chevron" /></>}>
                  {(close) => (
                    <>
                      <div className="mh">Reorder once by</div>
                      <button className="mi" role="menuitem" onClick={() => { close(); sortBy("title"); }}><Icon name="lines" /><span className="txt"><span className="t">Title</span></span></button>
                      <button className="mi" role="menuitem" onClick={() => { close(); sortBy("added"); }}><Icon name="clock" /><span className="txt"><span className="t">Date added</span></span></button>
                      <button className="mi" role="menuitem" onClick={() => { close(); sortBy("unread"); }}><Icon name="check" /><span className="txt"><span className="t">Unread first</span></span></button>
                      <div className="msep" />
                      <div className="mnote">Drag a row's number to set the order by hand, or press <kbd>Ctrl</kbd><kbd>↑</kbd> / <kbd>Ctrl</kbd><kbd>↓</kbd> on a focused row. The order is saved in qrabbit.json.</div>
                    </>
                  )}
                </Dropdown>
                <Dropdown align="right" triggerClass="btn primary" title="Add sources" label={<><Icon name="plus" />Add<Icon name="chevron" /></>}>
                  {addItems}
                </Dropdown>
              </div>
            )}
          </div>

          {sources.length === 0 ? (
            <div className={`emptybox ${fileOver ? "over" : ""}`}>
              <h2>Nothing to read yet</h2>
              <p>Add papers, notes or web pages. Files are copied into this collection's folder, so it stays self-contained and travels with git or Obsidian.</p>
              <div className="addcards">
                <button className="addcard" onClick={() => void importSources()}><Icon name="file" /><b>Files</b><span>PDF, Markdown or text</span><kbd>Ctrl+I</kbd></button>
                <button className="addcard" onClick={() => void addFromFolder()}><Icon name="folder" /><b>From a folder</b><span>Pick which files to bring in</span></button>
                <button className="addcard" onClick={() => setUrlDialogOpen(true)}><Icon name="globe" /><b>Web page</b><span>Saved as reader-mode Markdown</span></button>
              </div>
              <div className="hint"><Icon name="drop" />Or drop files or a folder anywhere on this page.</div>
            </div>
          ) : (
            <ol className={`rows ${fileOver ? "over" : ""}`}>
              {sources.map((s, i) => {
                const p = progress(s, readerState[s.id]);
                const bits = [kindLabel(s)];
                const threads = roots.filter((t) => t.anchor?.source === s.id).length;
                const marks = collection.annotations.filter((a) => a.source === s.id).length;
                if (threads) bits.push(plural(threads, "thread"));
                if (marks) bits.push(plural(marks, "mark"));
                bits.push(`added ${ago(s.added)}`);
                const cls = ["row", drag?.id === s.id ? "dragging" : "", drag?.over === s.id ? (drag.before ? "drop-before" : "drop-after") : ""].filter(Boolean).join(" ");
                return (
                  <li key={s.id} className={cls} data-id={s.id} {...(s.read ? { "data-read": "" } : {})} tabIndex={0} aria-label={s.title} onKeyDown={(e) => onRowKey(e, s)}>
                    <span className="ord" title="Drag to reorder" onPointerDown={(e) => onGripDown(e, s.id)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp}>
                      <span>{i + 1}</span>
                      <Icon name="grip" />
                    </span>
                    <span className="kind"><Icon name={kindIcon(s.kind)} /></span>
                    <button className="txt" onClick={() => selectSource(s.id)} tabIndex={-1} title="Open where you left it">
                      <span className="t">{s.title}</span>
                      <span className="m">{bits.join(" · ")}</span>
                    </button>
                    <span className={`prog ${p.muted ? "new" : ""}`}>{p.text}</span>
                    <button className="done" aria-pressed={!!s.read} title={s.read ? "Mark as unread" : "Mark as read"} onClick={() => void toggleRead(s.id)} tabIndex={-1}>
                      <Icon name="check" />
                    </button>
                    <Dropdown align="right" triggerClass="more" title="More" label={<Icon name="more" />}>
                      {(close) => (
                        <>
                          <button className="mi" role="menuitem" onClick={() => { close(); selectSource(s.id); }}><Icon name="open" /><span className="txt"><span className="t">Open</span></span><span className="meta"><kbd>Enter</kbd></span></button>
                          <button className="mi" role="menuitem" onClick={() => { close(); void toggleRead(s.id); }}><Icon name="check" /><span className="txt"><span className="t">{s.read ? "Mark as unread" : "Mark as read"}</span></span><span className="meta"><kbd>R</kbd></span></button>
                          <div className="msep" />
                          <button className="mi" role="menuitem" onClick={() => { close(); focusNext.current = s.id; void moveSource(s.id, "top"); }}><Icon name="top" /><span className="txt"><span className="t">Move to top</span></span></button>
                          <button className="mi" role="menuitem" onClick={() => { close(); focusNext.current = s.id; void moveSource(s.id, "bottom"); }}><Icon name="bottom" /><span className="txt"><span className="t">Move to bottom</span></span></button>
                          <button className="mi" role="menuitem" onClick={() => { close(); revealSource(s.id); }}><Icon name="reveal" /><span className="txt"><span className="t">Show in folder</span><span className="m">sources/{s.id}/</span></span></button>
                          <div className="msep" />
                          <button className="mi danger" role="menuitem" onClick={() => { close(); void removeSource(s.id); }}><Icon name="trash" /><span className="txt"><span className="t">Remove from collection</span><span className="m">Threads and their quotes stay</span></span><span className="meta"><kbd>Del</kbd></span></button>
                        </>
                      )}
                    </Dropdown>
                  </li>
                );
              })}
            </ol>
          )}

          {sources.length > 0 && (
            <div className="hint">
              <Icon name="folder" />
              Each source is a folder under sources/. The order lives in qrabbit.json; a read mark is a date in the source's source.json. Removing a source keeps its threads.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
