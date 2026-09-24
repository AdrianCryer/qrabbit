import { useEffect } from "react";
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

export function App() {
  const platform = useStore((s) => s.platform);
  const screen = useStore((s) => s.screen);
  const panelOpen = useStore((s) => s.panelOpen);
  const focus = useStore((s) => s.focus);
  const { init, closePanel } = useStore.getState();

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
    <div className="app" data-platform={platform} data-panel={panelOpen} data-focus={focus}>
      <Header />
      {screen === "home" ? (
        <Home />
      ) : (
        <main className="main">
          <ReaderPane />
          {panelOpen && <ThreadPanel />}
        </main>
      )}
      <Toasts />
    </div>
  );
}
