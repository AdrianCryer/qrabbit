import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "./state/store";
import { api } from "./lib/api";
import { Header } from "./components/Header";
import { Home } from "./components/Home";
import { Reader } from "./components/Reader";
import { ThreadPanel } from "./components/ThreadPanel";
import { Toasts } from "./components/Toasts";
import { Icon } from "./components/Icons";

function ReaderPane() {
  const collection = useStore((s) => s.collection);
  const sourceId = useStore((s) => s.sourceId);
  const thread = useStore((s) => s.thread);
  const focusTarget = useStore((s) => s.focusTarget);
  const { importSources, explore, askHere, openThread, savePosition, updateSource, toast } = useStore.getState();
  if (!collection) return null;
  const source = collection.sources.find((s) => s.id === sourceId) ?? null;

  if (!source) {
    return (
      <div className="reader">
        <div className="empty">
          <div className="box">
            <h3>{collection.sources.length === 0 ? "This collection has no sources yet" : "Pick a source"}</h3>
            <p>Add a PDF or a Markdown file. Highlight anything in it and choose Explore to start a thread anchored to that passage.</p>
            <button className="btn primary" onClick={() => void importSources()}>
              <Icon name="plus" />
              Add sources
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (source.kind === "markdown") {
    return (
      <div className="reader">
        <div className="empty">
          <div className="box">
            <h3>{source.title}</h3>
            <p>Markdown sources open in the reader in a later step. For now, pick a PDF from the source switcher.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Reader
      key={source.id}
      collectionPath={collection.info.path}
      source={source}
      threads={collection.threads}
      position={collection.readerState[source.id]}
      focusedThreadId={thread?.id ?? null}
      focusTarget={focusTarget}
      canAskHere={!!thread}
      onPosition={(pos) => savePosition(source.id, pos)}
      onExplore={(anchor) => void explore(anchor)}
      onAskHere={askHere}
      onOpenThread={(id) => void openThread(id)}
      onTextExtracted={(text, pages, title) => {
        void api.sources
          .saveText(collection.info.path, source.id, text, pages, title)
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (useStore.getState().panelOpen) closePanel();
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
      <Toasts />
    </div>
  );
}
