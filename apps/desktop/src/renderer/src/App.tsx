import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "./state/store";
import { api } from "./lib/api";
import { Header } from "./components/Header";
import { Home } from "./components/Home";
import { Reader } from "./components/Reader";
import { ReadingList } from "./components/ReadingList";
import { TextReader } from "./components/TextReader";
import { ThreadPanel } from "./components/ThreadPanel";
import { Toasts } from "./components/Toasts";
import { AgentChooser } from "./components/AgentChooser";
import { Settings } from "./components/Settings";
import { UrlDialog } from "./components/UrlDialog";
import { FolderDialog } from "./components/FolderDialog";
import { isTyping, matches } from "./lib/shortcuts";

function ReaderPane() {
  const collection = useStore((s) => s.collection);
  const sourceId = useStore((s) => s.sourceId);
  const thread = useStore((s) => s.thread);
  const focusTarget = useStore((s) => s.focusTarget);
  const { explore, askHere, openThread, savePosition, updateSource, toast, addBookmark, addComment, updateAnnotation, deleteAnnotation } = useStore.getState();
  if (!collection) return null;
  const source = collection.sources.find((s) => s.id === sourceId) ?? null;

  // No source open: the collection shows itself as a reading list.
  if (!source) return <ReadingList />;

  if (source.kind !== "pdf") {
    return (
      <TextReader
        key={source.id}
        collectionPath={collection.info.path}
        source={source}
        threads={collection.threads}
        annotations={collection.annotations}
        position={collection.readerState[source.id]}
        focusedThreadId={thread?.id ?? null}
        focusTarget={focusTarget}
        canAskHere={!!thread}
        onPosition={(pos) => savePosition(source.id, pos)}
        onExplore={(anchor) => void explore(anchor)}
        onAskHere={askHere}
        onOpenThread={(id) => void openThread(id)}
        onBookmark={(page, anchor) => void addBookmark(source.id, page, anchor)}
        onComment={(anchor, page, text) => void addComment(source.id, page, anchor, text)}
        onUpdateAnnotation={(id, text) => void updateAnnotation(id, text)}
        onDeleteAnnotation={(id) => void deleteAnnotation(id)}
      />
    );
  }

  return (
    <Reader
      key={source.id}
      collectionPath={collection.info.path}
      source={source}
      threads={collection.threads}
      annotations={collection.annotations}
      position={collection.readerState[source.id]}
      focusedThreadId={thread?.id ?? null}
      focusTarget={focusTarget}
      canAskHere={!!thread}
      onPosition={(pos) => savePosition(source.id, pos)}
      onExplore={(anchor) => void explore(anchor)}
      onAskHere={askHere}
      onOpenThread={(id) => void openThread(id)}
      onBookmark={(page, anchor) => void addBookmark(source.id, page, anchor)}
      onComment={(anchor, page, text) => void addComment(source.id, page, anchor, text)}
      onUpdateAnnotation={(id, text) => void updateAnnotation(id, text)}
      onDeleteAnnotation={(id) => void deleteAnnotation(id)}
      onTextExtracted={(text, pages, titles) => {
        void api.sources
          .saveText(collection.info.path, source.id, text, pages, titles)
          .then((info) => updateSource(info))
          .catch((err) => toast(`Could not save extracted text: ${String(err)}`));
      }}
    />
  );
}

const PANEL_KEY = "qrabbit:panel-width";
const PANEL_MIN = 320;
function readPanelWidth(): number {
  try {
    const v = Number(localStorage.getItem(PANEL_KEY));
    if (v >= PANEL_MIN) return v;
  } catch {
    /* ignore */
  }
  return 440;
}

/** Drag handle between the paper and the thread panel; the width is remembered per machine. */
function Divider({ onWidth }: { onWidth(w: number): void }) {
  const dragging = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("resizing");
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const max = Math.max(PANEL_MIN, Math.min(960, Math.floor(window.innerWidth * 0.7)));
    onWidth(Math.min(max, Math.max(PANEL_MIN, Math.round(window.innerWidth - e.clientX - 16))));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("resizing");
  };
  return <div className="divider" role="separator" aria-orientation="vertical" title="Drag to resize" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />;
}

export function App() {
  const platform = useStore((s) => s.platform);
  const screen = useStore((s) => s.screen);
  const panelOpen = useStore((s) => s.panelOpen);
  const focus = useStore((s) => s.focus);
  const { init, closePanel } = useStore.getState();
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const onWidth = useCallback((w: number) => {
    setPanelWidth(w);
    try {
      localStorage.setItem(PANEL_KEY, String(w));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void init();
  }, [init]);

  // Global shortcuts. Single-letter ones live where the selection is (Reader, ThreadPanel, ReadingList).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (matches(e, "Mod+,")) { e.preventDefault(); s.setSettingsOpen(!s.settingsOpen); return; }
      if (s.settingsOpen || s.folderScan || s.agentChosen === false) return;
      if (matches(e, "Mod+O")) { e.preventDefault(); void s.openCollectionDialog(); return; }
      if (matches(e, "Mod+Shift+H")) { e.preventDefault(); s.goHome(); return; }
      if (s.screen !== "reader") return;
      if (matches(e, "Mod+I")) { e.preventDefault(); void s.importSources(); return; }
      if (matches(e, "Mod+L")) { e.preventDefault(); s.toggleList(); return; }
      if (matches(e, "Mod+Shift+T")) { e.preventDefault(); s.setMenu(s.menu === "threads" ? null : "threads"); return; }
      if (matches(e, "Mod+Shift+M")) { e.preventDefault(); s.setMenu(s.menu === "marks" ? null : "marks"); return; }
      if (matches(e, "Mod+B")) { e.preventDefault(); s.togglePanel(); return; }
      if (matches(e, "Mod+Shift+F")) { e.preventDefault(); if (s.panelOpen) s.setFocus(!s.focus); return; }
      if (matches(e, "Alt+ArrowUp")) { e.preventDefault(); void s.openParent(); return; }
      if (e.key === "Escape" && !isTyping(e)) {
        if (s.menu) { s.setMenu(null); return; }
        if (s.panelOpen) closePanel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closePanel]);

  return (
    <div className="app" data-platform={platform} data-panel={panelOpen} data-focus={focus} style={{ "--panel-w": `${panelWidth}px` } as React.CSSProperties}>
      <Header />
      {screen === "home" ? (
        <Home />
      ) : (
        <main className="main">
          <ReaderPane />
          {panelOpen && <Divider onWidth={onWidth} />}
          {panelOpen && <ThreadPanel />}
        </main>
      )}
      <Settings />
      <AgentChooser />
      <UrlDialog />
      <FolderDialog />
      <Toasts />
    </div>
  );
}
